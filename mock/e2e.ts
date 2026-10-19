// End-to-end test against the mock board, with the fake decider + writer and a throwaway data dir.
// Run: npm run test:e2e   (add DECIDER=jev WRITER=openai to exercise the real APIs)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobdemon-e2e-'));
process.env.DATA_DIR = dir;
process.env.DECIDER ??= 'fake';
process.env.WRITER ??= 'fake';
process.env.HEADLESS = '1';
process.env.SIGNIN_WAIT_MS = '60000';

const { startMock, submissions, stats } = await import('./server.js');
const { config } = await import('../src/config.js');
const { db, schema } = await import('../src/db/index.js');
const { saveProfile } = await import('../src/profile.js');
const { enqueue, normalizeUrl } = await import('../src/intake.js');
const { processQueue } = await import('../src/run.js');
const { openFormPage, isFormOpen, closeBrowser, AppTabs } = await import('../src/agent/browser.js');
const { eq } = await import('drizzle-orm');

const server = startMock(4100);
const tpl = (f: string) => JSON.parse(fs.readFileSync(path.join(config.templatesDir, f), 'utf8'));
const OPENING = 'I care about two things: create and challenge. This paragraph never changes.';
const baseProfile = tpl('profile.example.json');
baseProfile.fields = { ...baseProfile.fields, veteran_status: 'No, I am not a protected veteran', graduation_month: 'May', race: 'Asian', ethnicity: 'No, not Hispanic or Latino', pronouns: 'He/him', school_start_month: 'August', school_start_year: '2024', gpa: '3.9', high_school_grad_year: '2020', address_zip: '02115', address_street: '1 Main St' };
saveProfile({ ...baseProfile, cover_letter: {
  header: 'Jane Doe\njane@example.com', salutation: 'To the {company} Selection Committee,', opening: OPENING,
  examples: 'My experience paragraph.\n\nWhy OtherCo paragraph.', closing: 'Sincerely,\n\nJane Doe',
} }, tpl('answer_bank.example.json'));
fs.writeFileSync(config.resumePath, '%PDF-1.4 fake resume');
fs.writeFileSync(config.transcriptPath, '%PDF-1.4 fake transcript');

let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`); if (!ok) failed++; };
const get = (url: string) => db.select().from(schema.application).where(eq(schema.application.url, normalizeUrl(url))).get()!;
const u = (n: number, q = '') => `http://localhost:4100/jobs/${n}${q}`;

try {
  enqueue([u(1), u(2), u(3), normalizeUrl(u(1, '?utm_source=x'))]);
  const { startAddress } = await import('../src/sites/index.js');
  const { portalName } = await import('../src/portals/index.js');
  check('portal identified from the link first', portalName('https://acme.wd5.myworkdayjobs.com/x/job/1') === 'Workday' && portalName('https://job-boards.greenhouse.io/a/jobs/1') === 'Greenhouse' && portalName('https://jobs.ashbyhq.com/a/b') === 'Ashby' && portalName('http://localhost:4100/jobs/1') === null);
  check('Ashby and Lever links go straight to the form', startAddress('https://jobs.ashbyhq.com/co/16529089-a048-4bc3-8456-3f197135e00b').endsWith('/application') && startAddress('https://jobs.lever.co/co/b18cc87d-fca2-485a-a0f2-ad6197db63f2').endsWith('/apply') && startAddress('https://jobs.lever.co/co/b18cc87d-fca2-485a-a0f2-ad6197db63f2/apply').endsWith('/apply'));
  check('intake dedups tracking params', db.select().from(schema.application).all().length === 3);

  await processQueue();
  const a1 = get(u(1)), a2 = get(u(2)), a3 = get(u(3));
  check('job 1 is filled and stops at the submit button', a1.status === 'ready_to_submit', `${a1.status}: ${a1.reason}`);
  check('nothing was submitted', submissions.length === 0);
  check('CAPTCHA goes to human review', a2.status === 'human_review' && /CAPTCHA/.test(a2.reason ?? ''), `${a2.status}: ${a2.reason}`);
  check('missing required data goes to human review', a3.status === 'human_review' && /clearance/i.test(a3.reason ?? ''), `${a3.status}: ${a3.reason}`);
  check('a CAPTCHA does not stop the rest of the form being filled', (await openFormPage(a2.id)!.locator('#email').inputValue()) === 'jane@example.com');
  check('it keeps filling past a question it cannot answer', (await openFormPage(a3.id)!.locator('#first_name').inputValue()) === 'Jane' && (await openFormPage(a3.id)!.locator('#why').inputValue()).length > 20);
  check('company/role read off page', a1.company === 'Mockco' && a1.role === 'Backend Engineer', `${a1.company} / ${a1.role}`);
  check('filled form is left open for the applicant', isFormOpen(a1.id));
  check('applications needing help are left open to finish by hand', isFormOpen(a2.id) && isFormOpen(a3.id));

  // Read what the bot typed straight from the open form.
  const page = openFormPage(a1.id)!;
  const val = (sel: string) => page.locator(sel).inputValue();
  check('structured fields mapped from profile', (await val('#first_name')) === 'Jane' && (await val('#email')) === 'jane@example.com' && (await val('#linkedin')) === 'https://www.linkedin.com/in/janedoe');
  check('answer bank used for select + radio', (await page.locator('#auth').evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex].text)) === 'Yes' && (await page.locator('input[name=sponsor][value=no]').isChecked()));
  check('transcript attached to the transcript field', (await page.locator('#transcript').evaluate((i: HTMLInputElement) => i.files?.[0]?.name)) === 'transcript.pdf');
  check('resume attached as-is', (await page.locator('#resume').evaluate((i: HTMLInputElement) => i.files?.[0]?.name)) === 'resume.pdf');
  const letter = await val('#cover_letter');
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  check('cover letter uses your template: header, date, company greeting, fixed opening, sign-off',
    letter.startsWith('Jane Doe\njane@example.com\n\n' + today + '\n\nTo the Mockco Selection Committee,\n\n' + OPENING + '\n\n') && letter.endsWith('Sincerely,\n\nJane Doe') && !letter.includes('OtherCo'));
  check('the form tab shows the generated cover letter in a corner panel', (await page.locator('#jobdemon-letter pre').innerText()).includes(OPENING) && (await page.locator('#jobdemon-letter pre').innerText()) === letter);
  check('cover letter + paragraph generated', (await val('#cover_letter')).includes('Mockco') && (await val('#why')).length > 20);
  check('EEO declined, not guessed', (await page.locator('#gender').evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex].text)) === 'Decline To Self Identify');
  check('privacy statement checkbox ticked', await page.locator('#privacy').isChecked());
  check('code of conduct: picks "I agree", not "I do not agree"', (await page.locator('#conduct').evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex].text)) === 'I agree');
  check('non-compete answered from the answer bank', (await val('#noncompete')) === 'No');
  check('follow-up to a "No" answer is left blank', (await val('#noncompete_explain')) === '');
  check('custom dropdown picked from its list', (await val('#country')) === 'United States +1' && (await page.locator('input[name=country]').inputValue()) === 'United States +1', await val('#country'));
  check('hidden dropdown helpers are not treated as fields', !db.select().from(schema.stepLog).all().some((s) => s.target === 'Select...'));
  check('trace screenshots written', fs.readdirSync(path.join(config.tracesDir, String(a1.id))).length > 5);

  // An unreliable decider (low confidence, no target, every other step) must not stop the form.
  process.env.FAKE_FLAKY = '1';
  enqueue([u(4)]);
  await processQueue();
  delete process.env.FAKE_FLAKY;
  const a4 = get(u(4));
  const p4 = openFormPage(a4.id);
  check('unsure decisions never stop filling: whole form done', a4.status === 'ready_to_submit' && !!p4 && (await p4.locator('#why').inputValue()).length > 20 && (await p4.locator('#gender').inputValue()) !== '', `${a4.status}: ${a4.reason}`);

  // Getting to the form: tabs, multi-step forms, new tabs, embedded forms.
  enqueue([u(5), u(6), u(7), u(8), u(9)]);
  await processQueue();
  const [a5, a6, a7, a8, a9] = [5, 6, 7, 8, 9].map((n) => get(u(n)));
  const p5 = openFormPage(a5.id), p6 = openFormPage(a6.id), p7 = openFormPage(a7.id), p8 = openFormPage(a8.id);
  check('Ashby-style: opens the Application tab from the overview, then fills it', a5.status === 'ready_to_submit' && !!p5 && p5.url().endsWith('/jobs/5/application') && (await p5.locator('#first_name').inputValue()) === 'Jane', `${a5.status}: ${a5.reason} @ ${p5?.url()}`);
  check('Ashby-style Yes/No buttons answered from the answer bank', (await p5!.locator('[data-field-path=q18] [data-option=yes]').getAttribute('aria-pressed')) === 'true');
  check('Ashby radio question read with its real wording and options', db.select().from(schema.stepLog).all().some((s) => s.target === 'Veteran Status' && /not a protected veteran/.test(s.detail ?? '')));
  check('veteran question answered from your self-identification', await p5!.locator('#vet-1').isChecked());
  check('college start month and year filled', (await p5!.locator('#startmonth').evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex].text)) === 'August' && (await p5!.locator('#startyear').inputValue()) === '2024');
  check('school not in their list: picks "Other"', (await p5!.locator('#school').evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex].text)) === 'Other');
  check('high school graduation year filled', (await p5!.locator('#hs').inputValue()) === '2020');
  check('GPA and street address filled', (await p5!.locator('#gpa').inputValue()) === '3.9' && (await p5!.locator('#street').inputValue()) === '1 Main St');
  check('graduation month fills "End date month"', (await p5!.locator('#enddate').evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex].text)) === 'May');
  check('combined race/ethnicity list answered from race + ethnicity', await p5!.locator('#race-2').isChecked());
  check('pronouns filled from your self-identification', (await p5!.locator('#pronouns').evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex].text)) === 'He/Him');
  check('languages checkboxes: ticks only the ones in your Skills', await p5!.locator('#lang-ts').isChecked() && !(await p5!.locator('#lang-java').isChecked()) && !(await p5!.locator('#lang-cobol').isChecked()));
  check('blank ACT score picks the "no score" option', (await p5!.locator('#act').evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex].text)) === "I don't have this score");
  check('U.S. Person question answered Yes', (await p5!.locator('[data-field-path=usp] [data-option=yes]').getAttribute('aria-pressed')) === 'true');
  check('career-fair question answered No', (await p5!.locator('[data-field-path=fair] [data-option=no]').getAttribute('aria-pressed')) === 'true');
  check('"Autofill from resume" upload is left alone', (await p5!.locator('#autofill').evaluate((i: HTMLInputElement) => i.files?.length ?? 0)) === 0);
  check('multi-step: fills step 1, clicks Next, fills step 2, stops at the review page', a6.status === 'ready_to_submit' && !!p6 && (await p6.locator('#why').inputValue()).length > 20 && await p6.locator('#s3').isVisible(), `${a6.status}: ${a6.reason}`);
  check('follows an "Apply now" link that opens a new tab', a7.status === 'ready_to_submit' && !!p7 && p7.url().endsWith('/jobs/7/application') && (await p7.locator('#email').inputValue()) === 'jane@example.com', `${a7.status}: ${a7.reason} @ ${p7?.url()}`);
  check('Lever-style radio question read with its real wording', db.select().from(schema.stepLog).all().some((s) => s.target === 'Are you able to work from our Boulder office?'));
  check('opens a form embedded in an iframe', a8.status === 'ready_to_submit' && !!p8 && p8.url().includes('/embed/job_app') && (await p8.locator('#first_name').inputValue()) === 'Jane', `${a8.status}: ${a8.reason} @ ${p8?.url()}`);
  check('no form anywhere: says so instead of claiming it filled something', a9.status === 'human_review' && /couldn't find the application form/i.test(a9.reason ?? ''), `${a9.status}: ${a9.reason}`);
  check('still nothing submitted after all the navigating', submissions.length === 0 && stats.posts === 0);

  // Workday-style pop-up: "Apply" opens start options on the same page; the bot must move on to one of them.
  enqueue([u(12)]);
  await processQueue();
  const a12 = get(u(12)), p12 = openFormPage(a12.id);
  check('Workday-style Apply pop-up: picks a start option instead of re-clicking Apply', a12.status === 'ready_to_submit' && !!p12 && p12.url().endsWith('/jobs/12/application'), `${a12.status}: ${a12.reason} @ ${p12?.url()}`);
  check('never fills a "robots only" trap field', !!p12 && (await p12.locator('#trap').inputValue()) === '');

  // Workday look-alike: Apply -> start option -> sign-in wall (you) -> five steps -> stops at Submit.
  enqueue([u(13)]);
  const run13 = processQueue();
  for (let i = 0; i < 60 && get(u(13))?.status !== 'waiting_for_you'; i++) await new Promise((r) => setTimeout(r, 500));
  const w13 = get(u(13));
  check('Workday: clicks Apply and a start option, then waits for you at sign-in', w13.status === 'waiting_for_you', `${w13.status}: ${w13.reason}`);
  const wsp = openFormPage(w13.id)!;
  check('Workday: never types into the sign-in form', (await wsp.locator('#em').inputValue()) === '' && (await wsp.locator('#pw').inputValue()) === '');
  await wsp.fill('#em', 'jane@example.com');
  await wsp.fill('#pw', 'test-only-password');
  await Promise.all([wsp.waitForURL('**/jobs/13/apply', { timeout: 10000 }).catch(() => {}), wsp.click('button[type=submit]')]);
  await run13;
  const a13 = get(u(13)), p13 = openFormPage(a13.id);
  const logs13 = db.select().from(schema.stepLog).all().filter((s) => s.applicationId === a13.id);
  const val13 = (sel: string) => p13!.locator(sel).inputValue();
  const pill13 = async (id: string) => (await p13!.locator(`[data-automation-id="formField-${id}"] [data-automation-id=selectedItem]`).allInnerTexts()).join(', ');
  check('Workday recognised from first-page markers and sent to the Workday flow', logs13.some((s) => s.detail === 'Portal: Workday (Workday flow)') && !logs13.some((s) => /Portal not recognised/.test(s.detail ?? '')));
  check('Workday: takes over after sign-in and goes through every step to Submit', a13.status === 'ready_to_submit' && !!p13 && await p13.locator('#wsubmit').isVisible(), `${a13.status}: ${a13.reason}`);
  check('Workday: moves between steps by its own buttons, not Jev', logs13.filter((s) => s.op === 'NEXT').length === 4 && !logs13.some((s) => s.op === 'PAGE'));
  check('Workday: "How did you hear" follows the guideline through the sub-list (Job Board > LinkedIn)', !!p13 && (await pill13('source')) === 'LinkedIn', await pill13('source'));
  check('Workday: "Country Phone Code" searched and picked', !!p13 && (await pill13('phoneCode')) === 'United States of America (+1)', await pill13('phoneCode'));
  check('Workday: button dropdown picked from its list', !!p13 && (await p13.locator('#countryDropdown').innerText()) === 'United States of America');
  check('Workday: text fields filled, optional extension left empty', !!p13 && (await val13('#legalNameSection_firstName')) === 'Jane' && (await val13('#postalCode')) === '02115' && (await val13('#extension')) === '');
  check('Workday: "I have a preferred name" left unticked', !!p13 && !(await p13.locator('#preferredCheckbox').isChecked()));
  check('Workday: hidden leftover "Terms and Conditions" box ignored', !logs13.some((s) => s.target === 'Terms and Conditions'));
  check('Workday: repeating sections get one entry per job and school in your profile', !!p13 && (await p13.locator('.entries[data-kind=work] .entry').count()) === 1 && (await p13.locator('.entries[data-kind=edu] .entry').count()) === 1);
  check('Workday: entry fields filled from that entry\'s facts', !!p13 && (await val13('#jobTitle-1')) === 'Software Engineer' && (await val13('#companyName-1')) === 'Acme Corp' && (await val13('#school-1')) === 'State University' && (await p13.locator('#degree-1').innerText()) === 'BS Computer Science');
  check('Workday: Month / Year date boxes filled', !!p13 && (await val13('[data-automation-id="formField-startDate-1"] [data-automation-id=dateSectionMonth-input]')) === '07' && (await val13('[data-automation-id="formField-startDate-1"] [data-automation-id=dateSectionYear-input]')) === '2021');
  check('Workday: skills searched one by one when the first suggestions don\'t fit', !!p13 && (await pill13('skills')).split(', ').sort().join(',') === 'AWS,Node.js,PostgreSQL,TypeScript', await pill13('skills'));
  check('Workday: "I currently work here" ticked for a current job', !!p13 && await p13.locator('#currentlyWorkHere-1').isChecked());
  check('Workday: resume uploaded', !!p13 && (await p13.locator('#uploaded').innerText()) === 'resume.pdf');
  check('Workday: radio question answered', !!p13 && await p13.locator('#workAuth-0').isChecked());
  check('Workday: open-ended answer written', !!p13 && (await val13('#why')).length > 20);
  check('Workday: demographic question declined, not guessed', !!p13 && (await p13.locator('#gender').innerText()) === 'I decline to self-identify');
  check('Workday: consent box ticked', !!p13 && await p13.locator('#termsAndConditions').isChecked());
  const snaps = fs.readdirSync(path.join(config.tracesDir, String(a13.id))).filter((f) => f.startsWith('workday-step-'));
  const snapText = snaps.map((f) => fs.readFileSync(path.join(config.tracesDir, String(a13.id), f), 'utf8')).join('\n');
  check('Workday: a structure snapshot per step, with no values in it', snaps.length >= 5 && !/Jane|Acme Corp|02115|jane@example/.test(snapText), `${snaps.length} snapshots`);
  enqueue([u(14)]);
  await processQueue();
  const a14 = get(u(14));
  const logs14 = db.select().from(schema.stepLog).all().filter((s) => s.applicationId === a14.id);
  const nexts14 = logs14.filter((s) => s.op === 'NEXT').length;
  check('Workday: the sign-in is remembered for the next job', !logs14.some((s) => s.op === 'WAIT_FOR_YOU'));
  check('Workday: a step that won\'t advance is retried once with Workday\'s message, then reported', a14.status === 'human_review' && /didn't move on/.test(a14.reason ?? '') && /Employee ID/.test(a14.reason ?? '') && logs14.some((s) => s.op === 'RETRY') && nexts14 === 2, `${a14.status} after ${nexts14} clicks: ${a14.reason}`);
  // The same application built with standard markup only (no Workday names): the flow must get through unchanged.
  enqueue([u(15)]);
  await processQueue();
  const a15 = get(u(15)), p15 = openFormPage(a15.id);
  const logs15 = db.select().from(schema.stepLog).all().filter((s) => s.applicationId === a15.id);
  const v15 = (sel: string) => p15!.locator(sel).inputValue();
  const chips15 = async (id: string) => (await p15!.locator(`#${id}`).locator('xpath=..').locator('.chips [role=option]').allInnerTexts()).join(', ');
  check('Standard markup: every step filled, stops at "Submit application"', a15.status === 'ready_to_submit' && !!p15 && await p15.locator('#send').isVisible(), `${a15.status}: ${a15.reason}`);
  check('Standard markup: steps followed by aria-current, Next found in the footer', logs15.filter((s) => s.op === 'NEXT').length === 4);
  check('Standard markup: combobox tree picked (Job Board > LinkedIn)', !!p15 && (await chips15('heard')) === 'LinkedIn', await chips15('heard'));
  check('Standard markup: search-only combobox searched and picked', !!p15 && (await chips15('dial')) === 'United States of America (+1)', await chips15('dial'));
  check('Standard markup: skills searched one by one', !!p15 && (await chips15('skills')).split(', ').sort().join(',') === 'AWS,Node.js,PostgreSQL,TypeScript', await chips15('skills'));
  check('Standard markup: listbox button picked', !!p15 && (await p15.locator('#ctry').innerText()) === 'United States of America');
  check('Standard markup: text fields filled, optional extension left empty', !!p15 && (await v15('#fname')) === 'Jane' && (await v15('#zip')) === '02115' && (await v15('#ext')) === '');
  check('Standard markup: custom role=checkbox left alone / ticked as answered', !!p15 && (await p15.locator('#pref').getAttribute('aria-checked')) === 'false' && (await p15.locator('#agree').getAttribute('aria-checked')) === 'true');
  check('Standard markup: "Add another" sections get one entry per job and school', !!p15 && (await p15.locator('.items[data-kind=job] .item').count()) === 1 && (await p15.locator('.items[data-kind=school] .item').count()) === 1);
  check('Standard markup: entry fields filled ("Job 1 > Title", "School 1 > Degree")', !!p15 && (await v15('#title-1')) === 'Software Engineer' && (await v15('#employer-1')) === 'Acme Corp' && (await v15('#inst-1')) === 'State University' && (await p15.locator('#deg-1').innerText()) === 'BS Computer Science');
  check('Standard markup: date parts told apart by their range, not their names', !!p15 && (await p15.locator('.item .sp').nth(0).inputValue()) === '07' && (await p15.locator('.item .sp').nth(1).inputValue()) === '2021');
  check('Standard markup: "I currently work here" (role=checkbox) ticked for a current job', !!p15 && (await p15.locator('#current-1').getAttribute('aria-checked')) === 'true');
  check('Standard markup: hidden file input attached', !!p15 && (await p15.locator('#cvname').innerText()) === 'resume.pdf');
  check('Standard markup: radio group labelled by aria-labelledby answered', !!p15 && await p15.locator('input[name=auth][value=Yes]').isChecked());
  check('Standard markup: native <select> declined for a demographic question', !!p15 && (await p15.locator('#sex').evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex].text)) === 'Prefer not to say');
  check('Standard markup: open-ended answer written', !!p15 && (await v15('#motive')).length > 20);

  // "Fill this page": fills what is empty on the page the tab shows now, leaves the rest, never navigates.
  const { fillPage } = await import('../src/portals/fillPage.js');
  const p3 = openFormPage(a3.id)!;
  await p3.fill('#first_name', '');
  await p3.fill('#last_name', 'Typed-By-You');
  const m3 = await fillPage(a3.id, p3);
  check('Fill this page (generic): refills an empty field, keeps what you typed, reports what is still missing', (await p3.locator('#first_name').inputValue()) === 'Jane' && (await p3.locator('#last_name').inputValue()) === 'Typed-By-You' && /clearance/i.test(m3), m3);
  const p14 = openFormPage(a14.id)!;
  await p14.fill('#legalNameSection_firstName', '');
  const url14 = p14.url();
  const m14 = await fillPage(a14.id, p14);
  check('Fill this page (Workday): refills an empty field on the current step and stays on it', (await p14.locator('#legalNameSection_firstName').inputValue()) === 'Jane' && p14.url() === url14 && await p14.locator('[data-name="My Information"]').isVisible(), m14);
  // "Continue from here": you fix what stopped the run by hand, then the bot carries on to Submit in the same tab.
  const { continueApplication } = await import('../src/portals/index.js');
  const { makeDecider } = await import('../src/decider/index.js');
  const { makeWriter } = await import('../src/writer/index.js');
  await p14.fill('#employeeId', 'E-12345');
  await continueApplication(get(u(14)), makeDecider(), makeWriter());
  const c14 = get(u(14)), q14 = openFormPage(c14.id);
  const nextsAfter = db.select().from(schema.stepLog).all().filter((s) => s.applicationId === c14.id && s.op === 'NEXT').length - nexts14;
  check('Continue from here: carries on from the page you fixed, through every step, to Submit', c14.status === 'ready_to_submit' && !!q14 && await q14.locator('#wsubmit').isVisible() && nextsAfter === 4 && (await q14.locator('#employeeId').inputValue()) === 'E-12345', `${c14.status}: ${c14.reason} (${nextsAfter} Next clicks)`);
  check('Continue from here: keeps the company and role read at the start', c14.company === a14.company && c14.role === a14.role);
  check('Workday: Submit never clicked', stats.posts === 0 && submissions.length === 0);

  // Sign-in walls: the bot waits for you, then takes over; the sign-in is remembered.
  enqueue([u(10)]);
  const run = processQueue();
  for (let i = 0; i < 60 && get(u(10))?.status !== 'waiting_for_you'; i++) await new Promise((r) => setTimeout(r, 500));
  const a10 = get(u(10));
  check('pauses at the sign-in page and waits for you', a10.status === 'waiting_for_you' && isFormOpen(a10.id), `${a10.status}: ${a10.reason}`);
  const sp = openFormPage(a10.id)!;
  check('does not type into the sign-in form itself', (await sp.locator('#em').inputValue()) === '');
  await sp.fill('#em', 'jane@example.com');
  await sp.fill('#pw', 'test-only-password');
  await Promise.all([sp.waitForURL('**/jobs/10', { timeout: 10000 }).catch(() => {}), sp.click('button[type=submit]')]);
  await run;
  const done10 = get(u(10)), p10 = openFormPage(done10.id);
  check('takes over after you sign in and fills the form', done10.status === 'ready_to_submit' && !!p10 && (await p10.locator('#first_name').inputValue()) === 'Jane', `${done10.status}: ${done10.reason}`);
  enqueue([u(11)]);
  await processQueue();
  const a11 = get(u(11));
  const waited11 = db.select().from(schema.stepLog).all().some((s) => s.applicationId === a11.id && s.op === 'WAIT_FOR_YOU');
  check('remembers the sign-in: the next job on that site skips the wait', a11.status === 'ready_to_submit' && !waited11, `${a11.status}: ${a11.reason}`);

  // Running a single application leaves the rest of the queue alone.
  enqueue([u(9, '?single=a'), u(9, '?single=b')]);
  const [sa, sb] = [get(u(9, '?single=a')), get(u(9, '?single=b'))];
  await processQueue([sa.id]);
  check('"Run this one" runs only that application', get(u(9, '?single=a')).status !== 'queued' && get(u(9, '?single=b')).status === 'queued', `${get(u(9, '?single=a')).status} / ${get(u(9, '?single=b')).status}`);

  // Re-running does not touch filled applications.
  await processQueue();
  check('re-run leaves filled applications alone', get(u(1)).status === 'ready_to_submit' && submissions.length === 0);

  // Backstop: while the bot is working, even a forced form submission is refused.
  const botTabs = await AppTabs.create();
  const botPage = await botTabs.newPage();
  await botPage.goto(u(1));
  await botPage.evaluate(() => (document.querySelector('form') as HTMLFormElement).submit()).catch(() => {});
  await botPage.waitForTimeout(1000);
  check('bot browser refuses form submissions', stats.posts === 0, `${stats.posts} attempt(s) reached the server`);
  await botTabs.close();

  // Once handed over, YOU can submit the filled form in that same tab.
  await Promise.all([page.waitForLoadState('load').catch(() => {}), page.locator('button[type=submit]').click()]);
  await page.waitForTimeout(500);
  check('you can submit the handed-over form yourself', submissions.length === 1 && submissions[0].fields.first_name === 'Jane');
} catch (err) {
  // A crash inside the checks is a failure, never a silent pass.
  failed++;
  console.log(`FAIL test crashed: ${(err as Error).message.split('\n')[0]}`);
} finally {
  await closeBrowser();
  server.close();
  console.log(failed ? `\n${failed} check(s) failed. Data kept at ${dir}` : `\nAll checks passed.`);
  if (!failed) fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
