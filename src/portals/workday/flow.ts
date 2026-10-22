// The Workday flow, end to end:
//   open the posting → Apply → start option → wait for your sign-in → each step: fill every field,
//   then Save and Continue → stop at Submit and hand the form to you.
// Navigation is Workday's fixed buttons. Every answer comes from the shared answering pipeline (src/qa).
import type { Page } from 'playwright';
import type { Decider } from '../../decider/index.js';
import type { Writer } from '../../writer/index.js';
import { config } from '../../config.js';
import { LowQualityError } from '../../content.js';
import { answerQuestion } from '../../qa/answer.js';
import { makeBrain } from '../../qa/brain.js';
import type { Brain, Context } from '../../qa/types.js';
import { Session, prepareJob } from '../../agent/session.js';
import type { ElementInfo } from '../../types.js';
import { readStep, saveSnapshot, type WdButton, type WdField, type WdStep } from './read.js';
import { WIDGETS } from './widgets.js';

// Workday's own buttons, by automation id first and wording second.
// Ways in, in order: carry on with a draft you already started, then Workday's start options.
const START = [
  { id: /^continueButton$/i, text: /^continue application$/i },
  { id: /autofillWithResume/i, text: /^autofill with resume$/i },
  { id: /applyManually/i, text: /^apply manually$/i },
];
const APPLY = { id: /adventureButton|applyButton/i, text: /^apply( now)?$/i };
const NEXT = { id: /pageFooterNextButton|bottom-navigation-next-button/i, text: /^(save (and|&) continue|continue|next( step)?)$/i };
const SUBMIT = /^submit( application)?$/i;
const MAX_ENTRIES = 6; // most entries the bot will add to one repeating section

// By wording, preferring the page's footer (where Next lives); Workday's own button names as a fallback.
const find = (buttons: WdButton[], b: { id: RegExp; text: RegExp }) =>
  buttons.find((x) => x.footer && b.text.test(x.text)) ?? buttons.find((x) => b.text.test(x.text)) ?? buttons.find((x) => b.id.test(x.autoId));
/** What the bot remembers across one application's pages. */
interface Memory {
  done: Set<string>; // "step|field key" dealt with
  decided: Set<string>; // "step|section" whose entry count is settled
  answers: Map<string, string>; // field key -> what the bot put there
  feedback: Map<string, string>; // field key -> Workday's error, for one more try
  needs: string[]; // fields left for you
  filled: boolean;
}
const newMemory = (): Memory => ({ done: new Set(), decided: new Set(), answers: new Map(), feedback: new Map(), needs: [], filled: false });
type Log = (op: string, target: string, detail: string) => Promise<unknown>;

/**
 * One unit of work on the current Workday step: settle a repeating section's entry count, or fill one empty
 * field. Returns false when the step has nothing left to do. Used by each step of the run.
 */
async function workOnStep(page: Page, step: WdStep, ctx: Context, brain: Brain, mem: Memory, log: Log): Promise<boolean> {
  const need = (label: string) => { if (!mem.needs.includes(label)) mem.needs.push(label); };
  // Repeating sections: how many entries each needs is the AI's call, from your data. Then add them.
  const section = step.sections.find((x) => !mem.decided.has(`${step.name}|${x.heading}`));
  if (section) {
    mem.decided.add(`${step.name}|${section.heading}`);
    const counts = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => String(i));
    const a = await answerQuestion({ prompt: `How many entries should the "${section.heading}" section have for this applicant?`, candidates: counts, required: false }, ctx, brain);
    const want = a.kind === 'pick' ? a.indexes[0] : section.entries;
    for (let i = section.entries; i < want; i++) {
      await page.locator(`[data-jdw-add="${section.id}"]`).click({ timeout: 5000 });
      await page.waitForTimeout(700);
      if (i + 1 < want) await readStep(page); // re-mark the Add button for the next click
    }
    await log('SECTION', section.heading, `${want} entr${want === 1 ? 'y' : 'ies'} (had ${section.entries})`);
    return true;
  }
  // The next empty field. Fields already filled (by Workday from your resume, or by you) are left alone.
  const f = step.fields.find((x) => !mem.done.has(`${step.name}|${x.key}`) && (!x.value || mem.feedback.has(x.key)));
  if (!f) return false;
  mem.done.add(`${step.name}|${f.key}`);
  const label = f.entry ? `${f.entry} > ${f.label}` : f.label;
  const handler = WIDGETS[f.kind];
  if (!handler) {
    await log('FILL:skipped', label, `[${step.name}] unrecognised Workday widget`);
    if (f.required) need(label);
    return true;
  }
  const above = step.fields[step.fields.indexOf(f) - 1];
  try {
    const r = await handler(f, { page, ctx, brain, feedback: mem.feedback.get(f.key), previous: above ? { prompt: above.label, answer: mem.answers.get(above.key) ?? above.value } : undefined });
    mem.feedback.delete(f.key);
    if (r.status === 'filled') { mem.answers.set(f.key, r.value); mem.filled = true; }
    await log(`FILL:${r.status}`, label, `[${step.name}] ${r.detail}`);
    if (r.status === 'escalate') need(label);
  } catch (err) {
    await page.keyboard.press('Escape').catch(() => {});
    const why = err instanceof LowQualityError ? err.message : (err as Error).message.split('\n')[0];
    await log('FILL:error', label, `[${step.name}] ${why}`);
    if (f.required) need(label);
  }
  return true;
}

const asElement = (f: WdField): ElementInfo => ({ idx: f.id, key: f.key, tag: f.kind, type: f.kind, label: f.entry ? `${f.entry} > ${f.label}` : f.label, value: f.value, required: f.required, handled: true });

export async function runWorkday(s: Session, decider: Decider, writer: Writer) {
  try {
    s.log('NOTE', undefined, 'Portal: Workday (Workday flow)');
    const prepared = await prepareJob(s);
    if (!prepared) return;
    const { ctx } = prepared;
    ctx.portal = 'Workday';
    const brain = makeBrain(decider, writer);

    const mem = newMemory();
    mem.filled = s.resumed; // carrying on mid-application: no Apply button to look for
    const { done, feedback, needs } = mem;
    const nextTries = new Map<string, number>();
    const snapped = new Set<string>();
    const notes: string[] = [];
    const started = new Set<string>();
    let lastStartAt = Date.now(), snaps = 0; // Workday pages render slowly: the first one gets the same wait as later ones
    const opened: typeof s.page[] = [];
    s.tabs.onTab((p) => opened.push(p));
    const finish = (step?: WdStep, stoppedAt?: WdButton) => s.finish({
      handled: mem.filled ? done.size : 0, needs, notes,
      elements: (step?.fields ?? []).map(asElement),
      stoppedAt: stoppedAt ? { idx: stoppedAt.id, key: stoppedAt.autoId, tag: 'button', type: 'button', label: stoppedAt.text, value: '', required: false, handled: true } : undefined,
    });

    while (s.step < config.maxSteps) {
      s.step++;
      const fresh = opened.splice(0).filter((p) => !p.isClosed()).pop();
      if (fresh) { s.page = fresh; await s.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}); }
      const step = await readStep(s.page);
      const tag = `${step.name}#${step.fields.map((f) => f.key).sort().join(',')}`;
      // Every new page is recorded (without values), including pages with no fields: those are the ones that get stuck.
      const look = `${tag}#${step.buttons.map((b) => b.autoId || b.text).join(',')}`;
      if (!snapped.has(look)) { snapped.add(look); saveSnapshot(s.traceDir, ++snaps, step); }

      // Sign-in / create account: hand the tab to you, then carry on.
      if (step.signIn) {
        if (await s.waitForSignIn('Workday sign-in required')) continue;
        return await s.signInTimeout('Workday sign-in required');
      }

      // Getting in: Apply, then a start option. Workday's next page can take a few seconds to appear.
      if (!step.fields.length && !mem.filled) {
        const start = START.map((b) => find(step.buttons, b)).find((b) => b && !started.has(b.text)) ?? (started.has('apply') ? undefined : find(step.buttons, APPLY));
        if (start) {
          started.add(APPLY.text.test(start.text) || APPLY.id.test(start.autoId) ? 'apply' : start.text);
          lastStartAt = Date.now();
          await s.page.locator(`[data-jdw-b="${start.id}"]`).click({ timeout: 5000 });
          await s.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
          s.log('OPEN', start.text, 'Opening the Workday application', await s.shot('open'));
          continue;
        }
        if (Date.now() - lastStartAt < 20000) { await s.page.waitForTimeout(1500); continue; }
        notes.push("Couldn't find Workday's Apply button or the application form");
        return await finish(step);
      }

      // This step's work: repeating sections, then each empty field, one at a time.
      if (await workOnStep(s.page, step, ctx, brain, mem, async (op, target, detail) => s.log(op, target, detail, await s.shot(op === 'SECTION' ? 'section' : op.endsWith('error') ? 'error' : 'fill')))) continue;

      // Step done: Save and Continue, or stop at Submit.
      const next = find(step.buttons, NEXT);
      const submit = step.buttons.find((b) => SUBMIT.test(b.text));
      if (!next || SUBMIT.test(next.text)) {
        // Nothing to click yet: the page may still be drawing after the last click. Give it the same 20 seconds.
        if (!submit && !next && Date.now() - lastStartAt < 20000) { await s.page.waitForTimeout(1500); continue; }
        if (!submit && !next) notes.push(`No "Save and Continue" or "Submit" button on "${step.name || 'this step'}"`);
        return await finish(step, submit ?? next);
      }
      // Tries: 0 = first click; 1 = Workday refused, answer its flagged fields again; 2 = second click; 3 = give up.
      const tries = nextTries.get(tag) ?? 0;
      const flagged = step.fields.filter((f) => f.error);
      if (tries === 1 || tries >= 3) saveSnapshot(s.traceDir, ++snaps, step); // what Workday showed each time it refused the step
      if (tries === 1 && flagged.length) {
        for (const f of flagged) { feedback.set(f.key, f.error!); done.delete(`${step.name}|${f.key}`); }
        nextTries.set(tag, 2);
        s.log('RETRY', step.name, `Workday flagged ${flagged.length} field${flagged.length === 1 ? '' : 's'}: asking again with its message`);
        continue;
      }
      if (tries === 1 || tries >= 3) {
        notes.push(`Workday didn't move on from "${step.name || 'this step'}"${step.errors.length ? `. It says: ${step.errors.join(' / ')}` : ''}`);
        return await finish(step);
      }
      nextTries.set(tag, tries + 1);
      await s.page.locator(`[data-jdw-b="${next.id}"]`).click({ timeout: 5000 });
      await s.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      // Saving can take a while: wait until the page moves on or shows an error before judging it (up to 20 s).
      for (let waited = 0; waited < 20000; waited += 1000) {
        await s.page.waitForTimeout(1000);
        const now = await readStep(s.page).catch(() => null);
        if (!now) continue; // between pages
        const moved = now.name !== step.name || now.progress?.at !== step.progress?.at || now.signIn;
        if (moved || now.errors.length || now.fields.some((f) => f.error)) break;
      }
      lastStartAt = Date.now();
      s.log('NEXT', next.text, `Finished "${step.name || 'step'}"`, await s.shot('next'));
    }
    notes.push(`Stopped after ${config.maxSteps} steps`);
    return await finish();
  } catch (err) {
    await s.toReview(`Error: ${(err as Error).message.split('\n')[0]}`);
  } finally {
    await s.close();
  }
}
