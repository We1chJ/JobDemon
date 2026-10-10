import { createHash } from 'node:crypto';
import { asc } from 'drizzle-orm';
import { db, schema } from './db/index.js';

export interface Profile {
  fields: Record<string, string>;
  facts: Record<string, unknown>;
}
export interface BankEntry { id: string; question: string; answer: string }

export function hash(s: string) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

export function saveProfile(p: Profile, bank: BankEntry[]) {
  const json = JSON.stringify(p);
  db.transaction((tx) => {
    tx.delete(schema.profile).run();
    tx.insert(schema.profile).values({ id: 1, version: hash(json), json }).run();
    tx.delete(schema.answerBank).run();
    for (const b of bank) tx.insert(schema.answerBank).values(b).run();
  });
}

export function loadProfile(): { profile: Profile; version: string; bank: BankEntry[] } {
  const row = db.select().from(schema.profile).get();
  if (!row) throw new Error('No profile in the database. Fill data/profile.json and run: npm run profile:import');
  const bank = db.select().from(schema.answerBank).orderBy(asc(schema.answerBank.id)).all();
  return { profile: JSON.parse(row.json), version: row.version, bank };
}
