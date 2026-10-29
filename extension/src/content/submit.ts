// Notices when you submit an application yourself: your click on the site's Submit button, then whether it went
// through (a thank-you page, or the form gone without errors). Only then does the job count as applied.
// Only real clicks (isTrusted) count here; JobDemon's own Submit (Auto-submit) is followed with trackSubmit.
import { ask } from '../shared/msg.js';
import { readStep } from './read.js';
import { sleep } from './widgets.js';
import { log } from './log.js';

const SUBMIT = /^(submit( (my |your )?application)?|send( (my )?application)?|finish( application)?|complete( (my )?application)?)$/i;
const CONFIRMED = /thank(s| you) for (applying|your application|your interest|submitting)|application (has been |was )?(received|submitted|complete)|we('ve| have) received your application|successfully (submitted|applied)|you('ve| have) (successfully )?applied|application submitted/i;

const own = (el: Element) => ((el as HTMLElement).innerText || (el as HTMLInputElement).value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
// A button drawn inside a web component may show its words from outside it (the component's own text).
const textOf = (el: Element) => own(el) || own(((el.getRootNode() as ShadowRoot).host as Element | undefined) ?? el);
const failed = () => { const s = readStep(); return s.errors.length > 0 || s.fields.some((f) => f.error); };
const confirmed = () => CONFIRMED.test(document.body?.innerText ?? '');

/** After a Submit: did it go through? true / false, or null when the page left before we could tell. */
async function outcome(button: Element): Promise<boolean | null> {
  for (let waited = 0; waited < 20000; waited += 1000) {
    await sleep(1000);
    if (failed()) return false;
    if (confirmed()) return true;
    if (!button.isConnected && !readStep().fields.length) return true; // the form went away
  }
  return false;
}

async function submitted(button: Element) {
  const tracked = await ask<boolean>({ t: 'submit:pending' }).catch(() => false);
  if (!tracked) return; // not a page JobDemon knows as a job application
  log({ type: 'you clicked submit', button: textOf(button) });
  const ok = await outcome(button);
  log({ type: 'submit outcome', went_through: ok, errors: readStep().errors });
  if (ok !== null) await ask({ t: 'submit:done', ok }).catch(() => {});
}

/** JobDemon is about to click this Submit itself (Auto-submit): follow it like one of yours. */
export const trackSubmit = (button: Element) => void submitted(button);

export function watchSubmits() {
  document.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    // The element really clicked, even inside a web component (the event's target is the component itself).
    const b = (e.composedPath()[0] as Element | undefined)?.closest?.('button, input[type=submit], [role=button], a[role=button]');
    if (b && SUBMIT.test(textOf(b))) void submitted(b);
  }, true);
}

/** The page that loaded after a Submit (a full page load): check how it went. */
export async function afterSubmit() {
  const pending = await ask<{ url: string } | null>({ t: 'submit:get' }).catch(() => null);
  if (!pending) return;
  await sleep(1500);
  log({ type: 'page after your submit', url: location.origin + location.pathname, errors: readStep().errors, questions: readStep().fields.length });
  for (let waited = 0; waited < 8000; waited += 1000) {
    if (failed()) return void ask({ t: 'submit:done', ok: false });
    if (confirmed() || !readStep().fields.length) return void ask({ t: 'submit:done', ok: true });
    await sleep(1000);
  }
  // The same form again with no message: it didn't go through.
  void ask({ t: 'submit:done', ok: location.href.split('#')[0] !== pending.url.split('#')[0] && !readStep().fields.some((f) => f.required && !f.value) });
}
