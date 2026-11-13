// Opt-in real-model evaluation using controlled synthetic evidence, never live web.
import "dotenv/config";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";
import { createKathaAdapters } from "../src/providers/index.ts";
import type { ModelAdapter, SearchResult } from "../src/core/types.ts";

if (!process.argv.includes("--run-live")) {
  console.log(
    "Dry run. --run-live consumes Groq quota with fixture-only search.",
  );
  process.exit(0);
}
if (!process.env.GROQ_API_KEY) throw new Error("Configured Groq key required.");
const stamp = new Date().toISOString();
const directory = await mkdtemp(join(tmpdir(), "katha-known-price-"));
const names = ["AsterCRM", "BerylCRM", "CedarCRM", "DuneCRM", "ElmCRM"];
const expected = [
  "CHANGED_WITH_DATED_EVIDENCE",
  "CHANGED_WITH_DATED_EVIDENCE",
  "CURRENTLY_MATCHES",
  "DIFFERS_CHANGE_TIME_UNKNOWN",
  "CONFLICTING",
];
const terms = (name: string, amount: number) =>
  `${name} Core: USD ${amount} per seat per month, billed monthly; region US; 20 seats; unlimited contacts; tax excluded.`;
const baselineAmounts = [10, 20, 30, 40, 50];
const currentAmounts = [12, 18, 30, 45, 60];
const fixtures: SearchResult[] = names.map((name, i) => ({
  title: `${name} controlled current pricing`,
  url: `https://${name.toLowerCase()}.example/pricing`,
  content: [
    "SYNTHETIC CONTROLLED EVIDENCE. Not a real vendor or live website.",
    terms(name, currentAmounts[i]),
    i === 0
      ? `Effective 2026-11-10, ${name} Core changes from USD 10 to USD 12 per seat per month.`
      : "",
    i === 1
      ? `Effective 2026-11-11, ${name} Core changes from USD 20 to USD 18 per seat per month.`
      : "",
    i === 2
      ? "This is a current observation only, not proof that no interim changes occurred."
      : "",
    i === 3 ? "No effective change date is available." : "",
    i === 4
      ? `A second equally current official offer contradicts this amount: ${terms(name, 70)} Neither offer supersedes the other; the current amount is unresolved.`
      : "",
  ]
    .filter(Boolean)
    .join("\n"),
  observedAt: "2026-11-13T10:00:00Z",
}));
let now = "2026-11-09T10:00:00Z";
let seeding = true;
const calls: unknown[] = [];
const wireContexts: unknown[] = [];
const providerErrors: unknown[] = [];
const adapters = createKathaAdapters({
  groqKey: process.env.GROQ_API_KEY,
  model: process.env.GROQ_MODEL,
  async fetcher(input, init) {
    const url =
      input instanceof Request ? new URL(input.url) : new URL(String(input));
    if (url.hostname !== "api.groq.com")
      throw new Error("Live web disabled: fixture search only.");
    // Capture the actual model-visible context; never headers or credentials.
    if (typeof init?.body === "string") {
      const request = JSON.parse(init.body);
      const context = request.messages?.find(
        (m: { role: string }) => m.role === "user",
      )?.content;
      wireContexts.push({
        maxTokens: request.max_tokens,
        context: typeof context === "string" ? JSON.parse(context) : context,
      });
    }
    const response = await fetch(input, init);
    if (!response.ok) {
      const body = await response
        .clone()
        .json()
        .catch(() => ({}));
      const clean = (value: unknown) =>
        String(value || "")
          .replaceAll(process.env.GROQ_API_KEY!, "[REDACTED]")
          .slice(0, 300);
      providerErrors.push({
        status: response.status,
        code: clean(body?.error?.code),
        message: clean(body?.error?.message),
      });
    }
    return response;
  },
});
const model: ModelAdapter = {
  async plan(input) {
    if (seeding) return { mode: "general", queries: [] };
    const output = await adapters.model.plan!(input);
    calls.push({ kind: "plan", output });
    return output;
  },
  async generate(input) {
    if (seeding)
      return {
        answer: "Synthetic original shortlist retained.",
        citations: [],
      };
    const { signal: _signal, onDelta: _onDelta, ...context } = input;
    try {
      const output = await adapters.model.generate(input);
      // Copy now so subsequent core validation cannot mutate the captured output.
      calls.push({
        kind: "generate",
        input: context,
        output: structuredClone(output),
      });
      return output;
    } catch (error) {
      calls.push({
        kind: "generate",
        input: context,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};
const app = createKatha({
  directory,
  clock: () => new Date(now),
  model,
  search: {
    async search(query) {
      const mentioned = fixtures.filter((_, i) =>
        query.toLowerCase().includes(names[i].toLowerCase()),
      );
      const results = mentioned.length ? mentioned : fixtures;
      calls.push({ kind: "fixture-search", query, results });
      return results;
    },
  },
});
async function ask(id: string, text: string) {
  const chat = await app.workspace.getConversation(id);
  const receipt = await app.turns.start({
    conversationId: id,
    clientRequestId: crypto.randomUUID(),
    expectedTailId: chat.tailId,
    text,
    timezone: "UTC",
  });
  const events = [];
  for await (const event of app.turns.events(receipt.turnId))
    events.push(event);
  return { receipt, events, snapshot: await app.turns.get(receipt.turnId) };
}
let result: Awaited<ReturnType<typeof ask>> | undefined;
let seed: Awaited<ReturnType<typeof ask>> | undefined;
const baselineSources = [];
try {
  const chat = await app.workspace.createConversation();
  seed = await ask(
    chat.id,
    `On Monday we shortlisted ${names.slice(0, -1).join(", ")} and ${names.at(-1)} for a 20-person sales team. The five separately retained offers record exact historical prices.`,
  );
  for (let i = 0; i < names.length; i++)
    baselineSources.push(
      await app.evidence.import({
        name: `${names[i]} Monday offer`,
        content: `SYNTHETIC historical offer retained on 2026-11-09.\n${terms(names[i], baselineAmounts[i])}`,
        occurredAt: "2026-11-09",
        timezone: "UTC",
      }),
    );
  now = "2026-11-13T10:00:00Z";
  seeding = false;
  result = await ask(
    chat.id,
    `On Monday we shortlisted ${names.slice(0, -1).join(", ")} and ${names.at(-1)}. Has pricing changed since? Compare all five individually using the controlled current evidence and retained Monday offers. Give exact commercial terms and effective-date support where available. The fixture vendors are invented; do not use outside knowledge.`,
  );
} finally {
  await mkdir("data/evaluations", { recursive: true });
  const destination = "data/evaluations/synthetic-known-price.json";
  try {
    await copyFile(
      destination,
      destination.replace(".json", `-${stamp.replaceAll(/[:.]/g, "-")}.json`),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const generated = [...calls]
    .reverse()
    .find((c: any) => c.kind === "generate" && c.output) as any;
  const coverage = names.map((vendor, i) => {
    const model =
      generated?.output?.comparisons?.filter((c: any) =>
        c.claim.includes(vendor),
      ) || [];
    const final =
      result?.snapshot.comparisons.filter((c) => c.claim.includes(vendor)) ||
      [];
    return {
      vendor,
      expected: expected[i],
      modelStatuses: model.map((c: any) => c.status),
      finalStatuses: final.map((c) => c.status),
      modelProvidedComparison: model.length > 0,
      expectedStatusMatched: final.some((c) => c.status === expected[i]),
      final,
    };
  });
  await writeFile(
    destination,
    JSON.stringify(
      {
        controlledSharedEvidence: true,
        liveWeb: false,
        realModel: true,
        syntheticOriginalRecords: true,
        stamp,
        model: process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
        fixtures,
        baselineSources,
        seed,
        result,
        calls,
        wireContexts,
        providerErrors,
        coverage,
        limitation:
          "Single controlled run, not production accuracy or live search quality. Model presence and status matching require source-level support review.",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      status: result?.snapshot.status,
      error: result?.snapshot.error,
      answer: result?.snapshot.answer,
      providerErrors,
      coverage: coverage.map(({ final: _final, ...c }) => c),
    }),
  );
  app.close();
  await rm(directory, { recursive: true, force: true });
}
