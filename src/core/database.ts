import Database from "better-sqlite3";
import { join } from "node:path";
import { migrate } from "./migrations.js";
import { KathaError } from "./types.js";

/** One lifetime connection owns a local workspace; network work holds no transaction. */
export function openWorkspaceDatabase(directory: string, now: () => string) {
  let db: Database.Database | undefined;
  let acquired = false;
  try {
    db = new Database(join(directory, "katha.sqlite"), { timeout: 3000 });
    db.pragma("busy_timeout = 3000");
    if (db.pragma("locking_mode = EXCLUSIVE", { simple: true }) !== "exclusive")
      throw new KathaError(
        "DATABASE_MODE",
        "Exclusive workspace ownership is unavailable.",
        500,
      );
    if (db.pragma("journal_mode = WAL", { simple: true }) !== "wal")
      throw new KathaError(
        "DATABASE_MODE",
        "This filesystem did not enable SQLite WAL.",
        500,
      );
    db.exec("BEGIN EXCLUSIVE; COMMIT;");
    acquired = true;
    db.pragma("foreign_keys = ON");
    db.pragma("synchronous = FULL");
    migrate(db);
    const owned = db;
    owned.transaction(() => {
      owned
        .prepare(
          "UPDATE turns SET status='INTERRUPTED',error='The process stopped before this turn completed.',updated_at=? WHERE status NOT IN ('COMPLETED','PARTIAL','FAILED','CANCELLED','INTERRUPTED')",
        )
        .run(now());
      owned
        .prepare("UPDATE jobs SET status='pending' WHERE status='running'")
        .run();
    })();
    return owned;
  } catch (error: any) {
    try {
      if (db?.open) db.close();
    } catch {
      /* Preserve the startup error. */
    }
    if (!acquired && /^SQLITE_BUSY(?:_|$)/.test(String(error?.code || ""))) {
      const unavailable = new KathaError(
        "WORKSPACE_IN_USE",
        "Another connection is using this Katha workspace. Stop the other Katha process or database inspector before opening it again.",
        409,
      );
      unavailable.cause = error;
      throw unavailable;
    }
    throw error;
  }
}
