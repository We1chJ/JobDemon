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

/** Tick or untick one box of a checkbox list. */
export async function setGroupOption(page: Page, e: ElementInfo, index: number, on: boolean) {
  await page.locator(`[data-jd-opt="${e.idx}:${index}"]`).setChecked(on, { timeout: TIMEOUT, force: true });
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

// Custom dropdowns / autocomplete: react-select style ([role=option]) and Workday style
// ([data-automation-id="promptOption"], often rendered in a pop-up outside the field).
const OPTION_SELECTORS = '[role=option], [data-automation-id="promptOption"], [data-automation-id="menuItem"]';
// Marks each visible option (skipping ones nested inside another option) and returns their texts in order.
const visibleOptions = (page: Page) => page.evaluate(`(() => {
  document.querySelectorAll('[data-jd-o]').forEach((n) => n.removeAttribute('data-jd-o'));
  const shown = (n) => { const r = n.getBoundingClientRect(), cs = getComputedStyle(n); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const all = [...document.querySelectorAll(${JSON.stringify(OPTION_SELECTORS)})].filter(shown);
  const top = all.filter((n) => !all.some((m) => m !== n && m.contains(n)));
  return top.map((n, i) => { n.setAttribute('data-jd-o', String(i)); return (n.getAttribute('data-automation-label') || n.innerText || '').trim(); });
})()`) as Promise<string[]>;

/** Open the dropdown without typing and return the options it shows. */
export async function comboboxOptions(page: Page, e: ElementInfo): Promise<string[]> {
  const l = await assertFresh(page, e);
  await openPicker(page, l);
  await page.waitForTimeout(600);
  return visibleOptions(page);
}

/**
 * Open a pick list. Some pickers (Workday's "Search" boxes) are covered by their own wrapper, so a normal
 * click never "reaches" the box: try briefly, then click through the cover, then just focus it.
 */
async function openPicker(page: Page, l: ReturnType<Page['locator']>) {
  try { await l.click({ timeout: 2000 }); return; } catch { /* covered */ }
  try { await l.click({ force: true, timeout: 2000 }); return; } catch { /* still not clickable */ }
  await l.focus().catch(() => {});
}

/** Type to search (async lists such as cities, long truncated lists such as schools). Some pickers (Workday) only search on Enter. */
export async function comboboxSearch(page: Page, e: ElementInfo, text: string): Promise<string[]> {
  await loc(page, e).fill(text, { timeout: TIMEOUT });
  await page.waitForTimeout(900);
  let found = await visibleOptions(page);
  if (!found.length) {
    await loc(page, e).press('Enter').catch(() => {});
    await page.waitForTimeout(1200);
    found = await visibleOptions(page);
  }
  return found;
}

/** Clear any typed search and show the full list again. */
export async function comboboxReset(page: Page, e: ElementInfo): Promise<string[]> {
  await loc(page, e).fill('', { timeout: TIMEOUT });
  await page.waitForTimeout(400);
  return visibleOptions(page);
}

/** Visible options right now (e.g. the next level of a pick list after choosing a category). */
export const currentOptions = (page: Page) => visibleOptions(page);

export async function pickComboboxOption(page: Page, index: number) {
  await page.locator(`[data-jd-o="${index}"]`).click({ timeout: TIMEOUT });
}

/** Last resort: click visible text that exactly matches the answer (outside the field itself). */
export async function pickByText(page: Page, e: ElementInfo, text: string): Promise<boolean> {
  const hits = page.getByText(text, { exact: true });
  const n = Math.min(await hits.count(), 20);
  for (let i = n - 1; i >= 0; i--) {
    const h = hits.nth(i);
    if (!(await h.isVisible().catch(() => false))) continue;
    const inField = await h.evaluate((node, idx) => !!node.closest(`[data-jd-idx="${idx}"]`), e.idx, { timeout: 2000 }).catch(() => true);
    if (inField) continue;
    await h.click({ timeout: TIMEOUT }).catch(() => {});
    return true;
  }
  return false;
}

/** Did the pick stick? Looks at the field's surroundings for the chosen text (pill, single value, or input value). */
export async function fieldShows(page: Page, e: ElementInfo, text: string): Promise<boolean> {
  return loc(page, e).evaluate((el, want) => {
    const w = String(want).toLowerCase();
    if ((el as HTMLInputElement).value?.toLowerCase().includes(w)) return true;
    let p: HTMLElement | null = el.parentElement;
    for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
      if ([...p.querySelectorAll('input, select, textarea')].some((x) => x !== el && (x as HTMLInputElement).type !== 'hidden' && (x as HTMLElement).tabIndex !== -1)) break; // stay within this field
      const sel = p.querySelector('[class*="single-value"],[class*="singleValue"],[data-automation-id*="selectedItem" i],[data-automation-id="promptSelectionLabel"]');
      if (sel && (sel as HTMLElement).innerText.toLowerCase().includes(w)) return true;
    }
    return false;
  }, text, { timeout: 3000 }).catch(() => false);
}

export async function closeCombobox(page: Page) {
  await page.keyboard.press('Escape').catch(() => {});
}

export class StaleTargetError extends Error {}
