// One shared browser. Filled-in application forms stay open in it so you can review and submit them yourself.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { config } from '../config.js';

let browser: Browser | null = null;
const openForms = new Map<number, BrowserContext>(); // application id -> its filled-in form

export async function getBrowser() {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({ headless: config.headless });
  browser.on('disconnected', () => { browser = null; openForms.clear(); });
  return browser;
}

/**
 * A browser context for one application. Hard backstop against submitting: while the bot works,
 * every form-submission navigation (any non-GET page load) is refused, so even a mistaken click
 * cannot send the form. The guard is lifted when the form is handed to you (keepForm).
 */
export async function newApplicationContext() {
  const ctx = await (await getBrowser()).newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route('**/*', (route) => {
    const req = route.request();
    if (req.isNavigationRequest() && req.method() !== 'GET') return route.abort('blockedbyclient');
    return route.continue();
  });
  return ctx;
}

/** Hand a form over to the applicant: the bot stops touching it and the submit guard is lifted. */
export async function keepForm(appId: number, ctx: BrowserContext) {
  await ctx.unrouteAll({ behavior: 'ignoreErrors' });
  const page = ctx.pages().filter((p) => !p.isClosed()).pop(); // the tab the bot ended on
  if (page) await showLetterPanel(page, appId);
  if (openForms.get(appId) !== ctx) await openForms.get(appId)?.close().catch(() => {});
  openForms.set(appId, ctx);
  ctx.on('close', () => { if (openForms.get(appId) === ctx) openForms.delete(appId); });
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
  const page = openForms.get(appId)?.pages().filter((p) => !p.isClosed()).pop();
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
  await browser?.close().catch(() => {});
  browser = null;
}

export async function waitForBrowserClose() {
  if (!browser) return;
  const b = browser;
  await new Promise<void>((r) => b.once('disconnected', () => r()));
}
