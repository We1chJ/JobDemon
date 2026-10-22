// The generic flow: Greenhouse, Ashby, Lever, Gem and any unrecognised site.
// Jev picks fields and buttons; fixed code rules keep it safe. Workday has its own flow (src/portals/workday.ts).
import type { Page } from 'playwright';
import { config } from '../config.js';
import { LowQualityError } from '../content.js';
import type { Decider } from '../decider/index.js';
import type { Writer } from '../writer/index.js';
import { cleanLabel, describe, isFileInput, isFillable, type ElementInfo } from '../types.js';
import { observe, detectBlocker, findEmbeddedForm } from './observe.js';
import { recipeForPage } from '../sites/index.js';
import { fillField } from './fill.js';
import { makeBrain } from '../qa/brain.js';
import * as exec from './executor.js';
import { Session, pageErrors, prepareJob } from './session.js';

// Most clicks the bot makes to reach and move through an application (Apply, Application tab, Next...).
const MAX_NAV_CLICKS = 25;
// Buttons the bot must never click. It stops at them and leaves the form for you to submit.
const FINAL_WORDS = /submit|send|apply|finish|complete|confirm/i;
// Buttons that send you to another account (autofill from a profile, apply with LinkedIn...): never the way into the form.
const ELSEWHERE = /autofill|auto-fill|apply with|sign (in|up) with|log ?in with|continue with|import (from|my)|quick apply|use my (profile|resume)/i;
// Judged on the button's own text only (its label also carries nearby text, e.g. the other buttons in a pop-up).
const goesElsewhere = (e: ElementInfo) => ELSEWHERE.test(e.label.split(' / ')[0]);

function isFinalButton(el: ElementInfo, jevSaysSubmit: number) {
  if (jevSaysSubmit >= 0.3 || FINAL_WORDS.test(el.label)) return true;
  // A plain submit button counts as final unless it clearly just moves to the next page.
  return el.type === 'submit' && !/next|continue/i.test(el.label);
}

/**
 * Fills one application and stops at the final button. Never submits.
 * The form (filled, or partly filled if the bot needed help) is left open for you to review and submit.
 */
export async function runGeneric(s: Session, decider: Decider, writer: Writer, startAt: string, isWorkdayPage: (p: Page) => Promise<boolean>): Promise<'workday' | void> {
  const app = s.app;
  let handedOver = false;
  const opened: Page[] = [];
  s.tabs.onTab((p) => opened.push(p)); // links that open the application in a new tab

  try {
    const portal = await recipeForPage(s.page);
    s.log('NOTE', undefined, `${portal ? `Portal: ${portal.name}` : 'Portal not recognised: using the generic bot'}${startAt !== app.url ? ` (opened ${startAt})` : ''}`);

    const prepared = await prepareJob(s);
    if (!prepared) return;
    const { info, ctx } = prepared;
    ctx.portal = portal?.name;
    const fillDeps = { ctx, brain: makeBrain(decider, writer) };
    // Fields the bot has dealt with, per page address: a sign-in page's "email" box is not the form's "email" box.
    const handledByPage = new Map<string, Set<string>>();
    const handledHere = () => {
      const key = (() => { try { const u = new URL(s.page.url()); return u.origin + u.pathname; } catch { return s.page.url(); } })();
      if (!handledByPage.has(key)) handledByPage.set(key, new Set());
      return handledByPage.get(key)!;
    };
    const handledTotal = () => [...handledByPage.values()].reduce((n, set) => n + set.size, 0);
    const recent: string[] = [];
    const needs: string[] = []; // fields the bot couldn't answer; it keeps going and reports them at the end
    const notes: string[] = []; // page-level problems (CAPTCHA, login), reported at the end
    const answers = new Map<string, string>(); // what the bot put in each field, by element key
    const goal = `Fill in every field of the job application for "${info.role}" at ${info.company}. When every field is done, pick the final submit button: the bot stops there and the applicant submits it themselves.`;
    const finish = (stoppedAt?: ElementInfo, elements: ElementInfo[] = []) => s.finish({ handled: handledTotal(), needs, notes, elements, stoppedAt });

    let elements: ElementInfo[] = [];
    const visited = new Set<string>(); // navigation already tried, so the bot never loops between tabs
    const nextClickedOn = new Set<string>(); // steps where the bot clicked Next
    let navClicks = 0;
    while (s.step < config.maxSteps) {
      s.step++;
      // A click opened the application in a new tab: carry on there.
      const fresh = opened.splice(0).filter((p) => !p.isClosed()).pop();
      if (fresh) {
        s.page = fresh;
        await s.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        await s.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        s.log('NOTE', undefined, `Followed the application into a new tab: ${s.page.url()}`);
      }
      // A careers site handed the application on to Workday: the Workday flow takes over in this tab.
      if (await isWorkdayPage(s.page)) {
        s.log('NOTE', undefined, `Workday page: the Workday flow takes over (${s.page.url()})`);
        handedOver = true;
        return 'workday';
      }
      const blocker = await detectBlocker(s.page);
      // Sign-in / create-account / verify-email: wait for you, then carry on.
      if (blocker && /login|verification/i.test(blocker)) {
        if (await s.waitForSignIn(blocker)) continue;
        return await s.signInTimeout(blocker);
      }
      // A visible CAPTCHA doesn't stop the run: fill what's there and report it at the end.
      if (blocker && !notes.includes(blocker)) { notes.push(blocker); s.log('NOTE', undefined, `${blocker}. Carrying on with the rest of the form.`); }

      elements = await observe(s.page, handledHere());
      const pending = elements.filter((e) => !e.handled && (isFillable(e) || isFileInput(e)));

      if (pending.length) {
        let action: Awaited<ReturnType<Decider['nextAction']>> = { op: 'TYPE_TEXT', target: null, confidence: 0 };
        try { action = await decider.nextAction({ goal, url: s.page.url(), elements, recent }); }
        catch (e) { s.log('NOTE', undefined, `Decider error, using the next empty field: ${(e as Error).message.split('\n')[0]}`); }
        let el = action.target === null ? undefined : elements.find((e) => e.idx === action.target);
        // While any field is still empty, the next action is always filling one. Whatever the decider
        // said (low confidence, scroll, wait, done, blocked, a button), take a pending field instead.
        if (!el || el.handled || !(isFillable(el) || isFileInput(el))) el = pending[0];
        recent.push(`${action.op} ${describe(el)}`);
        if (recent.length >= 3 && recent.slice(-3).every((r) => r === recent[recent.length - 1])) {
          // Same field three times in a row: set it aside and move on.
          handledHere().add(el.key);
          needs.push(cleanLabel(el.label));
          s.log('SKIP', el.label, 'Kept coming back to this field; left it for you');
          continue;
        }
        // The nearest field above this one, for follow-ups like "If so, please explain".
        const above = elements.slice(0, elements.indexOf(el)).reverse().find((e) => isFillable(e));
        handledHere().add(el.key);
        try {
          const r = await fillField(el, { ...fillDeps, page: s.page, previous: above ? { prompt: cleanLabel(above.label), answer: answers.get(above.key) ?? above.value } : undefined });
          if (r.status === 'filled' && r.value) answers.set(el.key, r.value);
          s.log(`${action.op}:${r.status}`, el.label, r.detail, await s.shot('fill'));
          if (r.status === 'escalate') needs.push(cleanLabel(el.label));
        } catch (err) {
          // One broken field never stops the rest of the form.
          await exec.closeCombobox(s.page);
          const why = err instanceof LowQualityError ? err.message : (err as Error).message.split('\n')[0];
          s.log('TYPE_TEXT:error', el.label, why, await s.shot('error'));
          if (el.required) needs.push(cleanLabel(el.label));
        }
        continue;
      }

      // No empty fields on this page. Work out where we are and what (if anything) moves the application forward.
      const fieldsHere = elements.filter((e) => isFillable(e) || isFileInput(e));
      // Filled = handled this run, or already answered (by an earlier run or by you: "Continue from here" on a filled form).
      const filledHere = fieldsHere.filter((e) => handledHere().has(e.key) || !!e.value).length;
      const filledAny = handledTotal() > 0 || filledHere > 0;
      if (!fieldsHere.length) {
        // Company career pages often embed the real form (e.g. Greenhouse) in an iframe: open it directly.
        const embedded = await findEmbeddedForm(s.page);
        if (embedded && !visited.has(embedded)) {
          visited.add(embedded);
          s.log('OPEN', undefined, `Opening the embedded application form: ${embedded}`);
          await s.page.goto(embedded, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await s.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
          continue;
        }
      }
      // Which step we're on: the address plus the fields showing (some forms keep one address for every step).
      const stepId = `${s.page.url()}#${fieldsHere.map((e) => cleanLabel(e.label)).sort().join(',')}`;
      // Clicked Next on this exact step already and we're still on it: the site refused to move on.
      if (nextClickedOn.has(stepId)) {
        const errors = await pageErrors(s.page);
        notes.push(`The page didn't move on to the next step${errors.length ? `. It says: ${errors.join(' / ')}` : ''}`);
        return await finish(undefined, elements);
      }
      const here = await recipeForPage(s.page);
      let nav: Awaited<ReturnType<Decider['navigate']>> = { stage: 'done', target: null, confidence: 0 };
      try {
        const tried = [...visited].filter((k) => k.startsWith(`${stepId}|`)).map((k) => k.slice(stepId.length + 1));
        const ways = elements.filter((e) => !goesElsewhere(e));
        nav = await decider.navigate({ url: s.page.url(), elements: ways, filledHere, filledTotal: Math.max(handledTotal(), filledHere), pageText: await s.page.innerText('body').catch(() => ''), tried, notes: here?.jevNotes });
      } catch (e) {
        s.log('NOTE', undefined, `Decider error while choosing where to go next: ${(e as Error).message.split('\n')[0]}`);
      }
      const target = nav.target === null ? undefined : elements.find((e) => e.idx === nav.target && !isFillable(e) && !isFileInput(e) && !goesElsewhere(e));
      s.log('PAGE', target?.label, `Page looks like: ${nav.stage}`);
      if (nav.stage === 'account') {
        if (await s.waitForSignIn('This site wants you to sign in or create an account')) continue;
        return await s.signInTimeout('This site wants you to sign in');
      }
      if (!target || nav.stage === 'done' || nav.stage === 'final') return await finish(nav.stage === 'final' ? target : undefined, elements);

      // Before anything is filled, clicking into the application ("Apply", an "Application" tab) is safe.
      // After that, a button that looks like submitting is where the bot stops: only real "Next" steps are clicked.
      // (A page with no fields after filling could be a review page, so it gets the same check.)
      if (filledAny) {
        const isFinal = await decider.isSubmitControl(target, elements).then((p) => isFinalButton(target, p)).catch(() => true);
        if (isFinal || nav.stage !== 'form_step') return await finish(target, elements);
      }
      const navKey = `${stepId}|${target.label}`;
      if (visited.has(navKey)) {
        const errors = await pageErrors(s.page);
        notes.push(`"${cleanLabel(target.label)}" didn't move to the next step${errors.length ? `. The page says: ${errors.join(' / ')}` : ''}`);
        return await finish(undefined, elements);
      }
      if (++navClicks > MAX_NAV_CLICKS) {
        notes.push(`Stopped moving between pages after ${MAX_NAV_CLICKS} clicks to avoid going in circles`);
        return await finish(undefined, elements);
      }
      visited.add(navKey);
      if (filledAny) nextClickedOn.add(stepId);
      try {
        const newTab = s.tabs.waitForTab(3000); // links with target=_blank
        await exec.click(s.page, target);
        await newTab;
        await s.page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
        await s.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        s.log(handledTotal() ? 'NEXT' : 'OPEN', target.label, handledTotal() ? 'Next step of the application' : 'Opening the application', await s.shot('navigate'));
      } catch {
        notes.push(`Couldn't click "${cleanLabel(target.label)}"`);
        return await finish(undefined, elements);
      }
    }
    notes.push(`Stopped after ${config.maxSteps} steps`);
    return await finish(undefined, elements);
  } catch (err) {
    // Only reached if the page itself fails (won't load, browser closed).
    await s.toReview(`Error: ${(err as Error).message.split('\n')[0]}`);
  } finally {
    if (!handedOver) await s.close();
  }
}
