import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Browser } from 'playwright';
import { config } from '../config.js';
import { db, schema, logStep, updateApp, now } from '../db/index.js';
import { loadProfile } from '../profile.js';
import { LowQualityError, type JobCtx } from '../content.js';
import type { Decider } from '../decider/index.js';
import type { Writer } from '../writer/index.js';
import { describe, isFileInput, isFillable } from '../types.js';
import { observe, readJob, detectBlocker } from './observe.js';
import { fillField } from './fill.js';
import * as exec from './executor.js';

type App = typeof schema.application.$inferSelect;
const MIN_ACTION_CONFIDENCE = 0.3;
const MAX_SUBMIT_ATTEMPTS = 2;

export async function runApplication(browser: Browser, app: App, decider: Decider, writer: Writer) {
  const live = config.live || app.live;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
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
  };

  try {
    // Crash safety: if a previous run clicked submit but never verified, NEVER click again.
    if (app.submitClickedAt) {
      return await toReview(`Submit was clicked at ${app.submitClickedAt} but never verified. Check the company's side before retrying.`);
    }
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
    let submitAttempts = 0;
    const goal = `Complete and submit the job application for "${info.role}" at ${info.company}.`;

    while (step < config.maxSteps) {
      step++;
      const blocker = await detectBlocker(page);
      if (blocker) return await toReview(blocker);

      const elements = await observe(page, handled);
      const action = await decider.nextAction({ goal, url: page.url(), elements, recent });
      const el = action.target === null ? undefined : elements.find((e) => e.idx === action.target);
      const summary = `${action.op}${el ? ` ${describe(el)}` : ''}`;
      recent.push(summary);
      updateApp(app.id, { step });

      if (action.confidence < MIN_ACTION_CONFIDENCE) return await toReview(`Low-confidence decision (${action.confidence.toFixed(2)}): ${summary}`, action.confidence);
      if (recent.length >= 3 && recent.slice(-3).every((r) => r === summary)) return await toReview(`Stuck repeating: ${summary}`);

      switch (action.op) {
        case 'BLOCKED':
          return await toReview('Decider reported BLOCKED');
        case 'WAIT':
          logStep(app.id, step, 'WAIT');
          await page.waitForTimeout(1500);
          continue;
        case 'SCROLL':
          logStep(app.id, step, 'SCROLL');
          await page.mouse.wheel(0, 800);
          continue;
        case 'DONE': {
          // Only a verified submit WE made counts as applied.
          if (!submitAttempts) return await toReview('Decider said DONE but the bot never clicked submit');
          const check = await decider.submissionCheck(await page.innerText('body'), page.url());
          return await finishSubmit(check.submitted);
        }
      }

      if (!el) return await toReview(`${action.op} with no valid target`);

      // Route by what the element IS, not by the op name: buttons/links get clicked, fields get filled.
      if (!isFillable(el) && !isFileInput(el)) {
        const p = await decider.isSubmitControl(el, elements);
        if (p >= 0.5) {
          if (!live) {
            const s = await shot('ready-to-submit');
            logStep(app.id, step, 'DRY_RUN_STOP', el.label, 'Form filled; stopped before final submit', s);
            return updateApp(app.id, { status: 'ready_to_submit', reason: 'Dry run: approve in the review UI to submit', step });
          }
          if (++submitAttempts > MAX_SUBMIT_ATTEMPTS) return await toReview('Submit failed twice with validation errors');
          // Write the guard BEFORE clicking so a crash can never cause a second submit.
          updateApp(app.id, { submitClickedAt: now() });
          logStep(app.id, step, 'SUBMIT', el.label, undefined, await shot('before-submit'));
          const navigated = page.waitForEvent('framenavigated', { timeout: 8000 }).catch(() => null);
          await exec.click(page, el);
          await navigated;
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          // Native HTML validation blocks the submit without any visible page text.
          const invalid = await page.locator('input:invalid, select:invalid, textarea:invalid').count();
          const check = await decider.submissionCheck(await page.innerText('body'), page.url());
          logStep(app.id, step, 'VERIFY', undefined, `submitted=${check.submitted.toFixed(2)} errors=${check.validationErrors.toFixed(2)} invalidFields=${invalid}`, await shot('after-submit'));
          if (check.submitted >= config.submitConfirmThreshold) return await finishSubmit(check.submitted);
          if (check.validationErrors >= 0.7 || invalid > 0) {
            // Form rejected the submit: nothing was sent, so it is safe to fix and retry.
            updateApp(app.id, { submitClickedAt: null });
            handled.clear();
            continue;
          }
          return await toReview(`Could not confirm submission (confidence ${check.submitted.toFixed(2)})`, check.submitted);
        }
        await exec.click(page, el);
        logStep(app.id, step, 'CLICK', el.label, undefined, await shot('click'));
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        continue;
      }

      // A field: work out the value, then fill.
      const r = await fillField(el, deps);
      handled.add(el.key);
      logStep(app.id, step, `${action.op}:${r.status}`, el.label, r.detail, await shot('fill'));
      if (r.status === 'escalate') return await toReview(r.detail);
    }
    return await toReview(`Hit the ${config.maxSteps}-step limit`);
  } catch (err) {
    if (err instanceof LowQualityError || err instanceof exec.StaleTargetError) return await toReview(err.message);
    await toReview(`Error: ${(err as Error).message.split('\n')[0]}`);
  } finally {
    await ctx.close();
  }

  async function finishSubmit(confidence: number) {
    if (confidence >= config.submitConfirmThreshold) {
      logStep(app.id, step, 'APPLIED', undefined, `confidence ${confidence.toFixed(2)}`, await shot('applied'));
      return updateApp(app.id, { status: 'applied', confidence, reason: null, step });
    }
    return toReview(`Could not confirm submission (confidence ${confidence.toFixed(2)})`, confidence);
  }
}
