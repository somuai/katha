import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";

test("turn usage includes planning and generation, while cache hits are not search dispatches", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-usage-"));
  const app = createKatha({
    directory,
    model: {
      async plan() {
        return {
          mode: "current",
          queries: ["official WAL documentation"],
          usage: { inputTokens: 40, outputTokens: 10 },
        };
      },
      async generate() {
        return {
          answer: "WAL permits concurrent readers and a writer.",
          usage: { inputTokens: 100, outputTokens: 20 },
        };
      },
    },
    search: {
      async search() {
        return [
          {
            title: "Documentation",
            url: "https://example.org/wal",
            content: "WAL allows readers and a writer concurrently.",
          },
        ];
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    for (let index = 0; index < 2; index++) {
      const current = await app.workspace.getConversation(chat.id);
      const request = await app.turns.start({
        conversationId: chat.id,
        clientRequestId: `usage-${index}`,
        expectedTailId: current.tailId,
        text: "Using the web, explain WAL.",
      });
      for await (const event of app.turns.events(request.turnId))
        if (event.type === "complete") break;
      const turn = await app.turns.get(request.turnId);
      assert.equal(turn.status, "COMPLETED");
      assert.deepEqual(turn.trace.usage, {
        inputTokens: 140,
        outputTokens: 30,
      });
      assert.equal(turn.trace.searchAttempts, 1);
      assert.equal(turn.trace.searchAdapterDispatches, index === 0 ? 1 : 0);
    }
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
