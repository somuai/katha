import type Database from "better-sqlite3";
import { seedAssertions } from "./assertions.js";
import { KathaError } from "./types.js";
// Version 1 adopts legacy CREATE IF NOT EXISTS databases without altering records.
const migrations = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
  INSERT OR IGNORE INTO meta VALUES('epoch',0);
  CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,created_at TEXT NOT NULL,tail_id TEXT,deleted_at TEXT);
  CREATE TABLE IF NOT EXISTS turns(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),request_id TEXT NOT NULL,input_hash TEXT NOT NULL,seq INTEGER NOT NULL,input_json TEXT NOT NULL,status TEXT NOT NULL,answer TEXT NOT NULL DEFAULT '',error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,cutoff INTEGER NOT NULL,epoch INTEGER NOT NULL,citations_json TEXT NOT NULL DEFAULT '[]',comparisons_json TEXT NOT NULL DEFAULT '[]',source_ids_json TEXT NOT NULL DEFAULT '[]',trace_json TEXT NOT NULL DEFAULT '{}',UNIQUE(conversation_id,request_id));
  CREATE TABLE IF NOT EXISTS sources(ordinal INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,role TEXT NOT NULL,conversation_id TEXT REFERENCES conversations(id),turn_id TEXT REFERENCES turns(id),title TEXT NOT NULL,content TEXT NOT NULL,recorded_at TEXT NOT NULL,occurred_at TEXT,occurred_end TEXT,date_provenance TEXT NOT NULL DEFAULT 'unknown',version INTEGER NOT NULL DEFAULT 1,deleted_at TEXT,invalidated INTEGER NOT NULL DEFAULT 0,metadata_json TEXT NOT NULL DEFAULT '{}');
  CREATE INDEX IF NOT EXISTS sources_time ON sources(recorded_at);CREATE INDEX IF NOT EXISTS sources_event ON sources(occurred_at);CREATE INDEX IF NOT EXISTS sources_chat ON sources(conversation_id,ordinal);
  CREATE VIRTUAL TABLE IF NOT EXISTS source_fts USING fts5(source_id UNINDEXED,content);
  CREATE TABLE IF NOT EXISTS corrections(id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES sources(id),target_id TEXT NOT NULL REFERENCES sources(id),mode TEXT NOT NULL,effective_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS dependencies(answer_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,PRIMARY KEY(answer_id,source_id));
  CREATE TABLE IF NOT EXISTS events(turn_id TEXT NOT NULL REFERENCES turns(id),sequence INTEGER NOT NULL,type TEXT NOT NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(turn_id,sequence));
  CREATE TABLE IF NOT EXISTS search_cache(key TEXT PRIMARY KEY,results_json TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS usage(month TEXT PRIMARY KEY,search_credits INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS verification_runs(id TEXT PRIMARY KEY,turn_id TEXT NOT NULL REFERENCES turns(id),baseline_ids_json TEXT NOT NULL,evidence_ids_json TEXT NOT NULL,outcomes_json TEXT NOT NULL,coverage_json TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS jobs(source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,version INTEGER NOT NULL,model_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,error TEXT,PRIMARY KEY(source_id,version,model_id));
  CREATE TABLE IF NOT EXISTS segments(source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,model_id TEXT NOT NULL,start_token INTEGER NOT NULL,end_token INTEGER NOT NULL,text TEXT NOT NULL,vector_json TEXT NOT NULL,PRIMARY KEY(source_id,model_id,start_token));
  CREATE TABLE IF NOT EXISTS embeddings(source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,version INTEGER NOT NULL,model_id TEXT NOT NULL,vector_json TEXT NOT NULL,PRIMARY KEY(source_id,version,model_id));
`,
  },
  {
    version: 2,
    sql: `
    CREATE TABLE assertions(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, text TEXT NOT NULL, UNIQUE(source_id,start_offset));
    ALTER TABLE corrections ADD COLUMN assertion_id TEXT REFERENCES assertions(id) ON DELETE CASCADE;
    CREATE INDEX correction_target ON corrections(target_id,effective_at);
  `,
  },
];
export function migrate(database: Database.Database) {
  const version = Number(database.pragma("user_version", { simple: true }));
  if (version > migrations.at(-1)!.version)
    throw new KathaError(
      "NEWER_WORKSPACE",
      "This workspace was created by a newer version of Katha. Upgrade the application before opening it.",
      409,
    );
  for (const migration of migrations) {
    if (migration.version <= version) continue;
    database
      .transaction(() => {
        database.exec(migration.sql);
        if (migration.version === 2) {
          for (const source of database
            .prepare("SELECT id,content FROM sources")
            .all() as { id: string; content: string }[])
            seedAssertions(database, source.id, source.content);
        }
        database.pragma(`user_version=${migration.version}`);
      })
      .immediate();
  }
}
