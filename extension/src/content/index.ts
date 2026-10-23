// Runs in every page and frame. The widget appears on job applications (or when you click the toolbar icon);
// frames with an embedded application form fill when the page asks them to.
import { ask, type Reply, type Run, type ToFrame } from '../shared/msg.js';
import { fillFrame, portalName } from './engine.js';
import { hover, showPanel } from './panel.js';
import { readStep } from './read.js';
import { sleep } from './widgets.js';

const top = window.top === window;

chrome.runtime.onMessage.addListener((m: ToFrame, _sender, reply: (r: Reply<unknown>) => void) => {
  if (m.t === 'fill') { fillFrame(() => {}, m.retry).then((v) => reply({ ok: true, v }), (e: Error) => reply({ ok: false, error: e.message })); return true; }
  if (m.t === 'hover') hover();
  if (m.t === 'show' && top) showPanel();
  reply({ ok: true, v: null });
  return false;
});

/** A job page: a known portal, a job posting, or a page asking for your email, name or a file. */
const looksLikeApplication = () => {
  if (portalName()) return true;
  // A job posting: marked up as one for search engines, or with an Apply button.
  if ([...document.querySelectorAll('script[type="application/ld+json"]')].some((s) => /"@type"\s*:\s*"JobPosting"/.test(s.textContent ?? ''))) return true;
  if (readStep().buttons.some((b) => /^(apply( now| for this (job|position|role))?|start (your |my )?application)$/i.test(b.text))) return true;
  const fields = readStep().fields;
  return fields.length >= 3 && fields.some((f) => f.kind === 'file' || /e-?mail|first name|last name|full name|resume|\bcv\b/i.test(f.label));
};

async function start() {
  if (top) {
    // "Continue" was going when this page loaded: carry on.
    const run = await ask<Run | null>({ t: 'run:get' }).catch(() => null);
    if (run?.active) { await sleep(1500); return showPanel({ resume: true }); }
  }
  // Pages draw their forms late: look again a few times.
  for (const wait of [800, 2000, 4000]) {
    await sleep(wait);
    if (!looksLikeApplication()) continue;
    return top ? showPanel() : hover();
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void start(), { once: true });
else void start();
