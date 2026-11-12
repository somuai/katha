// Select verbatim, question-relevant text from a retained observation. Never synthesize facts.
export function selectPassages(text: string, question: string, limit = 900) {
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
