import { createHash } from 'node:crypto';
import { asc } from 'drizzle-orm';
import { db, schema } from './db/index.js';

/** Your cover letter. Only the middle paragraphs are rewritten for each job. */
export interface CoverLetterTemplate {
  header: string; // name + contact lines, used as written
  salutation: string; // {company} and {role} are filled in, e.g. "To the {company} Selection Committee,"
  opening: string; // first paragraph, used word for word on every letter
  examples: string; // your own middle paragraphs: the style and content guide for each job's version
  closing: string; // e.g. "Sincerely,\n\nJane Doe"
}

export interface Profile {
  fields: Record<string, string>;
  facts: Record<string, unknown>;
  cover_letter?: CoverLetterTemplate;
  /** Documents you pasted in Setup; open-ended answers may draw on them. */
  reference_docs?: { title: string; text: string }[];
  /** Plain-language rules the AI reads with every question. Empty = the defaults. */
  guidelines?: string[];
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
