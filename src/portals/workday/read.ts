// Reads one application step into questions, by page structure and standard accessibility markup:
// a question is a label (or legend) plus the control(s) it belongs to; a control's kind comes from its
// standard type, role and ARIA state. Workday's own names (data-automation-id) are only a fallback.
// Nothing here decides an answer.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';

/** The six interaction patterns, plus native selects and anything unrecognised. */
export type WidgetKind = 'text' | 'textarea' | 'native' | 'pick' | 'checkbox' | 'checkgroup' | 'radio' | 'date' | 'file' | 'unknown';

export interface WdField {
  id: number; // container is marked [data-jdw="id"], its controls [data-jdw-c="id:k"], for this read
  key: string; // stable identity on this step: container name + entry + label
  kind: WidgetKind;
  label: string;
  entry?: string; // numbered entry of a repeating section, e.g. "Work Experience 2"
  required: boolean;
  value: string; // what the field shows now ('' = empty)
  options?: string[]; // radio / checkbox labels, native select options
  dateParts?: ('month' | 'day' | 'year')[];
  editable?: boolean; // a pick control you can type into (search lists)
  error?: string; // the page's message for this field
  outline: string; // structure for snapshots: tags, roles, automation ids (never values)
}
export interface WdButton { id: number; text: string; autoId: string; footer: boolean }
export interface WdSection { id: number; heading: string; entries: number }
export interface WdStep {
  name: string;
  progress?: { at: number; of: number };
  signIn: boolean;
  fields: WdField[];
  buttons: WdButton[];
  sections: WdSection[];
  errors: string[];
}

const READ_JS = String.raw`(() => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const noStar = (s) => clean(s).replace(/\*/g, '').trim();
  const shown = (el) => { if (!el || !el.getBoundingClientRect) return false; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const aid = (el) => (el && el.getAttribute && el.getAttribute('data-automation-id')) || '';
  const textOf = (el) => clean(el && (el.innerText || el.textContent));
  const byIds = (ids) => (ids || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)).filter(Boolean);
  const MARKS = ['data-jdw', 'data-jdw-c', 'data-jdw-b', 'data-jdw-add', 'data-jdw-part'];
  document.querySelectorAll(MARKS.map((m) => '[' + m + ']').join(',')).forEach((e) => MARKS.forEach((m) => e.removeAttribute(m)));

  // Structure only, for learning what a widget looks like: never text or values.
  const outline = (el, depth = 0) => {
    if (depth > 4) return '';
    const kids = [...el.children].filter((c) => c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE');
    const me = el.tagName.toLowerCase() + (aid(el) ? '[' + aid(el) + ']' : '') + (el.getAttribute('role') ? '{' + el.getAttribute('role') + '}' : '')
      + (el.type && el.tagName === 'INPUT' ? ':' + el.type : '') + (el.getAttribute('aria-haspopup') ? '(popup)' : '');
    const inner = kids.slice(0, 8).map((c) => outline(c, depth + 1)).filter(Boolean).join(' ');
    return inner ? me + ' > (' + inner + ')' : me;
  };

  // ── Controls ───────────────────────────────────────────────────────────────
  const CHROME = 'header, nav, [role=banner], [role=navigation], [role=search]';
  const SEL = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=password]), textarea, select, '
    + 'button[aria-haspopup], [role=combobox], [role=checkbox], [role=radio], [role=spinbutton], [contenteditable=true]';
  const roleOf = (el) => el.getAttribute('role') || (el.tagName === 'INPUT' ? (el.type || 'text') : el.tagName.toLowerCase());
  const isSpin = (el) => roleOf(el) === 'spinbutton' || el.hasAttribute('aria-valuemax') || /dateSection/i.test(aid(el));
  const ownLabels = (el) => [...(el.id ? document.querySelectorAll('label[for="' + CSS.escape(el.id) + '"]') : []), el.closest('label'), ...byIds(el.getAttribute('aria-labelledby'))].filter(Boolean);
  const firstText = (els) => els.map((l) => noStar(l.innerText || l.textContent)).find(Boolean) || '';
  // Hidden checkboxes, radios and date boxes are fine when something visible stands for them (a label, the field).
  const usable = (el) => shown(el) || el.type === 'file'
    || ((roleOf(el) === 'checkbox' || roleOf(el) === 'radio') && ownLabels(el).some(shown))
    || (isSpin(el) && shown(el.parentElement));
  const trap = (el) => /for robots only|if you.?re (a )?human|leave this (field|input|box) (blank|empty)|honeypot/i.test(firstText(ownLabels(el)) + ' ' + (el.getAttribute('aria-label') || ''));
  // An input inside a combobox wrapper is part of that one control.
  const innerOfCombo = (el) => { const c = el.parentElement && el.parentElement.closest('[role=combobox]'); return !!c && c !== el; };
  const ctrls = [...document.querySelectorAll(SEL)].filter((el) => !el.disabled && !el.closest(CHROME) && el.getAttribute('aria-haspopup') !== 'menu'
    && !innerOfCombo(el) && usable(el) && !trap(el));

  // ── Questions: radios / checkbox lists / date boxes grouped, everything else on its own ──
  const groups = [], groupOf = new Map();
  const addGroup = (els, kind) => { const g = { els, kind }; groups.push(g); els.forEach((e) => groupOf.set(e, g)); };
  for (const el of ctrls) {
    if (groupOf.has(el)) continue;
    const t = roleOf(el);
    if (t === 'radio' || t === 'checkbox') {
      const holder = el.closest('[role=radiogroup], [role=group], fieldset');
      let same = el.name ? ctrls.filter((x) => roleOf(x) === t && x.name === el.name && !groupOf.has(x)) : [];
      if (same.length < 2 && holder) same = ctrls.filter((x) => roleOf(x) === t && holder.contains(x) && !groupOf.has(x));
      if (same.length < 2) same = [el];
      addGroup(same, t === 'radio' ? 'radio' : same.length > 1 ? 'checkgroup' : 'checkbox');
    } else if (isSpin(el)) {
      // The date boxes of one question share the nearest ancestor that has a label.
      let box = el.parentElement;
      while (box && box !== document.body && !box.querySelector('label, legend')) box = box.parentElement;
      addGroup(ctrls.filter((x) => isSpin(x) && !groupOf.has(x) && box && box.contains(x)), 'date');
    } else addGroup([el], null);
  }
  const others = (g, el) => ctrls.some((c) => !g.els.includes(c) && el.contains(c));
  const LABELISH = 'label, legend, [role=heading], h1, h2, h3, h4, h5, h6, [data-automation-id*="label" i]';
  const optionLabelSet = (g) => new Set(g.els.flatMap(ownLabels));
  // The question's container: the smallest box around its controls that has a label and no other question's controls.
  for (const g of groups) {
    let box = g.els[0];
    while (box && !g.els.every((e) => box.contains(e))) box = box.parentElement;
    const known = g.els[0].closest('[data-automation-id^="formField-"]');
    if (known && g.els.every((e) => known.contains(e)) && !others(g, known)) box = known;
    else for (let k = 0; k < 6 && box.parentElement && box.parentElement !== document.body; k++) {
      const own = optionLabelSet(g);
      const labelled = box !== g.els[0] && [...box.querySelectorAll(LABELISH)].some((l) => !own.has(l) && noStar(l.innerText));
      if (labelled || (box !== g.els[0] && g.kind === 'checkbox' && ownLabels(g.els[0]).some((l) => box.contains(l)))) break;
      if (others(g, box.parentElement)) break;
      box = box.parentElement;
    }
    g.box = box;
  }

  // ── Repeating sections: an "Add" button; entries are its numbered headings ──
  const HEADS = 'h2, h3, h4, h5, h6, [role=heading], legend';
  const addButtons = [...document.querySelectorAll('button, [role=button]')].filter((b) => shown(b) && !b.closest(CHROME) && /^add\b/i.test(clean(b.innerText) || b.getAttribute('aria-label') || ''));
  const sections = addButtons.map((b, i) => {
    b.setAttribute('data-jdw-add', String(i));
    let box = b.parentElement;
    while (box && box !== document.body) {
      const head = [...box.querySelectorAll(HEADS)].find((h) => (h.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) && textOf(h));
      const up = box.parentElement;
      if (head || !up || addButtons.some((x) => x !== b && up.contains(x))) break;
      box = up;
    }
    const heads = [...box.querySelectorAll(HEADS)].filter((h) => textOf(h));
    const numbered = heads.filter((h) => /\s\d+$/.test(textOf(h)));
    const title = heads.find((h) => !/\s\d+$/.test(textOf(h)));
    return { id: i, heading: textOf(title) || (numbered[0] ? textOf(numbered[0]).replace(/\s\d+$/, '') : 'Section ' + (i + 1)), entries: numbered.length, box, numbered };
  });
  const entryOf = (el) => {
    const sec = sections.find((s) => s.box.contains(el));
    if (!sec) return '';
    const before = sec.numbered.filter((h) => h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    return textOf(before[before.length - 1]);
  };

  // ── Each question: label, kind, value, error ──
  const PLACEHOLDER = /^(select|choose|pick)\b|^please (select|choose)\b|^search$|^--+|^\d+ items? selected$/i;
  const kindOf = (el) => {
    if (el.type === 'file') return 'file';
    if (el.tagName === 'SELECT') return 'native';
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) return 'textarea';
    const pop = el.getAttribute('aria-haspopup');
    if (el.tagName === 'BUTTON' || roleOf(el) === 'button') return pop && pop !== 'false' ? 'pick' : 'unknown';
    if (roleOf(el) === 'combobox' || (pop && pop !== 'false') || el.hasAttribute('aria-autocomplete') || el.hasAttribute('aria-expanded')) return 'pick';
    if (/searchBox/i.test(aid(el)) || el.closest('[data-automation-id*="multiselectInputContainer" i]') || /^search\b/i.test(el.placeholder || '')) return 'pick';
    return 'text';
  };
  const partOf = (el, k, n) => {
    const max = Number(el.getAttribute('aria-valuemax'));
    if (max === 12) return 'month'; if (max === 31) return 'day'; if (max >= 1000) return 'year';
    const hint = [aid(el), el.getAttribute('aria-label'), el.placeholder, el.name, el.id].join(' ');
    if (/month|\bmm\b/i.test(hint)) return 'month'; if (/day|\bdd\b/i.test(hint)) return 'day'; if (/year|\byy/i.test(hint)) return 'year';
    return n === 2 ? ['month', 'year'][k] : n === 3 ? ['month', 'day', 'year'][k] : 'year';
  };
  const checked = (el) => el.checked || el.getAttribute('aria-checked') === 'true';
  const optText = (el) => firstText(ownLabels(el)) || clean(el.getAttribute('aria-label') || el.value || textOf(el));
  const pickValue = (el, box) => {
    if (el.tagName === 'BUTTON' || roleOf(el) === 'button') { const t = textOf(el); return PLACEHOLDER.test(t) || t === el.getAttribute('aria-placeholder') ? '' : t; }
    const chips = [...box.querySelectorAll('[aria-selected=true], [data-automation-id*="selectedItem" i], [class*="single-value" i], [class*="singleValue" i]')]
      .filter((c) => c !== el && !c.contains(el)).map(textOf).filter((t) => t && !PLACEHOLDER.test(t));
    return [...new Set(chips)].join(', ');
  };

  const fields = groups.map((g, id) => {
    const box = g.box, el = g.els[0];
    box.setAttribute('data-jdw', String(id));
    g.els.forEach((c, k) => c.setAttribute('data-jdw-c', id + ':' + k));
    const kind = g.kind || kindOf(el);
    const own = optionLabelSet(g);
    const boxLabels = [...box.querySelectorAll(LABELISH)].filter((l) => !own.has(l));
    const fs = el.closest('fieldset');
    const legend = fs && box.contains(fs) ? fs.querySelector('legend') : null;
    const groupBy = el.closest('[role=radiogroup], [role=group]');
    const groupLabels = groupBy ? byIds(groupBy.getAttribute('aria-labelledby')) : [];
    let label = '';
    if (kind === 'radio' || kind === 'checkgroup') label = firstText([legend, ...groupLabels, ...boxLabels].filter(Boolean));
    else if (kind === 'checkbox') label = firstText(boxLabels) || optText(el);
    else label = firstText(ownLabels(el)) || firstText(boxLabels) || noStar(el.getAttribute('aria-label') || '');
    if (!label && kind === 'file') label = firstText([...(box.closest('section, [role=region]') || box).querySelectorAll(HEADS)]) || 'File upload';
    if (!label) label = noStar((el.placeholder && !/^search\b/i.test(el.placeholder) ? el.placeholder : '') || aid(box).replace(/^formField-/, '').replace(/[_-]+/g, ' '));
    const required = g.els.some((c) => c.required || c.getAttribute('aria-required') === 'true') || (groupBy && groupBy.getAttribute('aria-required') === 'true')
      || [...boxLabels, ...ownLabels(el), ...groupLabels].some((l) => /\*/.test(l.innerText || '')) || !!box.querySelector('abbr[title*="required" i]');
    let value = '', options, dateParts;
    if (kind === 'radio' || kind === 'checkgroup' || kind === 'checkbox') {
      options = g.els.map(optText);
      value = kind === 'checkbox' ? (checked(el) ? 'checked' : '') : g.els.filter(checked).map(optText).join(', ');
    } else if (kind === 'date') {
      dateParts = g.els.map((c, k) => partOf(c, k, g.els.length));
      g.els.forEach((c, k) => c.setAttribute('data-jdw-part', dateParts[k]));
      const vals = g.els.map((c) => clean(c.value || c.getAttribute('aria-valuenow') || ''));
      value = vals.every(Boolean) ? vals.join('/') : '';
    } else if (kind === 'native') {
      options = [...el.options].map((o) => clean(o.text)).filter(Boolean);
      value = el.value ? clean(el.options[el.selectedIndex].text) : '';
    } else if (kind === 'pick') value = pickValue(el, box);
    else if (kind === 'file') value = (el.files && el.files.length ? el.files[0].name : '') || ((textOf(box).match(/[^\s/\\]+\.(pdf|docx?|txt|rtf)\b/i) || [])[0] || '');
    else value = clean(el.isContentEditable ? el.innerText : el.value);
    // The page's message for this field: linked by aria (aria-invalid + aria-describedby), or shown inside it.
    const linked = g.els.filter((c) => c.getAttribute('aria-invalid') === 'true').flatMap((c) => byIds((c.getAttribute('aria-errormessage') || '') + ' ' + (c.getAttribute('aria-describedby') || ''))).filter(shown).map(textOf).filter(Boolean);
    const inside = [...box.querySelectorAll('[role=alert], [id*="error" i], [class*="error" i], [data-automation-id*="error" i]')].filter(shown).map(textOf).filter(Boolean);
    const entry = entryOf(box);
    return {
      id, key: (aid(box) || el.name || el.id || '') + '|' + entry + '|' + label, kind, label, entry: entry || undefined, required, value, options, dateParts,
      editable: kind === 'pick' && el.tagName === 'INPUT', error: linked[0] || inside[0] || undefined, outline: outline(box),
    };
  });

  // ── Buttons, progress, errors, sign-in ──
  const buttons = [...document.querySelectorAll('button, [role=button], a[role=button], a[data-automation-id], input[type=submit], input[type=button]')]
    .filter((b) => shown(b) && !b.closest(CHROME) && !b.hasAttribute('data-jdw-c') && clean(b.innerText || b.getAttribute('aria-label') || b.value || ''))
    .map((b, id) => { b.setAttribute('data-jdw-b', String(id)); return { id, text: clean(b.innerText || b.getAttribute('aria-label') || b.value), autoId: aid(b), footer: !!b.closest('footer, [role=contentinfo], [data-automation-id*="footer" i]') }; });
  const current = document.querySelector('[aria-current="step"]') || document.querySelector('[data-automation-id="progressBarActiveStep"]');
  const pos = (textOf(current) || '').match(/step\s+(\d+)\s+of\s+(\d+)/i);
  let progress = pos ? { at: +pos[1], of: +pos[2] } : undefined;
  if (!progress && current && current.parentElement) { const sib = [...current.parentElement.children]; progress = { at: sib.indexOf(current) + 1, of: sib.length }; }
  const heading = [...document.querySelectorAll('main h2, h2, main h1, h1')].find(shown);
  const name = clean((textOf(current) || textOf(heading)).replace(/^(completed |current )?step\s+\d+\s+of\s+\d+\s*/i, ''));
  const alerts = [...document.querySelectorAll('[data-automation-id*="errorBanner" i], [role=alert]')].filter(shown).map(textOf)
    .filter((t) => t && /error|required|invalid|must|please (enter|select|fix)/i.test(t));
  const pw = [...document.querySelectorAll('input[type=password]')].find((p) => { const r = p.getBoundingClientRect(); return r.width > 30 && r.height > 8 && shown(p); });
  return { name: name.slice(0, 80), progress, signIn: !!pw, fields, buttons, sections: sections.map(({ box, numbered, ...s }) => s), errors: [...new Set(alerts)].slice(0, 5) };
})()`;

export async function readStep(page: Page): Promise<WdStep> {
  // Workday often moves to the next page right after a click: if the page changes mid-read, wait and read again.
  for (let attempt = 0; ; attempt++) {
    try {
      return (await page.evaluate(READ_JS)) as WdStep;
    } catch (err) {
      if (attempt >= 4 || !/context was destroyed|navigat|Target closed/i.test((err as Error).message) || page.isClosed()) throw err;
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }
  }
}

// Page text can carry account details (the account menu shows your email): mask them in snapshots.
const scrub = (s: string) => s.replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, '[email]').replace(/\+?\d[\d\s().-]{7,}\d/g, '[number]');

/** Save what this step looks like, without any values, so widgets that didn't work can be studied later. */
export function saveSnapshot(traceDir: string, n: number, step: WdStep) {
  const safe = {
    step: scrub(step.name),
    progress: step.progress,
    errors: step.errors.map(scrub),
    sections: step.sections,
    buttons: step.buttons.map((b) => ({ text: scrub(b.text), autoId: b.autoId, footer: b.footer })),
    fields: step.fields.map((f) => ({
      kind: f.kind, label: scrub(f.label), entry: f.entry, required: f.required, filled: !!f.value,
      options: f.options?.slice(0, 30).map(scrub), dateParts: f.dateParts, editable: f.editable, error: f.error && scrub(f.error), outline: f.outline,
    })),
  };
  fs.writeFileSync(path.join(traceDir, `workday-step-${String(n).padStart(2, '0')}.json`), JSON.stringify(safe, null, 2));
}
