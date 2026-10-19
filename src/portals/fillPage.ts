// "Fill this page": fill the empty fields on whatever page an application's tab is showing right now,
// then stop. Never clicks Next or Submit, never overwrites a field that already has something in it.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { config } from '../config.js';
import { eq } from 'drizzle-orm';
import { db, schema, logStep, updateApp } from '../db/index.js';
import { loadProfile } from '../profile.js';
import { makeDecider } from '../decider/index.js';
import { makeWriter } from '../writer/index.js';
import { makeBrain } from '../qa/brain.js';
import { buildContext } from '../qa/context.js';
import { observe, readJob } from '../agent/observe.js';
import { fillField } from '../agent/fill.js';
import { closeCombobox } from '../agent/executor.js';
import { cleanLabel, isFileInput, isFillable } from '../types.js';
import { isWorkdayPage } from './workday/index.js';
import { newMemory, workOnStep } from './workday/flow.js';
import { readStep, saveSnapshot } from './workday/read.js';

const MAX_FIELDS = 80; // a page never has more than this; stops a loop if a field keeps coming back

export async function fillPage(appId: number, page: Page): Promise<string> {
  const app = db.select().from(schema.application).where(eq(schema.application.id, appId)).get();
  if (!app) return 'Application not found.';
  const { profile, version, bank } = loadProfile();
  const info = await readJob(page).catch(() => ({ company: app.company ?? '', role: app.role ?? '', jd: '' }));
  const job = { appId, url: app.url, company: app.company || info.company, role: app.role || info.role, jd: info.jd };
  const workday = await isWorkdayPage(page);
  const ctx = buildContext(profile, version, bank, job, workday ? 'Workday' : undefined);
  const decider = makeDecider();
  const brain = makeBrain(decider, makeWriter());
  let step = app.step;
  const log = async (op: string, target: string, detail: string) => { logStep(appId, ++step, op, target, `(Fill this page) ${detail}`); };
  let filled = 0;
  const needs: string[] = [];

  if (workday) {
    const mem = newMemory();
    const dir = path.join(config.tracesDir, String(appId));
    fs.mkdirSync(dir, { recursive: true });
    saveSnapshot(dir, Date.now() % 100000, await readStep(page)); // what this page looked like, without values
    for (let i = 0; i < MAX_FIELDS; i++) {
      const s = await readStep(page);
      if (!(await workOnStep(page, s, ctx, brain, mem, async (op, target, detail) => { if (op === 'FILL:filled') filled++; await log(op, target, detail); }))) break;
    }
    needs.push(...mem.needs);
  } else {
    const done = new Set<string>();
    const answers = new Map<string, string>();
    for (let i = 0; i < MAX_FIELDS; i++) {
      const els = await observe(page, done);
      const e = els.find((x) => !x.handled && !x.value && (isFillable(x) || isFileInput(x)));
      if (!e) break;
      done.add(e.key);
      const above = els.slice(0, els.indexOf(e)).reverse().find(isFillable);
      try {
        const r = await fillField(e, { page, ctx, brain, previous: above ? { prompt: cleanLabel(above.label), answer: answers.get(above.key) ?? above.value } : undefined });
        if (r.status === 'filled') { filled++; if (r.value) answers.set(e.key, r.value); }
        if (r.status === 'escalate') needs.push(cleanLabel(e.label));
        await log(`FILL:${r.status}`, e.label, r.detail);
      } catch (err) {
        await closeCombobox(page);
        await log('FILL:error', e.label, (err as Error).message.split('\n')[0]);
        if (e.required) needs.push(cleanLabel(e.label));
      }
    }
  }

  updateApp(appId, { step });
  const msg = `Filled ${filled} field${filled === 1 ? '' : 's'} on this page.${needs.length ? ` Still needs you: ${needs.slice(0, 4).map((n) => `"${n}"`).join(', ')}${needs.length > 4 ? ` and ${needs.length - 4} more` : ''}.` : ''}`;
  logStep(appId, ++step, 'NOTE', undefined, `(Fill this page) ${msg}`);
  return msg;
}
