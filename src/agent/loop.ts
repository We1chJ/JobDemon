import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema, logStep, updateApp } from '../db/index.js';
import { loadProfile } from '../profile.js';
import { LowQualityError, type JobCtx } from '../content.js';
import type { Decider } from '../decider/index.js';
import type { Writer } from '../writer/index.js';
import { cleanLabel, describe, isFileInput, isFillable, type ElementInfo } from '../types.js';
import { observe, readJob, detectBlocker, findEmbeddedForm } from './observe.js';
import type { Page } from 'playwright';
import { fillField } from './fill.js';
import { newApplicationContext, keepForm } from './browser.js';
import * as exec from './executor.js';

type App = typeof schema.application.$inferSelect;
// Most clicks the bot makes to reach and move through an application (Apply, Application tab, Next...).
const MAX_NAV_CLICKS = 10;
// Buttons the bot must never click. It stops at them and leaves the form for you to submit.
const FINAL_WORDS = /submit|send|apply|finish|complete|confirm/i;

function isFinalButton(el: ElementInfo, jevSaysSubmit: number) {
  if (jevSaysSubmit >= 0.3 || FINAL_WORDS.test(el.label)) return true;
  // A plain submit button counts as final unless it clearly just moves to the next page.
  return el.type === 'submit' && !/next|continue/i.test(el.label);
}

/**
 * Fills one application and stops at the final button. Never submits.
 * The form (filled, or partly filled if the bot needed help) is left open for you to review and submit.
 */
export async function runApplication(app: App, decider: Decider, writer: Writer) {
  const ctx = await newApplicationContext();
  let page = await ctx.newPage();
  const opened: Page[] = [];
  ctx.on('page', (p) => opened.push(p)); // links that open the application in a new tab
  let keep = false;
  const traceDir = path.join(config.tracesDir, String(app.id));
  fs.mkdirSync(traceDir, { recursive: true });
  let step = app.step;

  const shot = async (label: string) => {
    const file = path.join(traceDir, `${String(step).padStart(3, '0')}-${label}.png`);
    await page.screenshot({ path: file }).catch(() => {});
    return path.relative(config.dataDir, file);
  };
  const toReview = async (reason: string, confidence?: number) => {
    const s = await shot('human-review');
    logStep(app.id, step, 'ESCALATE', undefined, reason, s);
    updateApp(app.id, { status: 'human_review', reason, confidence: confidence ?? null, step });
    // Leave the half-filled form open so you can finish it (solve the CAPTCHA, fill the missing field).
    if (page.url() !== 'about:blank') { keep = true; await keepForm(app.id, ctx); }
  };

  try {
    updateApp(app.id, { status: 'in_progress' });
    await page.goto(app.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    const { profile, version, bank } = loadProfile();
    const info = await readJob(page);
    const applicant = profile.fields.email ?? '';
    updateApp(app.id, { company: info.company, role: info.role, applicant });

    const dup = db.select().from(schema.application).where(and(
      eq(schema.application.company, info.company), eq(schema.application.role, info.role),
      eq(schema.application.applicant, applicant), ne(schema.application.id, app.id),
      inArray(schema.application.status, ['applied', 'in_progress', 'ready_to_submit']),
    )).get();
    if (dup) {
      logStep(app.id, step, 'DUPLICATE', undefined, `Same company/role as application #${dup.id}`);
      return updateApp(app.id, { status: 'duplicate', reason: `Duplicate of #${dup.id}` });
    }

    const job: JobCtx = { appId: app.id, url: app.url, company: info.company, role: info.role, jd: info.jd };
    const deps = { page, decider, writer, job, profile, profileVersion: version, bank };
    const handled = new Set<string>();
    const recent: string[] = [];
    const needs: string[] = []; // fields the bot couldn't answer; it keeps going and reports them at the end
    const notes: string[] = []; // page-level problems (CAPTCHA, login), reported at the end
    const answers = new Map<string, string>(); // what the bot put in each field, by element key
    const goal = `Fill in every field of the job application for "${info.role}" at ${info.company}. When every field is done, pick the final submit button: the bot stops there and the applicant submits it themselves.`;

    /** End of the run: the form is always handed to you, filled as far as the bot could get. */
    const finish = async (stoppedAt?: ElementInfo, elements: ElementInfo[] = []) => {
      if (handled.size === 0) {
        return toReview(`Couldn't find the application form on this page${notes.length ? ` (${notes.join('; ')})` : ''}. Open it in the browser: it may need a click the bot didn't recognise, or a sign-in.`);
      }
      const s = await shot('filled');
      if (stoppedAt) logStep(app.id, step, 'FILLED', stoppedAt.label, `Stopped at "${stoppedAt.label}". The bot never submits.`, s);
      const issues = [
        ...notes,
        ...(needs.length ? [`It needs your answer for: ${needs.slice(0, 4).map((n) => `"${n}"`).join(', ')}${needs.length > 4 ? ` and ${needs.length - 4} more` : ''}`] : []),
      ];
      if (issues.length) return toReview(`Filled what it could. ${issues.join('. ')}. Finish it in the browser.`);
      const empty = elements.filter((e) => e.required && !e.value && (isFillable(e) || isFileInput(e))).map((e) => `"${cleanLabel(e.label)}"`);
      const reason = empty.length
        ? `Filled in, but ${empty.length} required field${empty.length === 1 ? ' is' : 's are'} still empty: ${empty.slice(0, 3).join(', ')}. Fix ${empty.length === 1 ? 'it' : 'them'} in the browser, then submit.`
        : 'Filled in. Review it in the browser window and click Submit yourself.';
      updateApp(app.id, { status: 'ready_to_submit', reason, step });
      keep = true;
      await keepForm(app.id, ctx);
    };

    let elements: ElementInfo[] = [];
    const visited = new Set<string>(); // navigation already tried, so the bot never loops between tabs
    let navClicks = 0;
    while (step < config.maxSteps) {
      step++;
      updateApp(app.id, { step });
      // A click opened the application in a new tab: carry on there.
      const fresh = opened.splice(0).filter((p) => !p.isClosed()).pop();
      if (fresh) {
        page = fresh;
        deps.page = page;
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        logStep(app.id, step, 'NOTE', undefined, `Followed the application into a new tab: ${page.url()}`);
      }
      // CAPTCHA / login walls don't stop the run: fill what's there and report it at the end.
      const blocker = await detectBlocker(page);
      if (blocker && !notes.includes(blocker)) { notes.push(blocker); logStep(app.id, step, 'NOTE', undefined, `${blocker}. Carrying on with the rest of the form.`); }

      elements = await observe(page, handled);
      const pending = elements.filter((e) => !e.handled && (isFillable(e) || isFileInput(e)));

      if (pending.length) {
        let action: Awaited<ReturnType<Decider['nextAction']>> = { op: 'TYPE_TEXT', target: null, confidence: 0 };
        try { action = await decider.nextAction({ goal, url: page.url(), elements, recent }); }
        catch (e) { logStep(app.id, step, 'NOTE', undefined, `Decider error, using the next empty field: ${(e as Error).message.split('\n')[0]}`); }
        let el = action.target === null ? undefined : elements.find((e) => e.idx === action.target);
        // While any field is still empty, the next action is always filling one. Whatever the decider
        // said (low confidence, scroll, wait, done, blocked, a button), take a pending field instead.
        if (!el || el.handled || !(isFillable(el) || isFileInput(el))) el = pending[0];
        const summary = describe(el);
        recent.push(`${action.op} ${summary}`);
        if (recent.length >= 3 && recent.slice(-3).every((r) => r === recent[recent.length - 1])) {
          // Same field three times in a row: set it aside and move on.
          handled.add(el.key);
          needs.push(cleanLabel(el.label));
          logStep(app.id, step, 'SKIP', el.label, 'Kept coming back to this field; left it for you');
          continue;
        }

        // The nearest field above this one, for follow-ups like "If so, please explain".
        const above = elements.slice(0, elements.indexOf(el)).reverse().find((e) => isFillable(e));
        handled.add(el.key);
        try {
          const r = await fillField(el, { ...deps, previousAnswer: above ? answers.get(above.key) ?? above.value : undefined });
          if (r.status === 'filled' && r.value) answers.set(el.key, r.value);
          logStep(app.id, step, `${action.op}:${r.status}`, el.label, r.detail, await shot('fill'));
          if (r.status === 'escalate') needs.push(cleanLabel(el.label));
        } catch (err) {
          // One broken field never stops the rest of the form.
          await exec.closeCombobox(page);
          const why = err instanceof LowQualityError ? err.message : (err as Error).message.split('\n')[0];
          logStep(app.id, step, 'TYPE_TEXT:error', el.label, why, await shot('error'));
          if (el.required) needs.push(cleanLabel(el.label));
        }
        continue;
      }

      // No empty fields on this page. Work out where we are and what (if anything) moves the application forward.
      const fieldsHere = elements.filter((e) => isFillable(e) || isFileInput(e));
      const filledHere = fieldsHere.filter((e) => handled.has(e.key)).length;
      if (!fieldsHere.length) {
        // Company career pages often embed the real form (e.g. Greenhouse) in an iframe: open it directly.
        const embedded = await findEmbeddedForm(page);
        if (embedded && !visited.has(embedded)) {
          visited.add(embedded);
          logStep(app.id, step, 'OPEN', undefined, `Opening the embedded application form: ${embedded}`);
          await page.goto(embedded, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
          continue;
        }
      }
      let nav: Awaited<ReturnType<Decider['navigate']>> = { stage: 'done', target: null, confidence: 0 };
      try {
        nav = await decider.navigate({ url: page.url(), elements, filledHere, filledTotal: handled.size, pageText: await page.innerText('body').catch(() => '') });
      } catch (e) {
        logStep(app.id, step, 'NOTE', undefined, `Decider error while choosing where to go next: ${(e as Error).message.split('\n')[0]}`);
      }
      const target = nav.target === null ? undefined : elements.find((e) => e.idx === nav.target && !isFillable(e) && !isFileInput(e));
      logStep(app.id, step, 'PAGE', target?.label, `Page looks like: ${nav.stage}`);
      if (nav.stage === 'account') {
        notes.push('This site wants you to sign in or create an account');
        return await finish(undefined, elements);
      }
      if (!target || nav.stage === 'done' || nav.stage === 'final') return await finish(nav.stage === 'final' ? target : undefined, elements);

      // Before anything is filled, clicking into the application ("Apply", an "Application" tab) is safe.
      // After that, a button that looks like submitting is where the bot stops: only real "Next" steps are clicked.
      // (A page with no fields after filling could be a review page, so it gets the same check.)
      if (handled.size > 0) {
        const isFinal = await decider.isSubmitControl(target, elements).then((p) => isFinalButton(target, p)).catch(() => true);
        if (isFinal || nav.stage !== 'form_step') return await finish(target, elements);
      }
      const navKey = `${page.url()}|${target.label}`;
      if (visited.has(navKey) || ++navClicks > MAX_NAV_CLICKS) {
        notes.push(`Stopped moving between pages after ${navClicks} clicks to avoid going in circles`);
        return await finish(undefined, elements);
      }
      visited.add(navKey);
      try {
        const newTab = ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null); // links with target=_blank
        await exec.click(page, target);
        await newTab;
        await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        logStep(app.id, step, handled.size ? 'NEXT' : 'OPEN', target.label, handled.size ? 'Next step of the application' : 'Opening the application', await shot('navigate'));
      } catch (e) {
        notes.push(`Couldn't click "${cleanLabel(target.label)}"`);
        return await finish(undefined, elements);
      }
    }
    notes.push(`Stopped after ${config.maxSteps} steps`);
    return await finish(undefined, elements);
  } catch (err) {
    // Only reached if the page itself fails (won't load, browser closed).
    await toReview(`Error: ${(err as Error).message.split('\n')[0]}`);
  } finally {
    if (!keep) await ctx.close().catch(() => {});
  }
}
