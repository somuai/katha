import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";
import { createKathaAdapters } from "../src/providers/index.ts";

async function analyze(
  plan: unknown,
  question: string,
  csv = "owner,stage,last_activity_date,amount,currency\nAlia,Open,2026-11-01,0.10,INR\nAlia,Open,2026-11-06,0.20,INR\nBo,Open,2026-11-03,100.50,INR\nBo,Won,2026-11-02,1000.00,INR\nAlia,Open,2026-11-11,9.00,INR\n",
) {
  const dir = mkdtempSync(join(tmpdir(), "katha-csv-analysis-"));
  const adapters = createKathaAdapters({
    groqKey: "fixture",
    fetcher: (async () =>
      Response.json({
        choices: [{ message: { content: JSON.stringify(plan) } }],
      })) as typeof fetch,
  });
  const app = createKatha({ directory: dir, model: adapters.model });
  try {
    const source = await app.evidence.import({
      name: "pipeline.csv",
      content: csv,
    });
    const chat = await app.workspace.createConversation();
    const r = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "analysis",
      expectedTailId: null,
      text: question,
      attachmentIds: [source.sourceId],
    });
    for await (const e of app.turns.events(r.turnId))
      if (e.type === "complete") break;
    const turn = await app.turns.get(r.turnId);
    assert.equal(turn.status, "COMPLETED", turn.error || "");
    assert.ok(turn.citations.some((c) => c.sourceId === source.sourceId));
    return turn;
  } finally {
    app.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("CSV grouped sums apply all filters over the complete file using exact decimals", async () => {
  const turn = await analyze(
    {
      operation: "sum",
      column: "amount",
      groupBy: ["owner"],
      filters: [
        { column: "stage", op: "eq", value: "Open" },
        { column: "last_activity_date", op: "lt", value: "2026-11-09" },
      ],
      sort: "desc",
      limit: 10,
    },
    "Sum amount by owner for Open deals with last_activity_date before 9 November 2026, largest first.",
  );
  assert.match(turn.answer, /100\.50/);
  assert.match(turn.answer, /0\.30/);
  assert.doesNotMatch(turn.answer, /1000\.00|1109\.80/);
  assert.ok(turn.answer.indexOf("Bo") < turn.answer.indexOf("Alia"));
  assert.equal((turn.trace.csvAnalysis as any)?.matchedRows, 3);
});

test("a whole-file total cannot silently add INR to USD", async () => {
  const t = await analyze(
    {
      operation: "sum",
      column: "amount",
      groupBy: [],
      filters: [],
      sort: "desc",
      limit: 10,
    },
    "What is the total amount in this CSV?",
    "owner,amount,currency\nAlia,100,INR\nBo,20,USD\n",
  );
  assert.match(t.answer, /multiple currencies|one currency|mixed currencies/i);
  assert.doesNotMatch(t.answer, /Total amount: 120/);
});

test("CSV averages disclose missing values and use decimal rounding", async () => {
  const t = await analyze(
    {
      operation: "average",
      column: "amount",
      groupBy: [],
      filters: [],
      sort: "desc",
      limit: 10,
    },
    "What is the average amount in this CSV?",
    "owner,amount\nAlia,0.10\nBo,0.20\nChen,\n",
  );
  assert.match(t.answer, /0\.150000/);
  assert.match(t.answer, /1 missing/);
  assert.match(t.answer, /six decimal/);
});

test("CSV analysis rejects unknown columns and extra executable plan fields", async () => {
  for (const plan of [
    { operation: "sum", column: "invented" },
    { operation: "sum", column: "amount", sql: "DELETE FROM sources" },
  ]) {
    const t = await analyze(plan, "Sum amount by owner where stage is Open.");
    assert.match(t.answer, /could not run.*safely/i);
    assert.equal((t.trace.csvAnalysis as any)?.error, "PLAN_REJECTED");
  }
});

test("CSV top-row selection sorts numeric values and discloses the omitted remainder", async () => {
  const t = await analyze(
    {
      operation: "rows",
      column: "amount",
      groupBy: [],
      filters: [],
      sort: "desc",
      limit: 2,
    },
    "Show the top 2 rows sorted by amount.",
  );
  assert.match(t.answer, /Showing 2 of 5 matching rows/);
  assert.ok(t.answer.indexOf("1000.00") < t.answer.indexOf("100.50"));
  assert.doesNotMatch(t.answer, /\| 9.00 \|/);
});

test("a locale-formatted amount cannot silently become a numeric aggregate", async () => {
  const t = await analyze(
    {
      operation: "sum",
      column: "amount",
      groupBy: ["owner"],
      filters: [],
      sort: "desc",
      limit: 10,
    },
    "Sum amount by owner.",
    'owner,amount\nAlia,"1,200.00"\nBo,10.00\n',
  );
  assert.match(t.answer, /nonnumeric|locale-formatted/i);
  assert.doesNotMatch(t.answer, /1210/);
});

test("groups with missing values cannot outrank actual negative numeric results", async () => {
  const t = await analyze(
    {
      operation: "max",
      column: "amount",
      groupBy: ["owner"],
      filters: [],
      sort: "desc",
      limit: 1,
    },
    "Show the highest amount by owner.",
    "owner,amount\nAlia,-5\nBo,\nChen,-10\n",
  );
  assert.match(t.answer, /\| Alia \| -5 \|/);
  assert.doesNotMatch(t.answer, /\| Bo \|/);
});

test("CSV cells render as literal data rather than activating embedded Markdown images", async () => {
  const t = await analyze(
    { operation: "rows", groupBy: [], filters: [], sort: "desc", limit: 10 },
    "Show the top rows in this CSV.",
    "customer,amount\n![x](https://example.invalid/private),10\n",
  );
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { AnswerText } = await import("../client/src/AnswerText.tsx");
  const html = renderToStaticMarkup(
    createElement(AnswerText, { text: t.answer, onSource() {} }),
  );
  assert.doesNotMatch(html, /<img|href="https:\/\/example.invalid/);
  assert.match(html, /example.invalid/);
});
