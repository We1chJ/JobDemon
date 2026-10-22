// One shared browser that remembers sign-ins between runs (its profile lives in data/browser-profile).
// Filled-in application forms stay open in it so you can review and submit them yourself.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { config } from '../config.js';

let context: BrowserContext | null = null;
const openForms = new Map<number, AppTabs>(); // application id -> its tabs
const guarded = new Set<Page>(); // tabs the bot is working in: form submissions are refused there

async function getContext() {
  if (context) return context;
  const dir = path.join(config.dataDir, 'browser-profile');
  fs.mkdirSync(dir, { recursive: true });
  context = await chromium.launchPersistentContext(dir, { headless: config.headless, viewport: { width: 1280, height: 900 } });
  // Hard backstop against submitting: in a tab the bot is working in, every form-submission page load
  // (any non-GET navigation) is refused, so even a mistaken click cannot send an application.
  await context.route('**/*', async (route) => {
    const req = route.request();
    if (req.isNavigationRequest() && req.method() !== 'GET') {
      const pg = req.frame().page();
      const opener = await pg.opener().catch(() => null);
      if (guarded.has(pg) || (opener && guarded.has(opener))) return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  await context.exposeBinding('__jobdemon', async (source, action: unknown) => {
    if (source.frame !== source.page.mainFrame() || !panelHandler) return null;
    const appId = [...openForms].find(([, tabs]) => tabs.pages().includes(source.page))?.[0];
    return appId === undefined ? null : panelHandler(appId, String(action));
  });
  await context.addInitScript(PANEL_JS);
  for (const p of context.pages()) await p.close().catch(() => {}); // the empty start-up tab
  context.on('close', () => { context = null; openForms.clear(); guarded.clear(); });
  return context;
}

/** The tabs belonging to one application (its own tab plus any it opened). */
export class AppTabs {
  private tabs: Page[] = [];
  private listeners: ((p: Page) => void)[] = [];
  private constructor(private ctx: BrowserContext) {}
  static async create() { return new AppTabs(await getContext()); }

  private track(p: Page) {
    this.tabs.push(p);
    guarded.add(p);
    p.on('popup', (child) => { this.track(child); this.listeners.forEach((l) => l(child)); });
    p.on('close', () => guarded.delete(p));
  }
  async newPage() { const p = await this.ctx.newPage(); this.track(p); return p; }
  /** A link opened a new tab. */
  onTab(cb: (p: Page) => void) { this.listeners.push(cb); }
  waitForTab(timeout: number) {
    return new Promise<Page | null>((resolve) => {
      const t = setTimeout(() => resolve(null), timeout);
      this.listeners.push((p) => { clearTimeout(t); resolve(p); });
    });
  }
  pages() { return this.tabs.filter((p) => !p.isClosed()); }
  /** Let the person use these tabs normally (sign in, submit). */
  unguard() { this.tabs.forEach((p) => guarded.delete(p)); }
  /** The bot is working again: refuse form submissions. */
  guard() { this.pages().forEach((p) => guarded.add(p)); }
  async close() { for (const p of this.pages()) await p.close().catch(() => {}); }
}

/** Show the tab to the person (e.g. while they sign in) without handing the form over yet. */
export async function lendTabs(appId: number, tabs: AppTabs) {
  if (openForms.get(appId) !== tabs) await openForms.get(appId)?.close();
  openForms.set(appId, tabs);
  tabs.unguard();
  const page = tabs.pages().pop();
  if (page) { await showPanel(page); await page.bringToFront().catch(() => {}); }
}

/** Hand a form over to the applicant: the bot stops touching it and the submit guard is lifted. */
export async function keepForm(appId: number, tabs: AppTabs) {
  tabs.unguard();
  const page = tabs.pages().pop(); // the tab the bot ended on
  if (page) await showPanel(page);
  if (openForms.get(appId) !== tabs) await openForms.get(appId)?.close();
  openForms.set(appId, tabs);
}

export const letterPath = (appId: number) => path.join(config.lettersDir, `${appId}-cover-letter.txt`);

// ── The JobDemon widget ─────────────────────────────────────────────────────
// A small panel drawn in every tab the bot hands to you: status, what to do next, "Continue from here",
// "Mark submitted", and the cover letter. Clicks go to the bot through a page binding. The bot only answers
// tabs it has handed to you, only from the page itself (not from frames inside it), and only for those actions.
type PanelHandler = (appId: number, action: string) => Promise<unknown>;
let panelHandler: PanelHandler | null = null;
export const setPanelHandler = (h: PanelHandler) => { panelHandler = h; };

// Runs in the page. Kept as a plain string so the bundler can't inject helpers that don't exist there.
const PANEL_JS = String.raw`(() => {
  if (window.top !== window || window.__jobdemonPanel) return;
  window.__jobdemonPanel = true;
  const ask = (action) => (typeof window.__jobdemon === 'function' ? window.__jobdemon(action) : Promise.resolve(null)).catch(() => null);
  let host = null, ui = null, timer = null;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const css = '.p{width:min(380px,calc(100vw - 32px));background:#fff;color:#1a1a1a;border:1px solid #b4b4b4;border-radius:6px;box-shadow:0 6px 24px rgb(0 0 0/.18);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}'
    + '.h{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#1a1a1a;color:#fff;cursor:move;user-select:none;touch-action:none}.h b{font-size:13px}.h .s{flex:1;font-size:12px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.h button{background:transparent;color:#fff;border:1px solid rgb(255 255 255/.4);border-radius:4px;font:inherit;font-size:12px;padding:2px 8px;cursor:pointer}'
    + '.b{padding:10px 12px;display:grid;gap:10px}.t{color:#444;font-size:13px}.r{display:flex;gap:8px;flex-wrap:wrap}'
    + '.r button,.c{font:inherit;font-size:13px;font-weight:500;border:1px solid #b4b4b4;background:#fff;color:#1a1a1a;border-radius:4px;padding:6px 10px;cursor:pointer;min-height:32px}'
    + '.r button.pri{background:#1a1a1a;color:#fff;border-color:#1a1a1a}.r button:disabled{opacity:.5;cursor:default}'
    + 'details summary{cursor:pointer;font-size:13px;color:#0b57d0}pre{margin:6px 0;white-space:pre-wrap;max-height:40vh;overflow:auto;font:inherit;font-size:13px;line-height:1.55;border:1px solid #ddd;padding:8px;background:#f6f6f4}'
    + '.min .b{display:none}[hidden]{display:none!important}';
  const build = () => {
    host = document.createElement('div');
    host.id = 'jobdemon-panel';
    // Top right to start; drag the header to move it. Where you leave it is kept for this tab and site.
    host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647';
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('jobdemon-panel-pos') || 'null'); } catch {}
    const place = (x, y) => {
      const w = host.offsetWidth || 380, hgt = host.offsetHeight || 60;
      x = Math.min(Math.max(0, x), window.innerWidth - Math.min(w, window.innerWidth));
      y = Math.min(Math.max(0, y), window.innerHeight - Math.min(hgt, 40));
      host.style.left = x + 'px'; host.style.top = y + 'px'; host.style.right = 'auto';
      return { x, y };
    };
    const root = host.attachShadow({ mode: 'open' });
    root.appendChild(el('style', null, css));
    const p = el('div', 'p'); p.setAttribute('role', 'complementary'); p.setAttribute('aria-label', 'JobDemon');
    const h = el('div', 'h'); const s = el('span', 's'); const min = el('button', null, 'Hide');
    h.append(el('b', null, 'JobDemon'), s, min);
    const b = el('div', 'b'); const todo = el('div', 't'); const row = el('div', 'r');
    const go = el('button', 'pri', 'Continue from here'); const done = el('button', null, 'Mark submitted');
    row.append(go, done);
    const det = el('details'); const pre = el('pre'); const copy = el('button', 'c', 'Copy text');
    det.append(el('summary', null, 'Cover letter'), pre, copy);
    b.append(todo, row, det); p.append(h, b); root.appendChild(p);
    min.onclick = () => { const m = p.classList.toggle('min'); min.textContent = m ? 'Show' : 'Hide'; };
    h.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = host.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      h.setPointerCapture(e.pointerId);
      const move = (ev) => place(ev.clientX - dx, ev.clientY - dy);
      const up = (ev) => {
        h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up);
        const at = place(ev.clientX - dx, ev.clientY - dy);
        try { sessionStorage.setItem('jobdemon-panel-pos', JSON.stringify(at)); } catch {}
      };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
    });
    window.addEventListener('resize', () => { if (host && host.style.left) place(parseFloat(host.style.left), parseFloat(host.style.top)); });
    go.onclick = async () => { go.disabled = true; go.textContent = 'Starting…'; await ask('resume'); remove(); };
    done.onclick = async () => { done.disabled = true; done.textContent = 'Closing…'; await ask('applied'); }; // the bot marks it and closes this tab
    copy.onclick = async () => { try { await navigator.clipboard.writeText(pre.textContent); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed'; } };
    (document.body || document.documentElement).appendChild(host);
    if (saved) place(saved.x, saved.y);
    ui = { s, todo, row, go, done, det, pre };
  };
  const remove = () => { if (host) host.remove(); host = null; ui = null; };
  const render = (st) => {
    if (!st) { remove(); return; }
    if (!host) build();
    ui.s.textContent = st.label + (st.title ? ' · ' + st.title : '');
    ui.todo.textContent = st.working || st.todo || '';
    ui.row.hidden = !st.canAct;
    ui.det.hidden = !st.letter;
    if (ui.pre.textContent !== st.letter) ui.pre.textContent = st.letter || '';
  };
  const tick = async () => { render(await ask('status')); timer = setTimeout(tick, 2500); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick, { once: true }); else tick();
})()`;

/** Draw the widget in a tab now (new pages get it from the context's init script). */
async function showPanel(page: Page) {
  await page.evaluate(PANEL_JS).catch(() => {});
}

/** Close an application's tabs (it's done). */
export async function closeForm(appId: number) {
  const tabs = openForms.get(appId);
  openForms.delete(appId);
  await tabs?.close();
}

/** Take a handed-over form back so the bot can carry on in it. Returns null if it is no longer open. */
export function takeBackForm(appId: number) {
  const tabs = openForms.get(appId);
  if (!tabs || !tabs.pages().length) return null;
  openForms.delete(appId);
  tabs.guard(); // the bot is working in it again: form submissions are refused
  return tabs;
}

export function openFormPage(appId: number) {
  const page = openForms.get(appId)?.pages().pop();
  if (!page) openForms.delete(appId);
  return page ?? null;
}

/** Bring a filled-in form to the front. Returns false if it is no longer open. */
export async function showForm(appId: number) {
  const page = openForms.has(appId) ? openFormPage(appId) : null;
  if (!page) return false;
  await page.bringToFront();
  return true;
}

export const isFormOpen = (appId: number) => !!(openForms.has(appId) && openFormPage(appId));
export const openFormCount = () => openForms.size;

export async function closeBrowser() {
  await context?.close().catch(() => {});
  context = null;
}

export async function waitForBrowserClose() {
  if (!context) return;
  const c = context;
  await new Promise<void>((r) => c.once('close', () => r()));
}
