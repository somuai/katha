import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";

test("a question about what a price observation can prove is explanatory rather than a price-change check", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-proof-question-"));
  let observed: boolean | undefined;
  const app = createKatha({
    directory,
    model: {
      async generate(context) {
        observed = context.verification;
        return {
          answer:
            "A price observation gives a value, not its effective date. Dated evidence is needed to establish timing.",
        };
      },
    },
    search: {
      async search() {
        return [
          {
            title: "Observation dates",
            url: "https://example.com/observations",
            content:
              "Observation time is distinct from a change's effective date.",
          },
        ];
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "price-alone",
      expectedTailId: null,
      text: "Using the web, explain why a current price alone cannot establish its change date.",
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    assert.equal(observed, false);
    const snapshot = await app.turns.get(receipt.turnId);
    assert.equal(snapshot.status, "COMPLETED");
    assert.match(snapshot.answer, /not its effective date/);
    assert.deepEqual(snapshot.comparisons, []);
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a real dated vendor-price question still takes the verification path", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-price-check-"));
  let observed: boolean | undefined;
  const app = createKatha({
    directory,
    clock: () => new Date("2026-11-13T12:00:00Z"),
    model: {
      async generate(context) {
        observed = context.verification;
        const current = context.evidence.find((s) => s.kind === "web")!;
        return {
          answer: "The comparison is unresolved.",
          comparisons: [
            {
              claim: "Alder Team price",
              status: "UNVERIFIED",
              baselineSourceIds: [context.baseline![0].id],
              evidenceSourceIds: [current.id],
              explanation:
                "Complete commercial terms and the effective date are not established.",
            },
          ],
        };
      },
    },
    search: {
      async search() {
        return [
          {
            title: "Alder Team current price",
            url: "https://example.com/alder",
            content: "Alder Team costs USD 25 per seat per month.",
          },
        ];
      },
    },
  });
  try {
    await app.evidence.import({
      name: "Alder Team retained quote",
      occurredAt: "2026-11-03",
      content: "Alder Team costs USD 20 per seat per month.",
    });
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "actual-price-check",
      expectedTailId: null,
      text: "Using the web, has Alder Team pricing changed since 3 November?",
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    const snapshot = await app.turns.get(receipt.turnId);
    assert.equal(observed, true);
    assert.equal(snapshot.status, "COMPLETED");
    assert.equal(snapshot.comparisons[0].status, "UNVERIFIED");
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
