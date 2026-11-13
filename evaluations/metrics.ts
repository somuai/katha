import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export type Verdict =
  "supported" | "unsupported" | "unverifiable" | "inference";
export interface EvaluationRow {
  id: string;
  model: string;
  completionMs?: number;
  firstUsefulMs?: number | null;
  quotaMs?: number;
  error?: string;
  snapshot?: {
    status?: string;
    answer?: string;
    error?: string | null;
    trace?: { modelFallback?: { generatedAnswer?: boolean } };
    sources?: { id: string; content?: string }[];
  };
  review?: {
    reviewed?: boolean;
    taskSuccess?: boolean;
    abstained?: boolean;
    factualAnswer?: boolean;
    claims?: { text?: string; verdict?: string; evidenceIds?: string[] }[];
  };
}
export interface EvaluationRun {
  models?: string[];
  expectedCaseIds?: string[];
  results: EvaluationRow[];
}
const verdicts = new Set<string>([
  "supported",
  "unsupported",
  "unverifiable",
  "inference",
]);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b),
    mid = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[mid]
    : (ordered[mid - 1] + ordered[mid]) / 2;
}
export function summarizeEvaluation(
  run: EvaluationRun,
  options: { expectedCaseIds?: string[]; target?: number } = {},
) {
  if (!Array.isArray(run.results))
    throw Error("Evaluation results must be an array.");
  const target = options.target ?? 0.9;
  if (!Number.isFinite(target) || target < 0 || target > 1)
    throw Error("Target must be between zero and one.");
  if (
    run.results.some(
      (r) =>
        !r ||
        typeof r.id !== "string" ||
        !r.id ||
        typeof r.model !== "string" ||
        !r.model,
    )
  )
    throw Error("Every result needs a nonempty case ID and model name.");
  const declaredCases = options.expectedCaseIds ?? run.expectedCaseIds;
  const expectedCaseSetDeclared =
    Array.isArray(declaredCases) && declaredCases.length > 0;
  const expected = [...new Set(declaredCases || run.results.map((r) => r.id))];
  const models = [
    ...new Set([...(run.models || []), ...run.results.map((r) => r.model)]),
  ].map((model) => {
    const selected = run.results.filter((r) => r.model === model),
      seen = new Map<string, EvaluationRow>(),
      duplicates = new Set<string>();
    for (const row of selected) {
      if (seen.has(row.id)) duplicates.add(row.id);
      else seen.set(row.id, row);
    }
    const missingCaseIds = expected.filter((id) => !seen.has(id));
    const rows = expected
      .map((id) => seen.get(id))
      .filter((r): r is EvaluationRow => !!r);
    const counts = {
      supported: 0,
      unsupported: 0,
      unverifiable: 0,
      inference: 0,
    };
    let executionCompleted = 0,
      answered = 0,
      reviewed = 0,
      taskSuccess = 0,
      abstentions = 0,
      factualAnswerCases = 0,
      evidenceOnlyCases = 0,
      executionErrorCases = 0;
    const wall: number[] = [],
      active: number[] = [],
      first: number[] = [],
      quota: number[] = [],
      terminal: number[] = [];
    for (const row of rows) {
      const completed =
        !row.error &&
        ["COMPLETED", "PARTIAL"].includes(row.snapshot?.status || "");
      if (completed) executionCompleted++;
      const usable = completed && !!row.snapshot?.answer?.trim();
      const evidenceOnly =
        row.snapshot?.trace?.modelFallback?.generatedAnswer === false;
      if (evidenceOnly) evidenceOnlyCases++;
      if (
        row.error ||
        row.snapshot?.error ||
        ["FAILED", "CANCELLED", "INTERRUPTED"].includes(
          row.snapshot?.status || "",
        )
      )
        executionErrorCases++;
      if (finite(row.completionMs)) terminal.push(row.completionMs);
      if (usable) {
        answered++;
        if (!evidenceOnly && finite(row.completionMs)) {
          wall.push(row.completionMs);
          const waiting = row.quotaMs;
          if (finite(waiting) && waiting <= row.completionMs) {
            quota.push(waiting);
            active.push(row.completionMs - waiting);
          }
          const useful =
            row.firstUsefulMs === undefined
              ? row.completionMs
              : row.firstUsefulMs;
          if (finite(useful) && useful <= row.completionMs) first.push(useful);
        }
      }
      const review = row.review;
      const retainedEvidence = new Set(
        (row.snapshot?.sources || [])
          .filter((s) => typeof s.content === "string" && s.content.trim())
          .map((s) => s.id),
      );
      const completeReview =
        review?.reviewed === true &&
        typeof review.taskSuccess === "boolean" &&
        Array.isArray(review.claims) &&
        (review.claims.length > 0 ||
          (review.abstained === true && review.factualAnswer === false) ||
          (!usable &&
            review.taskSuccess === false &&
            review.abstained === false &&
            review.factualAnswer === false)) &&
        review.claims.every(
          (c) =>
            c &&
            typeof c.text === "string" &&
            !!c.text.trim() &&
            typeof c.verdict === "string" &&
            verdicts.has(c.verdict) &&
            (c.verdict !== "supported" ||
              (Array.isArray(c.evidenceIds) &&
                c.evidenceIds.length > 0 &&
                c.evidenceIds.every(
                  (id) => typeof id === "string" && retainedEvidence.has(id),
                ))),
        );
      if (!completeReview) continue;
      reviewed++;
      if (usable && !evidenceOnly && review.taskSuccess) taskSuccess++;
      if (review.abstained === true) abstentions++;
      // An empty/error result cannot earn factual support through fabricated review claims.
      if (!usable || evidenceOnly) continue;
      let factual = false;
      for (const claim of review.claims!) {
        counts[claim.verdict as Verdict]++;
        if (claim.verdict !== "inference") factual = true;
      }
      if (factual) factualAnswerCases++;
    }
    const factual = counts.supported + counts.unsupported + counts.unverifiable;
    const precision = factual ? counts.supported / factual : null;
    const completeRun =
      expected.length > 0 && !missingCaseIds.length && !duplicates.size;
    const allReviewsComplete = completeRun && reviewed === expected.length;
    const claimSupportGate = !completeRun
      ? "INCOMPLETE_RUN"
      : !allReviewsComplete
        ? "NOT_REVIEWED"
        : executionErrorCases || evidenceOnlyCases
          ? "EXECUTION_LIMITED"
          : precision === null
            ? "NO_FACTUAL_CLAIMS"
            : !expectedCaseSetDeclared
              ? "CASE_SET_UNDECLARED"
              : precision >= target
                ? "PASSED"
                : "BELOW_TARGET";
    return {
      model,
      expectedCases: expected.length,
      recordedCases: rows.length,
      missingCaseIds,
      duplicateCaseIds: [...duplicates],
      executionCompleted,
      executionErrorCases,
      evidenceOnlyCases,
      answered,
      answerCoverage: expected.length ? answered / expected.length : 0,
      reviewedCases: reviewed,
      reviewCoverage: expected.length ? reviewed / expected.length : 0,
      taskSuccesses: taskSuccess,
      taskSuccessRate: allReviewsComplete
        ? taskSuccess / expected.length
        : null,
      abstentions,
      factualAnswerCases,
      claims: { ...counts, factual, precision },
      claimSupportGate,
      latency: {
        medianAnswerCompletionMs: median(wall),
        medianActiveCompletionMs: median(active),
        medianFirstUsefulMs: median(first),
        medianQuotaMs: median(quota),
        medianTerminalMs: median(terminal),
        answerSamples: wall.length,
        firstUsefulSamples: first.length,
      },
    };
  });
  return {
    target,
    expectedCaseSetDeclared,
    scope:
      "All reviewed usable answers in the supplied end-to-end run. No production accuracy or model-only accuracy is inferred.",
    definitions: {
      claimPrecision:
        "supported / (supported + unsupported + unverifiable), reviewed usable answers only; inference excluded",
      taskSuccess:
        "Explicit reviewed taskSuccess labels; not inferred from terminal status or keyword checks",
      latency:
        "Useful-answer medians exclude failed, cancelled, empty and evidence-only fallback responses; quota waits are reported separately",
    },
    models,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const input = process.argv[2];
  if (!input)
    throw Error(
      "Usage: npx tsx evaluations/metrics.ts INPUT.json [OUTPUT.json] [CASES.json]",
    );
  const casesPath = process.argv[4];
  const expectedCaseIds = casesPath
    ? JSON.parse(await readFile(casesPath, "utf8")).cases.map(
        (c: { id: string }) => c.id,
      )
    : undefined;
  const report = summarizeEvaluation(
    JSON.parse(await readFile(input, "utf8")),
    { expectedCaseIds },
  );
  const json = JSON.stringify(report, null, 2) + "\n";
  if (process.argv[3]) await writeFile(process.argv[3], json);
  else process.stdout.write(json);
}
