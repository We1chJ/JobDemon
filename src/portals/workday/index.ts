// Workday: a standalone flow. It shares only the answering pipeline (src/qa) and the session basics
// (sign-in wait, hand-over, never submit) with the rest of the app; reading and driving pages is its own.
import type { Page } from 'playwright';

export const isWorkdayUrl = (url: string) => {
  try { return /(^|\.)(myworkdayjobs|myworkdaysite|myworkday)\.com$/.test(new URL(url).hostname); } catch { return false; }
};
/** By address, or (on a company's own careers site) by Workday's page markers. */
export async function isWorkdayPage(page: Page) {
  return isWorkdayUrl(page.url()) || (await page.locator('[data-automation-id]').count().catch(() => 0)) > 15;
}
export { runWorkday } from './flow.js';
