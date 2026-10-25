// End-to-end test of the extension: Chromium with JobDemon loaded, against the mock job board, using the
// offline stand-in brain (no AI calls). Run: npm run test:ext
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';
import { startMock, submissions, stats } from '../../mock/server.js';

const here = import.meta.dirname, dist = path.join(here, '..', 'dist');
execFileSync(process.execPath, [path.join(here, '..', 'build.mjs'), '--dev'], { stdio: 'inherit' });
const server = startMock(4100);
const u = (n: number, rest = '') => `http://localhost:4100/jobs/${n}${rest}`;

const tpl = (f: string) => JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'data', 'templates', f), 'utf8'));
const OPENING = 'I care about two things: create and challenge. This paragraph never changes.';
const profile = tpl('profile.example.json');
profile.fields = { ...profile.fields, veteran_status: 'No, I am not a protected veteran', graduation_month: 'May', race: 'Asian', ethnicity: 'No, not Hispanic or Latino', pronouns: 'He/him', school_start_month: 'August', school_start_year: '2024', gpa: '3.9', high_school_grad_year: '2020', address_zip: '02115', address_street: '1 Main St' };
profile.facts.education[0].start = '2017-09';
profile.cover_letter = { header: 'Jane Doe\njane@example.com', salutation: 'To the {company} Selection Committee,', opening: OPENING, examples: 'My experience paragraph.\n\nWhy OtherCo paragraph.', closing: 'Sincerely,\n\nJane Doe' };
const pdf = (name: string, text: string) => ({ name, type: 'application/pdf', size: text.length, data: Buffer.from(text).toString('base64') });

let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`); if (!ok) failed++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ctx: BrowserContext = await chromium.launchPersistentContext('', {
  headless: true, channel: 'chromium', viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
ctx.on('page', (p) => p.on('console', (m) => { if (process.env.LOG && m.text().startsWith('JobDemon')) console.log(`   ${m.text()}`); }));
const sw: Worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
await sw.evaluate((data) => chrome.storage.local.set(data), {
  profile, bank: tpl('answer_bank.example.json'), settings: { typesafeKey: '', openaiKey: '', openaiModel: 'gpt-4.1', fake: true },
  'file:resume': pdf('resume.pdf', '%PDF-1.4 fake resume'), 'file:transcript': pdf('transcript.pdf', '%PDF-1.4 fake transcript'),
});
const history = () => sw.evaluate(async () => (await chrome.storage.local.get('history')).history ?? {}) as Promise<Record<string, { url: string; status: string; needs: string[]; company: string; role: string; letter?: string }>>;
const item = async (url: string) => Object.values(await history()).find((h) => h.url.replace(/\/$/, '') === url.replace(/\/$/, ''));
const runs = () => sw.evaluate(async () => Object.keys(await chrome.storage.session.get(null)).filter((k) => k.startsWith('run:')).length);

const panel = (p: Page) => p.locator('#jobdemon-host');
const status = (p: Page) => panel(p).locator('.t').innerText().catch(() => '');
const needsText = (p: Page) => panel(p).locator('.n').textContent().then((t) => t ?? '', () => '');
/** Open a job, press a widget button, and wait until the run has finished (in whichever tab it ends up). */
async function run(url: string, button = 'Continue', timeout = 90000): Promise<Page> {
  const page = await open(url);
  await panel(page).locator('button', { hasText: button }).click({ timeout: 15000 });
  return settle(page, timeout);
}
/** Open a page; where the widget doesn't show by itself, click the toolbar icon (sends the same message). */
async function open(url: string) {
  const page = await ctx.newPage();
  await page.goto(url);
  if (!(await panel(page).waitFor({ timeout: 5000 }).then(() => true, () => false))) {
    await sw.evaluate(async (u) => { const [t] = await chrome.tabs.query({ url: u }); if (t?.id) await chrome.tabs.sendMessage(t.id, { t: 'show' }, { frameId: 0 }); }, url);
  }
  return page;
}
async function settle(page: Page, timeout = 90000) {
  const t0 = Date.now();
  await sleep(1000);
  for (; Date.now() - t0 < timeout; await sleep(500)) {
    const live = ctx.pages().filter((p) => !p.isClosed());
    const last = live[live.length - 1] ?? page;
    if (!(await runs()) && !(await panel(last).locator('button:disabled').count().catch(() => 1))) return last;
  }
  return ctx.pages().filter((p) => !p.isClosed()).pop() ?? page;
}
const val = (p: Page, sel: string) => p.locator(sel).inputValue();
const selected = (p: Page, sel: string) => p.locator(sel).evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex]?.text ?? '');
const fileName = (p: Page, sel: string) => p.locator(sel).evaluate((i: HTMLInputElement) => i.files?.[0]?.name ?? '');

try {
  // The setup tab opens on install.
  await sleep(500);
  check('Setup opens when the extension is installed', ctx.pages().some((p) => p.url().endsWith('/pages/setup.html')));

  // 1: a whole one-page form, stopping at its Submit button.
  const p1 = await run(u(1));
  const a1 = await item(u(1));
  check('job 1 is filled and stops at the submit button', a1?.status === 'filled' && /Submit Application/.test(await status(p1)), `${a1?.status}: ${await status(p1)}`);
  check('company/role read off page', a1?.company === 'Mockco' && a1?.role === 'Backend Engineer', `${a1?.company} / ${a1?.role}`);
  check('structured fields mapped from profile', (await val(p1, '#first_name')) === 'Jane' && (await val(p1, '#email')) === 'jane@example.com' && (await val(p1, '#linkedin')) === 'https://www.linkedin.com/in/janedoe');
  check('answer bank used for select + radio', (await selected(p1, '#auth')) === 'Yes' && (await p1.locator('input[name=sponsor][value=no]').isChecked()));
  check('transcript attached to the transcript field', (await fileName(p1, '#transcript')) === 'transcript.pdf');
  check('resume attached as-is', (await fileName(p1, '#resume')) === 'resume.pdf');
  const letter = await val(p1, '#cover_letter');
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  check('cover letter uses your template: header, date, company greeting, fixed opening, sign-off',
    letter.startsWith(`Jane Doe\njane@example.com\n\n${today}\n\nTo the Mockco Selection Committee,\n\n${OPENING}\n\n`) && letter.endsWith('Sincerely,\n\nJane Doe') && !letter.includes('OtherCo'), letter.slice(0, 80));
  check('cover letter kept with the application', a1?.letter === letter);
  check('open-ended paragraph written', (await val(p1, '#why')).length > 20);
  check('EEO declined, not guessed', (await selected(p1, '#gender')) === 'Decline To Self Identify');
  check('privacy statement checkbox ticked', await p1.locator('#privacy').isChecked());
  check('code of conduct: picks "I agree", not "I do not agree"', (await selected(p1, '#conduct')) === 'I agree');
  check('non-compete answered from the answer bank', (await val(p1, '#noncompete')) === 'No');
  check('follow-up to a "No" answer is left blank', (await val(p1, '#noncompete_explain')) === '');
  check('custom dropdown picked from its list', (await val(p1, '#country')) === 'United States +1', await val(p1, '#country'));
  await panel(p1).locator('button[aria-label=More]').click();
  await panel(p1).locator('[role=menuitem]', { hasText: 'Cover letter' }).click();
  await panel(p1).locator('pre').filter({ hasText: 'Selection Committee' }).waitFor({ timeout: 8000 }).catch(() => {});
  check("the widget shows this job's cover letter", (await panel(p1).locator('pre').textContent()) === letter);

  // 3: something the profile doesn't have: filled as far as possible, the rest listed for you.
  const p3 = await run(u(3));
  const a3 = await item(u(3));
  check('missing required data is left for you, by name', a3?.status === 'needs_you' && a3.needs.some((n) => /clearance/i.test(n)), `${a3?.status}: ${a3?.needs}`);
  check('it keeps filling past a question it cannot answer', (await val(p3, '#first_name')) === 'Jane' && (await val(p3, '#why')).length > 20);
  check('the widget lists the fields that need you', /clearance/i.test(await needsText(p3)));

  // Hover a field: its own button fills just that one.
  const p4 = await open(u(4));
  await panel(p4).waitFor({ timeout: 10000 });
  await p4.locator('#first_name').hover();
  await p4.mouse.move((await p4.locator('#first_name').boundingBox())!.x + (await p4.locator('#first_name').boundingBox())!.width + 16, (await p4.locator('#first_name').boundingBox())!.y + 10);
  await p4.locator('button[aria-label="Fill this field with JobDemon"]').click({ timeout: 5000 });
  for (let i = 0; i < 20 && !(await val(p4, '#first_name')); i++) await sleep(250);
  await sleep(1500); // the field's own fill finishes (it checks the field shows the answer)
  check('the button beside a field fills just that field', (await val(p4, '#first_name')) === 'Jane' && (await val(p4, '#email')) === '');
  await panel(p4).locator('button', { hasText: 'Fill page' }).click();
  await settle(p4);
  check('"Fill this page" fills the rest', (await val(p4, '#email')) === 'jane@example.com' && (await val(p4, '#why')).length > 20 && (await item(u(4)))?.status === 'filled', `${await val(p4, '#email')} ${(await item(u(4)))?.status} ${await needsText(p4)}`);

  // Stop: the field it's on finishes, nothing after it, and it stays stopped.
  const ps = await open(u(1, '?stop=1'));
  await panel(ps).locator('button', { hasText: 'Continue' }).click();
  await sleep(1200);
  await panel(ps).locator('button', { hasText: 'Stop' }).click();
  await sleep(1500);
  const filledAtStop = await ps.locator('#application-form input[type=text]:not([value=""]), #application-form input:not([type])').evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).value).length);
  await sleep(4000);
  const filledLater = await ps.locator('#application-form input[type=text], #application-form input:not([type])').evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).value).length);
  check('Stop stops mid-page and stays stopped', /Stopped/.test(await status(ps)) && filledLater === filledAtStop && (await val(ps, '#why')) === '' && !(await runs()) && (await panel(ps).locator('button', { hasText: 'Continue' }).isEnabled()), `${await status(ps)}: ${filledAtStop} → ${filledLater}`);

  // Getting to the form: tabs, multi-step forms, new tabs, embedded forms.
  const p5 = await run(u(5));
  check('Ashby-style: opens the Application tab from the overview, then fills it', p5.url().endsWith('/jobs/5/application') && (await val(p5, '#first_name')) === 'Jane', p5.url());
  check('Ashby-style Yes/No buttons answered from the answer bank', (await p5.locator('[data-field-path=q18] [data-option=yes]').getAttribute('aria-pressed')) === 'true');
  check('veteran question answered from your self-identification', await p5.locator('#vet-1').isChecked());
  check('college start month and year filled', (await selected(p5, '#startmonth')) === 'August' && (await val(p5, '#startyear')) === '2024');
  check('school not in their list: picks "Other"', (await selected(p5, '#school')) === 'Other');
  check('high school graduation year filled', (await val(p5, '#hs')) === '2020');
  check('GPA and street address filled', (await val(p5, '#gpa')) === '3.9' && (await val(p5, '#street')) === '1 Main St');
  check('graduation month fills "End date month"', (await selected(p5, '#enddate')) === 'May');
  check('combined race/ethnicity list answered from race + ethnicity', await p5.locator('#race-2').isChecked());
  check('pronouns filled from your self-identification', (await selected(p5, '#pronouns')) === 'He/Him');
  check('languages checkboxes: ticks only the ones in your Skills', (await p5.locator('#lang-ts').isChecked()) && !(await p5.locator('#lang-java').isChecked()) && !(await p5.locator('#lang-cobol').isChecked()));
  check('blank ACT score picks the "no score" option', (await selected(p5, '#act')) === "I don't have this score");
  check('U.S. Person question answered Yes', (await p5.locator('[data-field-path=usp] [data-option=yes]').getAttribute('aria-pressed')) === 'true');
  check('career-fair question answered No', (await p5.locator('[data-field-path=fair] [data-option=no]').getAttribute('aria-pressed')) === 'true');
  check('"Autofill from resume" upload is left alone', (await p5.locator('#autofill').evaluate((i: HTMLInputElement) => i.files?.length ?? 0)) === 0);

  const p6 = await run(u(6));
  check('multi-step: fills step 1, clicks Next, fills step 2, stops at the review page', (await val(p6, '#why')).length > 20 && (await p6.locator('#s3').isVisible()), await status(p6));
  const p7 = await run(u(7));
  check('follows an "Apply now" link that opens a new tab', p7.url().endsWith('/jobs/7/application') && (await val(p7, '#email')) === 'jane@example.com', `${p7.url()}: ${await status(p7)}`);
  check('Lever-style radio question answered', await p7.locator('input[name="cards[q1]"]:checked').count() === 1);
  const p8 = await run(u(8));
  const f8 = p8.frameLocator('iframe');
  check('fills a form embedded in an iframe', (await f8.locator('#first_name').inputValue()) === 'Jane' && (await f8.locator('#why').inputValue()).length > 20, await status(p8));
  const p9 = await run(u(9));
  check('no form anywhere: says so instead of claiming it filled something', /couldn't find the application form/i.test(await status(p9)), await status(p9));
  const p12 = await run(u(12));
  check('Workday-style Apply pop-up: picks a start option instead of re-clicking Apply', p12.url().endsWith('/jobs/12/application') && (await val(p12, '#first_name')) === 'Jane', p12.url());
  check('never fills a "robots only" trap field', (await val(p12, '#trap')) === '');
  const p17 = await run(u(17));
  check('careers page with a job search: skips the search boxes and fills the embedded application', (await p17.frameLocator('iframe').locator('#first_name').inputValue()) === 'Jane' && (await val(p17, '#kw')) === '' && (await val(p17, '#loc')) === '');
  // 18: IBM-style dropdowns drawn over a hidden select, and unnumbered education rows with month boxes.
  const p18 = await run(u(18));
  check('a dropdown drawn over a hidden select is filled through the select', (await val(p18, '#ctry')) === 'US' && (await p18.locator('#ctry + .select2 .face, #ctry ~ span .face').first().innerText()) === 'United States', await val(p18, '#ctry'));
  check("a drawn dropdown that doesn't follow its select is picked through its own list", (await p18.locator('#citface').innerText()) === 'United States' && (await val(p18, '#cit')) === 'US', `${await p18.locator('#citface').innerText()} / ${await val(p18, '#cit')}`);
  check('an already-chosen dropdown is not flagged (its choice is not part of the question)', !/State/.test(await needsText(p18)) && (await val(p18, '#state')) === 'MA', await needsText(p18));
  check('unnumbered repeating rows are told apart: row 1 gets school 1', (await val(p18, '#deg0')) === 'BS Computer Science' && (await val(p18, '#degsample')) === '');
  check('a month box gets YYYY-MM', (await val(p18, '#sd0')) === '2017-09', await val(p18, '#sd0'));
  await panel(p18).locator('button', { hasText: 'Fill page' }).click();
  await settle(p18);
  check('repeating rows: adds one per job, and filling again adds no more', (await p18.locator('#wrows .row:not([hidden])').count()) === 1 && (await val(p18, '#w0-0')) === 'Acme Corp', `${await p18.locator('#wrows .row:not([hidden])').count()} rows`);
  // The debug report: what it saw and did, without personal details.
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:4100' });
  await panel(p18).locator('button[aria-label=More]').click();
  await panel(p18).locator('[role=menuitem]', { hasText: 'Copy debug report' }).click();
  await panel(p18).locator('.t').filter({ hasText: 'copied' }).waitFor({ timeout: 5000 }).catch(() => {});
  const rep = await p18.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, rep); // DUMP=file: keep the report to look at
  check('debug report: page structure, every question and what was done, dropdown lists offered',
    /"type": "page"/.test(rep) && /Education 1 > Degree name/.test(rep) && /"type": "field"/.test(rep) && /dropdown over a hidden select/.test(rep) && /"outline"/.test(rep), `${rep.length} chars`);
  check('debug report: no personal details', rep.length > 0 && !/Jane|Doe|jane@example\.com|555 ?0100|linkedin\.com\/in/i.test(rep) && /\[first_name\]/.test(rep));
  // 19: what a Lever form showed (see mock/server.ts).
  const p19 = await run(u(19));
  const a19 = await item(u(19));
  check('company and role from a "Company - Role" title', a19?.company === 'Mockco Labs' && a19?.role === 'Lever Style Engineer', `${a19?.company} / ${a19?.role}`);
  check('a 300-option list: answered as text, then chosen from the closest options', (await selected(p19, '#uni19')) === 'State University', await selected(p19, '#uni19'));
  check('a short heading over the real question: the question underneath is read too', (await val(p19, '#dd19')).length > 20);
  check('a required "select all" with nothing that fits is left for you', /Language/.test(await needsText(p19)) && !(await p19.locator('input[name=lang19]:checked').count()), await needsText(p19));
  await panel(p19).locator('button[aria-label=More]').click();
  await panel(p19).locator('[role=menuitem]', { hasText: 'Copy debug report' }).click();
  await sleep(800);
  const fields19 = (JSON.parse(await p19.evaluate(() => navigator.clipboard.readText()).catch(() => '{}')).entries ?? []).find((e: { type: string }) => e.type === 'page')?.fields ?? [];
  const f19 = (q: RegExp) => fields19.find((f: { q: string }) => q.test(f.q));
  check('✱ counts as the required mark', f19(/^Resume/)?.required === true && f19(/^Resume/)?.q === 'Resume/CV', JSON.stringify(f19(/^Resume/)?.q));
  check("a label wrapping its <select> doesn't read out the options", f19(/^Veteran/)?.q === 'Veteran status', f19(/^Veteran/)?.q);
  check('the question underneath a heading is in the report', /which team you would prefer/.test(f19(/DELTA/)?.details ?? ''));
  check('linked help text and the box\'s placeholder are part of the question', /proud of/.test(f19(/^Short answer/)?.details ?? '') && /2-3 sentences/.test(f19(/^Short answer/)?.details ?? ''), f19(/^Short answer/)?.details);

  // 20: a form built from web components (fields kept in their own hidden trees, some closed).
  const p20 = await run(u(20));
  const v20 = (tag: string, name: string) => p20.evaluate(([t, n]) => (document.querySelector(`${t}[name=${n}]`) as unknown as { value: string }).value, [tag, name]);
  check('web components: text boxes inside them are filled (open and closed)', (await v20('x-text', 'fn20')) === 'Jane' && (await v20('x-text', 'em20')) === 'jane@example.com', `${await v20('x-text', 'fn20')} / ${await v20('x-text', 'em20')}`);
  check('web components: radio buttons, dropdown and a checkbox whose words come from outside it', (await v20('x-radios', 'sp20')) === 'No' && (await v20('x-select', 'g20')) === 'Decline To Self Identify' && (await v20('x-check', 'pv20')) === 'checked',
    `${await v20('x-radios', 'sp20')} / ${await v20('x-select', 'g20')} / ${await v20('x-check', 'pv20')}`);
  check('web components: the Submit button drawn inside one is found, and not clicked', /click "Submit"/.test(await status(p20)) && stats.posts === 0, await status(p20));

  check("row 2 isn't given school 1's details", (await val(p18, '#deg1')) === '' && (await val(p18, '#sd1')) === '');

  check('nothing submitted after all the navigating', submissions.length === 0 && stats.posts === 0);

  // Workday look-alike: Apply → start option → sign-in wall (you) → five steps → stops at Submit.
  const w13 = await open(u(13));
  await panel(w13).locator('button', { hasText: 'Continue' }).click({ timeout: 15000 });
  for (let i = 0; i < 60 && !/Sign in/.test(await status(w13)); i++) await sleep(500);
  check('Workday: clicks Apply and a start option, then waits for you at sign-in', /Sign in/.test(await status(w13)), await status(w13));
  check('Workday: never types into the sign-in form', (await val(w13, '#em')) === '' && (await val(w13, '#pw')) === '');
  await w13.fill('#em', 'jane@example.com');
  await w13.fill('#pw', 'test-only-password');
  await w13.click('button[type=submit]');
  const p13 = await settle(w13, 120000);
  const v13 = (sel: string) => val(p13, sel);
  const pill13 = async (id: string) => (await p13.locator(`[data-automation-id="formField-${id}"] [data-automation-id=selectedItem]`).allInnerTexts()).join(', ');
  check('Workday: carries on after sign-in through every step to Submit', await p13.locator('#wsubmit').isVisible(), await status(p13));
  check('Workday: "How did you hear" follows the guideline through the sub-list (Job Board > LinkedIn)', (await pill13('source')) === 'LinkedIn', await pill13('source'));
  check('Workday: "Country Phone Code" searched and picked', (await pill13('phoneCode')) === 'United States of America (+1)', await pill13('phoneCode'));
  check('Workday: button dropdown picked from its list', (await p13.locator('#countryDropdown').innerText()) === 'United States of America');
  check('Workday: text fields filled, optional extension left empty', (await v13('#legalNameSection_firstName')) === 'Jane' && (await v13('#postalCode')) === '02115' && (await v13('#extension')) === '');
  check('Workday: "I have a preferred name" left unticked', !(await p13.locator('#preferredCheckbox').isChecked()));
  check('Workday: repeating sections get one entry per job and school', (await p13.locator('.entries[data-kind=work] .entry').count()) === 1 && (await p13.locator('.entries[data-kind=edu] .entry').count()) === 1);
  check("Workday: entry fields filled from that entry's facts", (await v13('#jobTitle-1')) === 'Software Engineer' && (await v13('#companyName-1')) === 'Acme Corp' && (await v13('#school-1')) === 'State University' && (await p13.locator('#degree-1').innerText()) === 'BS Computer Science');
  check('Workday: Month / Year date boxes filled', (await v13('[data-automation-id="formField-startDate-1"] [data-automation-id=dateSectionMonth-input]')) === '07' && (await v13('[data-automation-id="formField-startDate-1"] [data-automation-id=dateSectionYear-input]')) === '2021');
  check('Workday: skills searched one by one', (await pill13('skills')).split(', ').sort().join(',') === 'AWS,Node.js,PostgreSQL,TypeScript', await pill13('skills'));
  check('Workday: "I currently work here" ticked for a current job', await p13.locator('#currentlyWorkHere-1').isChecked());
  check('Workday: resume uploaded', (await p13.locator('#uploaded').innerText()) === 'resume.pdf');
  check('Workday: radio question answered', await p13.locator('#workAuth-0').isChecked());
  check('Workday: open-ended answer written', (await v13('#why')).length > 20);
  check('Workday: demographic question declined, not guessed', (await p13.locator('#gender').innerText()) === 'I decline to self-identify');
  check('Workday: consent box ticked', await p13.locator('#termsAndConditions').isChecked());

  // 14: a step that won't move on is retried once with the page's message, then reported.
  const p14 = await run(u(14), 'Continue', 120000);
  check("Workday: a step that won't advance is retried with the page's message, then reported", /didn't move on/.test(await status(p14)) && /Employee ID/.test(await needsText(p14)), `${await status(p14)} / ${await needsText(p14)}`);
  // Continue from here: you fix what stopped it, then it carries on to Submit.
  await p14.fill('#employeeId', 'E-12345');
  await panel(p14).locator('button', { hasText: 'Continue' }).click();
  const q14 = await settle(p14, 120000);
  check('Continue: carries on from the page you fixed, through every step, to Submit', (await q14.locator('#wsubmit').isVisible()) && (await val(q14, '#employeeId')) === 'E-12345', await status(q14));

  // 15: the same application built with standard markup only (no Workday names).
  const p15 = await run(u(15), 'Continue', 120000);
  const v15 = (sel: string) => val(p15, sel);
  const chips15 = async (id: string) => (await p15.locator(`#${id}`).locator('xpath=..').locator('.chips [role=option]').allInnerTexts()).join(', ');
  check('Standard markup: every step filled, stops at "Submit application"', await p15.locator('#send').isVisible(), await status(p15));
  check('Standard markup: combobox tree picked (Job Board > LinkedIn)', (await chips15('heard')) === 'LinkedIn', await chips15('heard'));
  check('Standard markup: search-only combobox searched and picked', (await chips15('dial')) === 'United States of America (+1)', await chips15('dial'));
  check('Standard markup: skills searched one by one', (await chips15('skills')).split(', ').sort().join(',') === 'AWS,Node.js,PostgreSQL,TypeScript', await chips15('skills'));
  check('Standard markup: listbox button picked', (await p15.locator('#ctry').innerText()) === 'United States of America');
  check('Standard markup: text fields filled, optional extension left empty', (await v15('#fname')) === 'Jane' && (await v15('#zip')) === '02115' && (await v15('#ext')) === '');
  check('Standard markup: custom role=checkbox left alone / ticked as answered', (await p15.locator('#pref').getAttribute('aria-checked')) === 'false' && (await p15.locator('#agree').getAttribute('aria-checked')) === 'true');
  check('Standard markup: "Add another" sections get one entry per job and school', (await p15.locator('.items[data-kind=job] .item').count()) === 1 && (await p15.locator('.items[data-kind=school] .item').count()) === 1);
  check('Standard markup: date parts told apart by their range, not their names', (await p15.locator('.item .sp').nth(0).inputValue()) === '07' && (await p15.locator('.item .sp').nth(1).inputValue()) === '2021');
  check('Standard markup: hidden file input attached', (await p15.locator('#cvname').innerText()) === 'resume.pdf');
  check('Standard markup: native <select> declined for a demographic question', (await selected(p15, '#sex')) === 'Prefer not to say');

  // 16: a careers site whose Apply opens Workday in a new tab.
  const p16 = await run(u(16), 'Continue', 120000);
  check('careers site handing on to Workday in a new tab: carries on there to Submit', await p16.locator('#wsubmit').isVisible().catch(() => false), `${p16.url()}: ${await status(p16)}`);
  check('the bot never clicked Submit', stats.posts === 0 && submissions.length === 0);

  // The bar shows itself only on job applications; the toolbar icon brings it up anywhere.
  const plain = await ctx.newPage();
  await plain.goto(u(9));
  await sleep(5000);
  check('no bar on a page with no application', (await panel(plain).count()) === 0);
  await sw.evaluate(async (url) => { for (const t of await chrome.tabs.query({ url })) await chrome.tabs.sendMessage(t.id!, { t: 'show' }, { frameId: 0 }).catch(() => {}); }, u(9));
  check('the toolbar icon shows it anyway', await panel(plain).locator('button', { hasText: 'Continue' }).isVisible({ timeout: 3000 }).catch(() => false));

  // Your own Submit: it counts as applied only once it goes through.
  await p3.locator('button[type=submit]').click(); // required fields still empty: the browser refuses it
  await sleep(3000);
  check('a Submit that fails validation does not count as applied', (await item(u(3)))?.status === 'needs_you');
  await Promise.all([p1.waitForURL(/jobs\/1/, { timeout: 10000 }), p1.locator('button[type=submit]').click()]);
  for (let i = 0; i < 30 && (await item(u(1)))?.status !== 'applied'; i++) await sleep(500);
  check('your Submit that goes through marks it applied, and the tab stays open', (await item(u(1)))?.status === 'applied' && !p1.isClosed() && submissions.length === 1);
  await panel(p1).locator('.t').filter({ hasText: 'Submitted' }).waitFor({ timeout: 5000 }).catch(() => {});
  check('the bar says it was marked applied', /Submitted/.test(await status(p1)), await status(p1));

  // The extension's own pages.
  const dash = await ctx.newPage();
  await dash.goto(`chrome-extension://${new URL(sw.url()).host}/pages/dashboard.html`);
  await dash.locator('.cc').first().waitFor({ timeout: 5000 }).catch(() => {});
  check('Dashboard lists the applications with charts', (await dash.locator('.tbl tbody tr').count()) >= 10 && (await dash.locator('.cc').count()) === 4 && (await dash.locator('.cc-value').first().innerText()) === '1');
  const setup = ctx.pages().find((p) => p.url().endsWith('/pages/setup.html'))!;
  await setup.reload();
  check('Setup shows your saved profile', (await setup.locator('input[name=first_name]').inputValue()) === 'Jane' && (await setup.locator('#screening input:checked').count()) > 3);
  await setup.locator('input[name=preferred_name]').fill('JJ');
  await setup.locator('.sticky-save button').click();
  await setup.locator('.callout.t-ok').waitFor({ timeout: 5000 }).catch(() => {});
  const saved = await sw.evaluate(async () => (await chrome.storage.local.get('profile')).profile);
  check('Setup saves edits', saved.fields.preferred_name === 'JJ' && saved.fields.first_name === 'Jane' && saved.cover_letter.opening === OPENING, await setup.locator('.callout').first().innerText().catch(() => ''));
  const lp = await ctx.newPage();
  await lp.goto(`chrome-extension://${new URL(sw.url()).host}/pages/letter.html`);
  await lp.fill('#jd', 'Backend Engineer\nJoin Mockco and build APIs.');
  await lp.locator('button', { hasText: 'Generate' }).click();
  await lp.locator('#letter').waitFor({ timeout: 10000 }).catch(() => {});
  check('Cover letter page writes a letter for a pasted posting', (await lp.locator('#letter').inputValue().catch(() => '')).includes(OPENING));

  // Resume upload: the PDF's text is read in the Setup page and turned into a draft profile to review.
  const { textToPdf } = await import('../src/shared/pdf.js');
  const resumePdf = path.join(os.tmpdir(), 'jobdemon-test-resume.pdf');
  fs.writeFileSync(resumePdf, textToPdf('Rita Moreno\nrita@example.com · Boston, MA\nExperience: Software Engineer at Acme Corp, 2021 to present. Built APIs.'));
  await setup.locator('#resume').setInputFiles(resumePdf);
  await setup.locator('.callout.t-info').waitFor({ timeout: 15000 }).catch(() => {});
  check('Setup reads an uploaded resume into a draft to review', (await setup.locator('input[name=first_name]').inputValue()) === 'Rita' && (await setup.locator('input[name=email]').inputValue()) === 'rita@example.com',
    await setup.locator('.callout').first().innerText().catch(() => ''));
  const stored = await sw.evaluate(async () => (await chrome.storage.local.get('file:resume'))['file:resume']);
  check('the uploaded resume is the file attached from now on', stored?.name === 'jobdemon-test-resume.pdf' && Buffer.from(stored.data, 'base64').subarray(0, 4).toString() === '%PDF');
  await setup.locator('[data-act=discard]').click();

  // Backup: export, then import into a fresh state.
  const backupFile = path.join(os.tmpdir(), 'jobdemon-test-backup.json');
  const [dl] = await Promise.all([setup.waitForEvent('download'), setup.locator('[data-act=export]').click()]);
  await dl.saveAs(backupFile);
  const exported = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  check('Export: profile, answers, files and history, without API keys', exported.jobdemon === 1 && exported.profile.fields.first_name === 'Jane' && !!exported.files.resume && Object.keys(exported.history).length >= 10 && !JSON.stringify(exported).includes('typesafeKey'));
  await sw.evaluate(() => chrome.storage.local.remove(['profile', 'bank', 'history']));
  await setup.reload();
  await setup.locator('#import').setInputFiles(backupFile);
  await setup.locator('.callout.t-ok').waitFor({ timeout: 5000 }).catch(() => {});
  check('Import brings everything back', (await setup.locator('input[name=first_name]').inputValue()) === 'Jane' && Object.keys(await history()).length >= 10);
} catch (e) {
  console.error(e);
  failed++;
} finally {
  await ctx.close();
  server.close();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
