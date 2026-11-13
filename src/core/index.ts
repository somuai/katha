import { shortlistedVendors } from "./shortlist.js";
import { retainedEvidenceResponse } from "./evidence-recovery.js";
import { selectPassages, documentNamedPeople } from "./passages.js";
import { effectiveDateInQuote } from "./dated-evidence.js";
import {
  comparePrices,
  priceHasNumericSupport,
  supportedPriceConflict,
} from "./pricing.js";
import { seedAssertions } from "./assertions.js";
import { migrate } from "./migrations.js";
import Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveDate, dateWindow } from "./temporal.js";
import { KathaError } from "./types.js";
import type {
  Source,
  Conversation,
  TurnInput,
  TurnSnapshot,
  TurnStatus,
  KathaOptions,
  RecallQuery,
  ImportInput,
  CorrectionInput,
  Citation,
  Comparison,
  TurnEvent,
  SearchResult,
} from "./types.js";
export * from "./types.js";
export { resolveDate, dateWindow } from "./temporal.js";
const TERMINAL = new Set<TurnStatus>([
  "COMPLETED",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
]);
const json = (v: unknown) => JSON.stringify(v);
const hash = (v: unknown) => createHash("sha256").update(json(v)).digest("hex");
const iso = (d: Date | string) => new Date(d).toISOString();
const compact = (s: string, n = 1800) =>
  s.length > n ? s.slice(0, n) + "…" : s;
const safeUrl = (url: string) => {
  try {
    return ["https:", "http:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};
const stopWords = new Set(
  "what did i we you the a an on about me my your have has had is are was were and or that this it to for in since last today yesterday can could would should please tell ask asked discuss discussed answer still correct now changed changes anything any them those our".split(
    " ",
  ),
);
const terms = (text: string) =>
  [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])].filter(
    (x) => x.length > 2 && !stopWords.has(x),
  );

export function createKatha(options: KathaOptions) {
  mkdirSync(options.directory, { recursive: true });
  mkdirSync(join(options.directory, "sources"), { recursive: true });
  const db = new Database(join(options.directory, "katha.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = FULL");
  db.pragma("busy_timeout = 3000");
  try {
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  const now = () => iso(options.clock?.() || new Date());
  const epoch = () =>
    Number(
      (db.prepare("SELECT value FROM meta WHERE key='epoch'").get() as any)
        .value,
    );
  let closed = false,
    active = 0,
    indexBusy = false;
  const running = new Map<string, AbortController>(),
    pending: string[] = [],
    listeners = new Map<string, Set<() => void>>();
  const event = (id: string, type: string, data: unknown) => {
    if (closed) return;
    const sequence = Number(
      (
        db
          .prepare(
            "SELECT coalesce(max(sequence),0)+1 AS n FROM events WHERE turn_id=?",
          )
          .get(id) as any
      ).n,
    );
    db.prepare("INSERT INTO events VALUES(?,?,?,?,?)").run(
      id,
      sequence,
      type,
      json(data),
      now(),
    );
    listeners.get(id)?.forEach((fn) => fn());
  };
  const setStatus = (
    id: string,
    status: TurnStatus,
    error: string | null = null,
  ) => {
    if (closed) return;
    db.prepare("UPDATE turns SET status=?,error=?,updated_at=? WHERE id=?").run(
      status,
      error,
      now(),
      id,
    );
    event(id, "status", { status, error });
  };
  db.prepare(
    "UPDATE turns SET status='INTERRUPTED',error='The process stopped before this turn completed.',updated_at=? WHERE status NOT IN ('COMPLETED','PARTIAL','FAILED','CANCELLED','INTERRUPTED')",
  ).run(now());
  function source(row: any): Source {
    return {
      id: row.id,
      kind: row.kind,
      role: row.role,
      conversationId: row.conversation_id,
      turnId: row.turn_id,
      title: row.title,
      content: row.content,
      recordedAt: row.recorded_at,
      occurredAt: row.occurred_at,
      occurredEnd: row.occurred_end,
      dateProvenance: row.date_provenance,
      version: row.version,
      deletedAt: row.deleted_at,
      invalidated: !!row.invalidated,
      metadata: JSON.parse(row.metadata_json),
    };
  }
  function requireSource(id: string) {
    const row = db.prepare("SELECT * FROM sources WHERE id=?").get(id) as any;
    if (!row)
      throw new KathaError("SOURCE_NOT_FOUND", "Source not found.", 404);
    return row;
  }
  function conversation(row: any): Conversation {
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      tailId: row.tail_id,
      deletedAt: row.deleted_at,
    };
  }
  function requireConversation(id: string) {
    const row = db
      .prepare("SELECT * FROM conversations WHERE id=?")
      .get(id) as any;
    if (!row)
      throw new KathaError(
        "CONVERSATION_NOT_FOUND",
        "Conversation not found.",
        404,
      );
    return row;
  }
  function addSource(
    input: Partial<Source> & {
      content: string;
      title: string;
      kind: Source["kind"];
      role: Source["role"];
    },
  ) {
    const id = input.id || randomUUID(),
      time = input.recordedAt || now();
    db.prepare(
      "INSERT INTO sources(id,kind,role,conversation_id,turn_id,title,content,recorded_at,occurred_at,occurred_end,date_provenance,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      input.kind,
      input.role,
      input.conversationId || null,
      input.turnId || null,
      input.title,
      input.content,
      time,
      input.occurredAt || null,
      input.occurredEnd || null,
      input.dateProvenance || "unknown",
      json(input.metadata || {}),
    );
    db.prepare("INSERT INTO source_fts(source_id,content) VALUES(?,?)").run(
      id,
      input.content,
    );
    seedAssertions(db, id, input.content);
    if (options.embedder)
      db.prepare(
        "INSERT OR IGNORE INTO jobs(source_id,version,model_id) VALUES(?,1,?)",
      ).run(id, options.embedder.modelId);
    return id;
  }
  function invalidateDependents(id: string) {
    const stack = [id],
      seen = new Set<string>();
    while (stack.length) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const r of db
        .prepare("SELECT answer_id FROM dependencies WHERE source_id=?")
        .all(current) as any[]) {
        db.prepare("UPDATE sources SET invalidated=1 WHERE id=?").run(
          r.answer_id,
        );
        stack.push(r.answer_id);
      }
    }
  }
  const check = () => {
    if (closed)
      throw new KathaError("WORKSPACE_CLOSED", "Workspace is closed.", 503);
  };
  const changed = () => {
    db.prepare("UPDATE meta SET value=value+1 WHERE key='epoch'").run();
    for (const [id, controller] of running) {
      controller.abort(new Error("Source memory changed."));
      setStatus(id, "CANCELLED", "Source memory changed. Please ask again.");
    }
  };

  async function processIndex() {
    if (indexBusy || closed || !options.embedder) return;
    indexBusy = true;
    try {
      while (!closed) {
        const job = db
          .prepare(
            "SELECT j.*,s.content,s.deleted_at,s.invalidated FROM jobs j JOIN sources s ON s.id=j.source_id WHERE j.status='pending' AND j.attempts<3 AND s.deleted_at IS NULL AND s.invalidated=0 ORDER BY s.ordinal LIMIT 1",
          )
          .get() as any;
        if (!job) break;
        db.prepare(
          "UPDATE jobs SET status='running',attempts=attempts+1 WHERE source_id=? AND version=? AND model_id=?",
        ).run(job.source_id, job.version, job.model_id);
        const e = epoch();
        try {
          const segments = options.embedder.segment
            ? await options.embedder.segment(job.content)
            : [];
          const vector = segments.length
            ? segments[0].vector
            : await options.embedder.embed(compact(job.content, 3500));
          if (closed) break;
          const current = requireSource(job.source_id);
          if (
            e !== epoch() ||
            current.deleted_at ||
            current.version !== job.version
          ) {
            db.prepare(
              "UPDATE jobs SET status='cancelled' WHERE source_id=?",
            ).run(job.source_id);
            continue;
          }
          if (!vector.length || vector.some((n) => !Number.isFinite(n)))
            throw new Error("Invalid embedding.");
          db.transaction(() => {
            db.prepare("DELETE FROM segments WHERE source_id=?").run(
              job.source_id,
            );
            for (const part of segments) {
              db.prepare("INSERT INTO segments VALUES(?,?,?,?,?,?)").run(
                job.source_id,
                job.model_id,
                part.startToken,
                part.endToken,
                part.text,
                json(part.vector),
              );
            }
          })();
          db.prepare("INSERT OR REPLACE INTO embeddings VALUES(?,?,?,?)").run(
            job.source_id,
            job.version,
            job.model_id,
            json(vector),
          );
          db.prepare(
            "UPDATE jobs SET status='ready',error=NULL WHERE source_id=?",
          ).run(job.source_id);
        } catch (error) {
          if (closed) break;
          db.prepare(
            "UPDATE jobs SET status=CASE WHEN attempts<3 THEN 'pending' ELSE 'failed' END,error=? WHERE source_id=?",
          ).run(String(error).slice(0, 200), job.source_id);
        }
      }
    } finally {
      indexBusy = false;
    }
  }
  // A process crash cannot leave enrichment permanently marked running.
  db.prepare("UPDATE jobs SET status='pending' WHERE status='running'").run();
  function eligibleSql(
    q: RecallQuery,
    cutoff?: number,
    chatSeq?: { id: string; seq: number },
    ownId?: string,
  ) {
    const predicates = [
        "s.deleted_at IS NULL",
        "s.invalidated=0",
        "(s.conversation_id IS NULL OR NOT EXISTS(SELECT 1 FROM conversations c WHERE c.id=s.conversation_id AND c.deleted_at IS NOT NULL))",
      ],
      args: any[] = [];
    if (q.conversationId) {
      predicates.push("s.conversation_id=?");
      args.push(q.conversationId);
    }
    if (q.from) {
      predicates.push(
        q.timeField === "recorded"
          ? "s.recorded_at>=?"
          : "coalesce(s.occurred_at,s.recorded_at)>=?",
      );
      args.push(iso(q.from));
    }
    if (q.to) {
      predicates.push(
        q.timeField === "recorded"
          ? "s.recorded_at<?"
          : "coalesce(s.occurred_at,s.recorded_at)<?",
      );
      args.push(iso(q.to));
    }
    // Effective time answers "when was it true?"; cutoff answers "when did we know?".
    if (q.original) predicates.push("s.kind!='correction'");
    const effective = iso(q.asOf || now());
    predicates.push(
      "(s.kind!='correction' OR EXISTS(SELECT 1 FROM corrections ce WHERE ce.source_id=s.id AND ce.effective_at<=?))",
    );
    args.push(effective);
    if (!q.original) {
      predicates.push(
        `NOT EXISTS(SELECT 1 FROM corrections old JOIN corrections newer ON newer.target_id=old.target_id AND newer.assertion_id IS old.assertion_id JOIN sources ns ON ns.id=newer.source_id JOIN sources os ON os.id=old.source_id WHERE old.source_id=s.id AND newer.effective_at<=? AND ns.deleted_at IS NULL AND ns.invalidated=0 AND (newer.effective_at>old.effective_at OR (newer.effective_at=old.effective_at AND ns.ordinal>os.ordinal)) ${cutoff !== undefined ? "AND ns.ordinal<=" + Number(cutoff) : ""})`,
      );
      args.push(effective);
    }
    if (!q.original)
      predicates.push(
        "NOT EXISTS(SELECT 1 FROM corrections c JOIN sources cs ON cs.id=c.source_id WHERE c.target_id=s.id AND c.mode IN ('CORRECT_PAST_RECORD','CHANGE_FROM_NOW') AND c.assertion_id IS NULL AND c.effective_at<='" +
          effective +
          "' AND cs.deleted_at IS NULL AND cs.invalidated=0" +
          (cutoff !== undefined ? " AND cs.ordinal<=" + Number(cutoff) : "") +
          ")",
      );
    if (cutoff !== undefined) {
      predicates.push(
        "(s.ordinal<=? OR s.id=? OR (s.role='assistant' AND s.turn_id IN (SELECT id FROM turns WHERE conversation_id=? AND seq<? AND status='COMPLETED')))",
      );
      args.push(cutoff, ownId || "", chatSeq?.id || "", chatSeq?.seq || 0);
    }
    return { where: predicates.join(" AND "), args };
  }
  function effectiveInterpretation(
    row: any,
    original: boolean,
    at: string,
    cutoff?: number,
  ) {
    if (original)
      return {
        interpretation: row.content,
        interpretationSourceIds: [] as string[],
      };
    let current = row;
    const lineage: string[] = [];
    const seen = new Set<string>([row.id]);
    for (;;) {
      const replacement = db
        .prepare(
          `SELECT cs.* FROM corrections c JOIN sources cs ON cs.id=c.source_id WHERE c.target_id=? AND c.assertion_id IS NULL AND c.effective_at<=? AND cs.deleted_at IS NULL AND cs.invalidated=0 ${cutoff !== undefined ? "AND cs.ordinal<=?" : ""} ORDER BY c.effective_at DESC,cs.ordinal DESC LIMIT 1`,
        )
        .get(current.id, at, ...(cutoff !== undefined ? [cutoff] : [])) as any;
      if (!replacement) break;
      if (seen.has(replacement.id) || seen.size >= 128)
        throw new KathaError(
          "INVALID_CORRECTION_LINEAGE",
          "Correction lineage is cyclic or exceeds 128 records.",
          409,
        );
      seen.add(replacement.id);
      lineage.push(replacement.id);
      current = replacement;
    }
    const eligible = db
      .prepare(
        `SELECT a.start_offset,a.end_offset,c.source_id,cs.content,c.effective_at,cs.ordinal FROM assertions a JOIN corrections c ON c.assertion_id=a.id JOIN sources cs ON cs.id=c.source_id WHERE a.source_id=? AND c.effective_at<=? AND cs.deleted_at IS NULL AND cs.invalidated=0 ${cutoff !== undefined ? "AND cs.ordinal<=?" : ""} ORDER BY c.effective_at DESC,cs.ordinal DESC`,
      )
      .all(current.id, at, ...(cutoff !== undefined ? [cutoff] : [])) as any[];
    const spans = new Map<number, any>();
    for (const change of eligible)
      if (!spans.has(change.start_offset))
        spans.set(change.start_offset, change);
    let text = current.content;
    for (const change of [...spans.values()].sort(
      (a, b) => b.start_offset - a.start_offset,
    ))
      text =
        text.slice(0, change.start_offset) +
        change.content +
        text.slice(change.end_offset);
    return {
      interpretation: text,
      interpretationSourceIds: [
        ...lineage,
        ...[...spans.values()].map((c) => c.source_id),
      ],
    };
  }
  async function recall(
    q: RecallQuery = {},
    internal?: {
      cutoff: number;
      chatSeq: { id: string; seq: number };
      ownId: string;
    },
  ) {
    check();
    const limit = Math.max(1, Math.min(q.limit || 40, 200)),
      offset = Math.max(0, q.offset || 0),
      filter = eligibleSql(
        q,
        internal?.cutoff,
        internal?.chatSeq,
        internal?.ownId,
      );
    const rows = db
      .prepare(
        "SELECT s.* FROM sources s WHERE " +
          filter.where +
          " ORDER BY s.ordinal DESC",
      )
      .all(...filter.args) as any[];
    const tokens = terms(q.text || ""),
      byId = new Map(rows.map((r) => [r.id, r]));
    const matches = new Map<
      string,
      { text: string; startToken: number; endToken: number }[]
    >();
    let ranking: string[] = [],
      methods: string[] = [];
    if (options.retrievalStrategy === "recent") {
      ranking = rows.slice(0, 8).map((r) => r.id);
      methods = ["recent-context-ablation"];
    } else if (q.from || q.to || !tokens.length) {
      ranking = rows.map((r) => r.id);
      methods = ["calendar"];
    } else {
      const query = tokens
        .map((t) => '"' + t.replaceAll('"', '""') + '"')
        .join(" OR ");
      let lexical: any[] = [];
      try {
        lexical = db
          .prepare(
            "SELECT source_id,bm25(source_fts) score FROM source_fts WHERE source_fts MATCH ? ORDER BY score LIMIT 200",
          )
          .all(query) as any[];
      } catch {}
      const ranks = new Map<string, number>();
      lexical
        .filter((r) => byId.has(r.source_id))
        .slice(0, 20)
        .forEach((r, i) => ranks.set(r.source_id, 1 / (60 + i + 1)));
      methods = ["lexical"];
      if (
        options.retrievalStrategy !== "lexical" &&
        options.embedder &&
        q.text &&
        (
          db
            .prepare("SELECT count(*) n FROM embeddings WHERE model_id=?")
            .get(options.embedder.modelId) as any
        ).n > 0
      ) {
        try {
          const vector = await Promise.race([
            options.embedder.embed(q.text),
            new Promise<number[]>((_, reject) => {
              const timeout = setTimeout(
                () =>
                  reject(new Error("Semantic retrieval is still preparing.")),
                500,
              );
              timeout.unref?.();
            }),
          ]);
          if (closed) throw new Error("Closed");
          const dense = (
            db
              .prepare(
                "SELECT source_id,vector_json,NULL AS text,0 AS start_token,0 AS end_token FROM embeddings e WHERE model_id=? AND NOT EXISTS(SELECT 1 FROM segments s WHERE s.source_id=e.source_id AND s.model_id=e.model_id) UNION ALL SELECT source_id,vector_json,text,start_token,end_token FROM segments WHERE model_id=?",
              )
              .all(options.embedder.modelId, options.embedder.modelId) as any[]
          )
            .filter((r) => byId.has(r.source_id))
            .map((r) => {
              const v = JSON.parse(r.vector_json);
              let dot = 0,
                a = 0,
                b = 0;
              for (let i = 0; i < Math.min(v.length, vector.length); i++) {
                dot += v[i] * vector[i];
                a += v[i] * v[i];
                b += vector[i] * vector[i];
              }
              return {
                id: r.source_id,
                score: dot / Math.sqrt(a * b || 1),
                text: r.text,
                startToken: r.start_token,
                endToken: r.end_token,
              };
            })
            .filter((r) => r.score > 0.2)
            .sort((a, b) => b.score - a.score)
            .slice(0, 20);
          const seen = new Set<string>();
          dense.forEach((r, i) => {
            if (seen.has(r.id)) return;
            seen.add(r.id);
            ranks.set(r.id, (ranks.get(r.id) || 0) + 1 / (60 + i + 1));
            if (r.text)
              matches.set(r.id, [
                {
                  text: r.text,
                  startToken: r.startToken,
                  endToken: r.endToken,
                },
              ]);
          });
          methods.push("semantic");
        } catch {
          methods.push("semantic-unavailable");
        }
      }
      ranking = [...ranks].sort((a, b) => b[1] - a[1]).map(([id]) => id);
      if (!ranking.length) {
        ranking = rows.slice(0, 8).map((r) => r.id);
        methods.push("recent-fallback");
      }
    }
    const currentFilter = eligibleSql(
      q,
      internal?.cutoff,
      internal?.chatSeq,
      internal?.ownId,
    );
    const stillEligible = new Set(
      (
        db
          .prepare("SELECT s.id FROM sources s WHERE " + currentFilter.where)
          .all(...currentFilter.args) as any[]
      ).map((r) => r.id),
    );
    ranking = ranking.filter((id) => stillEligible.has(id));
    return {
      sources: ranking.slice(offset, offset + limit).map((id) => ({
        ...source(byId.get(id)),
        ...effectiveInterpretation(
          byId.get(id),
          !!q.original,
          iso(q.asOf || now()),
          internal?.cutoff,
        ),
        ...(matches.has(id) ? { matches: matches.get(id) } : {}),
      })),
      total: ranking.length,
      hasMore: ranking.length > offset + limit,
      methods,
    };
  }
  const workspace = {
    async createConversation(title = "New conversation") {
      check();
      const id = randomUUID();
      db.prepare(
        "INSERT INTO conversations(id,title,created_at) VALUES(?,?,?)",
      ).run(id, title.trim().slice(0, 100) || "New conversation", now());
      return conversation(requireConversation(id));
    },
    async listConversations(options: { deleted?: boolean } = {}) {
      check();
      return (
        db
          .prepare(
            `SELECT * FROM conversations WHERE deleted_at IS ${options.deleted ? "NOT " : ""}NULL ORDER BY created_at DESC`,
          )
          .all() as any[]
      ).map(conversation);
    },
    async getConversation(id: string) {
      check();
      const c = requireConversation(id);
      return {
        ...conversation(c),
        messages: (
          db
            .prepare(
              "SELECT s.*,t.status FROM sources s LEFT JOIN turns t ON t.id=s.turn_id WHERE s.conversation_id=? AND s.kind='message' AND s.deleted_at IS NULL ORDER BY s.ordinal",
            )
            .all(id) as any[]
        ).map((r) => ({ ...source(r), status: r.status })),
      };
    },
    async renameConversation(id: string, title: string) {
      check();
      requireConversation(id);
      db.prepare("UPDATE conversations SET title=? WHERE id=?").run(
        title.trim().slice(0, 100) || "New conversation",
        id,
      );
      return conversation(requireConversation(id));
    },
    async trashConversation(id: string) {
      check();
      requireConversation(id);
      db.transaction(() => {
        db.prepare("UPDATE conversations SET deleted_at=? WHERE id=?").run(
          now(),
          id,
        );
        changed();
      })();
      return { id, deleted: true };
    },
    async restoreConversation(id: string) {
      check();
      requireConversation(id);
      db.transaction(() => {
        db.prepare("UPDATE conversations SET deleted_at=NULL WHERE id=?").run(
          id,
        );
        changed();
      })();
      return conversation(requireConversation(id));
    },
  };
  const evidence = {
    async import(input: ImportInput) {
      check();
      if (
        !input.name?.trim() ||
        typeof input.content !== "string" ||
        !input.content.trim()
      )
        throw new KathaError(
          "INVALID_SOURCE",
          "A name and extracted content are required.",
        );
      if (Buffer.byteLength(input.content) > 5 * 1024 * 1024)
        throw new KathaError("SOURCE_TOO_LARGE", "Source exceeds 5 MB.", 413);
      if (input.conversationId) requireConversation(input.conversationId);
      let occurredAt: string | null = null,
        occurredEnd: string | null = null;
      if (input.occurredAt) {
        try {
          if (/^\d{4}-\d{2}-\d{2}$/.test(input.occurredAt)) {
            const w = dateWindow(input.occurredAt, input.timezone || "UTC");
            occurredAt = iso(w.from);
            occurredEnd = iso(w.to);
          } else occurredAt = iso(input.occurredAt);
        } catch {
          throw new KathaError(
            "INVALID_DATE",
            "The source date or timezone is invalid.",
          );
        }
      }
      const id = db.transaction(() =>
        addSource({
          kind: "attachment",
          role: "document",
          title: input.name.slice(0, 200),
          content: input.content,
          conversationId: input.conversationId,
          occurredAt,
          occurredEnd,
          dateProvenance: input.occurredAt ? "user-confirmed" : "unknown",
          metadata: {
            ...input.metadata,
            mimeType: input.mimeType || "text/plain",
          },
        }),
      )();
      writeFileSync(
        join(options.directory, "sources", id + ".txt"),
        input.content,
        { mode: 0o600 },
      );
      void processIndex();
      return {
        sourceId: id,
        status: "ready",
        embeddingStatus: options.embedder ? "pending" : "unconfigured",
      };
    },
    async inspect(id: string) {
      check();
      const row = requireSource(id);
      const corrections = (
        db
          .prepare(
            "SELECT s.* FROM corrections c JOIN sources s ON s.id=c.source_id WHERE c.target_id=? ORDER BY s.ordinal",
          )
          .all(id) as any[]
      ).map(source);
      const jobs = db
        .prepare(
          "SELECT model_id,status,attempts,error FROM jobs WHERE source_id=?",
        )
        .all(id);
      const assertionRows = db
        .prepare(
          "SELECT * FROM assertions WHERE source_id=? ORDER BY start_offset",
        )
        .all(id) as any[];
      const assertions = assertionRows.map((a) => ({
        id: a.id,
        text: a.text,
        locator: { start: a.start_offset, end: a.end_offset },
        corrections: (
          db
            .prepare(
              "SELECT c.*,s.content,s.recorded_at,s.deleted_at FROM corrections c JOIN sources s ON s.id=c.source_id WHERE c.assertion_id=? ORDER BY c.effective_at,s.ordinal",
            )
            .all(a.id) as any[]
        ).map((c) => ({
          sourceId: c.source_id,
          content: c.content,
          mode: c.mode,
          effectiveAt: c.effective_at,
          recordedAt: c.recorded_at,
          deletedAt: c.deleted_at,
        })),
      }));
      return { ...source(row), corrections, assertions, indexing: jobs };
    },
    recall,
    async correct(input: CorrectionInput) {
      check();
      const target = requireSource(input.sourceId);
      if (target.deleted_at)
        throw new KathaError(
          "SOURCE_DELETED",
          "Restore the source before correcting it.",
          409,
        );
      if (!input.content.trim())
        throw new KathaError(
          "INVALID_CORRECTION",
          "Correction cannot be empty.",
        );
      if (!["CORRECT_PAST_RECORD", "CHANGE_FROM_NOW"].includes(input.mode))
        throw new KathaError(
          "INVALID_CORRECTION",
          "Choose whether this corrects a past record or changes it from now.",
        );
      if (
        input.assertionId &&
        !db
          .prepare("SELECT id FROM assertions WHERE id=? AND source_id=?")
          .get(input.assertionId, target.id)
      )
        throw new KathaError(
          "INVALID_ASSERTION",
          "Select an assertion belonging to this source.",
        );
      let time: string;
      try {
        time = input.effectiveAt
          ? iso(input.effectiveAt)
          : input.mode === "CORRECT_PAST_RECORD"
            ? target.occurred_at || target.recorded_at
            : now();
      } catch {
        throw new KathaError("INVALID_DATE", "Provide a valid effective date.");
      }
      if (
        !input.assertionId &&
        db
          .prepare(
            "SELECT c.id FROM corrections c JOIN sources s ON s.id=c.source_id WHERE c.target_id=? AND c.assertion_id IS NOT NULL AND c.effective_at>=? AND s.deleted_at IS NULL AND s.invalidated=0 LIMIT 1",
          )
          .get(target.id, time)
      )
        throw new KathaError(
          "CORRECTION_CONFLICT",
          "This replacement would strand scheduled fact corrections. Resolve those corrections first, or edit their current record.",
          409,
        );
      if (input.assertionId) {
        const replacement = db
          .prepare(
            "SELECT c.source_id FROM corrections c JOIN sources s ON s.id=c.source_id WHERE c.target_id=? AND c.assertion_id IS NULL AND c.effective_at<=? AND s.deleted_at IS NULL AND s.invalidated=0 ORDER BY c.effective_at DESC,s.ordinal DESC LIMIT 1",
          )
          .get(target.id, time) as any;
        if (replacement)
          throw new KathaError(
            "SOURCE_SUPERSEDED",
            "This record was replaced. Inspect the latest correction and edit its assertions instead.",
            409,
          );
      }
      const id = db.transaction(() => {
        const id = addSource({
          kind: "correction",
          role: "user",
          title: `Correction: ${target.title}`,
          content: input.content,
          conversationId: target.conversation_id,
          occurredAt:
            input.mode === "CORRECT_PAST_RECORD" ? target.occurred_at : time,
          occurredEnd:
            input.mode === "CORRECT_PAST_RECORD" ? target.occurred_end : null,
          dateProvenance: "user-confirmed",
          metadata: {
            targetId: target.id,
            mode: input.mode,
            assertionId: input.assertionId || null,
            effectiveAt: time,
          },
        });
        db.prepare(
          "INSERT INTO corrections(id,source_id,target_id,mode,effective_at,assertion_id) VALUES(?,?,?,?,?,?)",
        ).run(
          randomUUID(),
          id,
          target.id,
          input.mode,
          time,
          input.assertionId || null,
        );
        db.prepare("INSERT OR IGNORE INTO dependencies VALUES(?,?)").run(
          id,
          target.id,
        );
        return id;
      })();
      void processIndex();
      return { sourceId: id, targetId: target.id, mode: input.mode };
    },
    async trash(id: string) {
      check();
      requireSource(id);
      db.transaction(() => {
        db.prepare(
          "UPDATE sources SET deleted_at=?,version=version+1 WHERE id=?",
        ).run(now(), id);
        invalidateDependents(id);
        changed();
        db.prepare("UPDATE jobs SET status='cancelled' WHERE source_id=?").run(
          id,
        );
      })();
      return { sourceId: id, deleted: true };
    },
    async restore(id: string) {
      check();
      const retained = requireSource(id);
      if (JSON.parse(retained.metadata_json).permanentlyDeleted)
        throw new KathaError(
          "SOURCE_PURGED",
          "This source was permanently deleted.",
          409,
        );
      db.transaction(() => {
        db.prepare(
          "UPDATE sources SET deleted_at=NULL,version=version+1 WHERE id=?",
        ).run(id);
        changed();
        if (options.embedder) {
          const row = requireSource(id);
          db.prepare(
            "INSERT OR IGNORE INTO jobs(source_id,version,model_id) VALUES(?,?,?)",
          ).run(id, row.version, options.embedder.modelId);
        }
      })();
      void processIndex();
      return evidence.inspect(id);
    },
    async permanentlyDelete(id: string) {
      check();
      const row = requireSource(id);
      if (!row.deleted_at)
        throw new KathaError(
          "TRASH_FIRST",
          "Move the source to Trash before permanently deleting it.",
          409,
        );
      db.transaction(() => {
        invalidateDependents(id);
        changed();
        db.prepare(
          "DELETE FROM corrections WHERE source_id=? OR target_id=?",
        ).run(id, id);
        db.prepare("DELETE FROM source_fts WHERE source_id=?").run(id);
        db.prepare("DELETE FROM segments WHERE source_id=?").run(id);
        db.prepare("DELETE FROM assertions WHERE source_id=?").run(id);
        db.prepare("DELETE FROM embeddings WHERE source_id=?").run(id);
        db.prepare("DELETE FROM jobs WHERE source_id=?").run(id);
        db.prepare(
          "UPDATE sources SET content='',metadata_json=?,invalidated=1 WHERE id=?",
        ).run(json({ permanentlyDeleted: true }), id);
      })();
      const path = join(options.directory, "sources", id + ".txt");
      if (existsSync(path)) unlinkSync(path);
      return { sourceId: id, deleted: true, permanent: true };
    },
    async list(options: { deleted?: boolean } = {}) {
      check();
      return (
        db
          .prepare(
            `SELECT * FROM sources WHERE kind IN ('attachment','correction') AND deleted_at IS ${options.deleted ? "NOT " : ""}NULL ORDER BY ordinal DESC`,
          )
          .all() as any[]
      ).map(source);
    },
  };
  function getTurn(id: string): TurnSnapshot {
    check();
    const row = db.prepare("SELECT * FROM turns WHERE id=?").get(id) as any;
    if (!row) throw new KathaError("TURN_NOT_FOUND", "Turn not found.", 404);
    const ids = JSON.parse(row.source_ids_json) as string[];
    return {
      id: row.id,
      conversationId: row.conversation_id,
      status: row.status,
      text: JSON.parse(row.input_json).text,
      answer: row.answer,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      citations: JSON.parse(row.citations_json),
      comparisons: JSON.parse(row.comparisons_json),
      sources: ids
        .map((id) => db.prepare("SELECT * FROM sources WHERE id=?").get(id))
        .filter(Boolean)
        .map(source),
      trace: JSON.parse(row.trace_json),
    };
  }
  function update(
    id: string,
    values: {
      answer?: string;
      citations?: Citation[];
      comparisons?: Comparison[];
      sourceIds?: string[];
      trace?: Record<string, unknown>;
    },
  ) {
    if (closed) return;
    const current = getTurn(id);
    db.prepare(
      "UPDATE turns SET answer=?,citations_json=?,comparisons_json=?,source_ids_json=?,trace_json=?,updated_at=? WHERE id=?",
    ).run(
      values.answer ?? current.answer,
      json(values.citations ?? current.citations),
      json(values.comparisons ?? current.comparisons),
      json(values.sourceIds ?? current.sources.map((s) => s.id)),
      json(values.trace ?? current.trace),
      now(),
      id,
    );
  }
  async function searchOne(
    query: string,
    signal: AbortSignal,
    fresh: boolean,
  ): Promise<{
    query: string;
    results: SearchResult[];
    error?: string;
    cached?: boolean;
  }> {
    const key = hash({ query: query.trim().toLowerCase(), fresh: false });
    // Observations remain retained sources; this table is only a disposable cache.
    db.prepare("DELETE FROM search_cache WHERE expires_at<=?").run(now());
    const cached = db
      .prepare("SELECT * FROM search_cache WHERE key=? AND expires_at>?")
      .get(key, now()) as any;
    if (cached && !fresh)
      return { query, results: JSON.parse(cached.results_json), cached: true };
    const month = now().slice(0, 7);
    db.prepare("INSERT OR IGNORE INTO usage(month) VALUES(?)").run(month);
    const usage = db
      .prepare("SELECT search_credits FROM usage WHERE month=?")
      .get(month) as any;
    if (usage.search_credits >= 800)
      return {
        query,
        results: [],
        error: "The local monthly search budget is exhausted.",
      };
    if (!options.search)
      return {
        query,
        results: [],
        error: "Web search is not configured. Add TAVILY_API_KEY.",
      };
    db.prepare(
      "UPDATE usage SET search_credits=search_credits+1 WHERE month=?",
    ).run(month);
    const combined = AbortSignal.any([signal, AbortSignal.timeout(12000)]);
    try {
      const results = (
        await options.search.search(query, { signal: combined, fresh })
      )
        .filter((r) => safeUrl(r.url) && typeof r.content === "string")
        .slice(0, 5)
        .map((r) => ({
          ...r,
          content: compact(r.content, 24000),
          observedAt: r.observedAt || now(),
        }));
      if (closed || signal.aborted)
        return { query, results: [], error: "Cancelled" };
      db.prepare("INSERT OR REPLACE INTO search_cache VALUES(?,?,?,?)").run(
        key,
        json(results),
        now(),
        new Date(Date.parse(now()) + 15 * 60000).toISOString(),
      );
      db.prepare(
        "DELETE FROM search_cache WHERE key NOT IN (SELECT key FROM search_cache ORDER BY expires_at DESC, key LIMIT 1000)",
      ).run();
      return { query, results };
    } catch (error) {
      return {
        query,
        results: [],
        error: error instanceof Error ? error.message : "Search failed.",
      };
    }
  }
  async function run(id: string) {
    const row = db.prepare("SELECT * FROM turns WHERE id=?").get(id) as any;
    if (!row || TERMINAL.has(row.status) || closed) return;
    const controller = new AbortController();
    running.set(id, controller);
    let remaining = options.activeTimeoutMs || 60000,
      segmentStarted = Date.now(),
      quotaWait = 0;
    let timer = setTimeout(
      () => controller.abort(new Error("Turn exceeded the active deadline.")),
      remaining,
    );
    timer.unref?.();
    const initialEpoch = epoch();
    const valid = () => {
      if (closed || controller.signal.aborted || epoch() !== initialEpoch)
        throw new KathaError(
          "TURN_CANCELLED",
          "The turn was cancelled or its sources changed.",
          409,
        );
    };
    let lastDelta = 0,
      deltaBuffer = "",
      streamed = "";
    let recoveryContext:
      | {
          sources: Source[];
          question: string;
          hint: string;
          verification: boolean;
          trace: Record<string, unknown>;
          dependencies: string[];
        }
      | undefined;
    async function withQuota<T>(operation: () => Promise<T>): Promise<T> {
      for (let attempt = 0; ; attempt++) {
        try {
          return await operation();
        } catch (error) {
          valid();
          const e = error as { code?: string; retryAt?: number };
          if (e.code !== "RATE_LIMIT" || attempt >= 10) throw error;
          const delay = Math.max(
            250,
            (e.retryAt || Date.now() + 60000) - Date.now() + 100,
          );
          if (quotaWait + delay > 120000)
            throw new KathaError(
              "QUOTA_WAIT_EXCEEDED",
              "The free-tier quota wait would exceed two minutes. Please retry later.",
              429,
            );
          clearTimeout(timer);
          remaining -= Date.now() - segmentStarted;
          if (remaining <= 0)
            throw new KathaError(
              "TURN_TIMEOUT",
              "The active deadline was exhausted.",
              504,
            );
          quotaWait += delay;
          setStatus(id, "WAITING_FOR_QUOTA");
          event(id, "progress", {
            stage: "waiting_for_quota",
            retryAt: new Date(Date.now() + delay).toISOString(),
          });
          await new Promise<void>((resolve, reject) => {
            const done = () => {
              controller.signal.removeEventListener("abort", aborted);
              resolve();
            };
            const wait = setTimeout(done, delay);
            function aborted() {
              clearTimeout(wait);
              reject(
                new KathaError(
                  "TURN_CANCELLED",
                  "The turn was cancelled.",
                  409,
                ),
              );
            }
            controller.signal.addEventListener("abort", aborted, {
              once: true,
            });
          });
          valid();
          segmentStarted = Date.now();
          timer = setTimeout(
            () =>
              controller.abort(new Error("Turn exceeded the active deadline.")),
            remaining,
          );
          timer.unref?.();
          setStatus(id, "RUNNING");
        }
      }
    }
    try {
      const input = JSON.parse(row.input_json) as TurnInput;
      setStatus(id, "RUNNING");
      let window;
      try {
        window = resolveDate(
          input.text,
          new Date(row.created_at),
          input.timezone || "UTC",
        );
      } catch {
        throw new KathaError(
          "INVALID_DATE",
          "That date or timezone is invalid. Please clarify.",
        );
      }
      let verification =
        /\b(changed?|still (?:correct|true|accurate|valid|right|available|supported|include|offer|provide|allow|require|exist|work|use|match(?:es)?|costs?|the same)|correct|current|pricing|latest|since|verify|update[ds]?)\b/i.test(
          input.text,
        ) &&
        (/\b(since|still (?:correct|true|accurate|valid|right|available|supported|include|offer|provide|allow|require|exist|work|use|match(?:es)?|costs?|the same)|changed?|correct|verify)\b/i.test(
          input.text,
        ) ||
          !!window) &&
        !(
          /\b(observation|snapshot|search failure)\b/i.test(input.text) &&
          /\b(establish|prove|mean)\b/i.test(input.text)
        );
      const explicitChatRecall =
        /\bwhat (?:did|have) (?:i|we) (?:ask|say|tell|decide|record|discuss|shortlist|upload|attach)\b|\bwhat (?:was|were) (?:my|our) (?:questions?|decisions?)\b/i.test(
          input.text,
        );
      const fileContentDate =
        !explicitChatRecall &&
        /\b(attendance|rows?|columns?|csv|spreadsheet|pdf|document|attached|uploaded)\b/i.test(
          input.text,
        );
      const historical =
        !fileContentDate &&
        !!window &&
        (/\b(what|asked?|said|discuss|shortlist|decid|remember)\b/i.test(
          input.text,
        ) ||
          verification);
      const originalRequested =
        historical ||
        (/\boriginal(?:ly)?\b/i.test(input.text) &&
          /\b(?:say|said|record|statement|quote|message|note|file|document|report|pdf)\b/i.test(
            input.text,
          ));
      const own = db
        .prepare(
          "SELECT id FROM sources WHERE turn_id=? AND role='user' LIMIT 1",
        )
        .get(id) as any;
      const scope =
        input.memoryScope === "conversation" ? input.conversationId : undefined;
      const query: RecallQuery = {
        text: input.text,
        conversationId: scope,
        limit: historical ? 200 : 20,
        original: originalRequested,
        asOf: row.created_at,
      };
      if (historical && window) {
        query.from = window.from;
        query.to = window.to;
        query.timeField = "occurred";
      }
      const recalled = await recall(query, {
        cutoff: row.cutoff,
        chatSeq: { id: input.conversationId, seq: row.seq },
        ownId: own.id,
      });
      valid();
      let local: Source[] = recalled.sources.filter(
        (s) => s.id !== own.id && s.kind !== "web",
      );
      const retrievalHints: string[] = [];
      const referenceDependencies = new Set<string>();
      if (
        !historical &&
        /\b(my (?:name|contributions?|role|identity)|who am i|about me|what did i (?:do|build|contribute))\b/i.test(
          input.text,
        )
      ) {
        const identity = await recall(
          {
            text: "my name is",
            conversationId: scope,
            limit: 5,
            asOf: row.created_at,
          },
          {
            cutoff: row.cutoff,
            chatSeq: { id: input.conversationId, seq: row.seq },
            ownId: own.id,
          },
        );
        valid();
        const stated = identity.sources.filter(
          (s) =>
            s.kind === "message" &&
            s.role === "user" &&
            /\bmy name is\b/i.test(s.interpretation || s.content),
        );
        for (const source of stated.slice(0, 3)) {
          retrievalHints.push(source.interpretation || source.content);
          if (!local.some((s) => s.id === source.id)) local.unshift(source);
        }
      }
      // Date-specific questions about what was asked refer to original user
      // messages, rather than every attachment or unrelated answer on that day.
      if (
        historical &&
        /\bwhat did i ask\b|\bwhat (?:was|were) my questions?\b/i.test(
          input.text,
        )
      ) {
        local = local.filter((s) => s.kind === "message" && s.role === "user");
      }
      // The visitor can provide the shortlist in the question itself. This is
      // evidence of their present statement, not evidence of historical prices.
      if (historical && verification && !local.length) {
        const group = input.text.match(
          /\bshortlisted\s+([^.!?\n]+?)(?=\s+for\b|[.!?\n]|$)/i,
        )?.[1];
        const names =
          group
            ?.split(/\s*,\s*|\s+and\s+/i)
            .map((n) => n.trim())
            .filter((n) => /^[A-Z][A-Za-z0-9 .&-]{0,35}$/.test(n)) || [];
        if (names.length >= 2 && names.length <= 10)
          local.push(source(requireSource(own.id)));
      }
      let previousObservationIds: string[] = [];
      if (
        verification &&
        /since (?:your |the |our )?last (?:check|verification)/i.test(
          input.text,
        )
      ) {
        const previous = db
          .prepare(
            "SELECT v.* FROM verification_runs v JOIN turns t ON t.id=v.turn_id WHERE t.conversation_id=? AND t.seq<? AND t.status='COMPLETED' ORDER BY t.seq DESC LIMIT 1",
          )
          .get(input.conversationId, row.seq) as any;
        if (previous) {
          previousObservationIds = JSON.parse(previous.evidence_ids_json);
          local = previousObservationIds
            .map((sourceId) =>
              db
                .prepare(
                  "SELECT * FROM sources WHERE id=? AND deleted_at IS NULL AND invalidated=0",
                )
                .get(sourceId),
            )
            .filter(Boolean)
            .map(source);
        }
      }
      const activeSourceIds = new Set<string>();
      for (const attachmentId of input.attachmentIds || []) {
        const attachment = source(requireSource(attachmentId));
        if (attachment.deletedAt || attachment.invalidated)
          throw new KathaError(
            "SOURCE_DELETED",
            "An attached source was removed before execution.",
            409,
          );
        const existing = local.findIndex((s) => s.id === attachmentId);
        const selected = {
          ...(existing >= 0 ? local.splice(existing, 1)[0] : attachment),
          ...effectiveInterpretation(
            requireSource(attachmentId),
            originalRequested,
            row.created_at,
            row.cutoff,
          ),
        };
        local.unshift(selected);
        activeSourceIds.add(selected.id);
      }
      // Resolve ordinary follow-ups to the most recent attachments in this conversation.
      // Apply the acceptance cutoff and deletion state so newer or removed files cannot leak in.
      if (
        !historical &&
        !input.attachmentIds?.length &&
        /\b(this|that|these|those|it|file|document|csv|pdf|data|spreadsheet|pages?|contributions?|role|he|she|his|her|they|their|them)\b/i.test(
          input.text,
        )
      ) {
        const prior = db
          .prepare(
            "SELECT input_json FROM turns WHERE conversation_id=? AND seq<? AND status IN ('COMPLETED','PARTIAL','FAILED','CANCELLED','INTERRUPTED') AND json_array_length(json_extract(input_json,'$.attachmentIds'))>0 ORDER BY seq DESC LIMIT 1",
          )
          .all(input.conversationId, row.seq) as { input_json: string }[];
        const previous = prior
          .map(
            (t) =>
              JSON.parse(t.input_json).attachmentIds as string[] | undefined,
          )
          .find((ids) => ids?.length);
        for (const sourceId of previous || []) {
          const eligible = db
            .prepare(
              "SELECT * FROM sources WHERE id=? AND ordinal<=? AND deleted_at IS NULL AND invalidated=0",
            )
            .get(sourceId, row.cutoff) as any;
          if (eligible) {
            const existing = local.findIndex((s) => s.id === sourceId);
            const selected = {
              ...(existing >= 0
                ? local.splice(existing, 1)[0]
                : source(eligible)),
              ...effectiveInterpretation(
                eligible,
                originalRequested,
                row.created_at,
                row.cutoff,
              ),
            };
            local.unshift(selected);
            activeSourceIds.add(selected.id);
          }
        }
      }
      // Exact historical recall must preserve the original questions and paired responses.
      if (historical) {
        for (const s of [...local]) {
          if (s.role !== "user" || !s.turnId) continue;
          const answer = db
            .prepare(
              "SELECT s.* FROM sources s JOIN turns t ON t.id=s.turn_id WHERE s.turn_id=? AND s.role='assistant' AND s.deleted_at IS NULL AND s.invalidated=0 AND t.status='COMPLETED' AND (s.ordinal<=? OR (s.conversation_id=? AND t.seq<?))",
            )
            .get(s.turnId, row.cutoff, input.conversationId, row.seq) as any;
          if (answer && !local.some((x) => x.id === answer.id))
            local.push(source(answer));
        }
      }
      const trace: Record<string, unknown> = {
        activeSourceIds: [...activeSourceIds],
        recordView: originalRequested ? "original" : "effective",
        resolvedDate: window || null,
        referenceClock: row.created_at,
        timezone: input.timezone || "UTC",
        retrievalMethods: recalled.methods,
        baselineSourceIds: local.flatMap((s) => [
          s.id,
          ...(s.interpretationSourceIds || []),
        ]),
        previousObservationIds,
        searches: [],
        coverage: null,
      };
      update(id, {
        sourceIds: local.flatMap((s) => [
          s.id,
          ...(s.interpretationSourceIds || []),
        ]),
        trace,
      });
      event(id, "sources", { sources: local });
      const asksRetainedPast =
        explicitChatRecall ||
        /\bwhat\b.{0,100}\b(?:did|have)\s+(?:i|we)\b.{0,60}\b(?:discuss|record|say|decide|shortlist)\b/i.test(
          input.text,
        );
      const asksPersonalFile =
        /\b(?:summarize|quote|read|analy[sz]e|extract)\b.{0,60}\b(?:my|this|that|attached|uploaded|removed|deleted)\b.{0,60}\b(?:file|pdf|csv|note|report|document|image)\b/i.test(
          input.text,
        );
      if (
        !historical &&
        !local.length &&
        (asksRetainedPast || asksPersonalFile)
      ) {
        const answer =
          "I could not find an eligible retained source for that request. Attach or import the earlier file or notes, or choose another retained source; I cannot reconstruct missing or deleted content.";
        update(id, { answer, trace: { ...trace, missingBaseline: true } });
        saveAnswer(id, answer, []);
        setStatus(id, "COMPLETED");
        event(id, "complete", getTurn(id));
        return;
      }
      if (historical && !local.length) {
        update(id, {
          answer: `I could not find a retained conversation or dated source for ${window!.label}. I cannot reconstruct that history or verify changes without a baseline. You can import the earlier notes and confirm their date.`,
        });
        saveAnswer(id, getTurn(id).answer, []);
        setStatus(id, "COMPLETED");
        event(id, "complete", getTurn(id));
        return;
      }
      if (historical && !verification) {
        const answer =
          (/\btoday[’']s date\b/i.test(input.text)
            ? `Today's date is ${resolveDate("today", new Date(row.created_at), input.timezone)?.label}.\n\n`
            : "") +
          `Here is the retained record for ${window!.label}:\n\n` +
          local
            .map(
              (s) =>
                `**${s.title}** (${s.role})\n\n> ${s.content.replaceAll("\n", "\n> ")}\n\n[Source ${s.id.slice(0, 8)}](katha-source:${s.id})`,
            )
            .join("\n\n");
        update(id, {
          answer,
          citations: local.map((s) => ({ sourceId: s.id })),
        });
        saveAnswer(
          id,
          answer,
          local.flatMap((s) => [s.id, ...(s.interpretationSourceIds || [])]),
        );
        setStatus(id, "COMPLETED");
        event(id, "complete", getTurn(id));
        return;
      }
      const history = (
        db
          .prepare(
            "SELECT s.* FROM sources s LEFT JOIN turns t ON t.id=s.turn_id WHERE s.conversation_id=? AND s.id<>? AND s.deleted_at IS NULL AND s.invalidated=0 AND s.kind='message' AND (s.ordinal<=? OR (t.seq<? AND t.status='COMPLETED')) ORDER BY s.ordinal DESC LIMIT 12",
          )
          .all(input.conversationId, own.id, row.cutoff, row.seq) as any[]
      )
        .reverse()
        .map(source);
      if (!historical) {
        const pronoun = /\b(he|she|his|her|they|their|them)\b/i.test(
          input.text,
        );
        const previous = db
          .prepare(
            "SELECT trace_json FROM turns WHERE conversation_id=? AND seq<? AND status IN ('COMPLETED','PARTIAL','FAILED','CANCELLED','INTERRUPTED') ORDER BY seq DESC LIMIT 1",
          )
          .get(input.conversationId, row.seq) as
          { trace_json: string } | undefined;
        const previousRefs = previous
          ? JSON.parse(previous.trace_json).documentReferences || []
          : [];
        const references: {
          sourceId: string;
          version: number;
          names: string[];
          mentionSourceId: string;
        }[] = [];
        const documents = local.filter(
          (s) => s.kind === "attachment" && /\[Page\s+\d+\]/.test(s.content),
        );
        for (const document of documents) {
          const content = document.interpretation || document.content;
          let names = documentNamedPeople(content, input.text),
            mentionSourceId = own.id;
          if (!names.length && pronoun) {
            const retained = previousRefs.find(
              (ref: any) =>
                ref.sourceId === document.id &&
                ref.version === document.version &&
                Array.isArray(ref.names) &&
                ref.names.length &&
                ref.names.every(
                  (name: unknown) =>
                    typeof name === "string" &&
                    documentNamedPeople(content, name).includes(name),
                ),
            );
            if (retained) {
              const mention = db
                .prepare(
                  "SELECT s.* FROM sources s LEFT JOIN turns t ON t.id=s.turn_id WHERE s.id=? AND s.conversation_id=? AND s.role='user' AND s.deleted_at IS NULL AND s.invalidated=0 AND (s.ordinal<=? OR (t.seq<? AND t.status='COMPLETED'))",
                )
                .get(
                  retained.mentionSourceId,
                  input.conversationId,
                  row.cutoff,
                  row.seq,
                ) as any;
              if (mention) {
                names = retained.names;
                mentionSourceId = mention.id;
              }
            }
            if (!names.length)
              for (const prior of [...history].reverse()) {
                if (prior.role !== "user") continue;
                const found = documentNamedPeople(
                  content,
                  prior.interpretation || prior.content,
                );
                if (found.length) {
                  names = found;
                  mentionSourceId = prior.id;
                  break;
                }
              }
            if (names.length)
              retrievalHints.push(
                names.length === 1
                  ? `Document follow-up about ${names[0]}.`
                  : `Ambiguous document follow-up: ${names.join(" or ")}. Ask which person.`,
              );
          }
          if (names.length) {
            references.push({
              sourceId: document.id,
              version: document.version,
              names,
              mentionSourceId,
            });
            referenceDependencies.add(mentionSourceId);
          }
        }
        trace.documentReferences = references;
      }
      recoveryContext = {
        sources: local.filter((s) => s.id !== own.id),
        question: input.text,
        hint: retrievalHints.join(" "),
        verification,
        trace,
        dependencies: [...referenceDependencies],
      };
      let web: Source[] = [],
        searches: any[] = [];
      const sourcesOnly =
        /\b(?:only|solely|exclusively)\s+(?:from\s+|using\s+|use\s+)?(?:my\s+|the\s+|our\s+)?(?:uploaded\s+|saved\s+|provided\s+)?(?:sources?|files?|documents?|data|records?)\b|\b(?:sources?|files?|documents?)\s+only\b|\b(?:do not|don't|without)\s+(?:use\s+|using\s+|search\s+|searching\s+)?(?:the\s+)?(?:web|internet|online)\b/i.test(
          input.text,
        );
      const personalMemory =
        /\b(my|our|we|remember|i said|i told|i asked)\b/i.test(input.text) ||
        !!input.attachmentIds?.length;
      // Freshness language is not permission to export a private register to
      // search. A public product/market question is a distinct evidence need.
      const liveMarketQuote =
        /\b(?:latest|current|today|now|live)\b/i.test(input.text) &&
        /\b(?:stock|share|ticker|equity|nvidia|nvda)\b/i.test(input.text) &&
        !/\b(?:inventory|warehouse|in stock|my shares|my portfolio)\b/i.test(
          input.text,
        );
      const publicFactQuestion =
        liveMarketQuote ||
        /\b(?:pricing|subscription|release(?:s| notes)?|hosting|vendor (?:pricing|releases?|updates?)|product updates?|market|official (?:plans?|documentation)|CRM (?:tools?|software|options?))\b/i.test(
          input.text,
        );
      const privateRecordQuestion =
        /\b(?:attendance|accounts?|account balances?|customers?|leads?|invoices?|payroll|employees?|students?|rows?|columns?|register|spreadsheet)\b/i.test(
          input.text,
        );
      const hasPrivateSources =
        !!input.attachmentIds?.length ||
        local.some((s) => s.kind === "attachment");
      const retainedDecisionQuestion =
        /\b(?:our|my|retained|saved)\s+records?\b/i.test(input.text) &&
        /\b(?:selected|selection|decided|decision|chose|chosen)\b/i.test(
          input.text,
        );
      const privateFileTask =
        !publicFactQuestion &&
        (retainedDecisionQuestion ||
          (hasPrivateSources && (!verification || privateRecordQuestion)) ||
          (personalMemory && privateRecordQuestion));
      if (privateFileTask || sourcesOnly) verification = false;
      if (recoveryContext) recoveryContext.verification = verification;
      let currentQuestion =
        !sourcesOnly &&
        !privateFileTask &&
        (verification ||
          (/\b(latest|current|today|news|pricing|price|search|web|recent|release|what is|who is)\b/i.test(
            input.text,
          ) &&
            !personalMemory));
      let queries: string[] = [];
      // Explicitly labelled decisions are stronger evidence than a guessed
      // search target. This deliberately covers labels, not inferred topics.
      const shortlistLabels = [
        ...new Set(
          local.flatMap((s) =>
            [
              ...s.content.matchAll(
                /\b([A-Za-z][A-Za-z0-9-]*)\s+shortlist\s*:/gi,
              ),
            ].map((m) => m[1]),
          ),
        ),
      ];
      const ambiguousShortlist =
        /\bshortlist\b/i.test(input.text) &&
        shortlistLabels.length > 1 &&
        !shortlistLabels.some((label) =>
          input.text.toLowerCase().includes(label.toLowerCase()),
        );
      if (ambiguousShortlist) {
        const answer = `Which shortlist do you mean: ${shortlistLabels.join(" or ")}?`;
        update(id, {
          answer,
          sourceIds: local.map((s) => s.id),
          trace: { ...trace, clarification: true },
        });
        saveAnswer(
          id,
          answer,
          local.flatMap((s) => [s.id, ...(s.interpretationSourceIds || [])]),
        );
        setStatus(id, "COMPLETED");
        event(id, "complete", getTurn(id));
        return;
      }
      if (options.model?.plan && !sourcesOnly && !privateFileTask) {
        event(id, "progress", {
          stage: "planning",
          label:
            "Choosing sources and checking whether fresh evidence is needed",
        });
        const plan = await withQuota(() =>
          options.model!.plan!({
            question: input.text,
            activeSourceIds: [...activeSourceIds],
            history,
            evidence: local,
            baseline: local,
            timezone: input.timezone,
            now: row.created_at,
            verification,
            signal: controller.signal,
          }),
        );
        valid();
        if (plan.clarification?.trim()) {
          update(id, {
            answer: plan.clarification.trim(),
            sourceIds: local.map((s) => s.id),
            trace: { ...trace, clarification: true },
          });
          saveAnswer(
            id,
            plan.clarification.trim(),
            local.flatMap((s) => [s.id, ...(s.interpretationSourceIds || [])]),
          );
          setStatus(id, "COMPLETED");
          event(id, "complete", getTurn(id));
          return;
        }
        queries = plan.queries;
        if (plan.mode === "current" || plan.mode === "verify")
          currentQuestion = true;
        else if (plan.mode === "general" || plan.mode === "recall")
          currentQuestion = verification;
        else if (plan.queries.length) currentQuestion = true;
      }
      if (liveMarketQuote && !sourcesOnly && !privateFileTask)
        currentQuestion = true;
      if (sourcesOnly) currentQuestion = false;
      trace.routing = {
        sourcesOnly,
        privateFileTask,
        usesWeb: currentQuestion,
      };
      if (currentQuestion) {
        if (!queries.length)
          queries = [
            input.text.replace(/what did i ask.*?\?/i, "").trim() || input.text,
          ];
        queries = [
          ...new Set(
            queries
              .filter((q) => typeof q === "string" && q.trim())
              .map((q) => q.trim().slice(0, 400))
              .filter(
                (q) =>
                  !/[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:gsk_|AIza|tvly-)[A-Za-z0-9_-]{12,}/i.test(
                    q,
                  ) &&
                  !(q.match(/\+?\d[\d ().-]{7,}\d/g) || []).some(
                    (value) => (value.match(/\d/g) || []).length >= 10,
                  ),
              ),
          ),
        ].slice(0, Math.min(options.searchAttempts || 12, 12));
        const outputs: any[] = new Array(queries.length);
        let next = 0,
          attempts = 0;
        const maxAttempts = Math.min(options.searchAttempts || 12, 12);
        event(id, "progress", {
          stage: "searching",
          label: `Searching ${queries.length} queries`,
          queries,
        });
        await Promise.all(
          Array.from({ length: Math.min(3, queries.length) }, async () => {
            while (next < queries.length) {
              const n = next++;
              if (attempts >= maxAttempts) {
                outputs[n] = {
                  query: queries[n],
                  results: [],
                  error: "Search attempt budget exhausted.",
                };
                continue;
              }
              attempts++;
              outputs[n] = await searchOne(
                queries[n],
                controller.signal,
                verification || /fresh|latest|today/i.test(input.text),
              );
              if (
                outputs[n].error &&
                !/retry after|rate.limit/i.test(outputs[n].error) &&
                /network|timeout|timed out|temporar|429|502|503|504/i.test(
                  outputs[n].error,
                ) &&
                attempts < maxAttempts &&
                !controller.signal.aborted
              ) {
                attempts++;
                outputs[n] = await searchOne(
                  queries[n],
                  controller.signal,
                  true,
                );
              }
            }
          }),
        );
        valid();
        trace.searchAttempts = attempts;
        searches = outputs.map((o) => ({
          query: o.query,
          error: o.error || null,
          cached: !!o.cached,
          resultCount: o.results.length,
        }));
        const urls = new Set<string>();
        for (const output of outputs)
          for (const result of output.results) {
            if (urls.has(result.url)) continue;
            urls.add(result.url);
            const sourceId = addSource({
              kind: "web",
              role: "web",
              title: result.title || result.url,
              content: result.content,
              metadata: {
                url: result.url,
                publishedAt: result.publishedAt || null,
                effectiveAt: result.effectiveAt || null,
                observedAt: result.observedAt,
                method: result.extractionMethod || "search observation",
                query: output.query,
                cached: !!output.cached,
              },
            });
            web.push(source(requireSource(sourceId)));
          }
        trace.searches = searches;
        trace.coverage = {
          queries: queries.length,
          succeeded: outputs.filter((o) => !o.error).length,
          failed: outputs.filter((o) => o.error).length,
        };
        update(id, { sourceIds: [...local, ...web].map((s) => s.id), trace });
        event(id, "sources", { sources: [...local, ...web] });
      }
      if (verification && !web.length && !sourcesOnly) {
        const names = shortlistedVendors([
          input.text,
          ...local.map((s) => s.content),
        ]);
        if (names.length)
          trace.vendorCoverage = {
            requested: names.length,
            individuallyCompared: 0,
            unresolved: names,
          };
        const answer =
          "I could not obtain current web evidence, so I cannot verify whether the recorded information changed. Your historical sources remain available below. Please retry web search or provide a dated source.";
        update(id, {
          answer,
          trace,
          comparisons: names.length
            ? names.map((name) => ({
                claim: name + " verification",
                status: "UNVERIFIED",
                baselineSourceIds: local
                  .filter((s) =>
                    s.content.toLowerCase().includes(name.toLowerCase()),
                  )
                  .map((s) => s.id),
                evidenceSourceIds: [],
                explanation: "No current web evidence was obtained.",
              }))
            : local.map((s) => ({
                claim: compact(s.content, 160),
                status: "UNVERIFIED",
                baselineSourceIds: [s.id],
                evidenceSourceIds: [],
                explanation: "No current web evidence was obtained.",
              })),
        });
        saveAnswer(
          id,
          answer,
          local.flatMap((s) => [s.id, ...(s.interpretationSourceIds || [])]),
        );
        setStatus(id, "PARTIAL");
        event(id, "complete", getTurn(id));
        return;
      }
      if (!options.model) {
        const answer = local.length
          ? "I retained these relevant sources, but model-based answering is not configured. Add GROQ_API_KEY to ask questions about them.\n\n" +
            local
              .map((s) => `**${s.title}**\n${compact(s.content, 600)}`)
              .join("\n\n")
          : "Your message is saved. Add GROQ_API_KEY for model-based answers and TAVILY_API_KEY for live web verification. Historical date recall and your retained sources remain available.";
        update(id, { answer });
        saveAnswer(
          id,
          answer,
          local.flatMap((s) => [s.id, ...(s.interpretationSourceIds || [])]),
        );
        setStatus(id, "COMPLETED");
        event(id, "complete", getTurn(id));
        return;
      }
      event(id, "progress", {
        stage: "answering",
        label: verification
          ? "Comparing the baseline with evidence"
          : "Writing an answer",
      });
      const result = await withQuota(() =>
        options.model!.generate({
          question: input.text,
          activeSourceIds: [...activeSourceIds],
          retrievalHint: retrievalHints.join(" "),
          history,
          baseline: local,
          timezone: input.timezone,
          now: row.created_at,
          evidence: [...local, ...web].map((s) => ({
            ...s,
            content: selectPassages(
              s.content,
              input.text + " " + retrievalHints.join(" "),
              1800,
            ),
          })),
          verification,
          signal: controller.signal,
          onDelta: verification
            ? undefined
            : (delta) => {
                valid();
                deltaBuffer += delta;
                if (Date.now() - lastDelta > 100) {
                  lastDelta = Date.now();
                  streamed += deltaBuffer;
                  update(id, { answer: streamed });
                  event(id, "delta", { text: deltaBuffer });
                  deltaBuffer = "";
                }
              },
        }),
      );
      valid();
      if (result.usage) trace.usage = result.usage;
      if (deltaBuffer) {
        streamed += deltaBuffer;
        update(id, { answer: streamed });
        event(id, "delta", { text: deltaBuffer });
        deltaBuffer = "";
      }
      const allowed = new Set([...local, ...web].map((s) => s.id));
      const citations = (result.citations || []).filter((c) =>
        allowed.has(c.sourceId),
      );
      // A cited current interpretation may combine the original with one or
      // more effective assertion corrections. Expose those corrections in the
      // answer's citations so the supporting values remain inspectable.
      const citedIds = new Set(citations.map((c) => c.sourceId));
      for (const s of local) {
        if (!citedIds.has(s.id)) continue;
        for (const correctionId of s.interpretationSourceIds || []) {
          if (!citedIds.has(correctionId)) {
            citations.push({
              sourceId: correctionId,
              label: `Correction to ${s.title}`,
            });
            citedIds.add(correctionId);
          }
        }
      }
      const statuses = new Set([
        "CURRENTLY_MATCHES",
        "DIFFERS_CHANGE_TIME_UNKNOWN",
        "CHANGED_WITH_DATED_EVIDENCE",
        "CONFLICTING",
        "UNVERIFIED",
      ]);
      const comparisons = (verification ? result.comparisons || [] : []).map(
        (c) => {
          const baseline = (c.baselineSourceIds || []).filter((x) =>
              local.some((s) => s.id === x),
            ),
            evidenceIds = (c.evidenceSourceIds || []).filter((x) =>
              web.some((s) => s.id === x),
            );
          let status = c.status;
          if (!statuses.has(status) || !baseline.length || !evidenceIds.length)
            status = "UNVERIFIED";
          if (
            status === "CHANGED_WITH_DATED_EVIDENCE" &&
            !web.some((s) => {
              const passage = c.effectiveDateEvidence;
              const explicitDate =
                passage &&
                passage.sourceId === s.id &&
                typeof passage.quote === "string" &&
                passage.quote.length >= 12 &&
                s.content.includes(passage.quote) &&
                typeof c.effectiveAt === "string" &&
                effectiveDateInQuote(c.effectiveAt, passage.quote)
                  ? c.effectiveAt
                  : null;
              const when = Date.parse(
                String(s.metadata.effectiveAt || explicitDate || ""),
              );
              return (
                evidenceIds.includes(s.id) &&
                Number.isFinite(when) &&
                when <= Date.parse(now()) &&
                (!window || when >= Date.parse(window.from))
              );
            })
          )
            status = "DIFFERS_CHANGE_TIME_UNKNOWN";
          let priceCheck;
          const priceClaim =
            /\b(price|pricing|cost|per seat|billing)\b|[$€£₹]/i.test(c.claim) ||
            c.baselinePrice ||
            c.currentPrice;
          let explanation = c.explanation;
          if (priceClaim) {
            priceCheck = comparePrices(c.baselinePrice, c.currentPrice);
            const baselineTexts = local
              .filter((s) => baseline.includes(s.id))
              .map((s) => s.interpretation || s.content);
            const currentTexts = web
              .filter((s) => evidenceIds.includes(s.id))
              .map((s) => s.content);
            if (
              status === "CONFLICTING" &&
              supportedPriceConflict(c.currentAlternatives, currentTexts)
            ) {
              priceCheck = {
                comparable: false,
                reason:
                  "Conflicting like-for-like current offers are each supported by retained evidence.",
              };
              explanation = priceCheck.reason;
            } else if (!priceCheck.comparable) {
              status = "UNVERIFIED";
              explanation = priceCheck.reason;
            } else if (
              !baselineTexts.some((text) =>
                priceHasNumericSupport(c.baselinePrice!, text),
              ) ||
              !currentTexts.some((text) =>
                priceHasNumericSupport(c.currentPrice!, text),
              )
            ) {
              status = "UNVERIFIED";
              explanation =
                "Extracted commercial terms are not supported by the linked source text.";
            } else if (
              priceCheck.equal &&
              [
                "DIFFERS_CHANGE_TIME_UNKNOWN",
                "CHANGED_WITH_DATED_EVIDENCE",
              ].includes(status)
            ) {
              status = "CONFLICTING";
              explanation =
                "The extracted like-for-like prices are equal but the generated comparison claims a change.";
            } else if (!priceCheck.equal && status === "CURRENTLY_MATCHES") {
              status = "DIFFERS_CHANGE_TIME_UNKNOWN";
              explanation =
                "Like-for-like amounts differ; the time of change is not established.";
            }
          }
          return {
            ...c,
            status,
            explanation,
            ...(priceCheck ? { priceCheck } : {}),
            baselineSourceIds: baseline,
            evidenceSourceIds: evidenceIds,
          };
        },
      );
      if (verification && !web.length && !sourcesOnly) {
        comparisons.forEach((c) => (c.status = "UNVERIFIED"));
        result.answer =
          "I could not obtain current web evidence, so I cannot establish what changed. " +
          result.answer;
      }
      if (verification && comparisons.some((c) => c.priceCheck)) {
        result.answer = comparisons
          .map(
            (c) =>
              `**${c.claim}** — ${c.status.replaceAll("_", " ").toLowerCase()}. ${c.explanation}`,
          )
          .join("\n\n");
      }
      // Do not let a multi-vendor answer silently omit shortlisted entities.
      if (verification) {
        const names = shortlistedVendors([
          input.text,
          ...local.map((s) => s.content),
        ]);
        if (names.length >= 2 && names.length <= 10) {
          const mentions = (claim: string, name: string) =>
            new RegExp(
              "(?:^|[^A-Za-z0-9])" +
                name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                "(?:$|[^A-Za-z0-9])",
              "i",
            ).test(claim);
          // A grouped assertion cannot substitute for individual vendor evidence.
          for (let i = comparisons.length - 1; i >= 0; i--)
            if (
              names.filter((n) => mentions(comparisons[i].claim, n)).length > 1
            )
              comparisons.splice(i, 1);
          const omitted = names.filter(
            (name) => !comparisons.some((c) => mentions(c.claim, name)),
          );
          for (const name of omitted) {
            comparisons.push({
              claim: name + " verification",
              status: "UNVERIFIED",
              baselineSourceIds: local
                .filter((s) => mentions(s.content, name))
                .map((s) => s.id),
              evidenceSourceIds: [],
              explanation:
                "No individual evidence comparison was established for this vendor. Search completion alone does not establish unchanged pricing or releases.",
            });
          }
          trace.vendorCoverage = {
            requested: names.length,
            individuallyCompared: names.length - omitted.length,
            unresolved: omitted,
          };
          result.answer = comparisons
            .map(
              (c) =>
                `**${c.claim}** — ${c.status.replaceAll("_", " ").toLowerCase()}. ${c.explanation}`,
            )
            .join("\n\n");
        }
      }
      const answer = result.answer?.trim();
      if (!answer)
        throw new KathaError(
          "EMPTY_ANSWER",
          "The model returned no answer.",
          502,
        );
      update(id, {
        answer,
        citations,
        comparisons,
        sourceIds: [
          ...new Set([
            ...local.map((s) => s.id),
            ...web.map((s) => s.id),
            ...citations.map((c) => c.sourceId),
          ]),
        ],
        trace,
      });
      saveAnswer(id, answer, [
        ...referenceDependencies,
        ...new Set(
          [...local, ...web].flatMap((s) => [
            s.id,
            ...(s.interpretationSourceIds || []),
          ]),
        ),
      ]);
      if (verification)
        db.prepare("INSERT INTO verification_runs VALUES(?,?,?,?,?,?,?)").run(
          randomUUID(),
          id,
          json(
            local.flatMap((s) => [s.id, ...(s.interpretationSourceIds || [])]),
          ),
          json(web.map((s) => s.id)),
          json(comparisons),
          json(trace.coverage),
          now(),
        );
      setStatus(id, searches.some((s) => s.error) ? "PARTIAL" : "COMPLETED");
      event(id, "complete", getTurn(id));
    } catch (error) {
      if (!closed) {
        const current = getTurn(id);
        if (!TERMINAL.has(current.status)) {
          const cancelled =
            controller.signal.aborted ||
            (error instanceof KathaError && error.code === "TURN_CANCELLED");
          const code = (error as { code?: string }).code;
          if (
            !cancelled &&
            epoch() === initialEpoch &&
            recoveryContext &&
            [
              "RATE_LIMIT",
              "QUOTA_WAIT_EXCEEDED",
              "MODEL_UNAVAILABLE",
              "CONTEXT_LIMIT",
            ].includes(code || "")
          ) {
            const eligible = recoveryContext.sources.filter((s) => {
              const row = db
                .prepare(
                  "SELECT version,deleted_at,invalidated FROM sources WHERE id=?",
                )
                .get(s.id) as any;
              return (
                row &&
                row.version === s.version &&
                !row.deleted_at &&
                !row.invalidated
              );
            });
            const recovery = retainedEvidenceResponse(
              eligible,
              recoveryContext.question,
              recoveryContext.hint,
              recoveryContext.verification,
            );
            if (recovery) {
              valid();
              const vendors = shortlistedVendors([
                recoveryContext.question,
                ...eligible.map((s) => s.content),
              ]);
              const comparisons: Comparison[] = recoveryContext.verification
                ? (vendors.length >= 2
                    ? vendors
                    : [recoveryContext.question]
                  ).map((claim) => ({
                    claim:
                      vendors.length >= 2 ? claim + " verification" : claim,
                    status: "UNVERIFIED",
                    baselineSourceIds: recovery.sourceIds,
                    evidenceSourceIds: [],
                    explanation:
                      "The model was unavailable; no comparison was established.",
                  }))
                : [];
              if (recoveryContext.verification && vendors.length >= 2)
                recoveryContext.trace.vendorCoverage = {
                  requested: vendors.length,
                  individuallyCompared: 0,
                  unresolved: vendors,
                };
              update(id, {
                answer: recovery.answer,
                citations: recovery.sourceIds.map((sourceId) => ({ sourceId })),
                sourceIds: recovery.sourceIds,
                comparisons,
                trace: {
                  ...recoveryContext.trace,
                  modelFallback: {
                    reasonCode: code,
                    mode: "retained-evidence-only",
                    generatedAnswer: false,
                  },
                },
              });
              saveAnswer(id, recovery.answer, [
                ...recoveryContext.dependencies,
                ...eligible
                  .filter((s) => recovery.sourceIds.includes(s.id))
                  .flatMap((s) => [s.id, ...(s.interpretationSourceIds || [])]),
              ]);
              setStatus(
                id,
                "PARTIAL",
                error instanceof Error
                  ? error.message
                  : "The model is unavailable.",
              );
              event(id, "complete", getTurn(id));
              return;
            }
          }
          setStatus(
            id,
            cancelled ? "CANCELLED" : "FAILED",
            error instanceof Error ? error.message : "The turn failed.",
          );
          event(id, "complete", getTurn(id));
        }
      }
    } finally {
      clearTimeout(timer);
      running.delete(id);
      void processIndex();
    }
  }
  function saveAnswer(id: string, answer: string, dependencies: string[]) {
    const row = db.prepare("SELECT * FROM turns WHERE id=?").get(id) as any;
    const sourceId = addSource({
      kind: "message",
      role: "assistant",
      title: "Katha response",
      content: answer,
      conversationId: row.conversation_id,
      turnId: id,
      dateProvenance: "conversation-time",
    });
    for (const dependency of dependencies)
      db.prepare("INSERT OR IGNORE INTO dependencies VALUES(?,?)").run(
        sourceId,
        dependency,
      );
  }
  function schedule() {
    if (closed) return;
    while (active < (options.maxActiveTurns || 2)) {
      const at = pending.findIndex((id) => {
        const t = db.prepare("SELECT * FROM turns WHERE id=?").get(id) as any;
        return (
          t &&
          !TERMINAL.has(t.status) &&
          ![...running.keys()].some(
            (r) =>
              (
                db
                  .prepare("SELECT conversation_id FROM turns WHERE id=?")
                  .get(r) as any
              )?.conversation_id === t.conversation_id,
          )
        );
      });
      if (at < 0) break;
      const [id] = pending.splice(at, 1);
      active++;
      void run(id).finally(() => {
        active--;
        if (!closed) schedule();
      });
    }
  }
  const turns = {
    async start(input: TurnInput) {
      check();
      if (
        !input.conversationId ||
        !input.clientRequestId ||
        typeof input.text !== "string" ||
        (!input.text.trim() && !input.attachmentIds?.length)
      )
        throw new KathaError(
          "INVALID_TURN",
          "Enter a message or attach a prepared source.",
        );
      if (input.text.length > 20000)
        throw new KathaError(
          "TURN_TOO_LARGE",
          "Message exceeds 20,000 characters.",
          413,
        );
      const normalized = {
        ...input,
        text: input.text.trim(),
        attachmentIds: input.attachmentIds || [],
        memoryScope: input.memoryScope || "workspace",
        timezone: input.timezone || "UTC",
      };
      const inputHash = hash(normalized);
      const receipt = db.transaction(() => {
        const existing = db
          .prepare(
            "SELECT * FROM turns WHERE conversation_id=? AND request_id=?",
          )
          .get(input.conversationId, input.clientRequestId) as any;
        if (existing) {
          if (existing.input_hash !== inputHash)
            throw new KathaError(
              "REQUEST_CONFLICT",
              "That request ID was already used for different input.",
              409,
            );
          return {
            turnId: existing.id,
            status: existing.status as TurnStatus,
            chatTail: existing.id,
            replayed: true,
          };
        }
        const pendingCount = (
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM turns WHERE status IN ('QUEUED','WAITING_FOR_SOURCES','RUNNING','WAITING_FOR_QUOTA')",
            )
            .get() as { n: number }
        ).n;
        if (pendingCount >= (options.maxPendingTurns ?? 32))
          throw new KathaError(
            "TURN_CAPACITY",
            "The workspace has too many pending questions. Wait for a turn to finish or cancel one.",
            429,
          );
        const chat = requireConversation(input.conversationId);
        if (chat.deleted_at)
          throw new KathaError(
            "CONVERSATION_DELETED",
            "Restore this conversation before continuing.",
            409,
          );
        if ((input.expectedTailId ?? null) !== chat.tail_id)
          throw new KathaError(
            "CONVERSATION_CHANGED",
            "This conversation changed in another tab. Reload and review it.",
            409,
          );
        for (const attachmentId of input.attachmentIds || []) {
          const s = requireSource(attachmentId);
          if (s.deleted_at || s.invalidated)
            throw new KathaError(
              "SOURCE_DELETED",
              "An attached source is unavailable.",
              409,
            );
        }
        try {
          resolveDate("today", new Date(now()), normalized.timezone);
        } catch {
          throw new KathaError(
            "INVALID_TIMEZONE",
            "Choose a valid IANA timezone.",
          );
        }
        const id = randomUUID(),
          time = now(),
          seq = Number(
            (
              db
                .prepare(
                  "SELECT coalesce(max(seq),0)+1 n FROM turns WHERE conversation_id=?",
                )
                .get(input.conversationId) as any
            ).n,
          ),
          cutoff = Number(
            (
              db
                .prepare("SELECT coalesce(max(ordinal),0) n FROM sources")
                .get() as any
            ).n,
          );
        db.prepare(
          "INSERT INTO turns(id,conversation_id,request_id,input_hash,seq,input_json,status,created_at,updated_at,cutoff,epoch) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          id,
          input.conversationId,
          input.clientRequestId,
          inputHash,
          seq,
          json(normalized),
          "QUEUED",
          time,
          time,
          cutoff,
          epoch(),
        );
        addSource({
          kind: "message",
          role: "user",
          title: compact(normalized.text, 80) || "Attached material",
          content: normalized.text,
          conversationId: input.conversationId,
          turnId: id,
          dateProvenance: "conversation-time",
        });
        db.prepare(
          "UPDATE conversations SET tail_id=?,title=CASE WHEN title='New conversation' THEN ? ELSE title END WHERE id=?",
        ).run(
          id,
          compact(normalized.text, 60) || "Attached material",
          input.conversationId,
        );
        event(id, "accepted", { turnId: id, status: "QUEUED" });
        return {
          turnId: id,
          status: "QUEUED" as TurnStatus,
          chatTail: id,
          replayed: false,
        };
      })();
      if (!receipt.replayed) {
        pending.push(receipt.turnId);
        queueMicrotask(schedule);
      }
      return {
        turnId: receipt.turnId,
        status: receipt.status,
        chatTail: receipt.chatTail,
      };
    },
    async get(id: string) {
      return getTurn(id);
    },
    async *events(id: string, after = 0): AsyncGenerator<TurnEvent> {
      getTurn(id);
      let cursor = after;
      while (!closed) {
        const rows = db
          .prepare(
            "SELECT * FROM events WHERE turn_id=? AND sequence>? ORDER BY sequence",
          )
          .all(id, cursor) as any[];
        for (const row of rows) {
          cursor = row.sequence;
          yield {
            id: row.sequence,
            turnId: id,
            type: row.type,
            data: JSON.parse(row.data_json),
            createdAt: row.created_at,
          };
        }
        if (TERMINAL.has(getTurn(id).status)) return;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(finish, 1000);
          function finish() {
            clearTimeout(timer);
            listeners.get(id)?.delete(finish);
            resolve();
          }
          if (!listeners.has(id)) listeners.set(id, new Set());
          listeners.get(id)!.add(finish);
        });
      }
    },
    async cancel(id: string) {
      check();
      const snapshot = getTurn(id);
      if (!TERMINAL.has(snapshot.status)) {
        setStatus(id, "CANCELLED", "Cancelled by the user.");
        running.get(id)?.abort();
        event(id, "complete", getTurn(id));
      }
      return getTurn(id);
    },
  };
  queueMicrotask(() => void processIndex());
  return {
    workspace,
    evidence,
    turns,
    async stats() {
      check();
      return {
        conversations: (
          db
            .prepare(
              "SELECT count(*) n FROM conversations WHERE deleted_at IS NULL",
            )
            .get() as any
        ).n,
        sources: (
          db
            .prepare("SELECT count(*) n FROM sources WHERE deleted_at IS NULL")
            .get() as any
        ).n,
        indexing: db
          .prepare("SELECT status,count(*) count FROM jobs GROUP BY status")
          .all(),
        searchUsage:
          db.prepare("SELECT * FROM usage ORDER BY month DESC LIMIT 1").get() ||
          null,
        providers: {
          model: !!options.model,
          search: !!options.search,
          embeddings: !!options.embedder,
        },
      };
    },
    close() {
      if (closed) return;
      for (const controller of running.values()) controller.abort();
      closed = true;
      listeners.forEach((set) => set.forEach((fn) => fn()));
      db.close();
    },
  };
}
