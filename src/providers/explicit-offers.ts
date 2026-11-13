import {
  comparePrices,
  currencyAmountPattern,
  supportedPriceConflict,
  type PriceTerms,
} from "../core/pricing.js";
import type { Answer, Evidence, ModelInput, Comparison } from "./types.js";
type Offer = { terms: PriceTerms; source: Evidence };
/** Parse complete, explicitly labelled offers only. No defaults for missing terms. */
function offers(sources: Evidence[]): Offer[] {
  const result: Offer[] = [];
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
  for (const source of sources) {
    const raw = source.sourceText || source.text;
    const pattern =
      /([A-Za-z][A-Za-z0-9 .&/-]{0,99})(?::\s*|\s+costs\s+)([A-Z]{3})\s*(\d+(?:\.\d{1,2})?)\s+per seat per (month|year)\b([^\n]{0,400}?)\btax\s+(included|excluded)\b\.?/g;
    for (const match of raw.matchAll(pattern)) {
      const tail = match[5];
      // A monthly display price with an annual commitment is not a monthly
      // subscription. The compact price model cannot represent both dimensions.
      const billsYearly =
        /\bbilled\s+(?:annually|yearly|(?:per\s+)?year)\b/i.test(tail);
      const billsMonthly = /\bbilled\s+(?:monthly|(?:per\s+)?month)\b/i.test(
        tail,
      );
      if (
        (match[4] === "month" && billsYearly) ||
        (match[4] === "year" && billsMonthly)
      )
        continue;
      const regions = [
        ...[...tail.matchAll(/\bregion\s*[:=]?\s*(US|IN|EU|CA|GB)\b/gi)].map(
          (m) => m[1].toUpperCase(),
        ),
        ...[...tail.matchAll(/\b(US|IN|EU|CA|GB)\s+region\b/gi)].map((m) =>
          m[1].toUpperCase(),
        ),
        ...(/\bIndia region\b/i.test(tail) ? ["IN"] : []),
      ];
      const region = new Set(regions).size === 1 ? regions[0] : undefined;
      const counts = [
        ...tail.matchAll(
          /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+seats\b/gi,
        ),
      ].map((m) =>
        /^\d+$/.test(m[1]) ? Number(m[1]) : words.indexOf(m[1].toLowerCase()),
      );
      const limits = [
        ...tail.matchAll(
          /\b((?:unlimited|\d+)\s+(?:contacts|records|projects|requests|users))\b/gi,
        ),
      ].map((m) => m[1].toLowerCase());
      if (
        !region ||
        new Set(counts).size !== 1 ||
        !counts[0] ||
        new Set(limits).size !== 1
      )
        continue;
      result.push({
        source,
        terms: {
          plan: match[1].trim(),
          amount: Number(match[3]),
          currency: match[2],
          region: region.toUpperCase(),
          cadence: match[4] as "month" | "year",
          seats: counts[0],
          basis: "per_seat",
          limits: limits[0],
          tax: match[6] as "included" | "excluded",
          sourceQuote: match[0],
        },
      });
      if (result.length >= 30) return result;
    }
  }
  return result;
}
const identity = (offer: Offer) =>
  JSON.stringify({ ...offer.terms, sourceQuote: undefined });
export function explicitOfferAnswer(
  input: ModelInput,
  subject?: string,
): Answer | undefined {
  if (!/\b(price|pricing|cost|billing)\b/i.test(input.question)) return;
  const relevant = (offer: Offer) =>
    !subject ||
    offer.terms.plan.toLowerCase().startsWith(subject.toLowerCase() + " ") ||
    offer.terms.plan.toLowerCase() === subject.toLowerCase();
  const old = offers(input.baseline || []).filter(relevant);
  if (!old.length || new Set(old.map(identity)).size !== 1) return;
  const baseline = old[0];
  const current = offers(input.evidence || []).filter(
    (o) => o.terms.plan.toLowerCase() === baseline.terms.plan.toLowerCase(),
  );
  if (!current.length) return;
  const distinct = [...new Map(current.map((o) => [identity(o), o])).values()];
  const comparison: Comparison = {
    claim: `${baseline.terms.plan} pricing`,
    status: "UNVERIFIED",
    explanation: "Offers cannot establish a like-for-like comparison.",
    baselineSourceIds: [baseline.source.id],
    evidenceIds: [...new Set(current.map((o) => o.source.id))],
    baselinePrice: baseline.terms,
    extractionMethod: "explicit-offer-parser",
  };
  if (distinct.length > 1) {
    if (
      !current.some((o) =>
        /(?:^|[.!?;\n])\s*neither (?:offer )?supersedes\b/i.test(
          o.source.sourceText || o.source.text,
        ),
      )
    )
      return;
    if (
      !supportedPriceConflict(
        distinct.map((o) => o.terms),
        current.map((o) => o.source.sourceText || o.source.text),
      )
    )
      return;
    comparison.currentAlternatives = distinct.map((o) => o.terms);
    comparison.status = "CONFLICTING";
    comparison.explanation =
      "Retained current offers state different amounts for the same commercial terms; a unique current amount is not established.";
  } else {
    const now = distinct[0];
    comparison.currentPrice = now.terms;
    const checked = comparePrices(baseline.terms, now.terms);
    comparison.explanation = checked.reason;
    if (checked.comparable) {
      comparison.status = checked.equal
        ? "CURRENTLY_MATCHES"
        : "DIFFERS_CHANGE_TIME_UNKNOWN";
      comparison.explanation = checked.equal
        ? "The complete stated commercial terms and amount match."
        : `The stated amount differs (${baseline.terms.amount} to ${now.terms.amount} ${now.terms.currency}); change timing is not established.`;
      if (!checked.equal) {
        const text = now.source.sourceText || now.source.text;
        const amountPattern = currencyAmountPattern(
          now.terms.currency,
          now.terms.amount,
        );
        const dated = [
          ...text.matchAll(
            /\bEffective(?: on)?\s+(\d{4}-\d{2}-\d{2})\b(?:[^\n.!?]|\.(?=\d)){0,250}\.?/gi,
          ),
        ].filter(
          (m) =>
            (m[0].includes(now.terms.plan + " ") ||
              m[0].includes(now.terms.plan + ":")) &&
            amountPattern?.test(m[0]),
        );
        if (
          dated.length === 1 &&
          Date.parse(dated[0][1]) <=
            Date.parse(input.now || new Date().toISOString())
        ) {
          comparison.status = "CHANGED_WITH_DATED_EVIDENCE";
          comparison.effectiveAt = dated[0][1];
          comparison.effectiveDateEvidence = {
            sourceId: now.source.id,
            quote: dated[0][0],
          };
          comparison.explanation = `The stated price changes from ${baseline.terms.amount} to ${now.terms.amount} ${now.terms.currency} per seat per ${now.terms.cadence}, effective ${dated[0][1]}. The complete commercial terms match.`;
        }
      }
    }
  }
  return {
    text: comparison.explanation,
    citations: [
      ...new Set([...comparison.baselineSourceIds, ...comparison.evidenceIds]),
    ],
    comparisons: [comparison],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}
