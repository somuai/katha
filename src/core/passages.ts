// Select verbatim, question-relevant text from a retained observation. Never synthesize facts.
export function selectPassages(text: string, question: string, limit = 900) {
  const pages = [
    ...text.matchAll(
      /\[Page\s+(\d+)\]\s*\n([\s\S]*?)(?=\[Page\s+\d+\]\s*\n|$)/g,
    ),
  ];
  const pageHint = question.match(/\bpage\s*(\d+)\b/i);
  if (pageHint && pages.length) {
    const page = pages.find((p) => p[1] === pageHint[1]);
    return page
      ? page[0].trim().slice(0, limit)
      : `The retained PDF has no extracted physical page ${pageHint[1]}. PDF page numbers can differ from printed page numbers.`;
  }
  if (pages.length && /\b(contribution|contributions|role)\b/i.test(question)) {
    const authors = pages.flatMap((p) => {
      const name = p[2]
        .match(/Student:\s*(.+?)(?=\s+Roll\s+number:|\n|$)/i)?.[1]
        ?.trim();
      return name ? [{ name, page: p }] : [];
    });
    const named = authors.filter((a) =>
      question.toLowerCase().includes(a.name.toLowerCase()),
    );
    if (named.length === 1) return named[0].page[0].trim().slice(0, limit);
    if (authors.length > 1)
      return (
        `The document has multiple named contribution sections. Do not assume which author the user means. Ask their name, or use an explicit page hint. Physical PDF pages:\n` +
        authors.map((a) => `[Page ${a.page[1]}] Student: ${a.name}`).join("\n")
      ).slice(0, limit);
  }
  const stop = new Set(
    "using the web explain whether what which when where does do can could would should have has had are was were that this their there with from cite evidence sources source please".split(
      " ",
    ),
  );
  const terms = [
    ...new Set(question.toLowerCase().match(/[a-z0-9_]+/g) || []),
  ].filter((t) => t.length > 2 && !stop.has(t));
  const paragraphs = text
    .split(/\n\s*\n/)
    .flatMap((p) => (p.length > 1400 ? p.split(/(?<=[.!?])\s+|\n/) : [p]))
    .map((p, i) => {
      const lower = p.toLowerCase(),
        hits = terms.filter((t) => lower.includes(t)).length;
      const linkDensity = (p.match(/\]\(/g) || []).length;
      return {
        text: p,
        index: i,
        score:
          hits * 8 +
          Math.min(p.length, 400) / 100 -
          (linkDensity > 3 ? linkDensity * 3 : 0),
      };
    })
    .filter((p) => p.text.trim())
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (!paragraphs.length) return text.slice(0, limit);
  let output = "";
  for (const p of paragraphs) {
    if (output.length >= limit) break;
    output += (output ? "\n\n" : "") + p.text.slice(0, limit - output.length);
  }
  return output;
}
