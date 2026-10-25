// Reads the page into questions, by page structure and standard accessibility markup: a question is a label
// (or legend) plus the control(s) it belongs to; a control's kind comes from its standard type, role and ARIA
// state. Portal-specific names (Workday's data-automation-id) are only a fallback. Nothing here decides an answer.
import { portalName } from '../shared/portal.js';

/** The interaction patterns, plus native selects and anything unrecognised. */
export type WidgetKind = 'text' | 'textarea' | 'native' | 'pick' | 'checkbox' | 'checkgroup' | 'radio' | 'buttons' | 'date' | 'file' | 'unknown';

export interface Field {
  key: string; // stable identity on this page: container name + entry + label
  kind: WidgetKind;
  label: string;
  entry?: string; // numbered entry of a repeating section, e.g. "Work Experience 2"
  required: boolean;
  value: string; // what the field shows now ('' = empty)
  options?: string[]; // radio / checkbox / button labels, native select options
  dateParts?: ('month' | 'day' | 'year')[];
  editable?: boolean; // a pick control you can type into (search lists)
  error?: string; // the page's message for this field
  box: HTMLElement; // the question's container
  els: HTMLElement[]; // its controls (one per option for radios, checkbox lists, button groups, date parts)
  face?: HTMLElement; // the dropdown drawn over a hidden <select>, when there is one
  description?: string; // other text shown with the question (instructions, or the real question under a heading)
}
export interface Button { el: HTMLElement; text: string; autoId: string; footer: boolean }
export interface Section { add: HTMLElement; heading: string; entries: number }
export interface Step {
  name: string;
  progress?: { at: number; of: number };
  signIn: boolean;
  fields: Field[];
  buttons: Button[];
  sections: Section[];
  errors: string[];
}

const clean = (s?: string | null) => (s || '').replace(/\s+/g, ' ').trim();
// Required marks: *, and the other stars sites use (✱ ✳ ＊ ∗).
const STAR = /[*✱✳＊⁎∗]/g;
const noStar = (s?: string | null) => clean(s).replace(STAR, '').trim();
export const shown = (el: Element | null | undefined): boolean => {
  if (!el || !(el as HTMLElement).getBoundingClientRect) return false;
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
};
const aid = (el: Element | null) => el?.getAttribute?.('data-automation-id') || '';

// ── Reading inside web components ──────────────────────────────────────────
// Some forms are built from web components that keep their fields in their own hidden tree (shadow DOM), out of
// reach of ordinary page queries. When the normal read finds no questions, the page is read again "deep": through
// every component, open or closed (an extension may open closed ones). These helpers follow that switch.
let deep = false;
let roots: ShadowRoot[] = [];
const shadowOf = (el: Element): ShadowRoot | null => {
  try { return (chrome.dom?.openOrClosedShadowRoot?.(el as HTMLElement) as ShadowRoot | null | undefined) ?? el.shadowRoot; } catch { return el.shadowRoot; }
};
/** Every component tree on the page, nested ones included. */
function collectRoots(from: ParentNode = document, out: ShadowRoot[] = []) {
  for (const el of from.querySelectorAll('*')) { const r = shadowOf(el); if (r) { out.push(r); collectRoots(r, out); } }
  return out;
}
/** One step up the page, crossing into the component that holds it when reading deep. */
const up = (el: Element): HTMLElement | null =>
  (deep ? ((el.assignedSlot as HTMLElement | null) ?? el.parentElement ?? ((el.getRootNode() as ShadowRoot).host as HTMLElement | undefined) ?? null) : el.parentElement);
/** a contains b (through components when reading deep). */
const within = (a: Element, b: Element) => {
  if (!deep) return a.contains(b);
  for (let n: Element | null = b; n; n = up(n)) if (n === a) return true;
  return false;
};
const closest = <T extends Element = HTMLElement>(el: Element, sel: string): T | null => {
  if (!deep) return el.closest<T>(sel as never) as T | null;
  for (let n: Element | null = el; n; n = up(n)) if (n.matches(sel)) return n as T;
  return null;
};
const all = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => {
  const out = [...root.querySelectorAll<T>(sel)] as T[];
  if (deep) for (const r of roots) if (root === document || (root instanceof Element && within(root, r.host))) out.push(...(r.querySelectorAll<T>(sel) as unknown as T[]));
  return out;
};
const first = (sel: string, root: ParentNode = document) => all(sel, root)[0] ?? null;
/** The text a person sees, including text drawn inside components and placed into their slots. */
function flatText(n: Node, skipControls = false): string {
  if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? '';
  if (!(n instanceof Element) || /^(SCRIPT|STYLE|TEMPLATE)$/.test(n.tagName)) return '';
  if (skipControls && n.matches('select, textarea, input, [role=listbox]')) return '';
  if (n instanceof HTMLSlotElement) { const got = n.assignedNodes({ flatten: true }); return (got.length ? got : [...n.childNodes]).map((c) => flatText(c, skipControls)).join(' '); }
  const r = shadowOf(n);
  return [...(r ?? n).childNodes].map((c) => flatText(c, skipControls)).join(' ');
}
const inner = (el: Element | null | undefined) => (!el ? '' : deep ? flatText(el) : (el as HTMLElement).innerText || el.textContent || '');
const textOf = (el: Element | null | undefined) => clean(inner(el));
/** Elements by id, looked up in the tree the referring element lives in. */
const byIds = (ids: string | null, from?: Element) => (ids || '').split(/\s+/).filter(Boolean)
  .map((id) => ((from?.getRootNode() as Document | ShadowRoot | undefined)?.getElementById?.(id) ?? document.getElementById(id)))
  .filter((e): e is HTMLElement => !!e);

/** The same, always through components: for pop-up lists and clicks, which may be drawn inside one. */
export function everywhere<T extends Element = HTMLElement>(sel: string) {
  return [document, ...collectRoots()].flatMap((r) => [...r.querySelectorAll<T>(sel)] as T[]);
}
/** a contains b, through components. */
export function inside(a: Element, b: Element) {
  for (let n: Element | null = b; n; n = (n.assignedSlot as Element | null) ?? n.parentElement ?? ((n.getRootNode() as ShadowRoot).host ?? null)) if (n === a) return true;
  return false;
}

// The site's own header and search (job search, filters) are not the application.
const CHROME = 'header, nav, [role=banner], [role=navigation], [role=search]';
const SEL = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=password]), textarea, select, '
  + 'button[aria-haspopup], [role=combobox], [role=checkbox], [role=radio], [role=spinbutton], [contenteditable=true]';
const input = (el: Element) => el as HTMLInputElement;
const roleOf = (el: Element) => el.getAttribute('role') || (el.tagName === 'INPUT' ? (input(el).type || 'text') : el.tagName.toLowerCase());
const isSpin = (el: Element) => roleOf(el) === 'spinbutton' || el.hasAttribute('aria-valuemax') || /dateSection/i.test(aid(el));
const ownLabels = (el: Element) => [
  ...(el.id ? [...(el.getRootNode() as ParentNode).querySelectorAll<HTMLElement>(`label[for="${CSS.escape(el.id)}"]`)] : []), closest(el, 'label'), ...byIds(el.getAttribute('aria-labelledby'), el),
].filter((l): l is HTMLElement => !!l);
/** An element's text without the controls inside it (a label wrapping its <select> would otherwise read out every option). */
const ownText = (el: Element) => {
  if (deep) return flatText(el, true);
  if (!el.querySelector('select, textarea, input, [role=listbox]')) return (el as HTMLElement).innerText || el.textContent || '';
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('select, textarea, input, [role=listbox], script, style').forEach((n) => n.remove());
  return copy.textContent || '';
};
const firstText = (els: (Element | null | undefined)[]) => els.map((l) => noStar(l && ownText(l))).find(Boolean) || '';
const isTrap = (el: Element) => /for robots only|if you.?re (a )?human|leave this (field|input|box) (blank|empty)|honeypot/i.test(`${firstText(ownLabels(el))} ${el.getAttribute('aria-label') || ''}`);
// A site search: a search region, or a small GET form with a search box. (Application forms may use GET too.)
const inSearchForm = (el: Element) => {
  if (closest(el, '[role=search]')) return true;
  const f = closest(el, 'form');
  if (!f || (f.getAttribute('method') || '').toLowerCase() !== 'get') return false;
  const fields = all<HTMLInputElement>('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea', f);
  return fields.length <= 5 && fields.some((i) => i.type === 'search' || /^(q|query|search|keywords?)$/i.test(i.name || '') || /^search\b/i.test(i.placeholder || ''));
};
const SEARCH_LABEL = /\bfilter (jobs|roles|positions|openings|results)\b|\bsearch (jobs|roles|positions|openings)\b|search job title/i;

function readOnce(): Step {
  // Hidden checkboxes, radios and date boxes are fine when something visible stands for them (a label, the field).
  const usable = (el: HTMLElement) => shown(el) || input(el).type === 'file'
    || ((roleOf(el) === 'checkbox' || roleOf(el) === 'radio') && ownLabels(el).some(shown))
    || (isSpin(el) && shown(up(el)));
  // An input inside a combobox wrapper is part of that one control.
  const innerOfCombo = (el: Element) => { const p = up(el); const c = p && closest(p, '[role=combobox]'); return !!c && c !== el; };
  // Text boxes that only back a custom dropdown (hidden from assistive tech, out of the tab order) aren't questions.
  const helper = (el: HTMLElement) => el.tagName === 'INPUT' && !['file', 'radio', 'checkbox'].includes(input(el).type) && el.getAttribute('role') !== 'combobox'
    && (el.tabIndex === -1 || el.getAttribute('aria-hidden') === 'true') && !isSpin(el);
  // Button-style choice groups (e.g. Ashby's Yes / No buttons beside a hidden checkbox) are one question.
  const buttonGroups = new Map<HTMLElement, HTMLElement[]>();
  for (const cb of all<HTMLInputElement>('input[type=checkbox]')) {
    const btns = cb.parentElement ? [...cb.parentElement.querySelectorAll<HTMLElement>(':scope > button[aria-pressed], :scope > [role=button][aria-pressed]')] : [];
    if (btns.length >= 2 && btns.some(shown)) buttonGroups.set(cb, btns);
  }
  const inGroup = new Set([...buttonGroups.values()].flat());
  // A native <select> hidden behind a dropdown drawn over it (a standard combobox beside it): the select is the
  // question, it holds the real options and the current choice; the drawn box is only its face.
  const faces = new Map<HTMLElement, HTMLElement>();
  // Hidden for real, or shrunk to a pixel and hidden from screen readers.
  const tucked = (e: HTMLElement) => { const r = e.getBoundingClientRect(); return !shown(e) || r.width <= 2 || r.height <= 2 || e.getAttribute('aria-hidden') === 'true'; };
  for (const sel of all('select')) {
    const p1 = up(sel);
    if (!tucked(sel) || !p1) continue;
    const near = [p1, up(p1)].filter((p): p is HTMLElement => !!p);
    const face = near.flatMap((p) => all('[role=combobox]', p)).find((f) => shown(f) && !within(f, sel));
    if (face) faces.set(sel, face);
  }
  const isFace = (el: HTMLElement) => [...faces.values()].some((f) => f === el || within(f, el));
  const ctrls = all(SEL).filter((el) => !(el as HTMLInputElement).disabled && !closest(el, CHROME) && el.getAttribute('aria-haspopup') !== 'menu'
    && !innerOfCombo(el) && (buttonGroups.has(el) || faces.has(el) || (usable(el) && !helper(el) && !isFace(el))) && !isTrap(el)
    && !inSearchForm(el) && !SEARCH_LABEL.test(`${firstText(ownLabels(el))} ${el.getAttribute('aria-label') || ''} ${input(el).placeholder || ''}`));

  // ── Questions: radios / checkbox lists / date boxes grouped, everything else on its own ──
  interface Group { els: HTMLElement[]; kind: WidgetKind | null; box?: HTMLElement; anchor: HTMLElement }
  const groups: Group[] = [], groupOf = new Map<HTMLElement, Group>();
  const addGroup = (els: HTMLElement[], kind: WidgetKind | null, anchor = els[0]) => { const g = { els, kind, anchor }; groups.push(g); els.forEach((e) => groupOf.set(e, g)); groupOf.set(anchor, g); };
  for (const el of ctrls) {
    if (groupOf.has(el)) continue;
    const t = roleOf(el);
    if (buttonGroups.has(el)) addGroup(buttonGroups.get(el)!, 'buttons', el);
    else if (t === 'radio' || t === 'checkbox') {
      const holder = closest(el, '[role=radiogroup], [role=group], fieldset');
      const name = input(el).name;
      let same = name ? ctrls.filter((x) => roleOf(x) === t && input(x).name === name && !groupOf.has(x)) : [];
      if (same.length < 2 && holder) same = ctrls.filter((x) => roleOf(x) === t && within(holder, x) && !groupOf.has(x));
      if (same.length < 2) same = [el];
      addGroup(same, t === 'radio' ? 'radio' : same.length > 1 ? 'checkgroup' : 'checkbox');
    } else if (isSpin(el)) {
      // The date boxes of one question share the nearest ancestor that has a label.
      let box = up(el);
      while (box && box !== document.body && !first('label, legend', box)) box = up(box);
      addGroup(ctrls.filter((x) => isSpin(x) && !groupOf.has(x) && !!box && within(box, x)), 'date');
    } else addGroup([el], null);
  }
  const others = (g: Group, el: Element) => ctrls.some((c) => !g.els.includes(c) && c !== g.anchor && within(el, c));
  const LABELISH = 'label, legend, [role=heading], h1, h2, h3, h4, h5, h6, [data-automation-id*="label" i]';
  const optionLabelSet = (g: Group) => new Set(g.kind === 'buttons' ? g.els : g.els.flatMap(ownLabels));
  // The question's container: the smallest box around its controls that has a label and no other question's controls.
  for (const g of groups) {
    const mine = [g.anchor, ...g.els];
    let box: HTMLElement = g.els[0];
    while (up(box) && !mine.every((e) => within(box, e))) box = up(box)!;
    const known = closest<HTMLElement>(g.els[0], '[data-automation-id^="formField-"], [data-field-path]');
    if (known && mine.every((e) => within(known, e)) && !others(g, known)) box = known;
    else for (let k = 0; k < 6 && up(box) && up(box) !== document.body; k++) {
      const own = optionLabelSet(g);
      const labelled = box !== g.els[0] && all(LABELISH, box).some((l) => !own.has(l) && noStar(inner(l)));
      if (labelled || (box !== g.els[0] && g.kind === 'checkbox' && ownLabels(g.els[0]).some((l) => within(box, l)))) break;
      if (others(g, up(box)!)) break;
      box = up(box)!;
    }
    g.box = box;
  }

  // ── Repeating sections: an "Add" button; entries are its numbered headings ──
  const HEADS = 'h2, h3, h4, h5, h6, [role=heading], legend';
  const addButtons = all('button, [role=button]').filter((b) => shown(b) && !closest(b, CHROME) && /^add\b/i.test(clean(inner(b)) || b.getAttribute('aria-label') || ''));
  const sections = addButtons.map((b, i) => {
    let box = up(b)!;
    while (box && box !== document.body) {
      const head = all(HEADS, box).find((h) => (h.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) && textOf(h));
      const parent = up(box);
      if (head || !parent || addButtons.some((x) => x !== b && within(parent, x))) break;
      box = parent;
    }
    const heads = all(HEADS, box).filter((h) => textOf(h));
    const numbered = heads.filter((h) => /\s\d+$/.test(textOf(h)));
    const title = heads.find((h) => !/\s\d+$/.test(textOf(h)));
    return { add: b, heading: textOf(title) || (numbered[0] ? textOf(numbered[0]).replace(/\s\d+$/, '') : `Section ${i + 1}`), entries: numbered.length, box, numbered };
  });
  const labelsOf = (el: Element) => all('label, legend', el).map((l) => noStar(inner(l))).filter(Boolean).join('|');
  // Rows of a repeating section with no numbered headings (e.g. one row per school): the same set of questions
  // repeated in sibling boxes. The row's place among the visible ones is its number.
  const rowOf = (el: Element) => {
    let a: Element = el;
    for (let k = 0; k < 8 && up(a) && up(a) !== document.body; k++, a = up(a)!) {
      const mine = labelsOf(a);
      if (!mine.includes('|')) continue; // a row asks several questions
      // Repeating = at least two such boxes, counting a hidden template row the site copies for "Add".
      const rows = [...up(a)!.children].filter((c) => c.tagName === a.tagName && labelsOf(c) === mine);
      if (rows.length < 2) continue;
      const head = all(HEADS).filter((h) => (h.compareDocumentPosition(up(a)!) & Node.DOCUMENT_POSITION_FOLLOWING) && textOf(h) && shown(h)).pop();
      return `${textOf(head) || 'Entry'} ${rows.filter(shown).indexOf(a) + 1}`;
    }
    return '';
  };
  const entryOf = (el: Element) => {
    const sec = sections.find((s) => within(s.box, el));
    if (!sec) return rowOf(el);
    const before = sec.numbered.filter((h) => h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    return textOf(before[before.length - 1]) || rowOf(el);
  };

  // ── Each question: label, kind, value, error ──
  const PLACEHOLDER = /^(select|choose|pick)\b|^please (select|choose)\b|^search$|^--+|^\d+ items? selected$/i;
  const kindOf = (el: HTMLElement): WidgetKind => {
    if (input(el).type === 'file') return 'file';
    if (el.tagName === 'SELECT') return 'native';
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) return 'textarea';
    const pop = el.getAttribute('aria-haspopup');
    if (el.tagName === 'BUTTON' || roleOf(el) === 'button') return pop && pop !== 'false' ? 'pick' : 'unknown';
    if (roleOf(el) === 'combobox' || (pop && pop !== 'false') || el.hasAttribute('aria-autocomplete') || el.hasAttribute('aria-expanded')) return 'pick';
    if (/searchBox/i.test(aid(el)) || closest(el, '[data-automation-id*="multiselectInputContainer" i]') || /^search\b/i.test(input(el).placeholder || '')) return 'pick';
    return 'text';
  };
  const partOf = (el: HTMLElement, k: number, n: number): 'month' | 'day' | 'year' => {
    const max = Number(el.getAttribute('aria-valuemax'));
    if (max === 12) return 'month'; if (max === 31) return 'day'; if (max >= 1000) return 'year';
    const hint = [aid(el), el.getAttribute('aria-label'), input(el).placeholder, input(el).name, el.id].join(' ');
    if (/month|\bmm\b/i.test(hint)) return 'month'; if (/day|\bdd\b/i.test(hint)) return 'day'; if (/year|\byy/i.test(hint)) return 'year';
    return n === 2 ? (['month', 'year'] as const)[k] : n === 3 ? (['month', 'day', 'year'] as const)[k] : 'year';
  };
  const checked = (el: HTMLElement) => input(el).checked || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true';
  const optText = (el: HTMLElement) => firstText(ownLabels(el)) || clean(el.getAttribute('aria-label') || (el.tagName === 'INPUT' ? input(el).value : '') || textOf(el));
  const pickValue = (el: HTMLElement, box: HTMLElement) => {
    if (el.tagName === 'BUTTON' || roleOf(el) === 'button') { const t = textOf(el); return PLACEHOLDER.test(t) || t === el.getAttribute('aria-placeholder') ? '' : t; }
    const chips = all('[aria-selected=true], [data-automation-id*="selectedItem" i], [data-automation-id="promptSelectionLabel"], [class*="single-value" i], [class*="singleValue" i]', box)
      .filter((c) => c !== el && !within(c, el)).map(textOf).filter((t) => t && !PLACEHOLDER.test(t));
    if (chips.length) return [...new Set(chips)].join(', ');
    // An editable combobox shows its choice in the box itself; a search box's text is only what was typed.
    const search = /searchBox/i.test(aid(el)) || /^search\b/i.test(input(el).placeholder || '') || !!closest(el, '[data-automation-id*="multiselectInputContainer" i]');
    return el.tagName === 'INPUT' && !search && el.getAttribute('aria-expanded') !== 'true' ? clean(input(el).value) : '';
  };
  const GENERIC_FILE = /^(attach|upload|choose file|browse|drop files? here|or)$/i;

  const fields: Field[] = groups.map((g) => {
    const box = g.box!, el = g.kind === 'buttons' ? g.anchor : g.els[0];
    const kind = g.kind || kindOf(el);
    const own = optionLabelSet(g);
    const boxLabels = all(LABELISH, box).filter((l) => !own.has(l));
    const fs = closest(el, 'fieldset');
    const legend = fs && within(box, fs) ? fs.querySelector('legend') : null;
    const groupBy = closest(el, '[role=radiogroup], [role=group]');
    const groupLabels = groupBy ? byIds(groupBy.getAttribute('aria-labelledby'), groupBy) : [];
    let label = '';
    if (kind === 'radio' || kind === 'checkgroup' || kind === 'buttons') label = firstText([legend, ...groupLabels, ...boxLabels]);
    else if (kind === 'checkbox') label = firstText(boxLabels) || optText(el);
    else label = firstText(ownLabels(el)) || firstText(boxLabels) || noStar(el.getAttribute('aria-label') || '');
    // Upload widgets are often labelled just "Attach": use the group's heading (e.g. "Resume/CV") instead.
    if (kind === 'file' && (!label || GENERIC_FILE.test(label))) {
      let p: HTMLElement | null = box;
      label = '';
      for (let i = 0; i < 6 && p && !label; i++, p = up(p)) label = firstText(all(`${LABELISH}, [class*="label" i]`, p).filter((h) => !within(h, el) && !GENERIC_FILE.test(noStar(inner(h))) && noStar(inner(h)).length < 80));
      label ||= noStar((input(el).name || el.id || 'File upload').replace(/[_-]+/g, ' '));
    }
    // e.g. Lever: <div class="application-label"><div class="text">Question</div></div>
    if (!label) label = firstText(all('[class*="label" i]', box).filter((l) => !g.els.some((c) => within(l, c))));
    if (!label) label = noStar((input(el).placeholder && !/^search\b/i.test(input(el).placeholder) ? input(el).placeholder : '') || aid(box).replace(/^formField-/, '').replace(/[_-]+/g, ' ') || input(el).name?.replace(/[_-]+/g, ' '));
    const required = [g.anchor, ...g.els].some((c) => input(c).required || c.getAttribute('aria-required') === 'true') || groupBy?.getAttribute('aria-required') === 'true'
      || [...boxLabels, ...ownLabels(el), ...groupLabels, ...all('[class*="label" i]', box)].some((l) => /[*✱✳＊⁎∗]/.test(ownText(l))) || !!first('abbr[title*="required" i]', box);
    let value = '', options: string[] | undefined, dateParts: Field['dateParts'];
    if (kind === 'radio' || kind === 'checkgroup' || kind === 'checkbox' || kind === 'buttons') {
      options = g.els.map((c) => (kind === 'buttons' ? textOf(c) : optText(c)));
      value = kind === 'checkbox' ? (checked(el) ? 'checked' : '') : g.els.filter(checked).map((c, i) => (kind === 'buttons' ? textOf(c) : optText(c)) || String(i)).join(', ');
    } else if (kind === 'date') {
      dateParts = g.els.map((c, k) => partOf(c, k, g.els.length));
      const vals = g.els.map((c) => clean(input(c).value || c.getAttribute('aria-valuenow') || ''));
      value = vals.every(Boolean) ? vals.join('/') : '';
    } else if (kind === 'native') {
      const s = el as HTMLSelectElement;
      options = [...s.options].map((o) => clean(o.text)).filter(Boolean);
      value = s.value && s.selectedIndex >= 0 ? clean(s.options[s.selectedIndex].text) : '';
      if (/^(select|choose)\b|^-+$/i.test(value)) value = '';
    } else if (kind === 'pick') value = pickValue(el, box);
    else if (kind === 'file') value = input(el).files?.[0]?.name || (textOf(box).match(/[^\s/\\]+\.(pdf|docx?|txt|rtf)\b/i) || [])[0] || '';
    else value = clean(el.isContentEditable ? inner(el) : input(el).value);
    // Some sites put the current choice inside the label (for screen readers): it isn't part of the question.
    if (value && label.length > value.length && label.endsWith(value)) label = label.slice(0, -value.length).trim();
    // The page's message for this field: linked by aria (aria-invalid + aria-describedby), or shown inside it.
    const linked = g.els.filter((c) => c.getAttribute('aria-invalid') === 'true').flatMap((c) => byIds(`${c.getAttribute('aria-errormessage') || ''} ${c.getAttribute('aria-describedby') || ''}`, c)).filter(shown).map(textOf).filter(Boolean);
    const inside = all('[role=alert], [id*="error" i], [class*="error" i], [data-automation-id*="error" i]', box).filter(shown).map(textOf).filter(Boolean);
    const entry = entryOf(box);
    // Everything else the form says about the question, so the AI never sees a bare heading: the rest of its box
    // (instructions, word limits, the real question under a short heading), help text linked to its controls, and
    // the box's placeholder. Minus its label, options, current value and error message.
    const error = linked[0] || inside[0] || '';
    const linkedHelp = [g.anchor, ...g.els].flatMap((c) => byIds(c.getAttribute('aria-describedby'), c)).filter((n) => !within(box, n)).map(textOf).filter((t) => t && t !== error);
    const placeholder = clean(input(el).placeholder) || clean(el.getAttribute('aria-placeholder'));
    let rest = clean(ownText(box));
    for (const t of [label, ...(options ?? []), value, error].filter((x) => x && x.length > 1).sort((x, y) => y.length - x.length)) rest = rest.split(t).join(' ');
    rest = clean(rest.replace(STAR, ''));
    const description = [...new Set([rest, ...linkedHelp, placeholder && placeholder !== label && !/^(select|choose|search)\b/i.test(placeholder) ? `(box says: ${placeholder})` : ''])]
      .filter((t) => t && t.length > 1 && t !== label).join('\n').slice(0, 2000);
    return {
      description: description || undefined,
      key: `${aid(box) || input(el).name || el.id || ''}|${entry}|${label}`, kind, label, entry: entry || undefined, required, value, options, dateParts,
      editable: kind === 'pick' && el.tagName === 'INPUT', error: linked[0] || inside[0] || undefined, box, els: g.els, face: faces.get(el),
    };
  });

  // ── Buttons, progress, errors, sign-in ──
  const controls = new Set([...ctrls, ...inGroup]);
  const buttons = all('button, [role=button], a[role=button], a[data-automation-id], a[href], [role=tab], input[type=submit], input[type=button]')
    .filter((b) => shown(b) && !closest(b, CHROME) && !controls.has(b) && clean(inner(b) || b.getAttribute('aria-label') || input(b).value || ''))
    .filter((b) => b.tagName !== 'A' || !/^(#|mailto:|tel:|javascript:)/i.test(b.getAttribute('href') || '') || b.getAttribute('role') === 'button')
    .map((b) => ({ el: b, text: clean(inner(b) || b.getAttribute('aria-label') || input(b).value), autoId: aid(b), footer: !!closest(b, 'footer, [role=contentinfo], [data-automation-id*="footer" i]') }));
  const current = first('[aria-current="step"]') || first('[data-automation-id="progressBarActiveStep"]');
  const pos = (textOf(current) || '').match(/step\s+(\d+)\s+of\s+(\d+)/i);
  let progress = pos ? { at: +pos[1], of: +pos[2] } : undefined;
  if (!progress && current?.parentElement) { const sib = [...current.parentElement.children]; progress = { at: sib.indexOf(current) + 1, of: sib.length }; }
  const heading = all('main h2, h2, main h1, h1').find(shown);
  const name = clean((textOf(current) || textOf(heading)).replace(/^(completed |current )?step\s+\d+\s+of\s+\d+\s*/i, ''));
  const alerts = all('[data-automation-id*="errorBanner" i], [role=alert]').filter(shown).map(textOf)
    .filter((t) => t && /error|required|invalid|must|please (enter|select|fix)/i.test(t));
  const pw = all<HTMLInputElement>('input[type=password]').find((p) => { const r = p.getBoundingClientRect(); return r.width > 30 && r.height > 8 && shown(p); });
  // A section's entries: its numbered headings, or (sites without them) the rows its questions sit in.
  const entries = (sec: (typeof sections)[number]) => Math.max(sec.entries, new Set(fields.filter((f) => f.entry && within(sec.box, f.box)).map((f) => f.entry)).size);
  return { name: name.slice(0, 80), progress, signIn: !!pw, fields, buttons, sections: sections.map((sec) => ({ add: sec.add, heading: sec.heading, entries: entries(sec) })), errors: [...new Set(alerts)].slice(0, 5) };
}

export function readStep(): Step {
  deep = false;
  const plain = readOnce();
  if (plain.fields.length) return plain;
  // Nothing found: the form may be built from web components. Read again through them.
  roots = collectRoots();
  if (!roots.length) return plain;
  deep = true;
  try {
    const through = readOnce();
    return through.fields.length ? through : plain;
  } finally { deep = false; roots = []; }
}

/** Company, role and job description text read off the page. */
export function readJob() {
  const title = document.title || '';
  const og = (p: string) => document.querySelector<HTMLMetaElement>(`meta[property="${p}"]`)?.content || '';
  const h1 = clean(document.querySelector('h1')?.textContent);
  let company = '', role = '';
  const m = title.match(/Job Application for (.+?) at (.+)$/i);
  if (m) { role = m[1].trim(); company = m[2].trim(); }
  // Otherwise titles are usually "Company - Role", "Role | Company" or "Role at Company". On a job board's own site
  // (jobs.lever.co/palantir/…) the company is the first part of the address, which tells the parts apart.
  const parts = (og('og:title') || title).split(/\s+[|–—-]\s+|\s+at\s+/i).map((p) => p.trim()).filter(Boolean);
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const slug = portalName(location.hostname) ? squash(location.pathname.split('/').filter(Boolean)[0] ?? '') : '';
  const byAddress = slug.length >= 3 ? parts.find((p) => squash(p).includes(slug) || slug.includes(squash(p))) : undefined;
  const byHeading = h1 && parts.length >= 2 ? parts.find((p) => !h1.includes(p) && !p.includes(h1)) : undefined;
  const fromTitle = (byAddress ?? byHeading)?.replace(/\s+(careers|jobs)$/i, '');
  if (!company && fromTitle && parts.length >= 2) { company = fromTitle; role = role || h1 || parts.filter((p) => p !== byAddress && p !== byHeading).join(' - '); }
  role = role || h1 || og('og:title') || title;
  company = company || og('og:site_name') || location.hostname.replace(/^(www|boards|job-boards|jobs|careers)\./, '').split('.')[0];
  const copy = document.body.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('form, script, style, nav, footer, #jobdemon-host').forEach((n) => n.remove());
  const jd = (copy.innerText || copy.textContent || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 12000);
  return { url: location.href, company, role, jd };
}
