import {
  inlineSourceIds,
  sourceIdPattern,
} from "../src/core/citation-markers.js";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import "dotenv/config";
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rm,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createKatha,
  type ModelAdapter,
  type Source,
  type SearchResult,
} from "../src/core/index.ts";
import {
  createKathaAdapters,
  createProviders,
} from "../src/providers/index.ts";
import { validateProviderSetup } from "../src/providers/setup.ts";
const fixture = JSON.parse(
  await readFile(new URL("./answer-cases.json", import.meta.url), "utf8"),
);
if (fixture.cases.length !== 40) throw Error("Expected 40 distinct cases");
const requestedCaseIds = process.env.EVAL_CASE_IDS?.split(",")
  .map((id) => id.trim())
  .filter(Boolean);
if (requestedCaseIds) {
  if (
    !requestedCaseIds.length ||
    requestedCaseIds.some((id) => !fixture.cases.some((c: any) => c.id === id))
  )
    throw Error("EVAL_CASE_IDS must name existing cases.");
  fixture.cases = fixture.cases.filter((c: any) =>
    requestedCaseIds.includes(c.id),
  );
}
if (!process.argv.includes("--run-live")) {
  console.log(
    `${fixture.cases.length} selected full-turn cases; pass --run-live to consume Groq/Tavily quota. A subset is not the full release gate.`,
  );
  process.exit(0);
}
const models = (
  process.env.EVAL_MODELS ||
  `${process.env.GROQ_MODEL || "qwen/qwen3.8-27b"},openai/gpt-oss-120b`
).split(",");
const output =
  process.env.EVAL_OUTPUT || `data/evaluations/answers-${Date.now()}`;
const sharedCaptureDirectory = process.env.EVAL_CAPTURE_DIR;
async function loadJSON(path: string, fallback: any) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e: any) {
    if (e.code === "ENOENT") return fallback;
    throw new Error(`Cannot resume corrupt file ${path}: ${e.message}`);
  }
}
async function saveJSON(path: string, value: unknown) {
  const tmp = path + "." + randomUUID() + ".tmp";
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, path);
}
const engineFiles = execFileSync(
  "git",
  [
    "ls-files",
    "src",
    "evaluations/answers.ts",
    "evaluations/answer-cases.json",
  ],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean);
const engineHash = createHash("sha256");
for (const f of engineFiles) engineHash.update(f).update(await readFile(f));
const identity = {
  fixtureHash: createHash("sha256")
    .update(JSON.stringify(fixture))
    .digest("hex"),
  implementationHash: engineHash.digest("hex"),
  models,
  temperature: 0,
  maxOutputTokens: 1000,
  node: process.versions.node,
  ...(sharedCaptureDirectory
    ? {
        sharedCaptureHash: createHash("sha256")
          .update(
            JSON.stringify(
              await loadJSON(
                join(sharedCaptureDirectory, "captured.json"),
                null,
              ),
            ),
          )
          .digest("hex"),
      }
    : {}),
};
await mkdir(output, { recursive: true });
const existingManifest = await loadJSON(join(output, "manifest.json"), null);
if (
  existingManifest &&
  JSON.stringify(existingManifest.identity) !== JSON.stringify(identity)
)
  throw new Error(
    "Run identity changed. Use a fresh EVAL_OUTPUT; incompatible experiments cannot be resumed.",
  );
await saveJSON(join(output, "manifest.json"), {
  identity,
  revision: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  startedAt: existingManifest?.startedAt || new Date().toISOString(),
});
console.log("Output:", output);
const options = {
  groqKey: process.env.GROQ_API_KEY,
  tavilyKey: process.env.TAVILY_API_KEY,
};
if (!options.groqKey || !options.tavilyKey)
  throw Error("Both server keys are required.");
let activeWireRequests: Record<string, unknown>[] = [];
const adapters = new Map<string, ReturnType<typeof createKathaAdapters>>();
for (const model of models) {
  const status = await validateProviderSetup({ ...options, model }, false);
  if (status.groq.availability !== "available")
    throw Error(`Unavailable configured candidate ${model}`);
  adapters.set(
    model,
    createKathaAdapters({
      ...options,
      model,
      fetcher: async (url, init) => {
        const request = JSON.parse(String(init?.body || "{}"));
        const system = String(request.messages?.[0]?.content || "");
        const record: Record<string, unknown> = {
          phase: system.startsWith("Plan a temporal")
            ? "planning"
            : system.startsWith("Review source qualifications")
              ? "qualification_review"
              : "generation",
          maxTokens: request.max_tokens,
        };
        activeWireRequests.push(record);
        try {
          const response = await fetch(url, init);
          record.status = response.status;
          const body = await response
            .clone()
            .json()
            .catch(() => ({}));
          record.usage = body.usage
            ? {
                inputTokens: body.usage.prompt_tokens,
                outputTokens: body.usage.completion_tokens,
                totalTokens: body.usage.total_tokens,
              }
            : undefined;
          record.finishReason = body.choices?.[0]?.finish_reason;
          if (record.phase === "generation" && response.ok) {
            try {
              const visible = String(body.choices?.[0]?.message?.content || "")
                .replace(/^\`\`\`(?:json)?\s*/, "")
                .replace(/\s*\`\`\`$/, "");
              const answer = JSON.parse(visible);
              record.generatedCitationCount = Array.isArray(answer.citations)
                ? answer.citations.length
                : null;
              record.explicitCitationIds = Array.isArray(answer.citations)
                ? answer.citations.filter(
                    (id: unknown) =>
                      typeof id === "string" &&
                      new RegExp("^" + sourceIdPattern + "$", "i").test(id),
                  )
                : [];
              record.inlineCitationIds =
                typeof answer.text === "string"
                  ? inlineSourceIds(answer.text)
                  : [];
            } catch {
              record.citationDiagnosticDecoded = false;
            }
          }
          if (record.phase === "qualification_review")
            record.visibleReview = String(
              body.choices?.[0]?.message?.content || "",
            ).replaceAll(options.groqKey!, "[REDACTED]");
          return response;
        } catch (error) {
          record.transportFailure = true;
          throw error;
        }
      },
    }),
  );
}
// Capture actual search observations once, independently of candidate planning.
let captured: Record<string, SearchResult[]> = {};
captured = await loadJSON(join(output, "captured.json"), {});
if (sharedCaptureDirectory) {
  const shared = await loadJSON(
    join(sharedCaptureDirectory, "captured.json"),
    null,
  );
  if (
    !shared ||
    fixture.cases.some(
      (c: any) => c.kind === "web" && !Array.isArray(shared[c.id]),
    )
  )
    throw Error(
      "Shared capture is missing selected web evidence; refusing to replace it with a new search.",
    );
  captured = shared;
  await saveJSON(join(output, "captured.json"), captured);
}
const captureOutcomes: Record<string, any> = await loadJSON(
  join(output, "capture-outcomes.json"),
  {},
);
if (sharedCaptureDirectory) {
  Object.assign(
    captureOutcomes,
    await loadJSON(join(sharedCaptureDirectory, "capture-outcomes.json"), {}),
  );
  await saveJSON(join(output, "capture-outcomes.json"), captureOutcomes);
}
const search = createProviders(options);
for (const c of fixture.cases.filter((c: any) => c.kind === "web")) {
  if (captured[c.id]) {
    if (!captureOutcomes[c.id])
      captureOutcomes[c.id] = {
        status: "legacy_outcome_unknown",
        errors: null,
      };
    continue;
  }
  const results = await search.search([{ query: c.query }], undefined, false);
  captureOutcomes[c.id] = {
    status: results.some((r) => r.error) ? "failed" : "succeeded",
    errors: results
      .filter((r) => r.error)
      .map((r) => ({ query: r.query, error: r.error })),
    observedAt: new Date().toISOString(),
  };
  captured[c.id] = results
    .flatMap((r) => r.evidence)
    .map((e) => ({
      title: e.title,
      url: e.url!,
      content: e.text,
      observedAt: e.observedAt,
      publishedAt: e.publishedAt,
    }));
  await saveJSON(join(output, "captured.json"), captured);
  await saveJSON(join(output, "capture-outcomes.json"), captureOutcomes);
  console.log("Captured", c.id, captured[c.id].length, "results");
}
const results: any[] = [];
const previous = await loadJSON(join(output, "results.json"), {
  identity,
  results: [],
});
if (JSON.stringify(previous.identity) !== JSON.stringify(identity))
  throw new Error("Saved result identity differs; start a fresh run.");
results.push(...previous.results);
for (const c of fixture.cases)
  for (const model of models) {
    if (results.some((r) => r.id === c.id && r.model === model)) continue;
    activeWireRequests = [];
    const directory = await mkdtemp(join(tmpdir(), "katha-answer-"));
    let clock = "2026-11-03T12:00:00Z";
    const adapter = adapters.get(model)!;
    const evidence: SearchResult[] =
      c.kind === "web"
        ? captured[c.id]
        : c.web
          ? [
              {
                title: "Labelled synthetic vendor fixture",
                url: `https://fixture.invalid/${c.id}`,
                content: c.web,
                observedAt: "2026-11-12T06:00:00Z",
              },
            ]
          : [];
    const recordingModel: ModelAdapter = {
      plan: adapter.model.plan,
      async generate(context) {
        const result = await adapter.model.generate(context);
        return result;
      },
    };
    const app = createKatha({
      directory,
      clock: () => new Date(clock),
      model: recordingModel,
      search: {
        async search() {
          if (captureOutcomes[c.id]?.status === "failed")
            throw Error(
              "Captured search failed: " +
                JSON.stringify(captureOutcomes[c.id].errors),
            );
          if (c.scenario === "failed")
            throw Error("Deliberate captured search failure");
          return evidence;
        },
      },
      activeTimeoutMs: 60000,
    });
    let baselineId: string | undefined;
    try {
      if (c.history) {
        const imported = await app.evidence.import({
          name: "Synthetic original record",
          content: c.history,
          occurredAt: "2026-11-03",
          timezone: "UTC",
        });
        baselineId = imported.sourceId;
        if (c.correction) {
          const inspected = await app.evidence.inspect(baselineId);
          await app.evidence.correct({
            sourceId: baselineId,
            assertionId:
              c.correction.assertion === undefined
                ? undefined
                : inspected.assertions[c.correction.assertion].id,
            content: c.correction.text,
            mode: c.correction.mode || "CHANGE_FROM_NOW",
            effectiveAt: c.correction.effectiveAt,
          });
        }
        if (c.deleteHistory) await app.evidence.trash(baselineId);
      }
      clock = "2026-11-12T12:00:00Z";
      const chat = await app.workspace.createConversation(
        "Isolated evaluation",
      );
      const started = performance.now();
      let firstUsefulMs: number | undefined;
      let quotaMs = 0,
        quotaStart: number | undefined;
      const receipt = await app.turns.start({
        conversationId: chat.id,
        clientRequestId: c.id,
        expectedTailId: null,
        text: c.question,
        timezone: "UTC",
      });
      for await (const event of app.turns.events(receipt.turnId)) {
        if (event.type === "delta" && firstUsefulMs === undefined)
          firstUsefulMs = performance.now() - started;
        if (event.type === "status") {
          const status = (event.data as any)?.status;
          if (status === "WAITING_FOR_QUOTA") quotaStart ??= performance.now();
          else if (quotaStart !== undefined) {
            quotaMs += performance.now() - quotaStart;
            quotaStart = undefined;
          }
        }
        if (event.type === "complete") break;
      }
      const snapshot = await app.turns.get(receipt.turnId);
      const completionMs = performance.now() - started;
      if (quotaStart !== undefined) quotaMs += performance.now() - quotaStart;
      const text = snapshot.answer.toLowerCase();
      const assertions = {
        includes: (c.mustInclude || []).map((t: string) => ({
          text: t,
          pass: text.includes(t.toLowerCase()),
        })),
        excludes: (c.mustNotInclude || []).map((t: string) => ({
          text: t,
          pass: !text.includes(t.toLowerCase()),
        })),
        expectedStatus: c.expectedStatus || null,
        statusMatches:
          !c.expectedStatus ||
          snapshot.comparisons.some((v) => v.status === c.expectedStatus),
      };
      results.push({
        id: c.id,
        kind: c.kind,
        model,
        runAt: new Date().toISOString(),
        wireRequests: structuredClone(activeWireRequests),
        baselineId,
        completionMs,
        firstUsefulMs:
          snapshot.answer.trim() &&
          ["COMPLETED", "PARTIAL"].includes(snapshot.status)
            ? (firstUsefulMs ?? completionMs)
            : null,
        quotaMs,
        assertions,
        snapshot,
        review: {
          claims: [],
          reviewed: false,
          notes:
            "Requires claim-by-claim evidence review. Matching keywords is not claim support.",
        },
      });
      console.log(
        model,
        c.id,
        snapshot.status,
        Math.round(completionMs) + "ms",
        snapshot.error || "",
      );
    } catch (error) {
      results.push({
        id: c.id,
        kind: c.kind,
        model,
        error: error instanceof Error ? error.message : String(error),
        wireRequests: structuredClone(activeWireRequests),
        review: { reviewed: false, claims: [] },
      });
      console.log("ERROR", model, c.id, String(error));
    } finally {
      app.close();
      await rm(directory, { recursive: true, force: true });
    }
    await saveJSON(join(output, "results.json"), {
      identity,
      label: requestedCaseIds
        ? `Targeted subset (${fixture.cases.length}/40), not a full release gate. ${fixture.label}`
        : fixture.label,
      expectedCaseIds: fixture.cases.map((c: any) => c.id),
      ...(sharedCaptureDirectory
        ? {
            reusedEvidence:
              "Shared captured observations retain their original dates; this is not fresh live web discovery.",
          }
        : {}),
      models,
      captureOutcomes,
      gate: "Unreviewed: no supported-claim accuracy is inferred from keyword checks.",
      results,
    });
  }
console.log(
  "Full-turn evaluation complete. Review each claim before computing support precision.",
);
