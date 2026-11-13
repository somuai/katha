# SQLite workspace ownership

Research date: 2026-11-14. Scope: one local Katha workspace, one lifetime owner connection, short database transactions, and no network work inside transactions. No runtime code changed.

## Recommendation

Use the existing `better-sqlite3` connection itself as the ownership guard: set `locking_mode=EXCLUSIVE` **before the first WAL database access**, enter/verify WAL, then complete a synchronous `BEGIN EXCLUSIVE` / `COMMIT` before migrations, restart recovery, or source mutations. Keep that connection open until Katha closes. This is suitable for the current single-connection design, provided rejecting other readers is intentional. This recommendation follows SQLite's documented retained-lock behavior and the local experiments below; it is not a claim of verified Windows/Linux behavior.

SQLite distinguishes exclusive **locking mode** from an exclusive **transaction**. Locking mode retains acquired file locks between transactions; a write obtains and retains exclusive access. A short transaction forces acquisition during construction. In WAL, `BEGIN EXCLUSIVE` alone is equivalent to `BEGIN IMMEDIATE` and does not provide lifetime ownership. [SQLite locking mode](https://www.sqlite.org/pragma.html#pragma_locking_mode), [SQLite transactions](https://www.sqlite.org/lang_transaction.html#deferred_immediate_and_exclusive_transactions).

Illustrative initialization order, not a patch:

```ts
const db = new Database(databasePath, { timeout: 3000 });
try {
  if (db.pragma('locking_mode = EXCLUSIVE', { simple: true }) !== 'exclusive') {
    throw new Error('Exclusive SQLite locking is unavailable');
  }
  if (db.pragma('journal_mode = WAL', { simple: true }) !== 'wal') {
    throw new Error('WAL is unavailable');
  }
  db.exec('BEGIN EXCLUSIVE; COMMIT;');
  // Ownership is now acquired, with no open transaction.
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = FULL');
  // migrate(db); initialize durable state; interrupt abandoned turns;
  // construct and return the Katha interface, retaining db privately.
} catch (error) {
  // This catch must cover every initialization step through return.
  // close() also ends any transaction left by a failed COMMIT.
  try { db.close(); } catch { /* preserve the original startup error */ }
  throw error;
}
```

Set the constructor timeout because contention can occur before the existing late `busy_timeout` pragma runs. Alternatively, make `busy_timeout=3000` the first pragma, before `locking_mode=EXCLUSIVE`, then WAL and the short transaction; the timeout pragma does not access the WAL database. A busy error during acquisition means the workspace is unavailable; preserve the SQLite cause and report that another connection *may* own it. It does not identify a PID or prove that an application process is the cause. Normalize SQLite error codes matching `/^SQLITE_BUSY(?:_|$)/` only around ownership acquisition into a workspace-unavailable error with the original cause; do not relabel arbitrary later migration failures or treat `SQLITE_LOCKED` as equivalent. Do not retry by disabling locks, deleting SQLite sidecars, or interrupting turns before acquisition. `better-sqlite3` documents the constructor timeout and error codes. [Constructor](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#new-databasepath-options), [SqliteError](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#class-sqliteerror).

The guard belongs inside `createKatha`'s implementation, not in callers: all callers should receive either a fully initialized owner or an error. The current code only closes on a migration exception; pragmas before that catch and the later restart update are outside it (`src/core/index.ts`, opening at line 65). Extend cleanup over all initialization and keep normal close idempotent. Constructor failures before a `Database` object is returned have no acquired JavaScript handle to close. [Connection close](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#close---this).

## WAL semantics and operational implications

- Set exclusive mode before WAL access even when the file already persists in WAL mode from a prior launch. SQLite can then keep its WAL index private rather than creating shared memory. The connection stays exclusive while in WAL; changing to `locking_mode=NORMAL` is ineffective until leaving WAL. [WAL without shared memory](https://www.sqlite.org/wal.html#use_of_wal_without_shared_memory).
- A second `new Database(...)` can succeed without ownership. Its first access, including the competing Katha initializer, must fail or wait with `SQLITE_BUSY` while the owner remains open. SQLite explicitly documents busy results for another connection's queries when exclusive locking is in use. Check successful acquisition, not constructor success. [WAL busy behavior](https://www.sqlite.org/wal.html#sometimes_queries_return_sqlite_busy_in_wal_mode).
- This excludes **connections**, including a second connection in the same process, readonly inspectors, a separate read pool, and another process's backup source connection. Route reads through the owner or an owner-produced snapshot. This is intentionally stricter than “one writer.” [WAL busy behavior](https://www.sqlite.org/wal.html#sometimes_queries_return_sqlite_busy_in_wal_mode).
- Back up through `ownerDb.backup(distinctDestination)`; the owner already has source access. Await completion before closing. The destination is a separate database. SQLite's backup interface accepts a source connection and holds destination locks; backup can fail when its source connection is concurrently writing. Keep individual synchronous source transactions short. The local backup probes succeeded, but did not exercise concurrent writes, cancellation, disk-full, or partial-file handling. [better-sqlite3 backup](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise), [SQLite backup interface](https://www.sqlite.org/c3ref/backup_finish.html).
- Never copy just the live main database file: committed data can remain in WAL. Use the backup interface or a properly closed workspace. [WAL file lifecycle](https://www.sqlite.org/wal.html#the_wal_file).

## Portability and file-lock alternative

Use a local filesystem with working SQLite VFS locks. Exclusive WAL avoids shared-memory requirements; it does not repair unreliable filesystem locks. Network filesystems, mixed SQLite locking protocols, and renaming/unlinking an open database undermine the assumptions. A malicious process or filesystem writer is outside this guard's scope. Do not recreate or replace `katha.sqlite` while it is open. [SQLite corruption hazards](https://www.sqlite.org/howtocorrupt.html#file_locking_problems), [WAL limitations](https://www.sqlite.org/wal.html#overview).

A separate workspace lock would allow SQLite's normal WAL readers and could cover workspace file operations before opening SQLite. However, every Katha entry point must honor it; an ordinary SQLite client would not. A plain `open(..., 'wx')` marker is exclusive creation, not an automatically released lifetime lock: a crash leaves a path, and deleting a supposedly stale marker requires a race-safe ownership policy. Node also documents network-filesystem limitations for exclusive creation. A proper OS-lock adapter adds platform-specific implementation and verification. Prefer SQLite ownership now; reconsider a separate lock if independent readers become a requirement. [Node filesystem flags](https://nodejs.org/api/fs.html#file-system-flags). The stale-marker and adapter recommendations are design inferences from those semantics.

## Local verification and remaining checks

Executed disposable real-file experiments with the repository-installed `better-sqlite3` on the current macOS host; all temporary directories were removed. Repeated the complete probe set using the supported Katha runtime: Node `v24.22.2` at `/Volumes/KathaRuntime/node-runtime/node_modules/node/bin/node`, SQLite `3.54.1`, with the runtime prepended to `PATH` and a non-login shell. Child probes used `process.execPath`. The acquisition sequence also explicitly set `busy_timeout=40` first to keep research contention checks short. The same results had previously been observed under the unrelated default-shell Node `v23.11.0`; the table below is confirmed on Node 24.

| Scenario | Observed result |
| --- | --- |
| Fresh file: exclusive mode, WAL, short exclusive transaction | Both pragmas returned expected modes; `inTransaction` was false after commit |
| Existing WAL file, same acquisition sequence | Acquisition succeeded; transaction was closed |
| Child process opens and queries while owner is idle after commit | Constructor succeeded; query returned `SQLITE_BUSY` |
| Separate readonly connection in the owner process | Query returned `SQLITE_BUSY` |
| Owner connection calls `backup()` to a distinct file | Backup opened independently and contained the expected row |
| Set `locking_mode=NORMAL` while owning WAL | Returned `exclusive`, confirming the documented no-op |
| Owner closes; child retries | Query succeeded |
| Kill owner child with SIGKILL after committed insert; successor acquires | Successor acquired ownership, saw committed row, and had no open transaction |

These were research probes, not committed application regression tests. Before implementation handoff, verify through the authorized `createKatha` interface that a second process cannot mark the first process's active Turn interrupted; startup failures release ownership; close/crash permit a successor; restart recovery remains correct; and backup behavior matches the chosen product interface. Include a true simultaneous-start race and an already-open normal-WAL reader. The supported Node runtime is verified on this macOS host; repeat on target operating systems/filesystems. A busy timeout bounds waiting, not correctness. No application-level concurrency test or cross-platform guarantee is claimed here.
