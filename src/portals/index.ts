// Identify the job portal first, then hand the application to that portal's flow.
// The first page decides; if the generic flow later lands on Workday (a careers site handing on), Workday takes over:
//   Workday  -> src/portals/workday/ (its own standalone flow)
//   anything else (Greenhouse, Ashby, Lever, Gem, unknown) -> src/agent/loop.ts (the generic flow)
import type { Decider } from '../decider/index.js';
import type { Writer } from '../writer/index.js';
import { runGeneric } from '../agent/loop.js';
import { recipeForUrl, startAddress } from '../sites/index.js';
import { Session, type App } from '../agent/session.js';
import { takeBackForm } from '../agent/browser.js';
import { isWorkdayPage, isWorkdayUrl, runWorkday } from './workday/index.js';

export async function runApplication(app: App, decider: Decider, writer: Writer) {
  const s = await Session.start(app);
  const startAt = startAddress(app.url); // e.g. Ashby / Lever: straight to the form
  try {
    await s.page.goto(startAt, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await s.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  } catch (err) {
    await s.toReview(`Error: ${(err as Error).message.split('\n')[0]}`);
    return s.close();
  }
  return runOn(s, decider, writer, startAt);
}

/** Workday pages get the Workday flow; everything else the generic flow, which hands over if it reaches Workday. */
async function runOn(s: Session, decider: Decider, writer: Writer, startAt: string) {
  if (await isWorkdayPage(s.page)) return runWorkday(s, decider, writer);
  if ((await runGeneric(s, decider, writer, startAt, isWorkdayPage)) === 'workday') return runWorkday(s, decider, writer);
}

/** "Continue from here": carry on in the application's open tab from the page it shows, until Submit. */
export async function continueApplication(app: App, decider: Decider, writer: Writer) {
  const tabs = takeBackForm(app.id);
  if (!tabs) return false;
  const s = await Session.resume(app, tabs);
  s.log('NOTE', undefined, `Continuing from the page the tab is on: ${s.page.url()}`);
  await runOn(s, decider, writer, s.page.url());
  return true;
}

/** Portal name for display. */
export const portalName = (url: string) => (isWorkdayUrl(url) ? 'Workday' : recipeForUrl(url)?.name ?? null);
