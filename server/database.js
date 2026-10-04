import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(databasePath) {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(databasePath);
  if (databasePath !== ':memory:') chmodSync(databasePath, 0o600);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      mobile TEXT NOT NULL UNIQUE,
      gender TEXT NOT NULL CHECK (gender IN ('مرد', 'زن')),
      nickname TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
      score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      admin_id INTEGER REFERENCES admins(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      CHECK ((user_id IS NULL) != (admin_id IS NULL))
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS progress_requests (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      coins_delta INTEGER NOT NULL,
      score_delta INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, request_id)
    );
  `);
  return db;
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    mobile: row.mobile,
    gender: row.gender,
    nickname: row.nickname,
    coins: row.coins,
    score: row.score,
    role: 'user',
  };
}

export function publicAdmin(row) {
  return {
    id: `admin:${row.id}`, firstName: 'مدیر', lastName: '', mobile: '', gender: '',
    nickname: row.username, coins: 0, score: 0, role: 'admin',
  };
}
