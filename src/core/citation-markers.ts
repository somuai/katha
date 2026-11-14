/** Shared citation notation, not a source-entailment check. IDs are validated by the host. */
export const sourceIdPattern = "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}";
export function sourceMarkerPattern() {
  const body =
    "(?:source[: ]*\\s*)?" +
    sourceIdPattern +
    "(?:\\s*,\\s*" +
    sourceIdPattern +
    ")*";
  return new RegExp("(?:\\[" + body + "\\]|【" + body + "】)", "gi");
}
export function sourceLinkPattern() {
  return new RegExp(
    "\\[[^\\]\\n]{1,200}\\]\\(katha-source:(" + sourceIdPattern + ")\\)",
    "gi",
  );
}
export function inlineSourceIds(text: string): string[] {
  const prose = text
    .replace(/(`{3,}|~{3,})[\s\S]*?\1/g, "")
    .replace(/(`+)[^\n]*?\1/g, "");
  const ids = [...prose.matchAll(sourceMarkerPattern())].flatMap(
    (m) => m[0].match(new RegExp(sourceIdPattern, "gi")) || [],
  );
  for (const match of prose.matchAll(sourceLinkPattern())) ids.push(match[1]);
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}
