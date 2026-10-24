// The JobDemon bar on a job application: Continue · Fill page · ⋯ (cover letter, Dashboard, Setup, Hide).
// A line under it says what it's doing and which fields are left for you. Starts top right; drag the logo or
// the bar to move it (kept for this tab and site). Plus a small button beside each field: fill just that one.
import LOGO from '../../../assets/logo.svg';
import { ask } from '../shared/msg.js';
import { textToPdf } from '../shared/pdf.js';
import { continueRun, fillOne, fillThisPage, portalName, requestStop, type Say } from './engine.js';
import { readJob } from './read.js';

const ICON = `data:image/svg+xml,${encodeURIComponent(LOGO)}`;
const CSS = `
:host{all:initial}
*{box-sizing:border-box}
.w{--bg:#fff;--fg:#18181b;--muted:#71717a;--line:#e4e4e7;--soft:#f4f4f5;--warn:#b45309;--pri:#18181b;--on-pri:#fff;
  font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--fg);width:max-content;max-width:calc(100vw - 32px)}
@media (prefers-color-scheme:dark){.w{--bg:#18181b;--fg:#f4f4f5;--muted:#a1a1aa;--line:#3f3f46;--soft:#27272a;--warn:#f59e0b;--pri:#f4f4f5;--on-pri:#18181b}}
.card{background:var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 24px rgb(0 0 0/.14),0 1px 3px rgb(0 0 0/.08);position:relative}
.bar{display:flex;align-items:center;gap:6px;padding:6px;cursor:grab;user-select:none;touch-action:none}
.bar:active{cursor:grabbing}
.logo{width:30px;height:30px;border:0;background:none;padding:2px;border-radius:8px;cursor:inherit;display:grid;place-items:center}
.logo img{width:20px;height:23px;display:block;pointer-events:none}
.mini .logo{cursor:pointer}.mini .logo:hover{background:var(--soft)}
button.b{font:inherit;font-weight:600;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer;white-space:nowrap}
button.b:hover{background:var(--soft)}
button.b.pri{background:var(--pri);border-color:var(--pri);color:var(--on-pri)}
button.b.pri:hover{opacity:.9}
button.b:disabled{opacity:.45;cursor:default}
button.more{width:30px;padding:0;font-size:16px;letter-spacing:1px;border-color:transparent;color:var(--muted)}
.sub{border-top:1px solid var(--line);padding:8px 10px 9px;max-width:330px;display:grid;gap:6px}
.t{display:flex;gap:7px;align-items:baseline}
.dot{width:7px;height:7px;border-radius:50%;background:var(--muted);flex:none;transform:translateY(-1px)}
.busy .dot{background:#7c3aed;animation:p 1s ease-in-out infinite}
@keyframes p{50%{opacity:.25}}
details.n summary{cursor:pointer;color:var(--warn);font-weight:600;list-style:none}
details.n summary::-webkit-details-marker{display:none}
details.n summary::before{content:"▸ "}details.n[open] summary::before{content:"▾ "}
details.n ul{margin:4px 0 0;padding-left:18px;color:var(--muted);max-height:30vh;overflow:auto}
.letter{display:grid;gap:6px}
.letter pre{margin:0;white-space:pre-wrap;max-height:40vh;overflow:auto;font:inherit;line-height:1.5;background:var(--soft);border-radius:8px;padding:8px}
.row{display:flex;gap:6px}
.menu{position:absolute;top:44px;right:6px;z-index:2;background:var(--bg);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgb(0 0 0/.16);padding:4px;min-width:160px}
.menu button{display:block;width:100%;text-align:left;font:inherit;background:none;border:0;color:var(--fg);padding:7px 10px;border-radius:6px;cursor:pointer}
.menu button:hover{background:var(--soft)}
.menu hr{border:0;border-top:1px solid var(--line);margin:4px 2px}
[hidden]{display:none!important}
`;
const POS_KEY = 'jobdemon-panel-pos', MINI_KEY = 'jobdemon-panel-mini';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const remember = (k: string, v: unknown) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} };
const recall = <T>(k: string): T | null => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } };

let host: HTMLElement | null = null;
let say: Say = () => {};
let busy = false;
let unhide = () => {};

/** Show the bar (once per page). */
export function showPanel(opts: { resume?: boolean } = {}) {
  if (host) return;
  // This page is a job application: remember it for your history (and for noticing your Submit).
  void ask({ t: 'job', job: readJob(), portal: portalName() || undefined }).catch(() => {});
  host = el('div');
  host.id = 'jobdemon-host';
  host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'open' });
  root.append(el('style', undefined, CSS));
  const w = el('div', 'w'); w.setAttribute('role', 'complementary'); w.setAttribute('aria-label', 'JobDemon');
  const card = el('div', 'card');
  const bar = el('div', 'bar');
  const logo = el('button', 'logo'); logo.title = 'JobDemon'; logo.setAttribute('aria-label', 'JobDemon');
  const img = el('img'); img.src = ICON; img.alt = ''; logo.append(img);
  const go = el('button', 'b pri', 'Continue'); go.title = 'Fill every page up to Submit';
  const fill = el('button', 'b', 'Fill page'); fill.title = 'Fill the empty fields on this page';
  const more = el('button', 'b more', '⋯'); more.title = 'More'; more.setAttribute('aria-label', 'More'); more.setAttribute('aria-haspopup', 'menu');
  bar.append(logo, go, fill, more);
  const menu = el('div', 'menu'); menu.setAttribute('role', 'menu'); menu.hidden = true;
  const item = (label: string, fn: () => void) => { const b = el('button', undefined, label); b.setAttribute('role', 'menuitem'); b.onclick = () => { menu.hidden = true; fn(); }; return b; };
  // Under the bar: status, fields left for you, the cover letter. Hidden when there's nothing to say.
  const sub = el('div', 'sub'); sub.hidden = true;
  const t = el('div', 't'); const msg = el('span'); t.append(el('span', 'dot'), msg);
  const needs = el('details', 'n'); const needsSum = el('summary'); const needsList = el('ul'); needs.append(needsSum, needsList); needs.hidden = true;
  const letter = el('div', 'letter'); letter.hidden = true;
  const pre = el('pre'); const lrow = el('div', 'row');
  const copy = el('button', 'b', 'Copy'); const pdf = el('button', 'b', 'Download PDF');
  const close = el('button', 'b more', '✕'); close.title = 'Close'; close.setAttribute('aria-label', 'Close the cover letter');
  lrow.append(copy, pdf, close); letter.append(pre, lrow);
  sub.append(t, needs, letter);
  card.append(bar, menu, sub); w.append(card); root.append(w);
  document.documentElement.append(host);

  const isMini = () => w.classList.contains('mini');
  const showSub = () => { t.hidden = !msg.textContent; sub.hidden = isMini() || (!msg.textContent && needs.hidden && letter.hidden); };
  const mini = (on: boolean) => {
    w.classList.toggle('mini', on);
    [go, fill, more].forEach((b) => (b.hidden = on));
    menu.hidden = true;
    logo.title = on ? 'Show JobDemon' : 'JobDemon';
    showSub();
    remember(MINI_KEY, on);
  };
  unhide = () => mini(false);

  // Position: top right to start; dragged positions are kept for this tab and site.
  const place = (x: number, y: number) => {
    const wd = host!.offsetWidth || 280, ht = host!.offsetHeight || 44;
    x = Math.min(Math.max(0, x), window.innerWidth - Math.min(wd, window.innerWidth));
    y = Math.min(Math.max(0, y), window.innerHeight - Math.min(ht, 44));
    Object.assign(host!.style, { left: `${x}px`, top: `${y}px`, right: 'auto' });
    return { x, y };
  };
  const saved = recall<{ x: number; y: number }>(POS_KEY);
  if (saved) place(saved.x, saved.y);
  let dragged = false;
  bar.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('button:not(.logo)')) return;
    const r = host!.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top, sx = e.clientX, sy = e.clientY;
    bar.setPointerCapture(e.pointerId);
    dragged = false;
    let last = { x: r.left, y: r.top };
    const move = (ev: PointerEvent) => { if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) { dragged = true; last = place(ev.clientX - dx, ev.clientY - dy); } };
    const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); if (dragged) remember(POS_KEY, last); };
    bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up);
  });
  logo.onclick = () => { if (!dragged && isMini()) mini(false); };

  say = (status, list) => {
    msg.textContent = status;
    if (list !== undefined) {
      needs.hidden = !list.length;
      needsSum.textContent = `${list.length} field${list.length === 1 ? '' : 's'} need you`;
      needsList.replaceChildren(...list.map((n) => el('li', undefined, n)));
    }
    showSub();
  };
  // While it works, the main button is Stop (for Continue and Fill page alike).
  const working = (on: boolean) => {
    busy = on;
    w.classList.toggle('busy', on);
    fill.disabled = on;
    go.textContent = on ? 'Stop' : 'Continue';
    go.title = on ? 'Stop after the field it is on' : 'Fill every page up to Submit';
  };
  const guard = (fn: () => Promise<unknown>) => async () => {
    if (busy) return;
    working(true);
    needs.hidden = true;
    try { await fn(); } catch (e) { say(`Error: ${(e as Error).message}`); } finally { working(false); }
  };
  fill.onclick = guard(() => fillThisPage(say));
  const runIt = guard(() => continueRun(say, opts.resume));
  go.onclick = () => { if (!busy) return void runIt(); say('Stopping after this field…'); void requestStop(); };
  more.onclick = () => { menu.hidden = !menu.hidden; };
  root.addEventListener('pointerdown', (e) => { if (!(e.target as Element).closest('.menu, .more')) menu.hidden = true; });
  document.addEventListener('pointerdown', (e) => { if (!e.composedPath().includes(host!)) menu.hidden = true; });

  const openLetter = async () => {
    letter.hidden = false;
    showSub();
    if (pre.textContent) return;
    pre.textContent = 'Writing your cover letter for this job (10–30 seconds)…';
    try { pre.textContent = await ask<string>({ t: 'letter' }); } catch (e) { pre.textContent = `Couldn't write it: ${(e as Error).message}`; }
  };
  menu.append(
    item('Cover letter', () => void openLetter()),
    el('hr'),
    item('Dashboard', () => void ask({ t: 'open', page: 'dashboard' })),
    item('Setup', () => void ask({ t: 'open', page: 'setup' })),
    el('hr'),
    item('Hide', () => mini(true)),
  );
  copy.onclick = async () => { try { await navigator.clipboard.writeText(pre.textContent ?? ''); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed'; } setTimeout(() => (copy.textContent = 'Copy'), 1500); };
  pdf.onclick = () => {
    const a = el('a'); a.href = URL.createObjectURL(new Blob([textToPdf(pre.textContent ?? '') as BlobPart], { type: 'application/pdf' }));
    a.download = 'Cover Letter.pdf'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  close.onclick = () => { letter.hidden = true; showSub(); };

  if (recall<boolean>(MINI_KEY) && !opts.resume) mini(true);
  hover();
  if (opts.resume) void runIt();
}

/** The toolbar icon: show the bar, opened up if it was hidden. */
export function revealPanel() {
  if (!host) return showPanel();
  unhide();
}

/** Your Submit went through: say so. */
export function appliedNotice() {
  if (!host) showPanel();
  say('Submitted. Marked as applied.', []);
}

// ── The per-field button ───────────────────────────────────────────────────
const CONTROL = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=password]), textarea, select, [role=combobox], [contenteditable=true], button[aria-haspopup]';
let hovering = false;
/** A small button beside the field under the pointer: fill just that field. */
export function hover() {
  if (hovering) return;
  hovering = true;
  const btn = el('div');
  btn.style.cssText = 'position:fixed;z-index:2147483647;display:none';
  const root = btn.attachShadow({ mode: 'open' });
  const b = el('button');
  b.title = 'Fill this field with JobDemon';
  b.setAttribute('aria-label', 'Fill this field with JobDemon');
  b.style.cssText = 'all:initial;cursor:pointer;width:24px;height:24px;border-radius:50%;background:#fff;border:1px solid #d4d4d8;box-shadow:0 2px 6px rgb(0 0 0/.18);display:grid;place-items:center';
  const img = el('img'); img.src = ICON; img.alt = ''; img.style.cssText = 'width:14px;height:16px;display:block';
  b.append(img); root.append(b);
  document.documentElement.append(btn);
  let target: Element | null = null, hideTimer = 0;
  const hide = () => { hideTimer = window.setTimeout(() => { btn.style.display = 'none'; }, 400); };
  document.addEventListener('mouseover', (e) => {
    const t = (e.target as Element)?.closest?.(CONTROL);
    if (!t || t.closest('#jobdemon-host') || (t as HTMLInputElement).disabled) return;
    const r = t.getBoundingClientRect();
    if (r.width < 12 || r.height < 12) return;
    clearTimeout(hideTimer);
    target = t;
    Object.assign(btn.style, { display: 'block', left: `${Math.min(window.innerWidth - 28, r.right + 4)}px`, top: `${r.top + Math.max(0, (r.height - 24) / 2)}px` });
  }, true);
  document.addEventListener('mouseout', (e) => { if ((e.target as Element)?.closest?.(CONTROL)) hide(); }, true);
  btn.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  btn.addEventListener('mouseleave', hide);
  addEventListener('scroll', () => { btn.style.display = 'none'; }, { passive: true, capture: true });
  b.onclick = async () => {
    if (!target || busy) return;
    busy = true;
    b.style.opacity = '.5';
    const sayHere: Say = (s) => { say(s); b.title = s; };
    try { await fillOne(target, sayHere); } catch (e) { sayHere(`Error: ${(e as Error).message}`); } finally { busy = false; b.style.opacity = '1'; }
  };
}
