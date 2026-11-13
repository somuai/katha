import type { ModelInput } from "./types.js";
const normalize = (text: string) =>
  text.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
/** Guard explicit/attributed source quotations; ordinary drafts and paraphrases remain generative. */
export function unsupportedSourceQuotes(
  input: ModelInput,
  text: string,
  citations: string[],
) {
  const records = [...(input.baseline || []), ...(input.evidence || [])];
  if (!records.length) return [];
  const cited = new Set(citations);
  const selected = records.filter((s) => cited.has(s.id));
  const originals = [
    input.question,
    ...(selected.length ? selected : records).flatMap((s) => [
      s.title,
      s.sourceText || s.text,
    ]),
  ].map(normalize);
  const explicit =
    /\b(?:verbatim|exact (?:words|quote)|quotations?|quote (?:from|the|my|our|your))\b/i.test(
      input.question,
    );
  const prose = text.replace(/```[\s\S]*?```/g, "");
  const attributed = (prefix: string) =>
    /\b(?:(?:the|this|your|my|our)\s+)?(?:report|document|documentation|source|record|file|pdf|author)\s+(?:says?|said|states?|reads?|wrote|recorded)(?:\s+that)?\s*[:,—-]?\s*$/i.test(
      prefix,
    ) ||
    /\b(?:your|my|our)\s+contribution\s+(?:was|is)\s*[:,—-]?\s*$/i.test(
      prefix,
    ) ||
    /\b(?:verbatim|direct quote|quotation)\s*[:,—-]?\s*$/i.test(prefix) ||
    (!!input.activeSourceIds?.length &&
      /\b(?:it|he|she|they)\s+(?:says?|said|wrote|states?|reads?)\s*[:,—-]?\s*$/i.test(
        prefix,
      ));
  const quotes: string[] = [];
  for (const match of prose.matchAll(/“([^”]+)”|"([^"\n]+)"/g)) {
    const quote = match[1] || match[2];
    if (
      explicit ||
      attributed(prose.slice(Math.max(0, match.index! - 160), match.index))
    )
      quotes.push(quote);
  }
  for (const match of prose.matchAll(/(?:^|\n)((?:>[^\n]*(?:\n|$))+)/g))
    if (
      explicit ||
      attributed(prose.slice(Math.max(0, match.index! - 160), match.index))
    )
      quotes.push(match[1].replace(/^>\s?/gm, ""));
  return quotes.filter(
    (quote) => !originals.some((source) => source.includes(normalize(quote))),
  );
}
