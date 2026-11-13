export interface PriceTerms {
  sourceQuote?: string;
  plan: string;
  amount: number;
  currency: string;
  region: string;
  cadence: "month" | "year" | "one_time";
  seats: number;
  basis: "per_seat" | "total";
  limits: string;
  tax: "included" | "excluded" | "unknown";
}
const dimensions = [
  "plan",
  "currency",
  "region",
  "cadence",
  "seats",
  "basis",
  "limits",
  "tax",
] as const;
export function completePriceTerms(value: any): value is PriceTerms {
  return (
    !!value &&
    typeof value === "object" &&
    Number.isFinite(value.amount) &&
    value.amount >= 0 &&
    Number.isInteger(value.seats) &&
    value.seats > 0 &&
    /^[A-Z]{3}$/.test(value.currency) &&
    /^[A-Z]{2}$/.test(value.region) &&
    (value.sourceQuote === undefined ||
      typeof value.sourceQuote === "string") &&
    ["month", "year", "one_time"].includes(value.cadence) &&
    ["per_seat", "total"].includes(value.basis) &&
    ["included", "excluded"].includes(value.tax) &&
    ["plan", "region", "limits"].every(
      (k) =>
        typeof value[k] === "string" &&
        value[k].trim() &&
        !/^(unknown|n\/a)$/i.test(value[k]),
    )
  );
}
export function comparePrices(baseline: unknown, current: unknown) {
  if (!completePriceTerms(baseline) || !completePriceTerms(current))
    return {
      comparable: false,
      reason:
        "Missing explicit plan, amount, currency, region, billing cadence, seats, basis, limits or tax treatment.",
    };
  const differences = dimensions.filter(
    (k) =>
      String(baseline[k]).trim().toLowerCase() !==
      String(current[k]).trim().toLowerCase(),
  );
  if (differences.length)
    return {
      comparable: false,
      reason: `Different ${differences.join(", ")}; these offers cannot establish a like-for-like price change.`,
    };
  const monthlyPerSeat = (p: PriceTerms) =>
    p.amount /
    (p.basis === "total" ? p.seats : 1) /
    (p.cadence === "year" ? 12 : 1);
  return {
    comparable: true,
    reason: "Same stated commercial terms.",
    equal: baseline.amount === current.amount,
    baselineMonthlyPerSeat:
      baseline.cadence === "one_time" ? null : monthlyPerSeat(baseline),
    currentMonthlyPerSeat:
      current.cadence === "one_time" ? null : monthlyPerSeat(current),
  };
}
export function supportedPriceConflict(
  alternatives: unknown,
  texts: string[],
): boolean {
  if (
    !Array.isArray(alternatives) ||
    alternatives.length < 2 ||
    alternatives.length > 5 ||
    !alternatives.every(completePriceTerms)
  )
    return false;
  if (
    !alternatives.every((offer) =>
      texts.some((text) => priceHasNumericSupport(offer, text)),
    )
  )
    return false;
  return alternatives.some((offer, i) =>
    alternatives.slice(i + 1).some((other) => {
      const comparison = comparePrices(offer, other);
      return comparison.comparable && comparison.equal === false;
    }),
  );
}
// Extracted numbers must at least occur in their linked records. Semantic support still needs review.
export function priceHasNumericSupport(quote: PriceTerms, text: string) {
  if (quote.sourceQuote) {
    if (!text.includes(quote.sourceQuote)) return false;
    text = quote.sourceQuote;
  }
  const pricePattern = new RegExp(
    `\\b${quote.currency}\\s*${String(quote.amount).replace(".", "\\.")}(?:\\.0+)?(?:[^\\d.]|$)`,
    "i",
  );
  const priceMatch = pricePattern.exec(text.replaceAll(",", ""));
  if (!priceMatch) return false;
  const passage = text.slice(
    Math.max(0, priceMatch.index - 120),
    priceMatch.index + 320,
  );
  const normalized = passage
    .toLowerCase()
    .replaceAll(",", "")
    .replace(/[-_]/g, " ");
  const words = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
  ];
  const amount = true; // The currency-bound number above is present in this passage.
  const regionAliases: Record<string, string[]> = {
    US: ["united states"],
    IN: ["india"],
    EU: ["europe", "european union"],
    CA: ["canada"],
    GB: ["united kingdom", "britain"],
  };
  const phrase = (term: string) =>
    normalized.includes(term.toLowerCase().replace(/[-_]/g, " "));
  const code = quote.region.toUpperCase();
  const region =
    (regionAliases[code] || []).some((r) => phrase(r)) ||
    (code === "IN"
      ? /(?:region|country)\s*[:=]?\s*IN\b/.test(passage)
      : new RegExp(`\\b${code.replace(/[^A-Z]/g, "")}\\b`).test(passage));
  const cadence =
    quote.cadence === "month"
      ? /monthly|per month|\/month/.test(normalized)
      : quote.cadence === "year"
        ? /annually|annual|per year|\/year/.test(normalized)
        : /one time|once|lifetime/.test(normalized);
  const seats = new RegExp(
    `\\b(${quote.seats}|${words[quote.seats] || "__no_word__"})\\s+(?:sales\\s+)?seats?\\b`,
  ).test(normalized);
  const basis =
    quote.basis === "per_seat"
      ? /per seat|each seat|\/seat/.test(normalized)
      : /total|all seats/.test(normalized);
  const tax =
    quote.tax === "included"
      ? /tax included|including tax|inclusive of tax/.test(normalized)
      : /tax excluded|excluding tax|exclusive of tax|before tax/.test(
          normalized,
        );
  return (
    amount &&
    phrase(quote.plan) &&
    phrase(quote.currency) &&
    region &&
    cadence &&
    seats &&
    basis &&
    phrase(quote.limits) &&
    tax
  );
}
