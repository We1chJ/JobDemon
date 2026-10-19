// Identify the job portal first, then hand the application to that portal's flow.
// The decision is made once, on the first page, before either flow starts:
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
  // By address, or a company careers site that is Workday underneath.
  if (await isWorkdayPage(s.page)) return runWorkday(s, decider, writer);
  return runGeneric(s, decider, writer, startAt);
}

/** "Continue from here": carry on in the application's open tab from the page it shows, until Submit. */
export async function continueApplication(app: App, decider: Decider, writer: Writer) {
  const tabs = takeBackForm(app.id);
  if (!tabs) return false;
  const s = Session.resume(app, tabs);
  s.log('NOTE', undefined, `Continuing from the page the tab is on: ${s.page.url()}`);
  if (await isWorkdayPage(s.page)) await runWorkday(s, decider, writer);
  else await runGeneric(s, decider, writer, s.page.url());
  return true;
}

/** Portal name for display. */
export const portalName = (url: string) => (isWorkdayUrl(url) ? 'Workday' : recipeForUrl(url)?.name ?? null);
