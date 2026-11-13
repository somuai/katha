import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";
import { createKathaAdapters } from "../src/providers/index.ts";
async function ask(
  question: string,
  responses: (
    id: string,
    attempt: number,
  ) => { text: string; citations: string[] },
) {
  const directory = mkdtempSync(join(tmpdir(), "katha-source-claim-"));
  let attempt = 0,
    clock = Date.now();
  const adapters = createKathaAdapters({
    groqKey: "fixture",
    clock: () => (clock += 2000),
    fetcher: (async (_url, init) => {
      const context = JSON.parse(
        JSON.parse(String(init?.body)).messages[1].content,
      );
      const id = context.baseline[0].id;
      const reply = responses(id, attempt++);
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
                content: JSON.stringify({ ...reply, comparisons: [] }),
              },
            },
          ],
        }),
      );
    }) as typeof fetch,
  });
  const app = createKatha({ directory, model: adapters.model });
  try {
    const source = await app.evidence.import({
      name: "contribution.pdf",
      content:
        "[Page 1]\nI led the team and coordinated testing across the project.",
    });
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "quote",
      expectedTailId: null,
      text: question,
      attachmentIds: [source.sourceId],
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    return await app.turns.get(receipt.turnId);
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
test("an attributed quotation with changed words is repaired rather than presented as the source's exact words", async () => {
  const turn = await ask("What was my contribution from this PDF?", (id, n) =>
    n === 0
      ? {
          text: `Your contribution was: “I lead the team and coordinated testing across the project.” [${id}]`,
          citations: [id],
        }
      : {
          text: `You led the team and coordinated project testing. [${id}]`,
          citations: [id],
        },
  );
  assert.equal(turn.status, "COMPLETED");
  assert.match(turn.answer, /You led/);
  assert.doesNotMatch(turn.answer, /I lead/);
});

test("a persistent invented source quotation fails closed after the one repair", async () => {
  const turn = await ask(
    "Quote my contribution verbatim from this PDF.",
    (id) => ({
      text: `Your contribution was: “I invented the whole project alone and shipped it to a million users.” [${id}]`,
      citations: [id],
    }),
  );
  assert.equal(turn.status, "FAILED");
  assert.equal(turn.answer, "");
  assert.match(turn.error || "", /quotation/i);
});
test("faithful source quotations tolerate layout whitespace without changing words", async () => {
  const turn = await ask(
    "Quote my contribution verbatim from this PDF.",
    (id) => ({
      text: `Your contribution was: “I led the team and coordinated\ntesting across the project.” [${id}]`,
      citations: [id],
    }),
  );
  assert.equal(turn.status, "COMPLETED");
  assert.match(turn.answer, /I led the team/);
});
test("new draft wording is not falsely treated as an original-source quotation", async () => {
  const turn = await ask(
    "Draft a friendly email using this project background.",
    () => ({
      text: "Draft: “I would love to discuss how we could build useful software together.”",
      citations: [],
    }),
  );
  assert.equal(turn.status, "COMPLETED");
  assert.match(turn.answer, /would love to discuss/);
});

test("a requested source citation is repaired when evidence exists", async () => {
  const turn = await ask(
    "Explain my contribution and cite the source.",
    (id, n) => ({
      text: `You led the team and coordinated testing.${n ? ` [${id}]` : ""}`,
      citations: n ? [id] : [],
    }),
  );
  assert.equal(turn.status, "COMPLETED");
  assert.ok(turn.citations.length > 0);
});
test("a persistently omitted requested citation fails rather than claiming cited evidence", async () => {
  const turn = await ask(
    "Explain my contribution and cite the source.",
    () => ({
      text: "You led the team and coordinated testing.",
      citations: [],
    }),
  );
  assert.equal(turn.status, "FAILED");
  assert.equal(turn.answer, "");
  assert.match(turn.error || "", /citation/i);
});
