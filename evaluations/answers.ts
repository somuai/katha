import "dotenv/config";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
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
if (!process.argv.includes("--run-live")) {
  console.log(
    "Forty full-turn cases; pass --run-live to consume Groq/Tavily quota.",
  );
  process.exit(0);
}
const models = (
  process.env.EVAL_MODELS ||
  `${process.env.GROQ_MODEL || "qwen/qwen3.8-27b"},openai/gpt-oss-120b`
).split(",");
const output = process.env.EVAL_OUTPUT || "data/evaluations/answers";
await mkdir(output, { recursive: true });
const options = {
  groqKey: process.env.GROQ_API_KEY,
  tavilyKey: process.env.TAVILY_API_KEY,
};
if (!options.groqKey || !options.tavilyKey)
  throw Error("Both server keys are required.");
const adapters = new Map<string, ReturnType<typeof createKathaAdapters>>();
for (const model of models) {
  const status = await validateProviderSetup({ ...options, model }, false);
  if (status.groq.availability !== "available")
    throw Error(`Unavailable configured candidate ${model}`);
  adapters.set(model, createKathaAdapters({ ...options, model }));
}
// Capture actual search observations once, independently of candidate planning.
let captured: Record<string, SearchResult[]> = {};
try {
  captured = JSON.parse(await readFile(join(output, "captured.json"), "utf8"));
} catch {}
const search = createProviders(options);
for (const c of fixture.cases.filter((c: any) => c.kind === "web")) {
  if (captured[c.id]) continue;
  const results = await search.search([{ query: c.query }], undefined, false);
  captured[c.id] = results
    .flatMap((r) => r.evidence)
    .map((e) => ({
      title: e.title,
      url: e.url!,
      content: e.text,
      observedAt: e.observedAt,
      publishedAt: e.publishedAt,
    }));
  await writeFile(
    join(output, "captured.json"),
    JSON.stringify(captured, null, 2),
  );
  console.log("Captured", c.id, captured[c.id].length, "results");
}
const results: any[] = [];
try {
  results.push(
    ...JSON.parse(await readFile(join(output, "results.json"), "utf8")).results,
  );
} catch {}
for (const c of fixture.cases)
  for (const model of models) {
    if (results.some((r) => r.id === c.id && r.model === model)) continue;
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
        baselineId,
        completionMs,
        firstUsefulMs: firstUsefulMs ?? completionMs,
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
        review: { reviewed: false, claims: [] },
      });
      console.log("ERROR", model, c.id, String(error));
    } finally {
      app.close();
      await rm(directory, { recursive: true, force: true });
    }
    await writeFile(
      join(output, "results.json"),
      JSON.stringify(
        {
          label: fixture.label,
          models,
          gate: "Unreviewed: no supported-claim accuracy is inferred from keyword checks.",
          results,
        },
        null,
        2,
      ),
    );
  }
console.log(
  "Full-turn evaluation complete. Review each claim before computing support precision.",
);
