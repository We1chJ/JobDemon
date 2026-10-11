import fs from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import * as schema from './schema.js';

fs.mkdirSync(config.dataDir, { recursive: true });
const sqlite = new Database(config.dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.exec(`
CREATE TABLE IF NOT EXISTS application (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  company TEXT, role TEXT, applicant TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  reason TEXT, confidence REAL,
  step INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS application_dedup ON application(company, role, applicant);
CREATE TABLE IF NOT EXISTS step_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL, step INTEGER NOT NULL,
  op TEXT NOT NULL, target TEXT, detail TEXT, screenshot TEXT, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY, version TEXT NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS answer_bank (id TEXT PRIMARY KEY, question TEXT NOT NULL, answer TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS question (
  key TEXT PRIMARY KEY, label TEXT NOT NULL, options TEXT NOT NULL DEFAULT '[]',
  required INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'new',
  company TEXT, url TEXT, seen INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS generation (key TEXT PRIMARY KEY, text TEXT NOT NULL, at TEXT NOT NULL);
`);

export const db = drizzle(sqlite, { schema });
export { schema };

export const now = () => new Date().toISOString();

export function updateApp(id: number, patch: Partial<typeof schema.application.$inferInsert>) {
  db.update(schema.application).set({ ...patch, updatedAt: now() }).where(eq(schema.application.id, id)).run();
}

export function logStep(applicationId: number, step: number, op: string, target?: string, detail?: string, screenshot?: string) {
  db.insert(schema.stepLog).values({ applicationId, step, op, target, detail, screenshot, at: now() }).run();
}
