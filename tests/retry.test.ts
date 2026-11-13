import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";
async function done(app: ReturnType<typeof createKatha>, id: string) {
  for await (const event of app.turns.events(id))
    if (event.type === "complete") break;
  return app.turns.get(id);
}
test("a deliberate retry is a fresh durable turn linked to its original, while request replay remains idempotent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-retry-"));
  let attempt = 0;
  let app = createKatha({
    directory,
    model: {
      async generate(c) {
        if (attempt++ === 0) throw Error("Fixture inference unavailable");
        return {
          answer:
            c.evidence.find((s) => s.title === "New design note")?.content ||
            "Missing note",
        };
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const first = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "original",
      expectedTailId: null,
      text: "Explain our design.",
    });
    assert.equal((await done(app, first.turnId)).status, "FAILED");
    await app.evidence.import({
      name: "New design note",
      content: "Our updated design uses a durable queue.",
    });
    const request = {
      conversationId: chat.id,
      clientRequestId: "deliberate-retry",
      expectedTailId: first.turnId,
      text: "Explain our updated design.",
      retryOf: first.turnId,
    };
    const retry = await app.turns.start(request);
    const result = await done(app, retry.turnId);
    assert.notEqual(retry.turnId, first.turnId);
    assert.equal(result.retryOf, first.turnId);
    assert.match(result.answer, /durable queue/);
    assert.equal((await app.turns.start(request)).turnId, retry.turnId);
    assert.equal(
      (await app.workspace.getConversation(chat.id)).messages.filter(
        (m) => m.role === "user",
      ).length,
      2,
    );
    assert.equal(
      (await app.turns.get(first.turnId)).text,
      "Explain our design.",
    );
    app.close();
    app = createKatha({ directory });
    assert.equal((await app.turns.get(retry.turnId)).retryOf, first.turnId);
    assert.equal(
      (await app.workspace.getConversation(chat.id)).messages.find(
        (m) => m.turnId === retry.turnId && m.role === "user",
      )?.retryOf,
      first.turnId,
    );
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("retry rejects active or foreign parents without partially accepting another message", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-retry-invalid-"));
  const app = createKatha({
    directory,
    model: {
      generate: ({ signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        ),
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const first = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "active",
      expectedTailId: null,
      text: "Hold this work open.",
    });
    for await (const event of app.turns.events(first.turnId))
      if (event.type === "status" && (event.data as any).status === "RUNNING")
        break;
    await assert.rejects(
      app.turns.start({
        conversationId: chat.id,
        clientRequestId: "too-soon",
        expectedTailId: first.turnId,
        text: "Hold this work open.",
        retryOf: first.turnId,
      }),
      { code: "RETRY_NOT_AVAILABLE" },
    );
    const other = await app.workspace.createConversation();
    await assert.rejects(
      app.turns.start({
        conversationId: other.id,
        clientRequestId: "foreign",
        expectedTailId: null,
        text: "Hold this work open.",
        retryOf: first.turnId,
      }),
      { code: "INVALID_RETRY" },
    );
    assert.equal(
      (await app.workspace.getConversation(other.id)).messages.length,
      0,
    );
    assert.equal(
      (await app.workspace.getConversation(chat.id)).messages.length,
      1,
    );
    await app.turns.cancel(first.turnId);
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("retry cannot restore a removed question from the turn's duplicate input storage", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-retry-deleted-"));
  const app = createKatha({
    directory,
    model: {
      async generate() {
        throw Error("Fixture unavailable");
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const first = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "original",
      expectedTailId: null,
      text: "Explain our private design.",
    });
    await done(app, first.turnId);
    const original = (
      await app.workspace.getConversation(chat.id)
    ).messages.find((m) => m.role === "user")!;
    await app.evidence.trash(original.id);
    const snapshot = await app.turns.get(first.turnId);
    assert.equal(snapshot.originalInputAvailable, false);
    assert.equal(snapshot.text, "");
    await assert.rejects(
      app.turns.start({
        conversationId: chat.id,
        clientRequestId: "removed",
        expectedTailId: first.turnId,
        text: "Explain our private design.",
        retryOf: first.turnId,
      }),
      { code: "RETRY_SOURCE_DELETED" },
    );
    assert.equal(
      (await app.workspace.getConversation(chat.id)).messages.length,
      0,
    );
    await app.evidence.restore(original.id);
    assert.equal(
      (await app.turns.get(first.turnId)).text,
      "Explain our private design.",
    );
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
