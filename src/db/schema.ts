import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export type AppStatus =
  | 'queued'
  | 'in_progress'
  | 'ready_to_submit' // form filled and left open; the applicant submits it
  | 'applied'
  | 'human_review'
  | 'duplicate';

export const application = sqliteTable('application', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  url: text('url').notNull().unique(),
  company: text('company'),
  role: text('role'),
  applicant: text('applicant'),
  status: text('status').$type<AppStatus>().notNull().default('queued'),
  reason: text('reason'), // why it went to human review
  confidence: real('confidence'),
  step: integer('step').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const stepLog = sqliteTable('step_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  applicationId: integer('application_id').notNull(),
  step: integer('step').notNull(),
  op: text('op').notNull(),
  target: text('target'),
  detail: text('detail'),
  screenshot: text('screenshot'),
  at: text('at').notNull(),
});

export const profile = sqliteTable('profile', {
  id: integer('id').primaryKey(),
  version: text('version').notNull(),
  json: text('json').notNull(),
});

export const answerBank = sqliteTable('answer_bank', {
  id: text('id').primaryKey(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
});

export const generation = sqliteTable('generation', {
  key: text('key').primaryKey(),
  text: text('text').notNull(),
  at: text('at').notNull(),
});
