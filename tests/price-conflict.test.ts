import test from "node:test";
import assert from "node:assert/strict";
import {
  supportedPriceConflict,
  priceHasNumericSupport,
} from "../src/core/pricing.ts";
test("equivalent monetary decimal spellings retain support without accepting a different amount", () => {
  const terms = {
    ...offer(25.5),
    sourceQuote:
      "Core USD 25.50 per seat per month, US, 20 seats, unlimited contacts, tax excluded.",
  };
  assert.equal(priceHasNumericSupport(terms, terms.sourceQuote), true);
  assert.equal(
    priceHasNumericSupport({ ...terms, amount: 25.51 }, terms.sourceQuote),
    false,
  );
  assert.equal(
    priceHasNumericSupport({ ...terms, currency: "EUR" }, terms.sourceQuote),
    false,
  );
});
const offer = (amount: number) => ({
  plan: "Core",
  amount,
  currency: "USD",
  region: "US",
  cadence: "month" as const,
  seats: 20,
  basis: "per_seat" as const,
  limits: "unlimited contacts",
  tax: "excluded" as const,
  sourceQuote: `Core USD ${amount} per seat per month, US, 20 seats, unlimited contacts, tax excluded.`,
});
test("conflicting offers require two complete like-for-like prices supported by retained text", () => {
  const a = offer(60),
    b = offer(70);
  const text = [a.sourceQuote, b.sourceQuote];
  assert.equal(supportedPriceConflict([a, b], text), true);
  assert.equal(supportedPriceConflict([a, offer(60)], text), false);
  assert.equal(supportedPriceConflict([a, b], [a.sourceQuote]), false);
  assert.equal(
    supportedPriceConflict([a, { ...b, region: "IN" }], text),
    false,
  );
  assert.equal(
    supportedPriceConflict([a, { ...b, amount: null }], text),
    false,
  );
});
