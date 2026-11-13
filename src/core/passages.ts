type Contributor = { name: string; page: RegExpMatchArray };
const pagePattern = /\[Page\s+(\d+)\]\s*\n([\s\S]*?)(?=\[Page\s+\d+\]\s*\n|$)/g;
function contributors(text: string): Contributor[] {
  return [...text.matchAll(pagePattern)].flatMap((page) => {
    const name = page[2]
      .match(/Student:\s*(.+?)(?=\s+Roll\s+number:|\n|$)/i)?.[1]
      ?.trim();
    return name ? [{ name, page }] : [];
  });
}
function mentioned(text: string, authors: Contributor[]) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  const full = authors.filter((a) =>
    normalized.includes(a.name.toLowerCase().replace(/\s+/g, " ")),
  );
  if (full.length) return full;
  const tokens = new Set(normalized.match(/[\p{L}\p{N}]+/gu) || []);
  const common = new Set(
    "do did is am my of in on to and what who the role".split(" "),
  );
  return authors.filter((a) =>
    (a.name.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).some(
      (t) => t.length >= 2 && !common.has(t) && tokens.has(t),
    ),
  );
}
/** Names are resolved only from literal mentions and this retained document's contributor headers. */
export function documentNamedPeople(text: string, question: string): string[] {
  return mentioned(question, contributors(text)).map((a) => a.name);
}
function pageExcerpt(
  page: RegExpMatchArray,
  question: string,
  limit: number,
): string {
  const marker = `[Page ${page[1]}]\n`;
  if (page[0].trim().length <= limit) return page[0].trim();
  const roleQuestion =
    /\b(contributions?|role|findings?|responsibilit(?:y|ies)|what did|what .{0,50} did)\b/i.test(
      question,
    );
  const contribution = page[2].match(
    /Contribution(?: and findings)?:\s*[\s\S]*/i,
  )?.[0];
  if (roleQuestion && contribution) {
    const student = page[2].match(
      /Student:\s*(.+?)(?=\s+Roll\s+number:|\n|$)/i,
    )?.[1];
    const header = marker + (student ? `Student: ${student}\n` : "");
    return header + contribution.slice(0, Math.max(0, limit - header.length));
  }
  return (
    marker +
    selectPassages(
      page[2],
      question.replace(/\bpage\s*\d+\b/gi, ""),
      Math.max(0, limit - marker.length),
    )
  );
}
// Select verbatim, question-relevant text from a retained observation. Never synthesize facts.
export function selectPassages(
  text: string,
  question: string,
  limit = 900,
): string {
  if (limit <= 0) return "";
  const pages = [
    ...text.matchAll(
      /\[Page\s+(\d+)\]\s*\n([\s\S]*?)(?=\[Page\s+\d+\]\s*\n|$)/g,
    ),
  ];
  const pageHint = question.match(/\bpage\s*(\d+)\b/i);
  if (pageHint && pages.length) {
    const page = pages.find((p) => p[1] === pageHint[1]);
    return page
      ? pageExcerpt(page, question, limit)
      : `The retained PDF has no extracted physical page ${pageHint[1]}. PDF page numbers can differ from printed page numbers.`;
  }
  if (pages.length) {
    const authors = contributors(text);
    const named = mentioned(question, authors);
    if (named.length === 1) return pageExcerpt(named[0].page, question, limit);
    if (
      named.length > 1 ||
      (authors.length > 1 &&
        /\b(contributions?|role|responsibilit(?:y|ies)|what did (?:i|he|she|they))\b/i.test(
          question,
        ))
    ) {
      const choices = named.length > 1 ? named : authors;
      return (
        `The document has multiple named contribution sections. Do not assume which author the user means. Ask their name, or use an explicit page hint. Physical PDF pages:\n` +
        choices.map((a) => `[Page ${a.page[1]}] Student: ${a.name}`).join("\n")
      ).slice(0, limit);
    }
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
    .flatMap((p) =>
      p.length > Math.min(1400, limit) ? p.split(/(?<=[.!?])\s+|\n/) : [p],
    )
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
