// Site recipes for the generic flow: small per-portal add-ons. (Workday has its own flow: src/portals/workday.ts.) The generic bot does everything by default; a recipe only
// fills gaps for its portal. Anything a recipe doesn't provide falls back to the generic behaviour.
import type { Page } from 'playwright';

export interface Recipe {
  name: string;
  /** Recognise the portal from the link's address. */
  matchesUrl(url: URL): boolean;
  /** Recognise it on a company's own careers site, from markers in the page. */
  matchesPage?(page: Page): Promise<boolean>;
  /** Open this address instead (e.g. straight to the form, skipping the job description). */
  startUrl?(url: URL): URL;
  /** Extra notes for Jev when it judges this portal's pages. */
  jevNotes?: string;
}

const count = (page: Page, sel: string) => page.locator(sel).count().catch(() => 0);

export const RECIPES: Recipe[] = [
  {
    name: 'Greenhouse',
    matchesUrl: (u) => /(^|\.)greenhouse\.io$/.test(u.hostname),
    matchesPage: async (p) => (await count(p, '#application-form, iframe[src*="greenhouse.io"], [id^="grnhse"]')) > 0,
  },
  {
    name: 'Lever',
    matchesUrl: (u) => u.hostname === 'jobs.lever.co' || u.hostname === 'jobs.eu.lever.co',
    matchesPage: async (p) => (await count(p, '.application-question, iframe[src*="lever.co"]')) > 0,
    // jobs.lever.co/<company>/<id> is the description; the form lives at .../apply
    startUrl: (u) => (/^\/[^/]+\/[0-9a-f-]{36}\/?$/i.test(u.pathname) ? new URL(u.pathname.replace(/\/?$/, '/apply') + u.search, u) : u),
  },
  {
    name: 'Ashby',
    matchesUrl: (u) => u.hostname === 'jobs.ashbyhq.com',
    matchesPage: async (p) => (await count(p, '[data-field-path], iframe[src*="ashbyhq.com"]')) > 0,
    // jobs.ashbyhq.com/<company>/<id> is the Overview tab; the form is .../application
    startUrl: (u) => (/^\/[^/]+\/[0-9a-f-]{36}\/?$/i.test(u.pathname) ? new URL(u.pathname.replace(/\/?$/, '/application') + u.search, u) : u),
  },
  {
    name: 'iCIMS',
    matchesUrl: (u) => /(^|\.)icims\.com$/.test(u.hostname),
    matchesPage: async (p) => (await count(p, 'iframe#icims_content_iframe, iframe[src*="icims.com"]')) > 0,
    jevNotes: 'This is an iCIMS portal. It usually asks for an email address first, then a sign-in or new account, before the application. "Next" moves between steps and does not submit.',
  },
  {
    name: 'SmartRecruiters',
    matchesUrl: (u) => /(^|\.)smartrecruiters\.com$/.test(u.hostname),
  },
  {
    name: 'Workable',
    matchesUrl: (u) => u.hostname === 'apply.workable.com',
  },
];

export const recipeForUrl = (url: string) => {
  try { const u = new URL(url); return RECIPES.find((r) => r.matchesUrl(u)) ?? null; } catch { return null; }
};

/** Address first (cheap, reliable), then page markers (portal embedded on a company's own site). */
export async function recipeForPage(page: Page): Promise<Recipe | null> {
  const byUrl = recipeForUrl(page.url());
  if (byUrl) return byUrl;
  for (const r of RECIPES) if (r.matchesPage && (await r.matchesPage(page))) return r;
  return null;
}

/** Where to open a link, after any recipe rewrite. */
export function startAddress(url: string) {
  const r = recipeForUrl(url);
  try { return r?.startUrl ? r.startUrl(new URL(url)).toString() : url; } catch { return url; }
}
