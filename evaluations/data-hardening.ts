// Opt-in live planning, isolated synthetic records; never reads owner history.
import "dotenv/config";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createKatha } from "../src/core/index.ts";
import { createKathaAdapters } from "../src/providers/index.ts";
if (!process.argv.includes("--run-live"))
  throw Error(
    "Pass --run-live to consume configured Groq quota on synthetic CSVs.",
  );
const directory = await mkdtemp(join(tmpdir(), "katha-data-hardening-"));
const adapters = createKathaAdapters({
  groqKey: process.env.GROQ_API_KEY,
  model: process.env.GROQ_MODEL,
});
const app = createKatha({
  directory,
  model: adapters.model,
  search: {
    async search() {
      throw Error("Private CSV analysis must not send records to web search.");
    },
  },
});
const csv =
  "owner,stage,last_activity_date,amount,currency\nAlia,Open,2026-11-01,0.10,INR\nAlia,Open,2026-11-06,0.20,INR\nBo,Open,2026-11-03,100.50,INR\nBo,Won,2026-11-02,1000.00,INR\nAlia,Open,2026-11-11,9.00,INR\n";
const cases = [
  {
    id: "filtered-groups",
    question:
      "Sum amount by owner for Open deals with last_activity_date before 9 November 2026, largest first.",
    csv,
    checks: [/100\.50/, /0\.30/, /3 matching rows/],
  },
  {
    id: "average",
    question: "What is the average amount in this CSV?",
    csv: csv + "Chen,Open,2026-11-01,,INR\n",
    checks: [/221\.960000/, /1 missing/],
  },
  {
    id: "top-two",
    question: "Show the top 2 rows sorted by amount, descending.",
    csv,
    checks: [/1000\.00/, /100\.50/, /Showing 2 of 5/],
  },
  {
    id: "count-filtered",
    question: "Count Open rows with last_activity_date before 9 November 2026.",
    csv,
    checks: [/3 matching rows/, /count/],
  },
  {
    id: "mixed-currency",
    question: "What is the total amount in this CSV?",
    csv: "owner,amount,currency\nAlia,100,INR\nBo,20,USD\n",
    checks: [/multiple currencies/],
  },
];
const results: any[] = [];
try {
  for (const c of cases) {
    const source = await app.evidence.import({
      name: `${c.id}.csv`,
      content: c.csv,
    });
    const chat = await app.workspace.createConversation();
    const r = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: randomUUID(),
      expectedTailId: null,
      text: c.question,
      attachmentIds: [source.sourceId],
      timezone: "Asia/Kolkata",
    });
    for await (const event of app.turns.events(r.turnId))
      if (event.type === "complete") break;
    const t = await app.turns.get(r.turnId);
    const passed =
      t.status === "COMPLETED" &&
      c.checks.every((re) => re.test(t.answer)) &&
      t.citations.some((x) => x.sourceId === source.sourceId);
    results.push({
      caseId: c.id,
      question: c.question,
      fixture: c.csv,
      sha256: createHash("sha256").update(c.csv).digest("hex"),
      passed,
      ...t,
    });
    console.log(
      JSON.stringify({
        id: c.id,
        passed,
        status: t.status,
        answer: t.answer,
        error: t.error,
      }),
    );
  }
} finally {
  app.close();
  await rm(directory, { recursive: true, force: true });
  await mkdir("data/evaluations", { recursive: true });
  const path = `data/evaluations/data-hardening-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await writeFile(
    path,
    JSON.stringify(
      {
        label:
          "Synthetic functional checks with live model planning; regex assertions are not supported-claim precision.",
        model: process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
        passed: results.filter((r) => r.passed).length,
        total: cases.length,
        results,
      },
      null,
      2,
    ),
  );
  console.log(path);
}
if (results.length !== cases.length || results.some((r) => !r.passed))
  process.exitCode = 1;
