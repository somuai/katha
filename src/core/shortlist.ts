export function shortlistedVendors(texts: string[]) {
  // A follow-up may say only "five CRM tools". It must not shadow the
  // actual named list in an eligible historical user record.
  for (const text of texts) {
    const group = text.match(
      /\bshortlisted\s+([^.!?\n]+?)(?=\s+for\b|[.!?\n]|$)/i,
    )?.[1];
    const names = [
      ...new Set(
        group
          ?.split(/\s*,\s*|\s+and\s+/i)
          .map((n) => n.trim())
          .filter((n) => /^[A-Z][A-Za-z0-9 .&-]{0,35}$/.test(n)) || [],
      ),
    ];
    if (names.length >= 2 && names.length <= 10) return names;
  }
  return [];
}

/** Verification topics are independent: missing prices cannot suppress a release check. */
export function verificationTopics(question: string): ("price" | "release")[] {
  const topics: ("price" | "release")[] = [];
  if (/\b(?:price|prices|pricing|cost|costs|billing)\b/i.test(question))
    topics.push("price");
  if (
    /\b(?:releases?|launche?s?|launched|shipp?ed|shipping|features?|capabilit(?:y|ies))\b|something big|anything big/i.test(
      question,
    )
  )
    topics.push("release");
  return topics;
}
