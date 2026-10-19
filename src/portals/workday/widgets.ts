// The interaction patterns: type in · pick from a pop-up (and search it) · tick/select · date parts · upload.
// Each turns its field into a shared Question, gets the Answer from the shared answering pipeline, applies it,
// and checks the result by reading the field again. Handlers know how controls behave, never what to answer.
import type { Locator, Page } from 'playwright';
import { answerQuestion, unanswered } from '../../qa/answer.js';
import type { Answer, Brain, Context, Question } from '../../qa/types.js';
import { readStep, type WdField, type WidgetKind } from './read.js';

export interface WidgetDeps { page: Page; ctx: Context; brain: Brain; previous?: { prompt: string; answer: string }; feedback?: string }
export type Result =
  | { status: 'filled'; detail: string; value: string }
  | { status: 'skipped'; detail: string }
  | { status: 'escalate'; detail: string };

const TIMEOUT = 5000;
const LONG_LIST = 100; // a list this long is cut off: search it instead of reading it
// Pop-up options: the standard role, plus Workday's own names as a fallback.
const OPTION = '[role=option], [data-automation-id="promptOption"], [data-automation-id="promptLeafNode"]';

const ctrl = (d: WidgetDeps, f: WdField, k = 0) => d.page.locator(`[data-jdw-c="${f.id}:${k}"]`);
const box = (d: WidgetDeps, f: WdField) => d.page.locator(`[data-jdw="${f.id}"]`);
const prompt = (f: WdField) => (f.entry ? `${f.entry} > ${f.label}` : f.label);
const question = (f: WdField, d: WidgetDeps, extra: Partial<Question> = {}): Question =>
  ({ prompt: prompt(f), required: f.required, previous: d.previous, feedback: d.feedback ?? f.error, ...extra });
const notDone = (q: Question, a: Answer): Result =>
  a.kind === 'unknown' ? { status: 'escalate', detail: `Required field "${q.prompt}": ${a.because}` } : { status: 'skipped', detail: a.because };
const filled = (detail: string, value: string): Result => ({ status: 'filled', detail, value });
const settle = (page: Page, ms = 600) => page.waitForTimeout(ms);

/** What the field shows now, read the same way the step was read. Re-reading renumbers fields, so f follows. */
async function shows(d: WidgetDeps, f: WdField) {
  const now = (await readStep(d.page)).fields.find((x) => x.key === f.key);
  if (now) f.id = now.id;
  return now?.value ?? '';
}

/** Type into a control: fill it, or (when something is drawn over it) focus it and type. */
async function typeInto(page: Page, el: Locator, value: string) {
  await el.fill(value, { timeout: 2000 }).catch(() => el.fill(value, { timeout: 2000, force: true })).catch(async () => {
    await el.evaluate((n: HTMLElement) => n.focus());
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(value, { delay: 20 });
  });
}

/** Open a control's pop-up: click it; if something covers it, click through; failing that, focus and press Down. */
async function openPopup(page: Page, el: Locator) {
  await el.click({ timeout: 2000 }).catch(() => el.click({ timeout: 2000, force: true })).catch(async () => {
    await el.evaluate((n: HTMLElement) => n.focus());
    await page.keyboard.press('ArrowDown');
  });
  await settle(page);
}

/** Options showing right now (outside the field, or inside it but not already chosen), each marked for clicking. */
async function visibleOptions(page: Page, f: WdField): Promise<string[]> {
  return (await page.evaluate(`(() => {
    document.querySelectorAll('[data-jdw-o]').forEach((n) => n.removeAttribute('data-jdw-o'));
    const shown = (n) => { const r = n.getBoundingClientRect(), cs = getComputedStyle(n); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const field = document.querySelector('[data-jdw="${f.id}"]');
    const all = [...document.querySelectorAll(${JSON.stringify(OPTION)})].filter((n) => shown(n) && !(field && field.contains(n) && n.getAttribute('aria-selected') === 'true'));
    const top = all.filter((n) => !all.some((m) => m !== n && m.contains(n)));
    return top.map((n, i) => { n.setAttribute('data-jdw-o', String(i)); return (n.getAttribute('data-automation-label') || n.innerText || '').trim(); });
  })()`)) as string[];
}
const clickOption = (page: Page, i: number) => page.locator(`[data-jdw-o="${i}"]`).click({ timeout: TIMEOUT }).catch(() => page.locator(`[data-jdw-o="${i}"]`).click({ timeout: TIMEOUT, force: true }));

/** Type in. If a list of suggestions pops up while typing (an autocomplete), pick from it. */
async function typeIn(f: WdField, d: WidgetDeps): Promise<Result> {
  const q = question(f, d);
  const a = await answerQuestion(q, d.ctx, d.brain);
  if (a.kind !== 'text') return notDone(q, a);
  const before = new Set(await visibleOptions(d.page, f));
  await typeInto(d.page, ctrl(d, f), a.value);
  await settle(d.page, 500);
  const after = await visibleOptions(d.page, f);
  const fresh = after.filter((o) => !before.has(o));
  if (fresh.length) {
    const p = await answerQuestion({ ...q, candidates: fresh }, d.ctx, d.brain);
    if (p.kind === 'pick') { await clickOption(d.page, after.indexOf(fresh[p.indexes[0]])); await settle(d.page, 300); }
    else await d.page.keyboard.press('Escape');
  }
  if (!(await shows(d, f))) return notDone(q, unanswered(q, `typed "${a.value}" but the field is still empty`));
  return filled(`${a.because}: ${a.value.length > 60 ? `${a.value.length} chars` : a.value}`, a.value);
}

/** Native <select>: the options are right there. */
async function native(f: WdField, d: WidgetDeps): Promise<Result> {
  const options = (f.options ?? []).filter((o) => !/^(select|choose)\b|^-+$/i.test(o));
  const q = question(f, d, { candidates: options });
  const a = await answerQuestion(q, d.ctx, d.brain);
  if (a.kind !== 'pick') return notDone(q, a);
  await ctrl(d, f).selectOption({ label: options[a.indexes[0]] }, { timeout: TIMEOUT });
  return filled(a.because, options[a.indexes[0]]);
}

/** Radios, checkbox lists and single checkboxes: the labels are the candidates. */
async function choose(f: WdField, d: WidgetDeps): Promise<Result> {
  const candidates = f.options ?? [];
  const q = question(f, d, { candidates, multiple: f.kind !== 'radio' });
  const a = await answerQuestion(q, d.ctx, d.brain);
  const picked = a.kind === 'pick' ? a.indexes : [];
  if (f.kind === 'radio' && !picked.length) return notDone(q, a);
  for (let k = 0; k < candidates.length; k++) {
    const on = picked.includes(k);
    if (f.kind === 'radio' && !on) continue;
    const el = ctrl(d, f, k);
    // Real inputs are set directly; custom ones (role=checkbox / role=radio) are clicked until their state matches.
    const isInput = await el.evaluate((n) => n.tagName === 'INPUT');
    if (isInput) await el.setChecked(on, { timeout: TIMEOUT, force: true });
    else if ((await el.getAttribute('aria-checked')) !== String(on)) await el.click({ timeout: TIMEOUT, force: true });
  }
  if (f.kind === 'checkbox') return filled(picked.length ? 'ticked' : `left unticked: ${a.because}`, picked.length ? 'checked' : '');
  return filled(a.because, picked.map((i) => candidates[i]).join(', '));
}

/**
 * Pick from a pop-up: open it and pick, one level at a time (a choice may open a sub-list). If the list is
 * empty, cut off, or has nothing that fits (suggestions only), search it with the answer, one term at a time.
 */
async function pick(f: WdField, d: WidgetDeps): Promise<Result> {
  const el = ctrl(d, f);
  const q = question(f, d);
  // Another field's list may still be on screen: close it, and only count options that appear after opening.
  await d.page.keyboard.press('Escape').catch(() => {});
  const stale = new Set(await visibleOptions(d.page, f));
  const fresh = async () => { const all = await visibleOptions(d.page, f); return { all, list: all.filter((o) => !stale.has(o)) }; };
  await openPopup(d.page, el);
  let shown = await fresh();
  let options = shown.list;
  const chosen: string[] = [];
  const pickFrom = async (list: string[]) => {
    const a = await answerQuestion({ ...q, prompt: chosen.length ? `${prompt(f)} > ${chosen.join(' > ')}` : prompt(f), candidates: list }, d.ctx, d.brain);
    if (a.kind !== 'pick') return a;
    await clickOption(d.page, shown.all.indexOf(list[a.indexes[0]]));
    chosen.push(list[a.indexes[0]]);
    await settle(d.page);
    return a;
  };

  let browse = options.length > 0 && options.length < LONG_LIST;
  for (let level = 0; browse && level < 3 && options.length; level++) {
    const a = await pickFrom(options);
    if (a.kind !== 'pick') {
      if (level > 0) { await d.page.keyboard.press('Escape'); return notDone(q, a); }
      browse = false; // nothing in the first list fits: search for the answer instead
      break;
    }
    if (await shows(d, f)) break;
    shown = await fresh();
    options = shown.list; // a sub-list, or nothing once the pick is made
  }

  if (!browse) {
    await d.page.keyboard.press('Escape');
    const a = await answerQuestion(q, d.ctx, d.brain);
    if (a.kind !== 'text') return notDone(q, a);
    // Something to type into: the control itself, or a text box inside the field.
    const input = f.editable ? el : box(d, f).locator('input:not([type=hidden]):not([type=checkbox]):not([type=radio])').first();
    const terms = a.value.split(/\s*[,;\n]\s*/).filter(Boolean).slice(0, 10);
    for (const term of terms) {
      if (!f.editable) await openPopup(d.page, el);
      await typeInto(d.page, input, term);
      await d.page.keyboard.press('Enter');
      await settle(d.page, 900);
      shown = await fresh();
      if (!shown.list.length) continue;
      const r = await pickFrom(shown.list);
      // A single-choice list is done after one pick; a multi-pick list (skills) keeps a box to type the next term.
      if (r.kind === 'pick' && !(await input.isEditable().catch(() => false))) break;
    }
  }
  await d.page.keyboard.press('Escape').catch(() => {});
  const now = await shows(d, f);
  if (!now) return notDone(q, unanswered(q, chosen.length ? `picked "${chosen.join(' > ')}" but the field doesn't show it` : 'nothing in the list matched'));
  return filled(`chose "${chosen.join(' > ')}"`, now);
}

/** Read a date out of a fact's text: 2028-05-15, 2028-05, 05/2028, 05/15/2028, May 2028, 2028. */
export function parseDate(s: string): { month?: string; day?: string; year?: string } | null {
  const t = s.trim();
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/))) return { year: m[1], month: pad(+m[2]), day: m[3] ? pad(+m[3]) : undefined };
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return { month: pad(+m[1]), day: pad(+m[2]), year: m[3] };
  if ((m = t.match(/^(\d{1,2})\/(\d{4})$/))) return { month: pad(+m[1]), year: m[2] };
  if ((m = t.match(/^([a-z]{3})[a-z]*\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})$/i)) && months.includes(m[1].toLowerCase())) return { month: pad(months.indexOf(m[1].toLowerCase()) + 1), day: m[2] ? pad(+m[2]) : undefined, year: m[3] };
  if ((m = t.match(/^(\d{4})$/))) return { year: m[1] };
  return null;
}

/** Date parts: ask for the date as text, then type each part into its box. */
async function date(f: WdField, d: WidgetDeps): Promise<Result> {
  const q = question(f, d);
  const a = await answerQuestion(q, d.ctx, d.brain);
  if (a.kind !== 'text') return notDone(q, a);
  const when = parseDate(a.value);
  if (!when) return notDone(q, unanswered(q, `"${a.value}" isn't a date`));
  for (const part of f.dateParts ?? []) {
    const v = when[part] ?? (part === 'day' ? '01' : undefined);
    if (!v) return notDone(q, unanswered(q, `"${a.value}" has no ${part}`));
    await typeInto(d.page, box(d, f).locator(`[data-jdw-part="${part}"]`).first(), v);
  }
  if (!(await shows(d, f))) return notDone(q, unanswered(q, `typed "${a.value}" but the date is still empty`));
  return filled(`${a.because}: ${a.value}`, a.value);
}

/** Uploads: the applicant's files are the candidates. The cover letter is written on demand. */
async function upload(f: WdField, d: WidgetDeps): Promise<Result> {
  const q = question(f, d, { candidates: d.ctx.files.map((x) => x.label), attach: true });
  const a = await answerQuestion(q, d.ctx, d.brain);
  if (a.kind !== 'pick') return notDone(q, a);
  const slot = d.ctx.files[a.indexes[0]];
  const path = slot.key === 'cover_letter' ? (await d.brain.write('cover_letter', q.prompt, d.ctx)).file : slot.path;
  if (!path) return notDone(q, unanswered(q, `no ${slot.key.replace('_', ' ')} file is available`));
  await ctrl(d, f).setInputFiles(path, { timeout: TIMEOUT });
  await settle(d.page, 1500); // the site uploads and may parse the file
  return filled(`uploaded ${slot.key.replace('_', ' ')}`, slot.key);
}

export const WIDGETS: Record<WidgetKind, ((f: WdField, d: WidgetDeps) => Promise<Result>) | null> = {
  text: typeIn, textarea: typeIn, native, pick, checkbox: choose, checkgroup: choose, radio: choose, date, file: upload,
  unknown: null,
};
