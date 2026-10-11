// New application questions the bot had no answer for. They show up on the Setup page;
// once answered they go into the answer bank and are used on every future application.
import { eq, sql } from 'drizzle-orm';
import { db, schema, now } from './db/index.js';
import type { NewQuestion } from './agent/fill.js';

export const questionKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 160);

export function recordQuestion(q: NewQuestion, company: string, url: string) {
  // Empty profile fields are keyed by field, so answering one fills in your profile.
  const key = q.profileKey ? `profile:${q.profileKey}` : questionKey(q.label);
  if (!key) return;
  db.insert(schema.question)
    .values({ key, label: q.label, options: JSON.stringify(q.options), required: q.required, company, url, createdAt: now() })
    .onConflictDoUpdate({
      target: schema.question.key,
      // Keep the richest option list and remember it was required anywhere.
      set: {
        seen: sql`${schema.question.seen} + 1`,
        required: sql`max(${schema.question.required}, ${q.required ? 1 : 0})`,
        options: q.options.length ? JSON.stringify(q.options) : sql`${schema.question.options}`,
      },
    }).run();
}

export const newQuestions = () =>
  db.select().from(schema.question).where(eq(schema.question.status, 'new')).all()
    .map((q) => ({ ...q, options: JSON.parse(q.options) as string[] }))
    .sort((a, b) => Number(b.required) - Number(a.required) || b.seen - a.seen);

export const removeQuestion = (key: string) => db.delete(schema.question).where(eq(schema.question.key, key)).run();
export const ignoreQuestion = (key: string) => db.update(schema.question).set({ status: 'ignored' }).where(eq(schema.question.key, key)).run();
