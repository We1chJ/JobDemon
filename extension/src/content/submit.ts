// Notices when you submit an application yourself: your click on the site's Submit button, then whether it went
// through (a thank-you page, or the form gone without errors). Only then does the job count as applied.
// Only real clicks (isTrusted) count here; JobDemon's own Submit (Auto-submit) is followed with trackSubmit.
import { ask } from '../shared/msg.js';
import { readStep } from './read.js';
import { sleep } from './widgets.js';
import { log } from './log.js';

const SUBMIT = /^((save|confirm|sign) (and|&) )?(submit|send|finish|complete)( (and|&) (submit|send))?( (my |your |this )?(job )?application)?( now)?\W*$/i;
// "Apply" also opens a form from a posting: it's a Submit only on a form you've filled in.
const APPLY = /^apply( now)?\W*$/i;
const WAIT = 60000; // uploads can make a site slow to answer
const CONFIRMED = /thank(s| you) for (applying|your application|your interest|submitting)|application (has been |was )?(received|submitted|complete)|we('ve| have) received your application|successfully (submitted|applied)|you('ve| have) (successfully )?applied|application submitted/i;

const own = (el: Element) => ((el as HTMLElement).innerText || (el as HTMLInputElement).value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
// A button drawn inside a web component may show its words from outside it (the component's own text).
const textOf = (el: Element) => own(el) || own(((el.getRootNode() as ShadowRoot).host as Element | undefined) ?? el);
const problems = () => { const s = readStep(); return [...s.errors, ...s.fields.flatMap((f) => (f.error ? [`${f.label}: ${f.error}`] : []))]; };
const failed = () => problems().length > 0;
const confirmed = () => CONFIRMED.test(document.body?.innerText ?? '');
const isSubmit = (b: Element) => SUBMIT.test(textOf(b)) || (APPLY.test(textOf(b)) && readStep().fields.filter((f) => f.value).length >= 2);

/** After a Submit: did it go through? A full page load ends this script: afterSubmit takes over there. */
async function outcome(button: Element, before: string[]) {
  for (let waited = 0; waited < WAIT; waited += 1000) {
    await sleep(1000);
    if (problems().some((p) => !before.includes(p))) return false; // a message from before your click says nothing
    if (confirmed()) return true;
    if (!button.isConnected && !readStep().fields.length) return true; // the form went away
  }
  return false;
}

async function submitted(button: Element) {
  const before = problems();
  const tracked = await ask<boolean>({ t: 'submit:pending' }).catch(() => false);
  if (!tracked) return; // not a page JobDemon knows as a job application
  log({ type: 'you clicked submit', button: textOf(button) });
  const ok = await outcome(button, before);
  log({ type: 'submit outcome', went_through: ok, errors: readStep().errors });
  await ask({ t: 'submit:done', ok }).catch(() => {});
}

/** JobDemon is about to click this Submit itself (Auto-submit): follow it like one of yours. */
export const trackSubmit = (button: Element) => void submitted(button);

export function watchSubmits() {
  document.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    // The element really clicked, even inside a web component (the event's target is the component itself).
    const b = (e.composedPath()[0] as Element | undefined)?.closest?.('button, input[type=submit], [role=button], a[role=button]');
    if (!b || !isSubmit(b)) return;
    if ((b as HTMLButtonElement).form?.matches(':invalid')) return; // the browser refuses it: nothing was sent
    void submitted(b);
  }, true);
}

/** The page that loaded after a Submit (a full page load): check how it went. */
export async function afterSubmit() {
  const pending = await ask<{ url: string; frame: number } | null>({ t: 'submit:get' }).catch(() => null);
  if (!pending) return;
  await sleep(1500);
  log({ type: 'page after your submit', url: location.origin + location.pathname, errors: readStep().errors, questions: readStep().fields.length });
  // A form embedded in the page, and now the whole page has loaded: only its own words can say the Submit went through.
  if (pending.frame !== 0) {
    for (let waited = 0; waited < 8000; waited += 1000) {
      if (confirmed()) return void ask({ t: 'submit:done', ok: true });
      await sleep(1000);
    }
    return;
  }
  for (let waited = 0; waited < 8000; waited += 1000) {
    if (failed()) return void ask({ t: 'submit:done', ok: false });
    if (confirmed() || !readStep().fields.length) return void ask({ t: 'submit:done', ok: true });
    await sleep(1000);
  }
  // The same form again with no message: it didn't go through.
  void ask({ t: 'submit:done', ok: location.href.split('#')[0] !== pending.url.split('#')[0] && !readStep().fields.some((f) => f.required && !f.value) });
}
