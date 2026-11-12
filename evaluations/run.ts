import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createKatha } from "../src/core/index.ts";
import { createLocalEmbedder } from "../src/ingestion/embeddings.ts";
const fixtures = JSON.parse(
  await readFile(new URL("./recall-cases.json", import.meta.url), "utf8"),
);
if (fixtures.cases.length !== 40) throw Error("Expected forty fixtures");
const report: any = {
  label: fixtures.label,
  runAt: new Date().toISOString(),
  metric:
    "Expected original source in top 5; no answer-generation accuracy claim",
  notMeasured: [
    "supported-claim precision",
    "dated-change precision",
    "live provider latency",
  ],
  runs: [],
};
const embedder = createLocalEmbedder(resolve("data/models"));
try {
  for (const strategy of ["recent", "lexical", "hybrid"] as const) {
    const directory = await mkdtemp(join(tmpdir(), "katha-eval-"));
    const app = createKatha({
      directory,
      retrievalStrategy: strategy,
      embedder: strategy === "hybrid" ? embedder : undefined,
      clock: () => new Date("2026-11-12T12:00:00Z"),
    });
    try {
      const ids = new Map<string, string>();
      for (const s of fixtures.sources) {
        const receipt = await app.evidence.import({
          name: s.id,
          content: s.text,
          occurredAt: s.date,
          timezone: "UTC",
        });
        ids.set(s.id, receipt.sourceId);
      }
      // Deliberate recent-context distractors, shared in every arm.
      for (let i = 0; i < 10; i++)
        await app.evidence.import({
          name: `distractor-${i}`,
          content: `Unrelated personal shopping list number ${i}: oranges, coffee and paper towels.`,
          occurredAt: "2026-11-12",
        });
      if (strategy === "hybrid") {
        const deadline = Date.now() + 180000;
        while (Date.now() < deadline) {
          const inspections = await Promise.all(
            [...ids.values()].map((id) => app.evidence.inspect(id)),
          );
          if (
            inspections.every((s) =>
              s.indexing.every((j: any) =>
                ["ready", "failed"].includes(j.status),
              ),
            )
          )
            break;
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      const results = [];
      for (const c of fixtures.cases) {
        const start = performance.now();
        const date =
          strategy !== "recent" && c.date
            ? {
                from: c.date + "T00:00:00Z",
                to: new Date(Date.parse(c.date) + 86400000).toISOString(),
                original: true,
              }
            : {};
        const result = await app.evidence.recall({
          text: c.query,
          ...date,
          limit: 5,
        });
        results.push({
          id: c.id,
          expected: c.expected,
          hit: result.sources.some((s) => s.id === ids.get(c.expected)),
          retrieved: result.sources.map((s) => s.title),
          methods: result.methods,
          ms: performance.now() - start,
        });
      }
      const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
      const summary = {
        strategy,
        hits: results.filter((r) => r.hit).length,
        cases: results.length,
        recallAt5: results.filter((r) => r.hit).length / results.length,
        medianMs: sorted[Math.floor(sorted.length / 2)],
        results,
      };
      report.runs.push(summary);
      console.log(
        strategy,
        summary.hits + "/40",
        "median",
        summary.medianMs.toFixed(2),
        "ms",
      );
    } finally {
      app.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
  await mkdir("docs/evaluations", { recursive: true });
  await writeFile(
    "docs/evaluations/recall-results.json",
    JSON.stringify(report, null, 2),
  );
} finally {
  await embedder.close();
}
