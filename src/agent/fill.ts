// Fills one form element: read it into a Question, let the Brain answer, apply the Answer.
// This file knows how elements work (lists open, boxes tick, files upload); it decides nothing.
import type { Page } from 'playwright';
import { cleanLabel, isFileInput, type ElementInfo } from '../types.js';
import { answerQuestion, unanswered } from '../qa/answer.js';
import type { Answer, Brain, Context, Question } from '../qa/types.js';
import * as exec from './executor.js';

export type FillResult =
  | { status: 'filled'; detail: string; value?: string }
  | { status: 'skipped'; detail: string }
  | { status: 'escalate'; detail: string };

export interface FillDeps {
  page: Page;
  ctx: Context;
  brain: Brain;
  previous?: { prompt: string; answer: string }; // the question just above, for follow-ups
}

const LONG_LIST = 100; // a list this long is cut off: search it instead of reading it

const notFilled = (q: Question, a: Answer): FillResult =>
  a.kind === 'unknown' ? { status: 'escalate', detail: `Required field "${q.prompt}": ${a.because}` } : { status: 'skipped', detail: a.because };

export async function fillField(e: ElementInfo, d: FillDeps): Promise<FillResult> {
  const base: Question = { prompt: cleanLabel(e.label), required: e.required, previous: d.previous };
  if (isFileInput(e)) return upload(e, base, d);
  if (e.tag === 'combobox') return pickList(e, base, d);
  if (e.tag === 'checkgroup') return choose(e, { ...base, candidates: e.options ?? [], multiple: true }, d);
  if (e.tag === 'radio' || e.tag === 'select') return choose(e, { ...base, candidates: e.options ?? [] }, d);
  if (e.type === 'checkbox') return choose(e, { ...base, candidates: [base.prompt], multiple: true }, d);
  return typeIn(e, base, d);
}

async function typeIn(e: ElementInfo, q: Question, d: FillDeps): Promise<FillResult> {
  const a = await answerQuestion(q, d.ctx, d.brain);
  if (a.kind !== 'text') return notFilled(q, a);
  await exec.typeText(d.page, e, a.value);
  return { status: 'filled', detail: `${a.because}: ${a.value.length > 60 ? `${a.value.length} chars` : a.value}`, value: a.value };
}

/** Native selects, radio groups, checkbox lists and lone checkboxes: the form's options are the candidates. */
async function choose(e: ElementInfo, q: Question & { candidates: string[] }, d: FillDeps): Promise<FillResult> {
  const a = await answerQuestion(q, d.ctx, d.brain);
  if (e.type === 'checkbox' && e.tag !== 'checkgroup') {
    const on = a.kind === 'pick';
    await exec.setCheckbox(d.page, e, on);
    return { status: 'filled', detail: on ? 'ticked' : `left unticked: ${a.because}`, value: on ? 'checked' : '' };
  }
  if (a.kind !== 'pick') return notFilled(q, a);
  if (e.tag === 'checkgroup') {
    for (let k = 0; k < q.candidates.length; k++) await exec.setGroupOption(d.page, e, k, a.indexes.includes(k));
    return { status: 'filled', detail: a.because, value: a.indexes.map((i) => q.candidates[i]).join(', ') };
  }
  await exec.chooseOption(d.page, e, a.indexes[0]);
  return { status: 'filled', detail: a.because, value: q.candidates[a.indexes[0]] };
}

/** Custom pick lists (react-select, Workday): open, read, pick; follow a sub-list; verify the field shows it. */
async function pickList(e: ElementInfo, q: Question, d: FillDeps): Promise<FillResult> {
  const options = await exec.comboboxOptions(d.page, e);
  const chosen: string[] = [];
  const pick = async (candidates: string[], prompt = q.prompt) => {
    const a = await answerQuestion({ ...q, prompt, candidates }, d.ctx, d.brain);
    if (a.kind !== 'pick') return a;
    await exec.pickComboboxOption(d.page, a.indexes[0]);
    chosen.push(candidates[a.indexes[0]]);
    return a;
  };
  const done = async (because: string): Promise<FillResult> => {
    await exec.closeCombobox(d.page);
    const last = chosen[chosen.length - 1];
    if (!(await exec.fieldShows(d.page, e, last)) && !(await exec.fieldShows(d.page, e, chosen[0]))) {
      return notFilled(q, unanswered(q, `picked "${chosen.join(' > ')}" but the field doesn't show it as chosen`));
    }
    return { status: 'filled', detail: because, value: chosen.join(' > ') };
  };

  if (options.length && options.length < LONG_LIST) {
    const a = await pick(options);
    if (a.kind !== 'pick') { await exec.closeCombobox(d.page); return notFilled(q, a); }
    // A sub-list may open after the first choice (Workday's "How did you hear": Other > Other).
    await d.page.waitForTimeout(600);
    const sub = await exec.currentOptions(d.page);
    if (sub.length) await pick(sub, `${q.prompt} > ${chosen[0]}`);
    return done(`chose "${chosen.join(' > ')}"`);
  }

  // Empty (async search) or cut-off list: find the answer first, then search the list with it.
  const a = await answerQuestion(q, d.ctx, d.brain);
  if (a.kind !== 'text') { await exec.closeCombobox(d.page); return notFilled(q, a); }
  let found = await exec.comboboxSearch(d.page, e, a.value);
  if (!found.length && options.length) found = await exec.comboboxReset(d.page, e); // nothing matched: offer the list as is
  if (found.length) {
    const b = await pick(found);
    if (b.kind === 'pick') return done(`${a.because}: chose "${chosen[0]}"`);
  } else if (await exec.pickByText(d.page, e, a.value)) {
    chosen.push(a.value); // pickers that don't mark their options
    return done(`${a.because}: chose "${a.value}"`);
  }
  await exec.closeCombobox(d.page);
  return notFilled(q, unanswered(q, `no option matches "${a.value}" (the list showed: ${found.slice(0, 8).join(', ') || 'nothing'})`));
}

/** File inputs: the applicant's files are the candidates. The cover letter is written on demand. */
async function upload(e: ElementInfo, q: Question, d: FillDeps): Promise<FillResult> {
  const a = await answerQuestion({ ...q, candidates: d.ctx.files.map((f) => f.label), attach: true }, d.ctx, d.brain);
  if (a.kind !== 'pick') return notFilled(q, a);
  const slot = d.ctx.files[a.indexes[0]];
  let path = slot.path;
  if (slot.key === 'cover_letter') path = (await d.brain.write('cover_letter', q.prompt, d.ctx)).file;
  if (!path) return notFilled(q, unanswered(q, `no ${slot.key.replace('_', ' ')} file is available`));
  await exec.uploadFile(d.page, e, path);
  return { status: 'filled', detail: `uploaded ${slot.key.replace('_', ' ')}`, value: slot.key };
}
