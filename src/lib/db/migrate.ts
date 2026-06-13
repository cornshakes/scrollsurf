import type { DatabaseSync } from 'node:sqlite';
import { migrations, type migration } from './migrations';

// Versioned migration runner for the runtime scrollsurf.db, backed by SQLite's
// built-in `PRAGMA user_version` slot (a single integer = the highest applied
// migration version). Up-only: recovery is restoring the DB file, not a `down`.

export const get_user_version = (db: DatabaseSync): number => {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
};

export const migrate = (db: DatabaseSync, list: readonly migration[] = migrations): void => {
  // 1. Validate the list on every run: versions must be exactly 1..list.length
  //    in array order. Cheap, and catches a misordered/duplicated history before
  //    any `up` touches the DB.
  list.forEach((entry, index) => {
    const expected = index + 1;
    if (entry.version !== expected) {
      throw new Error(
        `invalid migration list: entry at index ${index} (${entry.name}) has version ${entry.version}, expected ${expected}`
      );
    }
  });

  // 2. Downgrade guard: a DB ahead of this code means a newer deploy already ran.
  //    Refuse rather than silently treat unknown schema as up-to-date.
  const current = get_user_version(db);
  if (current > list.length) {
    throw new Error(
      `database is at schema version ${current} but this code only knows up to ${list.length}`
    );
  }

  // 3. FK pragma is a no-op inside a transaction, so bracket the whole loop with
  //    it (needed for future 12-step table rebuilds). Restore ON in finally.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    for (const entry of list) {
      if (entry.version <= get_user_version(db)) {
        continue;
      }

      // 4. One transaction per migration. BEGIN IMMEDIATE takes the write lock up
      //    front so racing processes serialize here instead of failing mid-write.
      db.exec('BEGIN IMMEDIATE');
      try {
        // Re-read inside the transaction: another process may have applied this
        // version while we waited for the write lock.
        if (entry.version <= get_user_version(db)) {
          db.exec('COMMIT');
          continue;
        }
        entry.up(db);
        // Transactional — rolls back with the migration if anything below fails.
        db.exec(`PRAGMA user_version = ${entry.version}`);
        db.exec('COMMIT');
      } catch (cause) {
        // 5. Roll back the partial migration (SQLite DDL is transactional) and
        //    surface which one failed, preserving the original error as `cause`.
        try {
          db.exec('ROLLBACK');
        } catch {}
        throw new Error(`migration ${entry.version} (${entry.name}) failed`, { cause });
      }
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
};
