// Filling and moving through an application, in the page. "Fill page": fill every empty field on this page (and in
// forms embedded in it), then Apply / Next / Save and Continue, page after page, stopping where the way on is Submit.
// When the application runs inside a frame (iCIMS), the page drives it there: it reads the frame's buttons and
// clicks them through the frame. The bot never clicks Submit. A run survives page loads: its state lives in the background.
import { ask, type FillReport, type Look, type Run } from '../shared/msg.js';
import { portalName as portalOf } from '../shared/portal.js';
import type { Answer } from '../shared/types.js';
import { store, type Action } from '../shared/store.js';
import { inside, readJob, readStep, type Field, type Step } from './read.js';
import { trackSubmit } from './submit.js';
import { WIDGETS, key, press, sleep } from './widgets.js';
import { log, snapshot } from './log.js';

const MAX_ENTRIES = 6; // most entries the bot will add to one repeating section
const MAX_PAGES = 40;
const SIGN_IN_FIELDS = 3; // a sign-in page asks this little; a longer form with a password also creates your account
const MAX_RELOADS = 3; // times a form may reload while being filled before the run stops trying
// Ways in, in order: carry on with a draft already started, then a portal's start options, then Apply.
const START = [
  { id: /^continueButton$/i, text: /^continue application$/i },
  { id: /autofillWithResume/i, text: /^autofill with resume$/i },
  { id: /applyManually/i, text: /^apply manually$/i },
  { id: /adventureButton|applyButton/i, text: /^(apply( now| online| for this (job|position|role)( online)?)?|start (your |my )?application|i'?m interested)$/i },
  { id: /^$/, text: /^application$/i }, // an "Application" tab beside the job description
];
const NEXT = { id: /pageFooterNextButton|bottom-navigation-next-button/i, text: /^(save (and|&) continue|continue|next( step| page)?)$/i };
const SUBMIT = /^(submit( (my )?application)?|send( application)?|finish|complete)$/i;
// Buttons that send you to another account (apply with LinkedIn...): never the way into the form.
/** What filling this field saved you, for the Time saved card (an unticked box saved nothing). */
const actionOf = (f: Field, detail: string, value: string): Action | null =>
  /^(uploaded )?cover letter/.test(detail) ? 'letters' : /^written answer/.test(detail) ? 'written' : f.kind === 'file' ? 'uploaded'
    : f.kind === 'text' || f.kind === 'textarea' || f.kind === 'date' ? 'typed' : f.kind === 'checkbox' || f.kind === 'checkgroup' ? (value ? 'ticked' : null) : 'picked';
const COUNTED = /experience|employment|work|education/i;
const ELSEWHERE = /apply with|sign (in|up) with|log ?in with|continue with|import (from|my)|quick apply|use my (profile)/i;
// The login and password of the account a form creates: yours to choose.
const ACCOUNT = /^(log ?in|user ?(name|id)|password)\b/i;

type Way = Look['buttons'][number];
// By wording, preferring the page's footer (where Next lives); the portal's own button names as a fallback.
const find = (buttons: Way[], b: { id: RegExp; text: RegExp }) =>
  buttons.find((x) => x.footer && b.text.test(x.text)) ?? buttons.find((x) => b.text.test(x.text)) ?? buttons.find((x) => x.autoId && b.id.test(x.autoId));

/** What the widget shows: a status line, and (when given) the fields left for you. */
export type Say = (status: string, needs?: string[]) => void;
const top = window.top === window;

// Stop: the field being filled finishes, nothing after it starts (in this frame, and in forms embedded in the page).
let stopping = false;
/** Stop whatever is filling in this tab. */
export async function requestStop() {
  stopping = true;
  await ask({ t: 'run:set', run: null }).catch(() => {});
  if (top) await ask({ t: 'frames', op: 'stop' }).catch(() => {});
}
/** A frame was told to stop (or, with false, that a new fill is starting). */
export const setStopping = (on: boolean) => { stopping = on; };

/** Fill this frame's page. `retry` also re-answers fields the page flagged with an error. */
export async function fillFrame(say: Say, retry = false): Promise<FillReport> {
  const tried = new Set<string>(), again = new Set<string>(), decided = new Set<string>(), answers = new Map<string, string>();
  const needs: string[] = [];
  let filled = 0, step: Step = readStep();
  const worth = top || step.fields.length > 0; // embedded frames with no questions (captchas, ads) stay out of the log
  if (worth) snapshot(retry ? 'before filling again (the page flagged fields)' : 'before filling');
  for (let guard = 0; guard < 300 && !stopping; guard++) {
    step = readStep();
    // Repeating sections: how many entries each needs is the AI's call, from your data. Then add them.
    const section = step.sections.find((s) => !decided.has(s.heading));
    if (section) {
      decided.add(section.heading);
      const counts = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => String(i));
      say(`Working out "${section.heading}"`);
      const a = await ask<Answer>({ t: 'answer', q: { prompt: `How many entries should the "${section.heading}" section have for this applicant?`, candidates: counts, required: false } });
      const want = a.kind === 'pick' ? a.indexes[0] : section.entries;
      log({ type: 'section', heading: section.heading, had: section.entries, want });
      for (let i = section.entries; i < want && !stopping; i++) {
        const add = readStep().sections.find((s) => s.heading === section.heading)?.add ?? section.add;
        press(add);
        await sleep(700);
      }
      // More jobs or schools than Setup has (a site's resume reader can turn a project into a job): remove the
      // extras, half-empty ones first, then from the bottom. Other sections' counts are only the AI's estimate.
      for (let i = section.entries; a.kind === 'pick' && want > 0 && i > want && COUNTED.test(section.heading) && !stopping; i--) {
        const now = readStep(), rows = [...(now.sections.find((s) => s.heading === section.heading)?.rows ?? [])].reverse();
        const row = rows.find((r) => now.fields.some((f) => f.entry === r.name && f.required && !f.value)) ?? rows[0];
        if (!row) break;
        log({ type: 'removed an extra entry', section: section.heading, entry: row.name });
        press(row.del);
        await sleep(700);
      }
      continue;
    }
    // The next empty field. Fields already filled (by the site from your resume, or by you) are left alone.
    const f = step.fields.find((x) => !tried.has(x.key) && (!x.value || (retry && !!x.error)));
    if (!f) break;
    tried.add(f.key);
    const label = f.entry ? `${f.entry} > ${f.label}` : f.label;
    // A form that also creates your account (iCIMS "Create Profile"): its login and password are yours.
    if (step.signIn && (ACCOUNT.test(f.label) || !!f.box.querySelector('input[type=password]'))) {
      log({ type: 'field', q: label, kind: f.kind, status: 'yours', detail: 'the login of the account this form creates' });
      needs.push(label);
      continue;
    }
    const handler = WIDGETS[f.kind];
    if (!handler) { log({ type: 'field', q: label, kind: f.kind, status: 'unrecognised control' }); if (f.required) needs.push(label); continue; }
    const i = step.fields.indexOf(f), above = step.fields[i - 1];
    say(`Filling "${label.slice(0, 60)}"`);
    try {
      const r = await handler(f, { previous: above ? { prompt: above.label, answer: answers.get(above.key) ?? above.value } : undefined, feedback: retry ? f.error : undefined }, retry && !!f.error);
      console.info(`JobDemon: ${r.status} "${label}": ${r.detail}`);
      log({ type: 'field', q: label, kind: f.kind, status: r.status, detail: r.detail });
      if (r.status === 'filled') {
        filled++; answers.set(f.key, r.value);
        const action = actionOf(f, r.detail, r.value);
        if (action) await ask({ t: 'did', action }).catch(() => {});
      }
      if (r.status === 'escalate') needs.push(label);
    } catch (err) {
      key('Escape');
      console.warn('JobDemon:', label, (err as Error).message);
      log({ type: 'field', q: label, kind: f.kind, status: 'error', detail: (err as Error).message });
      if (/API key|not responding/i.test((err as Error).message)) throw err;
      // The AI is busy for a moment ("529 ... try again later"): give this field one more go before leaving it for you.
      if (/\b(429|5\d\d)\b|try again/i.test((err as Error).message) && !again.has(f.key)) { again.add(f.key); tried.delete(f.key); await sleep(5000); continue; }
      if (f.required) needs.push(label);
    }
  }
  if (worth) snapshot(stopping ? 'stopped' : 'after filling');
  return { fields: readStep().fields.length, filled, needs };
}

/** Fill one field: the one holding this control. Overwrites what's there. */
export async function fillOne(control: Element, say: Say) {
  const step = readStep();
  const f = step.fields.find((x) => x.els.includes(control as HTMLElement)) ?? step.fields.find((x) => inside(x.box, control));
  if (!f) return say('Not a question JobDemon can read');
  const handler = WIDGETS[f.kind];
  if (!handler) return say(`Can't fill "${f.label}" (unrecognised control)`);
  const i = step.fields.indexOf(f), above = step.fields[i - 1];
  say(`Filling "${f.label.slice(0, 60)}"`);
  const r = await handler(f, { previous: above ? { prompt: above.label, answer: above.value } : undefined }, true);
  log({ type: 'field', q: f.label, kind: f.kind, status: r.status, detail: r.detail, how: 'button beside the field' });
  say(r.status === 'filled' ? `Filled "${f.label.slice(0, 40)}"` : r.detail);
}

/** This frame plus every form embedded in the page (e.g. a Greenhouse form on a company's careers site). */
async function fillAll(say: Say, retry = false): Promise<FillReport> {
  const here = await fillFrame(say, retry);
  const frames: FillReport = top && !stopping ? await ask<FillReport>({ t: 'frames', op: 'fill', retry }).catch(() => ({ fields: 0, filled: 0, needs: [] })) : { fields: 0, filled: 0, needs: [] };
  return { fields: here.fields + frames.fields, filled: here.filled + frames.filled, needs: [...here.needs, ...frames.needs], cut: frames.cut };
}

/** What this frame's page shows a run (see Look). */
export function look(job = false): Look {
  const s = readStep();
  return {
    signIn: s.signIn, fields: s.fields.length, name: s.name, tag: stepTag(s), errors: s.errors,
    flagged: s.fields.filter((f) => f.error).map((f) => `${f.label}: ${f.error}`),
    buttons: s.buttons.map(({ text, autoId, footer }) => ({ text, autoId, footer })), job: job ? readJob() : undefined,
  };
}
/** Click this frame's button with these words. A Submit is followed to see whether it went through. */
export function clickButton(text: string, submit = false) {
  const b = readStep().buttons.find((x) => x.text === text);
  if (b && submit) trackSubmit(b.el);
  if (b) press(b.el);
  return !!b;
}

/** The page as the run sees it: this page, or the form embedded in it (the one asking the most). With no form
 * anywhere yet, the ways in may be on the page or inside a frame (an iCIMS posting): all their buttons. */
async function view(job = false): Promise<Look> {
  const here = look(job);
  const frames = await ask<Look[]>({ t: 'frames:look', job }).catch(() => [] as Look[]);
  const form = [here, ...frames].filter((l) => l.fields || l.signIn).sort((a, b) => b.fields - a.fields)[0];
  return form ?? { ...here, buttons: [...here.buttons, ...frames.flatMap((l) => l.buttons)] };
}
const click = async (b: Way, submit = false) => {
  if (b.frame === undefined) clickButton(b.text, submit);
  else await ask({ t: 'frames:click', frameId: b.frame, text: b.text, submit });
};
const where = (v: Look) => `${v.frame ?? 'page'}#${v.tag}`;

/** The job portal this page belongs to ('' when it isn't a known one). */
export const portalName = (host = location.hostname) => portalOf(host);

async function begin(say: Say) {
  const job = readJob();
  await ask({ t: 'job', job, portal: portalName() || undefined });
  // A posting or form embedded in the page may name the job better than the page around it.
  for (const l of await ask<Look[]>({ t: 'frames:look', job: true }).catch(() => [] as Look[])) if (l.job) await ask({ t: 'job', job: l.job, fix: true });
  await ask({ t: 'history', patch: { status: 'in_progress' } });
  say('Reading your Setup');
}

async function end(report: FillReport, say: Say, final: string) {
  await ask({ t: 'history', patch: { status: report.needs.length ? 'needs_you' : 'filled', needs: report.needs } }).catch(() => {});
  say(final, report.needs);
}


const newRun = (): Run => ({ active: true, filledAny: false, tries: {}, started: [], lastClickAt: Date.now() });
// Once you press Stop, nothing here may bring the run back.
const save = (run: Run | null) => (stopping && run ? Promise.resolve() : ask({ t: 'run:set', run }));
// The same step, by its questions' wording (internal ids can change every time a page redraws).
const stepTag = (s: Step) => `${location.pathname}#${s.name}#${s.progress?.at ?? ''}#${[...new Set(s.fields.map((f) => (f.entry ? `${f.entry} > ${f.label}` : f.label)))].sort().join(',')}`;

/** After a click: wait until the page (or its embedded form) moves on or shows an error (up to 20 s). A full page
 * load ends this script. */
async function waitForChange(before: Look) {
  const url = location.href, tag = where(before);
  for (let waited = 0; waited < 20000; waited += 1000) {
    await sleep(1000);
    const now = await view();
    if (location.href !== url || where(now) !== tag || now.signIn || now.errors.length || now.flagged.length) return;
    if (!(await ask<Run | null>({ t: 'run:get' }))?.active) return; // stopped, or moved to a new tab
  }
}

/** Fill page: from the page this tab shows, through the next pages, to Submit. */
export async function continueRun(say: Say, resume = false) {
  stopping = false;
  let run = (resume && (await ask<Run | null>({ t: 'run:get' }))) || newRun();
  run.active = true;
  await save(run);
  if (!resume) { await ask({ t: 'uploads', clear: true }).catch(() => {}); await begin(say); }
  const stillOn = async () => !stopping && !!(await ask<Run | null>({ t: 'run:get' }))?.active;
  let report: FillReport = { fields: 0, filled: 0, needs: [] };
  const halted = () => say(stopping ? 'Stopped.' : Date.now() - run.lastClickAt < 10000 ? 'Carrying on in the tab that just opened' : 'Stopped.', stopping ? report.needs : undefined);
  const stop = async (msg: string) => { log({ type: 'continue ended', message: msg }); await save(null); await end(report, say, msg); };
  // Wait while a sign-in shows (you sign in, or create the account), then carry on here or on the page that loads next.
  const waitForYou = async (msg: string) => {
    run.waiting = 'sign-in';
    await save(run);
    say(msg);
    while ((await view()).signIn) { await sleep(2000); if (!(await stillOn())) return false; }
    run.waiting = undefined;
    await save(run);
    await sleep(1500);
    return true;
  };
  let reloads = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (!(await stillOn())) return halted();
    const first = await view();
    if (first.signIn && first.fields <= SIGN_IN_FIELDS && !(await waitForYou('Sign in or create your account. JobDemon carries on after.'))) return halted();
    report = await fillAll(say);
    if (!(await stillOn())) return halted();
    // The form loaded again while being filled (some read your resume, then redraw the form with it): fill what's left.
    if (report.cut) {
      if (reloads >= MAX_RELOADS) return stop('The form keeps reloading while JobDemon fills it. Check it, then press Fill page to carry on.');
      reloads++;
      log({ type: 'form reloaded while filling' });
      say('The form reloaded. Carrying on.');
      await sleep(2500);
      continue;
    }
    const step = await view(true);
    if (step.frame !== undefined && step.job) await ask({ t: 'job', job: step.job, fix: true });
    const ways = step.buttons.filter((b) => !ELSEWHERE.test(b.text));

    // Something was filled (an upload can leave a page with no questions): this is the application.
    if (report.filled) run.filledAny = true;
    // Getting in: Apply, then a start option. The next page can take a few seconds to appear.
    if (!report.fields && !run.filledAny) {
      const start = START.map((b) => find(ways, b)).find((b) => b && !run.started.includes(b.text));
      if (start) {
        run.started.push(start.text);
        run.lastClickAt = Date.now();
        await save(run);
        if (!(await stillOn())) return halted();
        say(`Opening the application: "${start.text}"`);
        log({ type: 'click', button: start.text, why: 'way into the application', in: start.frame === undefined ? 'page' : 'embedded form' });
        await click(start);
        await waitForChange(step);
        continue;
      }
      if (Date.now() - run.lastClickAt < 20000) { say('Waiting for the form to appear'); await sleep(1500); continue; }
      return stop("Couldn't find the application form. Open it, then press Fill page.");
    }
    if (report.fields) run.filledAny = true;
    // A form that also creates your account: its login and password are yours. Carry on once it's created.
    if (step.signIn) {
      const create = step.buttons.find((b) => /create|register|sign ?up|continue|next/i.test(b.text));
      if (!(await waitForYou(`Choose a login and password${create ? `, then click "${create.text}"` : ''}. JobDemon carries on after.`))) return halted();
      continue;
    }

    // Page done: Save and Continue, or stop at Submit.
    const next = find(ways, NEXT);
    if (!next || SUBMIT.test(next.text)) {
      // Nothing to click yet: the page may still be drawing after the last click.
      if (!next && !report.fields && Date.now() - run.lastClickAt < 20000) { await sleep(1500); continue; }
      const submit = step.buttons.find((b) => SUBMIT.test(b.text));
      // Auto-submit (your switch on the bar): only a complete form, with nothing left for you and no messages on it.
      if (submit && (await store.autoSubmit()) && !report.needs.length && !step.errors.length && !step.flagged.length) {
        log({ type: 'auto-submit', button: submit.text });
        await click(submit, true);
        return stop(`Auto-submit: clicked "${submit.text}". Checking it went through…`);
      }
      return stop(submit ? `Done. Check it, then click "${submit.text}".` : 'Done. Check the page, then submit it.');
    }
    // Tries: 0 = first click; 1 = the page refused, answer its flagged fields again; 2 = second click; 3 = give up.
    const tag = where(step);
    const tries = run.tries[tag] ?? 0;
    const flagged = step.flagged;
    if (tries === 1 && flagged.length) {
      run.tries[tag] = 2;
      await save(run);
      say(`The page flagged ${flagged.length} field${flagged.length === 1 ? '' : 's'}: answering again with its message`);
      log({ type: 'retry', flagged });
      report = await fillAll(say, true);
      if (!(await stillOn())) return halted();
      continue;
    }
    if (tries === 1 || tries >= 3) return stop(`The page didn't move on from "${step.name || 'this step'}"${step.errors.length ? `. It says: ${step.errors.join(' / ')}` : ''}`);
    run.tries[tag] = tries + 1;
    run.lastClickAt = Date.now();
    await save(run);
    if (!(await stillOn())) return halted();
    say(`Next: "${next.text}"`);
    if (!tries) await ask({ t: 'did', action: 'pages' }).catch(() => {});
    log({ type: 'click', button: next.text, why: 'next page', attempt: tries + 1, in: next.frame === undefined ? 'page' : 'embedded form' });
    await click(next);
    await waitForChange(step);
  }
  return stop(`Stopped after ${MAX_PAGES} pages`);
}

export const stopRun = () => ask({ t: 'run:set', run: null });
export type { Field };
