// Shared basics for every portal flow: the application's tabs, trace screenshots, hand-over,
// waiting for you at sign-in pages, and the end-of-run summary. Portal flows (generic, Workday)
// decide WHAT to do; this decides how a run starts, pauses and ends.
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Page } from 'playwright';
import { config } from '../config.js';
import { db, schema, logStep, updateApp } from '../db/index.js';
import { loadProfile } from '../profile.js';
import type { JobCtx } from '../content.js';
import { cleanLabel, isFileInput, isFillable, type ElementInfo } from '../types.js';
import { observe, readJob, detectBlocker } from './observe.js';
import { AppTabs, keepForm, lendTabs } from './browser.js';
import { buildContext } from '../qa/context.js';

export type App = typeof schema.application.$inferSelect;

/** Visible error messages on the page (e.g. Workday's "Errors Found" banner), to report why a step didn't advance. */
export async function pageErrors(page: Page): Promise<string[]> {
  const texts = await page.locator('[role=alert]:visible, [data-automation-id*="error" i]:visible, [class*="error" i]:visible').allInnerTexts().catch(() => []);
  return [...new Set(texts.map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 200))].slice(0, 3);
}

export class Session {
  page!: Page;
  keep = false;
  resumed = false; // carrying on in a tab you already had open ("Continue from here")
  step: number;
  readonly traceDir: string;
  private constructor(readonly app: App, readonly tabs: AppTabs) {
    this.step = app.step;
    this.traceDir = path.join(config.tracesDir, String(app.id));
    fs.mkdirSync(this.traceDir, { recursive: true });
  }

  /** Carry on in an application's open tab, from whatever page it shows. */
  static resume(app: App, tabs: AppTabs) {
    const s = new Session(app, tabs);
    s.page = tabs.pages().pop()!;
    s.resumed = true;
    updateApp(app.id, { status: 'in_progress', reason: null });
    return s;
  }

  static async start(app: App) {
    const s = new Session(app, await AppTabs.create());
    s.page = await s.tabs.newPage();
    updateApp(app.id, { status: 'in_progress' });
    return s;
  }

  log(op: string, target?: string, detail?: string, screenshot?: string) {
    logStep(this.app.id, this.step, op, target, detail, screenshot);
    updateApp(this.app.id, { step: this.step });
  }

  async shot(label: string) {
    const file = path.join(this.traceDir, `${String(this.step).padStart(3, '0')}-${label}.png`);
    await this.page.screenshot({ path: file }).catch(() => {});
    return path.relative(config.dataDir, file);
  }

  /** "Needs you": leave the (half-)filled form open so you can finish it. */
  async toReview(reason: string, confidence?: number) {
    const s = await this.shot('human-review');
    this.log('ESCALATE', undefined, reason, s);
    updateApp(this.app.id, { status: 'human_review', reason, confidence: confidence ?? null, step: this.step });
    if (this.page.url() !== 'about:blank') { this.keep = true; await keepForm(this.app.id, this.tabs); }
  }

  /** "Filled in": hand the form over for you to review and submit. */
  async handOver(reason: string) {
    updateApp(this.app.id, { status: 'ready_to_submit', reason, step: this.step });
    this.keep = true;
    await keepForm(this.app.id, this.tabs);
  }

  /**
   * Sign-in, create-account or verify-email page: hand the tab to you and wait. Once the page is no
   * longer asking you to sign in, the bot takes over again. Returns false if you didn't get past it in time.
   */
  async waitForSignIn(why: string) {
    const startUrl = this.page.url();
    this.log('WAIT_FOR_YOU', undefined, `${why}. Waiting for you to sign in.`, await this.shot('sign-in'));
    updateApp(this.app.id, { status: 'waiting_for_you', reason: `${why}: sign in or create your account in the browser window. The bot carries on by itself once you're in.`, step: this.step });
    await lendTabs(this.app.id, this.tabs); // submit block lifted so your sign-in goes through
    const deadline = Date.now() + config.signInWaitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const fresh = this.tabs.pages().pop();
      if (!fresh) return false; // you closed the tab
      this.page = fresh;
      const still = await detectBlocker(this.page).catch(() => null);
      const signInScreen = !!still && /login|verification/i.test(still);
      const moved = this.page.url() !== startUrl;
      // Through: no sign-in / verification screen any more, and either the address changed or real form fields appeared.
      if (!signInScreen && (moved || (await observe(this.page, new Set()).catch(() => [])).some((e) => isFillable(e) && e.type !== 'password' && e.type !== 'email'))) {
        await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        this.tabs.guard();
        updateApp(this.app.id, { status: 'in_progress', reason: null });
        this.log('NOTE', undefined, 'You\'re signed in. The bot is taking over again.');
        return true;
      }
    }
    this.tabs.guard();
    return false;
  }

  signInTimeout(what: string) {
    return this.toReview(`${what}, and the bot stopped waiting after ${Math.round(config.signInWaitMs / 60000)} minutes. Sign in, then click Fill again.`);
  }

  /** End of a run: the form is always handed to you, filled as far as the bot could get. */
  async finish(o: { handled: number; needs: string[]; notes: string[]; elements?: ElementInfo[]; stoppedAt?: ElementInfo }) {
    if (o.handled === 0 && !this.resumed) {
      return this.toReview(`Couldn't find the application form on this page${o.notes.length ? ` (${o.notes.join('; ')})` : ''}. Open it in the browser: it may need a click the bot didn't recognise, or a sign-in.`);
    }
    const s = await this.shot('filled');
    if (o.stoppedAt) this.log('FILLED', o.stoppedAt.label, `Stopped at "${o.stoppedAt.label}". The bot never submits.`, s);
    const issues = [
      ...o.notes,
      ...(o.needs.length ? [`It needs your answer for: ${o.needs.slice(0, 4).map((n) => `"${n}"`).join(', ')}${o.needs.length > 4 ? ` and ${o.needs.length - 4} more` : ''}`] : []),
    ];
    if (issues.length) return this.toReview(`Filled what it could. ${issues.join('. ')}. Finish it in the browser.`);
    const empty = (o.elements ?? []).filter((e) => e.required && !e.value && (isFillable(e) || isFileInput(e))).map((e) => `"${cleanLabel(e.label)}"`);
    return this.handOver(empty.length
      ? `Filled in, but ${empty.length} required field${empty.length === 1 ? ' is' : 's are'} still empty: ${empty.slice(0, 3).join(', ')}. Fix ${empty.length === 1 ? 'it' : 'them'} in the browser, then submit.`
      : 'Filled in. Review it in the browser window and click Submit yourself.');
  }

  async close() { if (!this.keep) await this.tabs.close(); }
}

/** Read the posting, record company/role, and skip duplicates. Returns null when it's a duplicate. */
export async function prepareJob(s: Session) {
  const { profile, version, bank } = loadProfile();
  const read = await readJob(s.page);
  // Carrying on mid-application: the company and role read at the start are better than this page's.
  const info = s.resumed && s.app.company ? { ...read, company: s.app.company, role: s.app.role ?? read.role } : read;
  const applicant = profile.fields.email ?? '';
  updateApp(s.app.id, { company: info.company, role: info.role, applicant });
  if (s.resumed) {
    const job: JobCtx = { appId: s.app.id, url: s.app.url, company: info.company, role: info.role, jd: info.jd };
    return { info, job, ctx: buildContext(profile, version, bank, job) };
  }
  const dup = db.select().from(schema.application).where(and(
    eq(schema.application.company, info.company), eq(schema.application.role, info.role),
    eq(schema.application.applicant, applicant), ne(schema.application.id, s.app.id),
    inArray(schema.application.status, ['applied', 'in_progress', 'ready_to_submit', 'waiting_for_you']),
  )).get();
  if (dup) {
    s.log('DUPLICATE', undefined, `Same company/role as application #${dup.id}`);
    updateApp(s.app.id, { status: 'duplicate', reason: `Duplicate of #${dup.id}` });
    return null;
  }
  const job: JobCtx = { appId: s.app.id, url: s.app.url, company: info.company, role: info.role, jd: info.jd };
  return { info, job, ctx: buildContext(profile, version, bank, job) };
}
