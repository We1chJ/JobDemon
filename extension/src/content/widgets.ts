// The interaction patterns: type in · pick from a pop-up (and search it) · tick/select · date parts · upload.
// Each turns its field into a Question, gets the Answer from the background (the AI), applies it with the same
// DOM events a person's typing and clicking would send, and checks the result by reading the field again.
// Handlers know how controls behave, never what to answer.
import { unanswered } from '../shared/answer.js';
import { ask, type FileReply } from '../shared/msg.js';
import type { Answer, Question } from '../shared/types.js';
import { readStep, shown, type Field, type WidgetKind } from './read.js';

export interface Deps { previous?: { prompt: string; answer: string }; feedback?: string }
export type Result =
  | { status: 'filled'; detail: string; value: string }
  | { status: 'skipped'; detail: string }
  | { status: 'escalate'; detail: string };

const LONG_LIST = 100; // a list this long is cut off: search it instead of reading it
// Pop-up options: the standard role, plus Workday's own names as a fallback.
const OPTION = '[role=option], [data-automation-id="promptOption"], [data-automation-id="promptLeafNode"], [data-automation-id="menuItem"]';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const prompt = (f: Field) => (f.entry ? `${f.entry} > ${f.label}` : f.label);
const question = (f: Field, d: Deps, extra: Partial<Question> = {}): Question =>
  ({ prompt: prompt(f), required: f.required, previous: d.previous, feedback: d.feedback ?? f.error, ...extra });
const answer = (q: Question) => ask<Answer>({ t: 'answer', q });
const notDone = (q: Question, a: Answer): Result =>
  a.kind === 'unknown' ? { status: 'escalate', detail: `Required field "${q.prompt}": ${a.because}` } : { status: 'skipped', detail: a.because };
const filled = (detail: string, value: string): Result => ({ status: 'filled', detail, value });

// ── DOM events, as a person would send them ────────────────────────────────
const at = (el: Element) => { const r = el.getBoundingClientRect(); return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, composed: true, view: window }; };
/** Press and release the pointer on an element, then click it. */
export function press(el: HTMLElement) {
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  const o = at(el);
  el.dispatchEvent(new PointerEvent('pointerover', o)); el.dispatchEvent(new MouseEvent('mouseover', o));
  el.dispatchEvent(new PointerEvent('pointerdown', { ...o, pointerId: 1, isPrimary: true })); el.dispatchEvent(new MouseEvent('mousedown', { ...o, button: 0 }));
  if (el.tabIndex >= 0 || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)) el.focus({ preventScroll: true });
  el.dispatchEvent(new PointerEvent('pointerup', { ...o, pointerId: 1, isPrimary: true })); el.dispatchEvent(new MouseEvent('mouseup', { ...o, button: 0 }));
  el.click();
}
const KEYS: Record<string, number> = { Escape: 27, Enter: 13, ArrowDown: 40, Tab: 9 };
export function key(name: keyof typeof KEYS, el: Element = document.activeElement ?? document.body) {
  const o = { key: name, code: name, keyCode: KEYS[name], which: KEYS[name], bubbles: true, cancelable: true, composed: true };
  el.dispatchEvent(new KeyboardEvent('keydown', o));
  el.dispatchEvent(new KeyboardEvent('keyup', o));
}
/** Set a text box's value the way typing does, so the page's own code sees the change. */
function typeInto(el: HTMLElement, value: string) {
  el.scrollIntoView({ block: 'center' });
  el.focus({ preventScroll: true });
  if (el.isContentEditable) {
    el.textContent = value;
  } else {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
const leave = (el: HTMLElement) => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); el.blur(); };

/** Options showing right now (outside the field, or inside it but not already chosen). */
function visibleOptions(f: Field): HTMLElement[] {
  const opts = [...document.querySelectorAll<HTMLElement>(OPTION)].filter((n) => shown(n) && !(f.box.contains(n) && n.getAttribute('aria-selected') === 'true'));
  return opts.filter((n) => !opts.some((m) => m !== n && m.contains(n)));
}
const optLabel = (n: HTMLElement) => (n.getAttribute('data-automation-label') || n.innerText || n.textContent || '').trim();

/** What the field shows now, read the same way the page was read. f follows the page's current elements. */
function shows(f: Field) {
  const now = readStep().fields.find((x) => x.key === f.key);
  if (now) { f.box = now.box; f.els = now.els; }
  return now?.value ?? '';
}

/** Type in. If a list of suggestions pops up while typing (an autocomplete), pick from it. */
async function typeIn(f: Field, d: Deps, force = false): Promise<Result> {
  const q = question(f, d);
  const a = await answer(q);
  if (a.kind !== 'text') return notDone(q, a);
  // Date boxes the browser draws (type=date / month) take only their own format.
  const type = (f.els[0] as HTMLInputElement).type;
  const when = /^(date|month)$/.test(type) ? parseDate(a.value) : null;
  const value = when?.year && when.month ? (type === 'month' ? `${when.year}-${when.month}` : `${when.year}-${when.month}-${when.day ?? '01'}`) : a.value;
  if (force || f.value !== value) {
    const before = new Set(visibleOptions(f));
    typeInto(f.els[0], value);
    await sleep(500);
    const fresh = visibleOptions(f).filter((o) => !before.has(o));
    if (fresh.length) {
      const p = await answer({ ...q, candidates: fresh.map(optLabel) });
      if (p.kind === 'pick') { press(fresh[p.indexes[0]]); await sleep(300); } else key('Escape', f.els[0]);
    }
    leave(f.els[0]);
  }
  if (!shows(f)) return notDone(q, unanswered(q, `typed "${value}" but the field is still empty`));
  return filled(`${a.because}: ${value.length > 60 ? `${value.length} chars` : value}`, value);
}

/** Native <select>: the options are right there. */
async function native(f: Field, d: Deps): Promise<Result> {
  const sel = f.els[0] as HTMLSelectElement;
  const opts = [...sel.options].filter((o) => o.text.trim() && !/^(select|choose)\b|^-+$/i.test(o.text.trim()));
  const q = question(f, d, { candidates: opts.map((o) => o.text.trim()) });
  const a = await answer(q);
  if (a.kind !== 'pick') return notDone(q, a);
  sel.focus();
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, opts[a.indexes[0]].value);
  sel.dispatchEvent(new Event('input', { bubbles: true }));
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  leave(sel);
  const chosen = opts[a.indexes[0]].text.trim();
  // A dropdown drawn over the select should now show the choice. If it doesn't follow the select, pick it there instead.
  if (f.face) {
    await sleep(300);
    if (!(f.face.innerText || '').toLowerCase().includes(chosen.toLowerCase())) return pick({ ...f, kind: 'pick', els: [f.face], editable: false, face: undefined }, d);
  }
  return filled(a.because, chosen);
}

/** Radios, checkbox lists, single checkboxes and button groups: the labels are the candidates. */
async function choose(f: Field, d: Deps): Promise<Result> {
  const candidates = f.options ?? [];
  const single = f.kind === 'radio' || f.kind === 'buttons';
  const q = question(f, d, { candidates, multiple: !single });
  const a = await answer(q);
  const picked = a.kind === 'pick' ? a.indexes : [];
  if (single && !picked.length) return notDone(q, a);
  for (let k = 0; k < candidates.length; k++) {
    const on = picked.includes(k);
    if (single && !on) continue;
    const el = f.els[k];
    const isOn = () => (el as HTMLInputElement).checked === true || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true';
    if (isOn() === on) continue;
    press(el);
    await sleep(100);
    // Some sites ignore clicks on the control itself and only react to its label.
    if (isOn() !== on) {
      const label = (el.id && document.querySelector<HTMLElement>(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
      if (label) { press(label); await sleep(100); }
    }
    if (isOn() !== on) return notDone(q, unanswered(q, `couldn't ${on ? 'select' : 'clear'} "${candidates[k]}" on the page`));
  }
  if (f.kind === 'checkbox') return filled(picked.length ? 'ticked' : `left unticked: ${a.because}`, picked.length ? 'checked' : '');
  return filled(a.because, picked.map((i) => candidates[i]).join(', '));
}

/**
 * Pick from a pop-up: open it and pick, one level at a time (a choice may open a sub-list). If the list is
 * empty, cut off, or has nothing that fits (suggestions only), search it with the answer, one term at a time.
 */
async function pick(f: Field, d: Deps): Promise<Result> {
  const el = f.els[0];
  const q = question(f, d);
  // Another field's list may still be on screen: close it, and only count options that appear after opening.
  key('Escape');
  await sleep(150);
  const stale = new Set(visibleOptions(f));
  const fresh = () => visibleOptions(f).filter((o) => !stale.has(o));
  press(el);
  if (el.tagName === 'INPUT') key('ArrowDown', el);
  // Lists often load their options a moment after opening: give them up to 3 seconds to appear.
  let options = fresh();
  for (let i = 0; i < 6 && !options.length; i++) { await sleep(500); options = fresh(); }
  const chosen: string[] = [];
  const pickFrom = async (list: HTMLElement[]) => {
    const labels = list.map(optLabel);
    const a = await answer({ ...q, prompt: chosen.length ? `${prompt(f)} > ${chosen.join(' > ')}` : prompt(f), candidates: labels });
    if (a.kind !== 'pick') return a;
    press(list[a.indexes[0]]);
    chosen.push(labels[a.indexes[0]]);
    await sleep(600);
    return a;
  };

  let browse = options.length > 0 && options.length < LONG_LIST;
  for (let level = 0; browse && level < 3 && options.length; level++) {
    const a = await pickFrom(options);
    if (a.kind !== 'pick') {
      if (level > 0) { key('Escape'); return notDone(q, a); }
      browse = false; // nothing in the first list fits: search for the answer instead
      break;
    }
    if (shows(f)) break;
    const before = options.map(optLabel).join('|');
    options = fresh(); // a sub-list, or nothing once the pick is made
    // The same list again means the pick didn't take: stop rather than repeat it.
    if (options.map(optLabel).join('|') === before) { key('Escape'); return notDone(q, unanswered(q, `picking "${chosen[chosen.length - 1]}" didn't take: the list stayed the same`)); }
  }

  if (!browse) {
    key('Escape');
    const a = await answer(q);
    if (a.kind !== 'text') return notDone(q, a);
    // Something to type into: the control itself, or a text box inside the field.
    const box = () => (f.editable ? f.els[0] : f.box.querySelector<HTMLElement>('input:not([type=hidden]):not([type=checkbox]):not([type=radio])'));
    const terms = a.value.split(/\s*[,;\n]\s*/).filter(Boolean).slice(0, 10);
    for (const term of terms) {
      if (!f.editable) { press(f.els[0]); await sleep(300); }
      const target = box();
      if (!target) break;
      typeInto(target, term);
      await sleep(700);
      if (!fresh().length) { key('Enter', target); await sleep(1000); }
      const list = fresh();
      if (!list.length) continue;
      const r = await pickFrom(list);
      // A single-choice list is done after one pick; a multi-pick list (skills) keeps a box to type the next term.
      if (r.kind === 'pick' && !(box() && shown(box()))) break;
      if (r.kind === 'pick' && terms.length === 1) break;
    }
  }
  key('Escape');
  await sleep(150);
  const now = shows(f);
  if (!now) return notDone(q, unanswered(q, chosen.length ? `picked "${chosen.join(' > ')}" but the field doesn't show it` : 'nothing in the list matched'));
  return filled(`chose "${chosen.join(' > ')}"`, now);
}

/** Read a date out of a fact's text: 2028-05-15, 2028-05, 05/2028, 05/15/2028, May 2028, 2028, or "present" (= today). */
export function parseDate(s: string, today = new Date()): { month?: string; day?: string; year?: string } | null {
  const t = s.trim();
  if (/^(present|current|now|today)$/i.test(t)) return { year: String(today.getFullYear()), month: String(today.getMonth() + 1).padStart(2, '0'), day: String(today.getDate()).padStart(2, '0') };
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
async function date(f: Field, d: Deps): Promise<Result> {
  const q = question(f, d);
  const a = await answer(q);
  if (a.kind !== 'text') return notDone(q, a);
  const when = parseDate(a.value);
  if (!when) return notDone(q, unanswered(q, `"${a.value}" isn't a date`));
  for (const [k, part] of (f.dateParts ?? []).entries()) {
    const v = when[part] ?? (part === 'day' ? '01' : undefined);
    if (!v) return notDone(q, unanswered(q, `"${a.value}" has no ${part}`));
    typeInto(f.els[k], v);
    leave(f.els[k]);
  }
  if (!shows(f)) return notDone(q, unanswered(q, `typed "${a.value}" but the date is still empty`));
  return filled(`${a.because}: ${a.value}`, a.value);
}

/** Uploads: the applicant's files are the candidates. The cover letter is written on demand. */
async function upload(f: Field, d: Deps, force = false): Promise<Result> {
  // A file is already there (an earlier fill, or the site's own autofill): never upload a second copy.
  if (!force && f.value) return { status: 'skipped', detail: `already attached: ${f.value}` };
  const q = question(f, d, { attach: true });
  const a = await ask<Answer & { slot?: 'resume' | 'transcript' | 'cover_letter' }>({ t: 'answer', q });
  if (a.kind !== 'pick' || !a.slot) return notDone(q, a);
  const file = await ask<FileReply | null>({ t: 'file', key: a.slot });
  if (!file) return notDone(q, unanswered(q, `no ${a.slot.replace('_', ' ')} file is available`));
  const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], file.name, { type: file.type }));
  const el = f.els[0] as HTMLInputElement;
  el.files = dt.files;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(1500); // the site uploads and may parse the file
  return filled(`uploaded ${a.slot.replace('_', ' ')}`, a.slot);
}

export const WIDGETS: Record<WidgetKind, ((f: Field, d: Deps, force?: boolean) => Promise<Result>) | null> = {
  text: typeIn, textarea: typeIn, native, pick, checkbox: choose, checkgroup: choose, radio: choose, buttons: choose, date, file: upload,
  unknown: null,
};
