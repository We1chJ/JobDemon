// The run log behind "Copy debug report": what JobDemon saw on each page (its structure, never your answers) and
// what it did with every question. Kept per tab by the background; personal details are removed in the report.
import { ask } from '../shared/msg.js';
import { readStep } from './read.js';

const where = window.top === window ? 'page' : `frame ${location.host}`;

export function log(e: Record<string, unknown>) {
  void ask({ t: 'log', e: { at: new Date().toISOString().slice(11, 19), where, ...e } }).catch(() => {});
}

/** Structure only, for seeing how a widget is built: tags, roles, input types, ARIA state, portal ids. */
function outline(el: Element, depth = 0): string {
  if (depth > 4) return '';
  const a = (n: string) => el.getAttribute(n);
  const me = el.tagName.toLowerCase() + (a('data-automation-id') ? `[${a('data-automation-id')}]` : '') + (a('role') ? `{${a('role')}}` : '')
    + (el.tagName === 'INPUT' ? `:${(el as HTMLInputElement).type}` : '') + (a('aria-haspopup') ? '(popup)' : '') + (a('aria-hidden') === 'true' ? '(aria-hidden)' : '');
  const kids = [...el.children].filter((c) => !/^(SCRIPT|STYLE|OPTION|SVG|PATH)$/i.test(c.tagName)).slice(0, 8).map((c) => outline(c, depth + 1)).filter(Boolean);
  return kids.length ? `${me} > (${kids.join(' ')})` : me;
}

/** What the page looks like now: its questions (filled or not, never their values), buttons and errors. */
export function snapshot(when: string) {
  const s = readStep();
  log({
    type: 'page', when, url: location.origin + location.pathname, step: s.name, progress: s.progress, signIn: s.signIn || undefined, errors: s.errors,
    sections: s.sections.map((x) => `${x.heading}: ${x.entries}`),
    buttons: s.buttons.slice(0, 40).map((b) => `${b.text.slice(0, 50)}${b.footer ? ' (footer)' : ''}`),
    fields: s.fields.map((f) => ({
      q: f.entry ? `${f.entry} > ${f.label}` : f.label, details: f.description, kind: f.kind, required: f.required || undefined, filled: !!f.value, error: f.error,
      options: f.options?.slice(0, 30), dropdownShows: f.face ? (f.face.innerText || '').trim().slice(0, 60) : undefined, outline: outline(f.box),
    })),
  });
}
