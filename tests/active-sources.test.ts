import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createKatha } from "../src/core/index.ts";
import { createKathaAdapters } from "../src/providers/index.ts";

test("explicit attachments and follow-ups preserve selected-file priority over workspace recall", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-active-source-"));
  let fixtureClock = Date.now();
  const adapters = createKathaAdapters({
    groqKey: "fixture",
    clock: () => (fixtureClock += 2000),
    fetcher: (async (_url, init) => {
      const c = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
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
                  text: JSON.stringify({
                    active: c.activeSourceIds || [],
                    first: c.baseline?.[0]?.title,
                    content: c.baseline?.[0]?.text,
                  }),
                  citations: c.baseline?.[0] ? [c.baseline[0].id] : [],
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
    const active = await app.evidence.import({
      name: "selected.pdf",
      content: "[Page 1]\nThe approval code is ACTIVE-731.",
    });
    await app.evidence.import({
      name: "other.pdf",
      content: "Approval code is DECOY-999.",
    });
    const chat = await app.workspace.createConversation();
    for (const [i, text] of [
      "What is the approval code in the selected PDF?",
      "What is it again?",
    ].entries()) {
      const current = await app.workspace.getConversation(chat.id);
      const receipt = await app.turns.start({
        conversationId: chat.id,
        clientRequestId: `active-${i}`,
        expectedTailId: current.tailId,
        text,
        attachmentIds: i === 0 ? [active.sourceId] : [],
      });
      for await (const event of app.turns.events(receipt.turnId))
        if (event.type === "complete") break;
      const turn = await app.turns.get(receipt.turnId);
      assert.equal(turn.status, "COMPLETED");
      const answer = JSON.parse(turn.answer);
      assert.deepEqual(answer.active, [active.sourceId]);
      assert.equal(answer.first, "selected.pdf");
      assert.match(answer.content, /ACTIVE-731/);
    }
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("selected files use their effective correction while original records remain unchanged", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-active-corrected-"));
  let clock = "2026-11-03T10:00:00Z";
  const app = createKatha({
    directory,
    clock: () => new Date(clock),
    model: {
      generate: async (c: any) => ({
        answer: c.baseline[0].interpretation || c.baseline[0].content,
        citations: [{ sourceId: c.baseline[0].id }],
      }),
    },
  });
  try {
    const file = await app.evidence.import({
      name: "selected.pdf",
      content: "[Page 1]\nApproval code: ORIGINAL-100.",
    });
    clock = "2026-11-10T10:00:00Z";
    await app.evidence.correct({
      sourceId: file.sourceId,
      mode: "CHANGE_FROM_NOW",
      effectiveAt: clock,
      content: "[Page 1]\nApproval code: UPDATED-200.",
    });
    clock = "2026-11-13T10:00:00Z";
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "effective-file",
      expectedTailId: null,
      text: "What approval code is in the selected PDF?",
      attachmentIds: [file.sourceId],
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    const turn = await app.turns.get(receipt.turnId);
    assert.equal(turn.status, "COMPLETED");
    assert.match(turn.answer, /UPDATED-200/);
    assert.doesNotMatch(turn.answer, /ORIGINAL-100/);
    const original = await app.evidence.recall({
      text: "ORIGINAL-100",
      original: true,
    });
    assert.ok(
      original.sources.some(
        (s) => s.id === file.sourceId && s.content.includes("ORIGINAL-100"),
      ),
    );
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("active source interpretation follows whole replacements and assertion changes but excludes future edits", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-active-chain-"));
  let clock = "2026-11-03T10:00:00Z";
  const app = createKatha({
    directory,
    clock: () => new Date(clock),
    model: {
      generate: async (c: any) => ({
        answer: c.baseline[0].interpretation || c.baseline[0].content,
        citations: [{ sourceId: c.baseline[0].id }],
      }),
    },
  });
  try {
    const file = await app.evidence.import({
      name: "selected.pdf",
      content: "[Page 1]\nCode: OLD-100. Region: Europe.",
    });
    clock = "2026-11-07T10:00:00Z";
    const replacement = await app.evidence.correct({
      sourceId: file.sourceId,
      mode: "CHANGE_FROM_NOW",
      effectiveAt: clock,
      content: "[Page 1]\nCode: NEW-200. Region: Europe.",
    });
    const inspected = await app.evidence.inspect(replacement.sourceId);
    const code = inspected.assertions.find((a) => a.text.includes("NEW-200"));
    assert.ok(code);
    clock = "2026-11-10T10:00:00Z";
    const current = await app.evidence.correct({
      sourceId: replacement.sourceId,
      assertionId: code.id,
      mode: "CHANGE_FROM_NOW",
      effectiveAt: clock,
      content: "Code: FINAL-300.",
    });
    await app.evidence.correct({
      sourceId: replacement.sourceId,
      assertionId: code.id,
      mode: "CHANGE_FROM_NOW",
      effectiveAt: "2026-11-15T10:00:00Z",
      content: "Code: FUTURE-400.",
    });
    clock = "2026-11-13T10:00:00Z";
    const chat = await app.workspace.createConversation();
    async function ask(request: string) {
      const c = await app.workspace.getConversation(chat.id);
      const r = await app.turns.start({
        conversationId: chat.id,
        clientRequestId: request,
        expectedTailId: c.tailId,
        text: "What code and region are in the selected PDF?",
        attachmentIds: [file.sourceId],
      });
      for await (const e of app.turns.events(r.turnId))
        if (e.type === "complete") break;
      return app.turns.get(r.turnId);
    }
    const answer = await ask("current");
    assert.match(answer.answer, /FINAL-300/);
    assert.match(answer.answer, /Europe/);
    assert.doesNotMatch(answer.answer, /OLD-100|NEW-200|FUTURE-400/);
    assert.ok(answer.citations.some((c) => c.sourceId === current.sourceId));
    await app.evidence.trash(current.sourceId);
    const restored = await ask("without-correction");
    assert.match(restored.answer, /NEW-200/);
    assert.doesNotMatch(restored.answer, /FINAL-300|FUTURE-400/);
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an attachment correction recorded after a queued turn cannot leak into its accepted context", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-active-cutoff-"));
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  let holding = true;
  const app = createKatha({
    directory,
    clock: () => new Date("2026-11-13T10:00:00Z"),
    model: {
      generate: async (c: any) => {
        if (holding) {
          holding = false;
          entered();
          await gate;
          return { answer: "Held request" };
        }
        return {
          answer: c.baseline[0].interpretation || c.baseline[0].content,
          citations: [{ sourceId: c.baseline[0].id }],
        };
      },
    },
  });
  try {
    const file = await app.evidence.import({
      name: "selected.pdf",
      content: "[Page 1]\nCode: BEFORE-100.",
    });
    const chat = await app.workspace.createConversation();
    const first = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "hold",
      expectedTailId: null,
      text: "Hold this request.",
    });
    await started;
    const queued = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "accepted-before-change",
      expectedTailId: first.turnId,
      text: "What code is in this PDF?",
      attachmentIds: [file.sourceId],
    });
    await app.evidence.correct({
      sourceId: file.sourceId,
      mode: "CHANGE_FROM_NOW",
      content: "[Page 1]\nCode: AFTER-200.",
    });
    release();
    for await (const e of app.turns.events(queued.turnId))
      if (e.type === "complete") break;
    const turn = await app.turns.get(queued.turnId);
    assert.equal(turn.status, "COMPLETED");
    assert.match(turn.answer, /BEFORE-100/);
    assert.doesNotMatch(turn.answer, /AFTER-200/);
  } finally {
    release();
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
