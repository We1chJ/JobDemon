// Notices when you submit an application yourself: your click on the site's Submit button, then whether it went
// through (a thank-you page, or the form gone without errors). Only then does the job count as applied.
// The bot never clicks Submit, so only real clicks (isTrusted) count.
import { ask } from '../shared/msg.js';
import { readStep } from './read.js';
import { sleep } from './widgets.js';

const SUBMIT = /^(submit( (my |your )?application)?|send( (my )?application)?|finish( application)?|complete( (my )?application)?)$/i;
const CONFIRMED = /thank(s| you) for (applying|your application|your interest|submitting)|application (has been |was )?(received|submitted|complete)|we('ve| have) received your application|successfully (submitted|applied)|you('ve| have) (successfully )?applied|application submitted/i;

const textOf = (el: Element) => ((el as HTMLElement).innerText || (el as HTMLInputElement).value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
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
  const ok = await outcome(button);
  if (ok !== null) await ask({ t: 'submit:done', ok }).catch(() => {});
}

export function watchSubmits() {
  document.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const b = (e.target as Element)?.closest?.('button, input[type=submit], [role=button], a[role=button]');
    if (b && SUBMIT.test(textOf(b))) void submitted(b);
  }, true);
}

/** The page that loaded after a Submit (a full page load): check how it went. */
export async function afterSubmit() {
  const pending = await ask<{ url: string } | null>({ t: 'submit:get' }).catch(() => null);
  if (!pending) return;
  await sleep(1500);
  for (let waited = 0; waited < 8000; waited += 1000) {
    if (failed()) return void ask({ t: 'submit:done', ok: false });
    if (confirmed() || !readStep().fields.length) return void ask({ t: 'submit:done', ok: true });
    await sleep(1000);
  }
  // The same form again with no message: it didn't go through.
  void ask({ t: 'submit:done', ok: location.href.split('#')[0] !== pending.url.split('#')[0] && !readStep().fields.some((f) => f.required && !f.value) });
}
