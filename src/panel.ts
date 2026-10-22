// What the JobDemon widget in a form tab can see and do, shared by the control panel and every run.
// "Continue from here" and "Mark submitted" only act on applications waiting for you.
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, schema, updateApp } from './db/index.js';
import { closeForm, isFormOpen, letterPath, setPanelHandler } from './agent/browser.js';
import { continueApplication } from './portals/index.js';
import { makeDecider } from './decider/index.js';
import { makeWriter } from './writer/index.js';
import { STATUS } from './ui/views.js';

type App = typeof schema.application.$inferSelect;
const get = (id: number) => db.select().from(schema.application).where(eq(schema.application.id, id)).get();
const YOURS = ['human_review', 'ready_to_submit']; // the bot has stopped and handed the form to you

/** "Continue from here" in progress: application id -> what it's doing. */
export const working = new Map<number, string>();

/** One sentence: what you do next with this application. */
export function whatToDo(a: App) {
  if (a.status === 'waiting_for_you') return 'Sign in or create your account in the browser window. The bot carries on by itself once you are in.';
  if (a.status === 'ready_to_submit') return 'Every field is filled. Check it in the browser window and click Submit yourself, then mark it submitted here.';
  if (a.status === 'human_review') {
    if (/couldn't find the application form/i.test(a.reason ?? '')) return 'The bot could not find the form. Open the page: it may need a click the bot did not recognise, or a sign-in.';
    const needs = (a.reason?.match(/"[^"]+"/g) ?? []).length;
    return `${needs ? `${needs} field${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} your answer. ` : ''}Finish it in the browser window and submit it yourself, then mark it submitted here.`;
  }
  return '';
}

/** Carry on in the application's open tab, in the background. Returns an error message, or null. */
export function startResume(a: App): string | null {
  if (!isFormOpen(a.id)) return 'Error: that form is no longer open (the browser was closed or the app restarted). Click Run again.';
  if (working.has(a.id) || a.status === 'in_progress') return null;
  working.set(a.id, 'Continuing from this page…');
  continueApplication(a, makeDecider(), makeWriter())
    .catch((e: Error) => updateApp(a.id, { status: 'human_review', reason: `Error: ${e.message.split('\n')[0]}` }))
    .finally(() => working.delete(a.id));
  return null;
}

export const markSubmitted = (id: number) => updateApp(id, { status: 'applied', reason: 'Marked submitted by you', confidence: 1 });

setPanelHandler(async (id, action) => {
  const a = get(id);
  if (!a) return null;
  if (action === 'resume' && YOURS.includes(a.status)) startResume(a);
  if (action === 'applied' && YOURS.includes(a.status)) {
    markSubmitted(id);
    setTimeout(() => void closeForm(id), 300); // after the widget gets its answer: the application is done, close its tab
    return null;
  }
  const now = get(id)!;
  const letter = fs.existsSync(letterPath(id)) ? fs.readFileSync(letterPath(id), 'utf8') : '';
  return {
    label: STATUS[now.status]?.label ?? now.status,
    title: [now.role, now.company].filter(Boolean).join(' at '),
    todo: whatToDo(now).replace(/, then mark it submitted here\.$/, '.'),
    working: working.get(id) ?? null,
    canAct: YOURS.includes(now.status) && !working.has(id),
    letter,
  };
});
