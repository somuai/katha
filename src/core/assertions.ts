import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
// A sentence is a located assertion candidate, not a model-verified fact.
export function seedAssertions(
  db: Database.Database,
  sourceId: string,
  text: string,
) {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO assertions(id,source_id,start_offset,end_offset,text) VALUES(?,?,?,?,?)",
  );
  for (const piece of new Intl.Segmenter("en", {
    granularity: "sentence",
  }).segment(text)) {
    if (!piece.segment.trim()) continue;
    const leading = piece.segment.length - piece.segment.trimStart().length;
    const start = piece.index + leading,
      end = piece.index + piece.segment.trimEnd().length;
    insert.run(randomUUID(), sourceId, start, end, text.slice(start, end));
  }
}
