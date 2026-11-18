// Runs in every page and frame. The bar appears by itself only on job applications (and postings you apply from);
// the toolbar icon shows it on any page. Frames with an embedded application form fill when the page asks them to.
import { ask, type FillStatus, type Reply, type Run, type ToFrame } from '../shared/msg.js';
import { clickButton, fillFrame, look as lookHere, portalName, setStopping } from './engine.js';
import { appliedNotice, hover, revealPanel, showPanel } from './panel.js';
import { readStep } from './read.js';
import { afterSubmit, watchSubmits } from './submit.js';
import { sleep } from './widgets.js';

const top = window.top === window;

// One fill at a time in this frame: a second Fill page while one is still going waits for it, then fills what's
// left. (Two at once open each other's dropdowns and pick from the wrong list.) The page asks how it's going.
let fill: FillStatus | null = null, said = '', queue: Promise<unknown> = Promise.resolve();

chrome.runtime.onMessage.addListener((m: ToFrame, _sender, reply: (r: Reply<unknown>) => void) => {
  if (m.t === 'stop') setStopping(true);
  if (m.t === 'fill') {
    setStopping(false);
    const mine: FillStatus = { busy: true };
    fill = mine;
    queue = queue.then(() => fillFrame((s) => { said = s; }, m.retry)).then((v) => { mine.report = v; }, () => {}).finally(() => { mine.busy = false; });
    reply({ ok: true, v: true });
    return false;
  }
  if (m.t === 'fill:status') { reply({ ok: true, v: fill && { ...fill, said } }); return false; }
  if (m.t === 'look') { reply({ ok: true, v: lookHere(m.job) }); return false; }
  if (m.t === 'click') { reply({ ok: true, v: clickButton(m.text, m.submit) }); return false; }
  if (m.t === 'hover') hover();
  if (m.t === 'show' && top) revealPanel();
  if (m.t === 'applied' && top) appliedNotice();
  reply({ ok: true, v: null });
  return false;
});

const APPLY = /^(apply( now| online| for this (job|position|role)( online)?)?|start (your |my )?application|i'?m interested)$/i;
/** A job application: a form asking for your name, email or resume; or a job posting you can apply from. */
function isJobApplication() {
  const step = readStep();
  const fields = step.fields;
  if (fields.length >= 3 && fields.some((f) => f.kind === 'file' || /e-?mail|first name|last name|full name|resume|\bcv\b/i.test(f.label))) return true;
  const posting = [...document.querySelectorAll('script[type="application/ld+json"]')].some((s) => /"@type"\s*:\s*"JobPosting"/.test(s.textContent ?? ''));
  return posting || (!!portalName() && step.buttons.some((b) => APPLY.test(b.text)));
}

async function look() {
  // Pages draw their forms late: look again a few times.
  for (const wait of [800, 2000, 4000]) {
    await sleep(wait);
    if (!isJobApplication()) continue;
    return void (top ? showPanel() : hover());
  }
}

async function start() {
  watchSubmits();
  void afterSubmit();
  if (top) {
    // A fill was going when this page loaded: carry on.
    const run = await ask<Run | null>({ t: 'run:get' }).catch(() => null);
    if (run?.active) { await sleep(1500); return showPanel({ resume: true }); }
  }
  await look();
  // Sites that change page without loading a new one (an "Application" tab): look again when the address changes.
  let at = location.href;
  setInterval(() => { if (location.href !== at && !document.getElementById('jobdemon-host')) { at = location.href; void look(); } }, 1500);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void start(), { once: true });
else void start();
