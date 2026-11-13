import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";
const offer = (amount: number) =>
  `Alder Team: USD ${amount} per seat per month, US region, 20 seats, unlimited contacts, tax excluded.`;
const price = (amount: number) => ({
  plan: "Alder Team",
  amount,
  currency: "USD",
  region: "US",
  cadence: "month" as const,
  seats: 20,
  basis: "per_seat" as const,
  limits: "unlimited contacts",
  tax: "excluded" as const,
  sourceQuote: offer(amount),
});
async function verify(pricing: boolean, empty = false) {
  const directory = mkdtempSync(
    join(tmpdir(), "katha-verification-integrity-"),
  );
  const falseQuote = "Effective 2026-11-12, CSV export became available.";
  const unrelated =
    "Effective 2026-11-12, Alder Team introduced a new dark theme.";
  const app = createKatha({
    directory,
    clock: () => new Date("2026-11-13T10:00:00Z"),
    search: {
      async search() {
        return [
          {
            title: "Current documentation",
            url: "https://example.org/current",
            content: pricing
              ? offer(25) + "\n" + unrelated
              : "CSV export is available. No effective date is supplied.",
          },
        ];
      },
    },
    model: {
      async generate(c) {
        const web = c.evidence.find((s) => s.kind === "web")!;
        if (empty)
          return {
            answer: "The requested change took effect on 2026-11-12.",
            comparisons: [],
          };
        return {
          answer: "The requested change took effect on 2026-11-12.",
          comparisons: [
            {
              claim: pricing ? "Alder Team pricing" : "Export capability",
              status: "CHANGED_WITH_DATED_EVIDENCE" as const,
              explanation: "The requested change took effect on 2026-11-12.",
              baselineSourceIds: (c.baseline || []).map((s) => s.id),
              evidenceSourceIds: [web.id],
              effectiveAt: "2026-11-12",
              effectiveDateEvidence: {
                sourceId: web.id,
                quote: pricing ? unrelated : falseQuote,
              },
              ...(pricing
                ? { baselinePrice: price(20), currentPrice: price(25) }
                : {}),
            },
          ],
        };
      },
    },
  });
  try {
    await app.evidence.import({
      name: "Monday record",
      content: pricing ? offer(20) : "Export supports JSON only.",
      occurredAt: "2026-11-09",
    });
    const chat = await app.workspace.createConversation();
    const request = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "date-proof",
      expectedTailId: null,
      text: pricing
        ? "Has Alder Team pricing changed since Monday?"
        : "Has export capability changed since Monday?",
      timezone: "UTC",
    });
    for await (const event of app.turns.events(request.turnId))
      if (event.type === "complete") break;
    return await app.turns.get(request.turnId);
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
test("an invalid effective-date quote cannot survive in answer prose or structured dates", async () => {
  const turn = await verify(false);
  assert.equal(turn.status, "COMPLETED");
  assert.equal(turn.comparisons[0].status, "DIFFERS_CHANGE_TIME_UNKNOWN");
  assert.doesNotMatch(turn.answer, /2026-11-12/);
  assert.equal(turn.comparisons[0].effectiveAt, undefined);
});
test("a dated UI release cannot establish the date of a price change on the same page", async () => {
  const turn = await verify(true);
  assert.equal(turn.comparisons[0].status, "DIFFERS_CHANGE_TIME_UNKNOWN");
  assert.equal(turn.comparisons[0].effectiveAt, undefined);
  assert.doesNotMatch(turn.answer, /effective 2026-11-12/i);
});

test("a dated verification cannot replace its missing structured assessment with unvalidated prose", async () => {
  const turn = await verify(false, true);
  assert.equal(turn.comparisons[0].status, "UNVERIFIED");
  assert.doesNotMatch(turn.answer, /2026-11-12/);
  assert.match(turn.answer, /No structured comparison/);
});
