import type { Source } from "./types.js";
import { selectPassages } from "./passages.js";
import { prepareCsvEvidence } from "./csv-summary.js";

/** Render eligible, already-materialized records only; never interpret them as a new answer. */
export function retainedEvidenceResponse(
  sources: Source[],
  question: string,
  hint: string,
  verification: boolean,
) {
  const file = question.match(
    /[\p{L}\p{N}_-][\p{L}\p{N}_.-]*\.(?:csv|pdf|png|jpe?g|webp|txt|md|json)\b/iu,
  )?.[0];
  const selected = sources
    .filter(
      (s) =>
        s.kind !== "web" &&
        s.role !== "assistant" &&
        (!file || s.title.toLowerCase().endsWith(file.toLowerCase())),
    )
    .sort(
      (a, b) =>
        Number(b.kind === "attachment") - Number(a.kind === "attachment"),
    )
    .slice(0, 3);
  if (!selected.length && !file) return undefined;
  const heading =
    "Evidence only — not a generated answer. Automatic answering is unavailable for this request.";
  if (!selected.length)
    return {
      answer: `${heading}\n\nNo eligible retained excerpt for ${file} was retrieved. I cannot answer from that file here. Check the Sources library or restore it from Trash if needed.`,
      sourceIds: [] as string[],
    };
  const sections = selected.map((source) => {
    const raw = source.interpretation || source.content;
    const table = source.title.toLowerCase().endsWith(".csv")
      ? prepareCsvEvidence(raw, question)
      : undefined;
    const label = table
      ? "Locally computed CSV facts"
      : String(source.metadata.method || "").includes("model") ||
          String(source.metadata.method || "").includes("vision")
        ? "Retained interpretation — verify against the original"
        : "Retained source excerpt";
    const text = table
      ? table.summary + "\n" + table.excerpt
      : selectPassages(raw, question + " " + hint, 900);
    return `**${label}: ${source.title}**\n\n> ${text.replaceAll("\n", "\n> ")}\n\n[Inspect source](katha-source:${source.id})`;
  });
  return {
    answer:
      heading +
      (verification
        ? " No current comparison was established; verification remains unresolved."
        : " No new interpretation or recommendations were generated.") +
      "\n\n" +
      sections.join("\n\n"),
    sourceIds: selected.map((s) => s.id),
  };
}
