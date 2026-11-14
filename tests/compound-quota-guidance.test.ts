import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";
import { createKathaAdapters } from "../src/providers/index.ts";

test("long compound provider waits fail the turn promptly instead of entering a premature retry", async () => {
  for (const duration of ["1h2m3.5s", "2m1s", "1d3h"]) {
    const directory = mkdtempSync(join(tmpdir(), "katha-quota-guidance-"));
    const adapter = createKathaAdapters({
      groqKey: "fixture",
      fetcher: (async () =>
        Response.json(
          {
            error: {
              message: `Rate limit reached. Please try again in ${duration}.`,
            },
          },
          { status: 429 },
        )) as typeof fetch,
    });
    const app = createKatha({
      directory,
      model: { generate: adapter.model.generate },
    });
    let turnId: string | undefined;
    try {
      const chat = await app.workspace.createConversation();
      const receipt = await app.turns.start({
        conversationId: chat.id,
        clientRequestId: duration,
        expectedTailId: null,
        text: "Hello",
      });
      const acceptedId = String(receipt.turnId);
      turnId = acceptedId;
      for await (const event of app.turns.events(acceptedId)) {
        if (
          event.type === "complete" ||
          (event.type === "progress" &&
            (event.data as { stage?: string }).stage === "waiting_for_quota")
        )
          break;
      }
      const snapshot = await app.turns.get(acceptedId);
      assert.equal(snapshot.status, "FAILED", duration);
      assert.match(snapshot.error || "", /wait would exceed two minutes/);
      assert.equal(snapshot.answer, "");
    } finally {
      if (turnId) await app.turns.cancel(turnId);
      app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
