import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";
import { createKathaAdapters } from "../src/providers/index.ts";

// Real Turns + Evidence Library; only the external model response is substituted.
async function inspectPreparedContext(
  name: string,
  content: string,
  question: string | string[],
  options: {
    invalidFirstCitation?: boolean;
    deleteFirstMentionBeforeLast?: boolean;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "katha-attachment-contract-"));
  let returnedBadCitation = false;
  let fixtureClock = Date.now();
  const adapters = createKathaAdapters({
    groqKey: "fixture",
    clock: () => (fixtureClock += 2000),
    fetcher: (async (_url, init) => {
      const context = JSON.parse(
        JSON.parse(String(init?.body)).messages[1].content,
      );
      const evidence =
        context.baseline.find((s: any) => /\.(?:pdf|csv)$/i.test(s.title)) ||
        context.baseline[0];
      const citation =
        options.invalidFirstCitation && !returnedBadCitation
          ? "invented-source"
          : evidence.id;
      returnedBadCitation = true;
      return new Response(
        JSON.stringify({
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
          },
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text: evidence.csvSummary
                    ? evidence.csvSummary + "\n" + evidence.text
                    : evidence.text,
                  citations: [citation],
                  comparisons: [],
                }),
              },
            },
          ],
        }),
      );
    }) as typeof fetch,
  });
  const app = createKatha({ directory, model: adapters.model });
  try {
    const imported = await app.evidence.import({ name, content });
    const chat = await app.workspace.createConversation();
    let answer = "";
    for (const [i, text] of (Array.isArray(question)
      ? question
      : [question]
    ).entries()) {
      if (
        options.deleteFirstMentionBeforeLast &&
        Array.isArray(question) &&
        i === question.length - 1
      ) {
        const conversation = await app.workspace.getConversation(chat.id);
        const originalMention = conversation.messages.find(
          (s) => s.role === "user",
        );
        assert.ok(originalMention);
        await app.evidence.trash(originalMention.id);
      }
      const current = await app.workspace.getConversation(chat.id);
      const receipt = await app.turns.start({
        conversationId: chat.id,
        clientRequestId: `contract-${i}`,
        expectedTailId: current.tailId,
        text,
        attachmentIds: i === 0 ? [imported.sourceId] : [],
      });
      for await (const event of app.turns.events(receipt.turnId))
        if (event.type === "complete") break;
      const result = await app.turns.get(receipt.turnId);
      assert.equal(result.status, "COMPLETED", result.error || "");
      assert.ok(result.citations.some((c) => c.sourceId === imported.sourceId));
      answer = result.answer;
    }
    return answer;
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("decimal CSV totals remain exact and missing cells are disclosed through a complete turn", async () => {
  const answer = await inspectPreparedContext(
    "payments.csv",
    "customer,amount\nA,0.10\nB,0.20\nC,\nD,-0.05\n",
    "What is the sum of amount across all rows in this CSV?",
  );
  assert.match(answer, /sum 0\.25\b/);
  assert.match(answer, /1 (?:missing|blank)/);
  assert.doesNotMatch(answer, /0\.2500000|0\.3000000/);
});

test("Monday attendance is counted within the matching day rather than across Tuesday too", async () => {
  const answer = await inspectPreparedContext(
    "attendance.csv",
    "person,day,status\nAlia,Monday,present\nBo,Monday,absent\nChen,Monday,present\nDee,Tuesday,absent\nEli,Tuesday,absent\n",
    "What was Monday attendance: how many were present and absent in this CSV?",
  );
  assert.match(answer, /For day="Monday".*3 rows/);
  assert.match(answer, /status.*"present": 2.*"absent": 1/);
});

test("a partial contributor name selects that person's contribution instead of the title-page roster", async () => {
  const answer = await inspectPreparedContext(
    "team.pdf",
    "[Page 1]\nStudent roster: Alia Das, Bo Sen.\n\n[Page 44]\nStudent: Alia Das Roll number: 1 Contribution and findings: I led the architecture.\n\n[Page 45]\nStudent: Bo Sen Roll number: 2 Contribution and findings: I tested the local language model. Key findings: Results apply only to that setup.\n",
    "what did Bo do",
  );
  assert.match(answer, /tested the local language model/);
  assert.doesNotMatch(answer, /led the architecture|Student roster/);
});

test("pronoun follow-ups keep the last named PDF contributor across repeated questions", async () => {
  const answer = await inspectPreparedContext(
    "team.pdf",
    "[Page 1]\nStudent roster: Alia Das, Bo Sen.\n\n[Page 44]\nStudent: Alia Das Roll number: 1 Contribution and findings: I led the architecture.\n\n[Page 45]\nStudent: Bo Sen Roll number: 2 Contribution and findings: I tested the local language model. Key findings: Results apply only to that setup.\n",
    [
      "what did Bo do",
      "yes what he did in the project",
      "what were his findings?",
    ],
  );
  assert.match(answer, /tested the local language model/);
  assert.match(answer, /only to that setup/);
  assert.doesNotMatch(answer, /led the architecture|Student roster/);
});

test("an explicit PDF page can retrieve a relevant fact beyond its first excerpt window", async () => {
  const answer = await inspectPreparedContext(
    "late-fact.pdf",
    "[Page 3]\n" +
      "Unrelated overview. ".repeat(41) +
      "Approval code: COBALT-731.",
    "What is the approval code on page 3?",
  );
  assert.match(answer, /COBALT-731/);
  assert.match(answer, /\[Page 3\]/);
});

test("ambiguous partial contributor names require a choice instead of selecting the first person", async () => {
  const answer = await inspectPreparedContext(
    "team.pdf",
    "[Page 44]\nStudent: Bo Sen Roll number: 1 Contribution: I built the client.\n\n[Page 45]\nStudent: Bo Das Roll number: 2 Contribution: I built the database.\n",
    "what did Bo do",
  );
  assert.match(answer, /Ask their name/);
  assert.match(answer, /Bo Sen/);
  assert.match(answer, /Bo Das/);
  assert.doesNotMatch(answer, /I built/);
});

test("a turn can recover an invalid model citation using only retained source identifiers", async () => {
  const answer = await inspectPreparedContext(
    "facts.pdf",
    "[Page 2]\nThe approved budget is USD 4200.",
    "What is the approved budget from this PDF?",
    { invalidFirstCitation: true },
  );
  assert.match(answer, /4200/);
  assert.doesNotMatch(answer, /invented-source/);
});

test("duplicate CSV column names cannot produce an apparently authoritative named-column sum", async () => {
  const answer = await inspectPreparedContext(
    "ambiguous.csv",
    "amount,amount\n1,100\n2,200\n",
    "What is the sum of amount in this CSV?",
  );
  assert.match(answer, /ambiguous|duplicate/i);
  assert.doesNotMatch(answer, /sum (?:3|300)\b/);
});

test("a contributor reference survives more pronoun follow-ups than the recent-message window", async () => {
  const answer = await inspectPreparedContext(
    "team.pdf",
    "[Page 44]\nStudent: Alia Das Roll number: 1 Contribution: I led architecture.\n\n[Page 45]\nStudent: Bo Sen Roll number: 2 Contribution: I tested local models.\n",
    [
      "what did Bo do",
      ...Array.from({ length: 14 }, () => "what did he do in the project?"),
    ],
  );
  assert.match(answer, /tested local models/);
  assert.doesNotMatch(answer, /led architecture|multiple named/);
});

test("deleting the original person mention invalidates durable pronoun focus", async () => {
  const answer = await inspectPreparedContext(
    "team.pdf",
    "[Page 44]\nStudent: Alia Das Roll number: 1 Contribution: I led architecture.\n\n[Page 45]\nStudent: Bo Sen Roll number: 2 Contribution: I tested local models.\n",
    [
      "what did Bo do",
      ...Array.from({ length: 14 }, () => "what did he do in the project?"),
    ],
    { deleteFirstMentionBeforeLast: true },
  );
  assert.match(answer, /Ask their name/);
  assert.doesNotMatch(answer, /I tested local models/);
});

test("a collective project question is not mistaken for an ambiguous individual contribution", async () => {
  const answer = await inspectPreparedContext(
    "team.pdf",
    "[Page 1]\nProject overview: The team built a bounded memory gateway.\n\n[Page 44]\nStudent: Alia Das Roll number: 1 Contribution: I led architecture.\n\n[Page 45]\nStudent: Bo Sen Roll number: 2 Contribution: I tested models.\n",
    "What did we build in this project?",
  );
  assert.match(answer, /bounded memory gateway/);
  assert.doesNotMatch(answer, /Ask their name/);
});

test("complete CSV rows disclose zero missing cells and distinguish omitted excerpts from malformed data", async () => {
  const csv =
    "customer,amount\n" +
    Array.from({ length: 120 }, (_, i) => `Customer${i + 1},0.10`).join("\n");
  const answer = await inspectPreparedContext(
    "crm.csv",
    csv,
    "Recommend next steps from this CRM CSV.",
  );
  assert.match(answer, /0 blank cells/);
  assert.match(answer, /complete rows/i);
  assert.match(answer, /Customer1/);
  assert.doesNotMatch(answer, /Customer77/);
});
