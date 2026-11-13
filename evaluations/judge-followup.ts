// Two targeted synthetic full-turn checks. Explicit opt-in consumes provider quota.
import "dotenv/config";
import { copyFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createKatha } from "../src/core/index.ts";
import { createKathaAdapters } from "../src/providers/index.ts";
import type { ModelAdapter } from "../src/core/types.ts";

if (!process.argv.includes("--run-live")) {
  console.log("Dry run: pass --run-live for two synthetic live checks.");
  process.exit(0);
}
if (!process.env.GROQ_API_KEY || !process.env.TAVILY_API_KEY)
  throw new Error("Both configured provider keys are required.");

const directory = await mkdtemp(join(tmpdir(), "katha-judge-followup-"));
const startedAt = new Date().toISOString();
const providerErrors: unknown[] = [];
function sanitized(value: unknown, limit: number) {
  let text = typeof value === "string" ? value : "";
  for (const secret of [process.env.GROQ_API_KEY, process.env.TAVILY_API_KEY])
    if (secret) text = text.replaceAll(secret, "[REDACTED]");
  return text
    .replace(/(?:gsk_|tvly-|sk-)[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, limit);
}
const adapters = createKathaAdapters({
  groqKey: process.env.GROQ_API_KEY,
  tavilyKey: process.env.TAVILY_API_KEY,
  model: process.env.GROQ_MODEL,
  async fetcher(input, init) {
    const response = await fetch(input, init);
    if (!response.ok) {
      // Retain only the requested bounded error fields, never failed_generation,
      // request headers, credentials, token usage, or the response body.
      let code = "";
      let message = "";
      try {
        const body = await response.clone().json();
        code = sanitized(body?.error?.code, 100);
        message = sanitized(body?.error?.message, 300);
      } catch {
        message = "Non-JSON provider error.";
      }
      providerErrors.push({ caseId, status: response.status, code, message });
      console.log(
        JSON.stringify({
          providerError: { caseId, status: response.status, code, message },
        }),
      );
    }
    return response;
  },
});
const vendors = ["Attio", "HubSpot", "Close", "Pipedrive", "Folk"];
let now = "2026-11-02T10:00:00Z";
let seeding = true;
let caseId = "seed";
const calls: unknown[] = [];
const snapshots: unknown[] = [];
const model: ModelAdapter = {
  async plan(context) {
    if (seeding) return { mode: "general", queries: [] };
    const { signal: _signal, ...input } = context;
    const output = await adapters.model.plan!(context);
    calls.push({ caseId, kind: "plan", input, output });
    return output;
  },
  async generate(context) {
    if (seeding) return { answer: "Synthetic record retained.", citations: [] };
    const { signal: _signal, onDelta: _onDelta, ...input } = context;
    try {
      const output = await adapters.model.generate(context);
      calls.push({ caseId, kind: "generate", input, output });
      return output;
    } catch (error) {
      calls.push({
        caseId,
        kind: "generate",
        input,
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
    async search(query, options) {
      const started = performance.now();
      try {
        const results = await adapters.search.search(query, options);
        calls.push({
          caseId,
          kind: "search",
          query,
          results,
          elapsedMs: performance.now() - started,
        });
        return results;
      } catch (error) {
        calls.push({
          caseId,
          kind: "search",
          query,
          error: error instanceof Error ? error.message : String(error),
          elapsedMs: performance.now() - started,
        });
        throw error;
      }
    },
  },
});
async function ask(chatId: string, question: string) {
  const chat = await app.workspace.getConversation(chatId);
  const receipt = await app.turns.start({
    conversationId: chatId,
    clientRequestId: crypto.randomUUID(),
    expectedTailId: chat.tailId,
    text: question,
    timezone: "Asia/Kolkata",
  });
  const events = [];
  for await (const event of app.turns.events(receipt.turnId))
    events.push(event);
  const snapshot = await app.turns.get(receipt.turnId);
  const coverage = vendors.map((vendor) => {
    const pattern = new RegExp(`\\b${vendor}\\b`, "i");
    return {
      vendor,
      answerMentioned: pattern.test(snapshot.answer),
      comparisons: snapshot.comparisons.filter((c) =>
        pattern.test(`${c.claim} ${c.explanation}`),
      ),
      webSources: snapshot.sources
        .filter(
          (s) =>
            s.kind === "web" &&
            pattern.test(
              `${s.title} ${s.content} ${JSON.stringify(s.metadata)}`,
            ),
        )
        .map((s) => ({ id: s.id, title: s.title, metadata: s.metadata })),
    };
  });
  const result = {
    caseId,
    question,
    evaluationNow: now,
    receipt,
    events,
    snapshot,
    coverage,
  };
  snapshots.push(result);
  return result;
}
try {
  const original = await app.workspace.createConversation();
  await ask(
    original.id,
    "On Monday we shortlisted Salesforce and Zoho for a 5-person team. No prices or vendor snapshots were recorded.",
  );
  now = "2026-11-09T10:00:00Z";
  await ask(
    original.id,
    "On Monday we shortlisted Attio, HubSpot, Close, Pipedrive and Folk for a 20-person sales team. We need email synchronization and reporting. No historical prices, commercial terms, or release snapshots were recorded.",
  );
  seeding = false;
  now = "2026-11-13T10:00:00Z";
  const followup = await app.workspace.createConversation();
  caseId = "date-anchoring";
  const dateResult = await ask(
    followup.id,
    "What is today's date and what did I shortlist on Monday? Give Monday's calendar date and use retained sources only.",
  );
  console.log(
    JSON.stringify({
      caseId,
      status: dateResult.snapshot.status,
      answer: dateResult.snapshot.answer,
      error: dateResult.snapshot.error,
    }),
  );
  caseId = "five-crm-verification";
  const crmResult = await ask(
    followup.id,
    "On Monday we shortlisted Attio, HubSpot, Close, Pipedrive and Folk for a 20-person sales team. Has any pricing changed or shipped something big since? Compare all five individually; distinguish current evidence from proven changes since Monday and state gaps.",
  );
  console.log(
    JSON.stringify({
      caseId,
      status: crmResult.snapshot.status,
      answer: crmResult.snapshot.answer,
      error: crmResult.snapshot.error,
      coverage: crmResult.coverage.map(
        ({ vendor, answerMentioned, comparisons, webSources }) => ({
          vendor,
          answerMentioned,
          comparisonStatuses: comparisons.map((c) => c.status),
          webSourceCount: webSources.length,
        }),
      ),
    }),
  );
} finally {
  await mkdir("data/evaluations", { recursive: true });
  try {
    await copyFile(
      "data/evaluations/judge-followup.json",
      `data/evaluations/judge-followup-${startedAt.replaceAll(/[:.]/g, "-")}.json`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(
    "data/evaluations/judge-followup.json",
    JSON.stringify(
      {
        syntheticRecords: true,
        startedAt,
        completedAt: new Date().toISOString(),
        model: process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
        evaluationClock: "2026-11-13T10:00:00Z",
        notes: [
          "Seed turns use a fixture acknowledgement, not live answers.",
          "Only two followup turns use live adapters.",
          "Coverage flags count mentions and candidate sources, not independently verified claim support.",
          "Full source text, events, model contexts, search results and returned answers are retained for manual review.",
        ],
        snapshots,
        calls,
        providerErrors,
      },
      null,
      2,
    ),
  );
  app.close();
  await rm(directory, { recursive: true, force: true });
}
