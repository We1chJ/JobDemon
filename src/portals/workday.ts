// The Workday flow: Workday's own step machine. It does not use Jev to pick buttons or field order:
// Workday's buttons and steps are fixed, so they are handled by rule. Shared basics (filling a field,
// your profile and answers, sign-in wait, submit block, hand-over) come from src/agent.
import type { Page } from 'playwright';
import { config } from '../config.js';
import { LowQualityError } from '../content.js';
import type { Decider } from '../decider/index.js';
import type { Writer } from '../writer/index.js';
import { cleanLabel, isFileInput, isFillable, type ElementInfo } from '../types.js';
import { observe, detectBlocker } from '../agent/observe.js';
import { fillField } from '../agent/fill.js';
import { makeBrain } from '../qa/brain.js';
import * as exec from '../agent/executor.js';
import { Session, pageErrors, prepareJob } from '../agent/session.js';

export const isWorkdayUrl = (url: string) => {
  try { return /(^|\.)myworkdayjobs\.com$|(^|\.)myworkdaysite\.com$/.test(new URL(url).hostname); } catch { return false; }
};
/** By address, or (on a company's own careers site) by Workday's page markers. */
export async function isWorkdayPage(page: Page) {
  return isWorkdayUrl(page.url()) || (await page.locator('[data-automation-id]').count().catch(() => 0)) > 15;
}

// Ways in, in order of preference: Workday's "Start Your Application" pop-up options, then Apply.
const START_OPTIONS = [/^autofill with resume$/i, /^apply manually$/i];
const APPLY = /^apply( now)?$/i;
// Workday's buttons between steps. "Submit" is where the bot stops.
const NEXT = /^(save and continue|continue|next)$/i;
const SUBMIT = /^submit( application)?$/i;

const isButton = (e: ElementInfo) => !isFillable(e) && !isFileInput(e);
const findButton = (els: ElementInfo[], re: RegExp) => els.find((e) => isButton(e) && re.test(cleanLabel(e.label)));

/** The Workday step you're on, from its heading (e.g. "My Information", "My Experience", "Review"). */
async function stepName(page: Page) {
  return (await page.locator('[data-automation-id="progressBarActiveStep"]:visible, h2:visible').first().innerText().catch(() => '')).trim().slice(0, 80);
}

export async function runWorkday(s: Session, decider: Decider, writer: Writer) {
  try {
    s.log('NOTE', undefined, 'Portal: Workday (Workday flow)');

    const prepared = await prepareJob(s);
    if (!prepared) return;
    const { ctx } = prepared;
    ctx.portal = 'Workday';
    const fillDeps = { ctx, brain: makeBrain(decider, writer) };

    const handled = new Set<string>(); // "step|field" the bot has dealt with
    const needs: string[] = [];
    const notes: string[] = [];
    const answers = new Map<string, string>();
    const nextClickedOn = new Set<string>();
    const opened = new Set<string>(); // start buttons already clicked
    let lastOpenAt = 0; // Workday's next page (e.g. sign-in) can take ~5s to appear
    const finish = (stoppedAt?: ElementInfo, elements: ElementInfo[] = []) => s.finish({ handled: handled.size, needs, notes, elements, stoppedAt });

    let elements: ElementInfo[] = [];
    while (s.step < config.maxSteps) {
      s.step++;
      const blocker = await detectBlocker(s.page);
      if (blocker && /login|verification/i.test(blocker)) {
        if (await s.waitForSignIn(blocker)) continue;
        return await s.signInTimeout(blocker);
      }
      if (blocker && !notes.includes(blocker)) notes.push(blocker);

      const step = await stepName(s.page);
      elements = await observe(s.page, new Set([...handled].filter((k) => k.startsWith(`${step}|`)).map((k) => k.slice(step.length + 1))));
      const fields = elements.filter((e) => isFillable(e) || isFileInput(e));

      // 1. Getting in: Apply, then the start option (Autofill with Resume / Apply Manually).
      if (!fields.length && handled.size === 0) {
        const start = START_OPTIONS.map((re) => findButton(elements, re)).find(Boolean) ?? (opened.has('apply') ? undefined : findButton(elements, APPLY));
        if (start) {
          opened.add(APPLY.test(cleanLabel(start.label)) ? 'apply' : cleanLabel(start.label));
          lastOpenAt = Date.now();
          await exec.click(s.page, start);
          await s.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
          await s.page.waitForTimeout(1000);
          s.log('OPEN', start.label, 'Opening the Workday application', await s.shot('open'));
          continue;
        }
        // Just clicked a way in: give Workday up to 20 seconds to show the next page.
        if (opened.size && Date.now() - lastOpenAt < 20000) { await s.page.waitForTimeout(1500); continue; }
        notes.push("Couldn't find Workday's Apply button or start options");
        return await finish(undefined, elements);
      }

      // 2. Fill this step's empty fields, top to bottom.
      const pending = fields.filter((e) => !e.handled);
      if (pending.length) {
        const el = pending[0];
        const above = elements.slice(0, elements.indexOf(el)).reverse().find((e) => isFillable(e));
        handled.add(`${step}|${el.key}`);
        try {
          const r = await fillField(el, { ...fillDeps, page: s.page, previous: above ? { prompt: cleanLabel(above.label), answer: answers.get(above.key) ?? above.value } : undefined });
          if (r.status === 'filled' && r.value) answers.set(el.key, r.value);
          s.log(`FILL:${r.status}`, el.label, `${step ? `[${step}] ` : ''}${r.detail}`, await s.shot('fill'));
          if (r.status === 'escalate') needs.push(cleanLabel(el.label));
        } catch (err) {
          await exec.closeCombobox(s.page);
          const why = err instanceof LowQualityError ? err.message : (err as Error).message.split('\n')[0];
          s.log('FILL:error', el.label, why, await s.shot('error'));
          if (el.required) needs.push(cleanLabel(el.label));
        }
        continue;
      }

      // 3. Step done. Clicked Next here already and still on it: Workday refused (e.g. "Errors Found").
      const stepId = `${step}#${fields.map((e) => cleanLabel(e.label)).sort().join(',')}`;
      if (nextClickedOn.has(stepId)) {
        const errors = await pageErrors(s.page);
        notes.push(`Workday didn't move on from "${step || 'this step'}"${errors.length ? `. It says: ${errors.join(' / ')}` : ''}`);
        return await finish(undefined, elements);
      }
      // 4. Next step, or stop at Submit.
      const next = findButton(elements, NEXT);
      if (!next) {
        const submit = findButton(elements, SUBMIT);
        if (!submit) notes.push(`No "Save and Continue" or "Submit" button found on "${step || 'this step'}"`);
        return await finish(submit, elements);
      }
      nextClickedOn.add(stepId);
      await exec.click(s.page, next);
      await s.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await s.page.waitForTimeout(800);
      s.log('NEXT', next.label, `Finished "${step || 'step'}"`, await s.shot('next'));
    }
    notes.push(`Stopped after ${config.maxSteps} steps`);
    return await finish(undefined, elements);
  } catch (err) {
    await s.toReview(`Error: ${(err as Error).message.split('\n')[0]}`);
  } finally {
    await s.close();
  }
}
