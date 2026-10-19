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
  await tabs.pages().pop()?.bringToFront().catch(() => {});
}

/** Hand a form over to the applicant: the bot stops touching it and the submit guard is lifted. */
export async function keepForm(appId: number, tabs: AppTabs) {
  tabs.unguard();
  const page = tabs.pages().pop(); // the tab the bot ended on
  if (page) await showLetterPanel(page, appId);
  if (openForms.get(appId) !== tabs) await openForms.get(appId)?.close();
  openForms.set(appId, tabs);
}

export const letterPath = (appId: number) => path.join(config.lettersDir, `${appId}-cover-letter.txt`);

/**
 * Corner panel in the application tab showing the cover letter the bot generated, so you can check it
 * (especially when it went in as an uploaded file). Lives in a shadow root outside the form; adds no inputs.
 */
async function showLetterPanel(page: Page, appId: number) {
  const file = letterPath(appId);
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  // Built from a string so the bundler can't inject helpers that don't exist in the page.
  await page.evaluate(`(() => {
    const text = ${JSON.stringify(text)};
    document.getElementById('jobdemon-letter')?.remove();
    const host = document.createElement('div');
    host.id = 'jobdemon-letter';
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = \`<style>
      .p{width:min(440px,calc(100vw - 32px));background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 10px 30px rgb(15 23 42/.25);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;overflow:hidden}
      .h{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#1e3a5f;color:#fff}
      .h b{flex:1;font-size:14px}
      button{font-family:inherit;font-size:13px;font-weight:600;border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:8px;padding:6px 10px;cursor:pointer;min-height:32px}
      .h button{background:transparent;color:#fff;border-color:rgb(255 255 255/.4)}
      pre{margin:0;padding:12px 14px;white-space:pre-wrap;max-height:55vh;overflow:auto;font-family:inherit;font-size:14px;line-height:1.6}
      .f{display:flex;gap:8px;justify-content:flex-end;padding:8px 12px;border-top:1px solid #e2e8f0}
      .min pre,.min .f{display:none}
    </style>
    <div class="p" role="complementary" aria-label="Cover letter from JobDemon">
      <div class="h"><b>Cover letter (JobDemon)</b><button class="t" aria-expanded="true">Hide</button><button class="x" aria-label="Close panel">\u2715</button></div>
      <pre></pre>
      <div class="f"><button class="c">Copy text</button></div>
    </div>\`;
    root.querySelector('pre').textContent = text;
    const p = root.querySelector('.p'), t = root.querySelector('.t');
    t.onclick = () => { const min = p.classList.toggle('min'); t.textContent = min ? 'Show' : 'Hide'; t.setAttribute('aria-expanded', String(!min)); };
    root.querySelector('.x').onclick = () => host.remove();
    root.querySelector('.c').onclick = async (e) => { try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Copy failed'; } };
    document.body.appendChild(host);
  })()`).catch(() => {});
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
