import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";

test("answer citing an interpreted source also exposes its effective correction", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-correction-cite-"));
  const app = createKatha({
    directory,
    clock: () => new Date("2026-11-12T12:00:00Z"),
    model: {
      async generate(context) {
        const original = context.evidence.find((s) => s.title === "Terms")!;
        assert.match(original.interpretation || "", /quota is eight/);
        return {
          answer: "The quota is eight and the region is Europe.",
          citations: [{ sourceId: original.id }],
        };
      },
    },
  });
  try {
    const original = await app.evidence.import({
      name: "Terms",
      content: "The quota is five. The region is Europe.",
    });
    const inspected = await app.evidence.inspect(original.sourceId);
    const assertion = inspected.assertions.find((a: any) =>
      a.text.includes("quota"),
    );
    assert.ok(assertion);
    const correction = await app.evidence.correct({
      sourceId: original.sourceId,
      assertionId: assertion.id,
      content: "The quota is eight.",
      mode: "CHANGE_FROM_NOW",
      effectiveAt: "2026-11-10T00:00:00Z",
    });
    const future = await app.evidence.correct({
      sourceId: original.sourceId,
      assertionId: assertion.id,
      content: "The quota is nine.",
      mode: "CHANGE_FROM_NOW",
      effectiveAt: "2026-11-20T00:00:00Z",
    });
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "correction-cite",
      expectedTailId: null,
      text: "What is our quota and region?",
    });
    let result: any;
    for (let i = 0; i < 100; i++) {
      result = await app.turns.get(receipt.turnId);
      if (["COMPLETED", "FAILED", "PARTIAL"].includes(result.status)) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(result.status, "COMPLETED");
    assert.ok(
      result.citations.some((c: any) => c.sourceId === original.sourceId),
    );
    assert.ok(
      result.citations.some((c: any) => c.sourceId === correction.sourceId),
    );
    assert.ok(result.sources.some((s: any) => s.id === correction.sourceId));
    assert.ok(
      !result.citations.some((c: any) => c.sourceId === future.sourceId),
    );
    assert.ok(!result.sources.some((s: any) => s.id === future.sourceId));
    assert.equal(
      (await app.evidence.inspect(original.sourceId)).content,
      "The quota is five. The region is Europe.",
    );
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
