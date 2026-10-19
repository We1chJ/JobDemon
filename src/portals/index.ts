// Identify the job portal first, then hand the application to that portal's flow.
// The decision is made once, on the first page, before either flow starts:
//   Workday  -> src/portals/workday.ts (its own step machine)
//   anything else (Greenhouse, Ashby, Lever, Gem, unknown) -> src/agent/loop.ts (the generic flow)
import type { Decider } from '../decider/index.js';
import type { Writer } from '../writer/index.js';
import { runGeneric } from '../agent/loop.js';
import { recipeForUrl, startAddress } from '../sites/index.js';
import { Session, type App } from '../agent/session.js';
import { isWorkdayPage, isWorkdayUrl, runWorkday } from './workday.js';

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

/** Portal name for display. */
export const portalName = (url: string) => (isWorkdayUrl(url) ? 'Workday' : recipeForUrl(url)?.name ?? null);
