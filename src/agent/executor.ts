import type { Page } from 'playwright';
import type { ElementInfo } from '../types.js';

const TIMEOUT = 5000; // bounded waits on every action

const loc = (page: Page, e: ElementInfo) => page.locator(`[data-jd-idx="${e.idx}"]`);

/** Freshness + visibility check. Playwright's click/fill also refuse occluded targets. */
async function assertFresh(page: Page, e: ElementInfo) {
  const l = loc(page, e);
  if ((await l.count()) !== 1) throw new StaleTargetError(`Element [${e.idx}] "${e.label}" is gone`);
  if (e.type !== 'file') await l.scrollIntoViewIfNeeded({ timeout: TIMEOUT });
  return l;
}

export async function click(page: Page, e: ElementInfo) {
  if (e.tag === 'radio') throw new Error('Use chooseOption for radio groups');
  await (await assertFresh(page, e)).click({ timeout: TIMEOUT });
}

export async function typeText(page: Page, e: ElementInfo, text: string) {
  await (await assertFresh(page, e)).fill(text, { timeout: TIMEOUT });
}

export async function uploadFile(page: Page, e: ElementInfo, file: string) {
  await (await assertFresh(page, e)).setInputFiles(file, { timeout: TIMEOUT });
}

export async function setCheckbox(page: Page, e: ElementInfo, checked: boolean) {
  await (await assertFresh(page, e)).setChecked(checked, { timeout: TIMEOUT, force: true });
}

/** Select an option by index for native selects and radio groups. */
export async function chooseOption(page: Page, e: ElementInfo, index: number) {
  if (e.tag === 'radio') {
    const opt = page.locator(`[data-jd-opt="${e.idx}:${index}"]`);
    // Real radio buttons get checked; button-style choices (e.g. Ashby Yes/No) get clicked.
    if (await opt.evaluate((n) => n.tagName === 'INPUT')) await opt.check({ timeout: TIMEOUT, force: true });
    else await opt.click({ timeout: TIMEOUT });
  } else {
    await (await assertFresh(page, e)).selectOption({ label: e.options![index] }, { timeout: TIMEOUT });
  }
}

// Custom dropdowns / autocomplete (react-select style).
const visibleOptions = (page: Page) => page.locator('[role=option]:visible').allInnerTexts().then((o) => o.map((t) => t.trim()));

/** Open the dropdown without typing and return the options it shows. */
export async function comboboxOptions(page: Page, e: ElementInfo): Promise<string[]> {
  const l = await assertFresh(page, e);
  await l.click({ timeout: TIMEOUT });
  await page.waitForTimeout(500);
  return visibleOptions(page);
}

/** Type to search (for async lists such as cities or long, truncated lists such as schools). */
export async function comboboxSearch(page: Page, e: ElementInfo, text: string): Promise<string[]> {
  await loc(page, e).fill(text, { timeout: TIMEOUT });
  await page.waitForTimeout(900);
  return visibleOptions(page);
}

/** Clear any typed search and show the full list again. */
export async function comboboxReset(page: Page, e: ElementInfo): Promise<string[]> {
  await loc(page, e).fill('', { timeout: TIMEOUT });
  await page.waitForTimeout(400);
  return visibleOptions(page);
}

export async function pickComboboxOption(page: Page, index: number) {
  await page.locator('[role=option]:visible').nth(index).click({ timeout: TIMEOUT });
}

export async function closeCombobox(page: Page) {
  await page.keyboard.press('Escape').catch(() => {});
}

export class StaleTargetError extends Error {}
