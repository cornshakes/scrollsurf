import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db_path } from '../paths';
import { migrate } from './migrate';

export let db: DatabaseSync;

export const open_db = (file: string): DatabaseSync => {
  const target = new DatabaseSync(file);
  target.exec('PRAGMA journal_mode = WAL');
  target.exec('PRAGMA busy_timeout = 5000');
  target.exec('PRAGMA foreign_keys = ON');
  migrate(target);
  return target;
};

export const init_db = (reset = false) => {
  if (!reset && db) {
    return;
  }
  // SQLite creates the DB file but not its parent dir — ensure it exists so the
  // server and the test seeder are each self-sufficient (no startup ordering race).
  mkdirSync(path.dirname(db_path()), { recursive: true });
  db = open_db(db_path());
};

export const get_db = (): DatabaseSync => {
  init_db();
  return db;
};
