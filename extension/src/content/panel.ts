// The JobDemon widget on a job page: Fill this page · Continue · Mark submitted, with what it's doing, the fields
// left for you, and the cover letter. Starts top right; drag the header to move it (kept for this tab and site).
// Plus a small button beside each field you point at: fill just that one.
import LOGO from '../../../assets/logo.svg';
import { ask } from '../shared/msg.js';
import { textToPdf } from '../shared/pdf.js';
import { continueRun, fillOne, fillThisPage, portalName, stopRun, type Say } from './engine.js';
import { readJob } from './read.js';

const ICON = `data:image/svg+xml,${encodeURIComponent(LOGO)}`;
const CSS = `
:host{all:initial}
.p{width:min(340px,calc(100vw - 32px));background:#fff;color:#1a1a1a;border:1px solid #b4b4b4;border-radius:8px;box-shadow:0 6px 24px rgb(0 0 0/.18);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
.h{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 10px;background:#1a1a1a;color:#fff;cursor:move;user-select:none;touch-action:none}
.h img{width:18px;height:20px;display:block}.h b{font-size:13px}.h .s{flex:1;font-size:12px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h button{background:transparent;color:#fff;border:1px solid rgb(255 255 255/.4);border-radius:4px;font:inherit;font-size:12px;padding:1px 8px;cursor:pointer}
.b{padding:10px 12px;display:grid;gap:10px}.t{color:#333;font-size:13px}.n{color:#9a5b00;font-size:13px}
.r{display:flex;gap:8px;flex-wrap:wrap}
button.k{font:inherit;font-size:13px;font-weight:500;border:1px solid #b4b4b4;background:#fff;color:#1a1a1a;border-radius:4px;padding:6px 10px;cursor:pointer;min-height:32px}
button.k:hover{background:#f4f4f2}button.k.pri{background:#1a1a1a;color:#fff;border-color:#1a1a1a}button.k:disabled{opacity:.5;cursor:default}
button.k.x{min-width:34px;font-size:15px;line-height:1}
details summary{cursor:pointer;font-size:13px;color:#0b57d0}
pre{margin:6px 0;white-space:pre-wrap;max-height:40vh;overflow:auto;font:inherit;font-size:13px;line-height:1.55;border:1px solid #ddd;padding:8px;background:#f6f6f4}
.f{display:flex;gap:12px;font-size:12px}.f a{color:#5f5f5f;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.min .b{display:none}[hidden]{display:none!important}
@media (prefers-color-scheme:dark){.p{background:#1c1c1c;color:#e8e8e8;border-color:#4c4c4c}.t{color:#cfcfcf}.n{color:#e0a24a}
button.k{background:#1c1c1c;color:#e8e8e8;border-color:#4c4c4c}button.k:hover{background:#262626}button.k.pri{background:#e8e8e8;color:#151515;border-color:#e8e8e8}
pre{background:#232323;border-color:#333}.f a{color:#9c9c9c}details summary{color:#8ab4f8}}
`;
const POS_KEY = 'jobdemon-panel-pos';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

let host: HTMLElement | null = null;
let say: Say = () => {};
let busy = false;

/** Show the widget (once per page). */
export function showPanel(opts: { resume?: boolean } = {}) {
  if (host) return;
  host = el('div');
  host.id = 'jobdemon-host';
  host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'open' });
  root.append(el('style', undefined, CSS));
  const p = el('div', 'p'); p.setAttribute('role', 'complementary'); p.setAttribute('aria-label', 'JobDemon');
  const h = el('div', 'h'); const logo = el('img'); logo.src = ICON; logo.alt = '';
  const s = el('span', 's'); const min = el('button', undefined, 'Hide');
  h.append(logo, el('b', undefined, 'JobDemon'), s, min);
  const b = el('div', 'b');
  const todo = el('div', 't', 'Fill this page, or Continue to go through every page up to Submit.');
  const needs = el('div', 'n'); needs.hidden = true;
  const row = el('div', 'r');
  const fill = el('button', 'k', 'Fill this page'); const go = el('button', 'k pri', 'Continue');
  const done = el('button', 'k x', '✓'); done.title = 'Mark submitted (closes this tab)'; done.setAttribute('aria-label', 'Mark submitted');
  row.append(fill, go, done);
  const det = el('details'); const pre = el('pre'); const r2 = el('div', 'r');
  const copy = el('button', 'k', 'Copy text'); const pdf = el('button', 'k', 'Download PDF');
  r2.append(copy, pdf); det.append(el('summary', undefined, 'Cover letter'), pre, r2);
  const foot = el('div', 'f'); const setup = el('a', undefined, 'Setup'); const dash = el('a', undefined, 'Dashboard');
  foot.append(setup, dash);
  b.append(todo, needs, row, det, foot); p.append(h, b); root.append(p);
  document.documentElement.append(host);

  // Position: top right to start; dragged positions are kept for this tab and site.
  const place = (x: number, y: number) => {
    const w = host!.offsetWidth || 340, hgt = host!.offsetHeight || 60;
    x = Math.min(Math.max(0, x), window.innerWidth - Math.min(w, window.innerWidth));
    y = Math.min(Math.max(0, y), window.innerHeight - Math.min(hgt, 40));
    Object.assign(host!.style, { left: `${x}px`, top: `${y}px`, right: 'auto' });
    return { x, y };
  };
  try { const saved = JSON.parse(sessionStorage.getItem(POS_KEY) || 'null'); if (saved) place(saved.x, saved.y); } catch {}
  h.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('button')) return;
    const r = host!.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    h.setPointerCapture(e.pointerId);
    let last = { x: r.left, y: r.top };
    const move = (ev: PointerEvent) => { last = place(ev.clientX - dx, ev.clientY - dy); };
    const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); try { sessionStorage.setItem(POS_KEY, JSON.stringify(last)); } catch {} };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
  });
  min.onclick = () => { const m = p.classList.toggle('min'); min.textContent = m ? 'Show' : 'Hide'; };

  say = (status, detail) => {
    s.textContent = status;
    todo.textContent = status;
    if (detail !== undefined) { needs.textContent = detail; needs.hidden = !detail; }
  };
  const working = (on: boolean, running = false) => {
    busy = on;
    fill.disabled = on; done.disabled = on;
    go.textContent = running ? 'Stop' : 'Continue';
    go.disabled = on && !running;
  };
  const guard = (fn: () => Promise<unknown>, running = false) => async () => {
    if (busy) return;
    working(true, running);
    needs.hidden = true;
    try { await fn(); } catch (e) { say(`Error: ${(e as Error).message}`); } finally { working(false); }
  };
  fill.onclick = guard(() => fillThisPage(say));
  const runIt = guard(() => continueRun(say, opts.resume), true);
  go.onclick = () => (busy && go.textContent === 'Stop' ? void stopRun().then(() => say('Stopping after this field')) : void runIt());
  done.onclick = async () => {
    await stopRun().catch(() => {});
    await ask({ t: 'job', job: readJob(), portal: portalName() || undefined });
    await ask({ t: 'history', patch: { status: 'applied' } });
    await ask({ t: 'close' });
  };
  setup.onclick = () => void ask({ t: 'open', page: 'setup' });
  dash.onclick = () => void ask({ t: 'open', page: 'dashboard' });
  det.addEventListener('toggle', async () => {
    if (!det.open || pre.textContent) return;
    pre.textContent = 'Writing your cover letter for this job (10–30 seconds)…';
    try { pre.textContent = await ask<string>({ t: 'letter' }); } catch (e) { pre.textContent = `Couldn't write it: ${(e as Error).message}`; }
  });
  copy.onclick = async () => { try { await navigator.clipboard.writeText(pre.textContent ?? ''); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed'; } setTimeout(() => (copy.textContent = 'Copy text'), 1500); };
  pdf.onclick = () => {
    const a = el('a'); a.href = URL.createObjectURL(new Blob([textToPdf(pre.textContent ?? '') as BlobPart], { type: 'application/pdf' }));
    a.download = 'Cover Letter.pdf'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  hover();
  if (opts.resume) void runIt();
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
  b.style.cssText = 'all:initial;cursor:pointer;width:24px;height:24px;border-radius:50%;background:#fff;border:1px solid #b4b4b4;box-shadow:0 2px 6px rgb(0 0 0/.2);display:grid;place-items:center';
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
