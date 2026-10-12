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

const { startMock, submissions, stats } = await import('./server.js');
const { config } = await import('../src/config.js');
const { db, schema } = await import('../src/db/index.js');
const { saveProfile } = await import('../src/profile.js');
const { enqueue, normalizeUrl } = await import('../src/intake.js');
const { processQueue } = await import('../src/run.js');
const { openFormPage, isFormOpen, closeBrowser, newApplicationContext } = await import('../src/agent/browser.js');
const { eq } = await import('drizzle-orm');

const server = startMock(4100);
const tpl = (f: string) => JSON.parse(fs.readFileSync(path.join(config.templatesDir, f), 'utf8'));
const OPENING = 'I care about two things: create and challenge. This paragraph never changes.';
const baseProfile = tpl('profile.example.json');
baseProfile.fields = { ...baseProfile.fields, veteran_status: 'No, I am not a protected veteran', graduation_month: 'May', race: 'Asian', ethnicity: 'No, not Hispanic or Latino', pronouns: 'He/him', school_start_month: 'August', school_start_year: '2024', gpa: '3.9', high_school_grad_year: '2020', address_street: '1 Main St' };
saveProfile({ ...baseProfile, cover_letter: {
  header: 'Jane Doe\njane@example.com', salutation: 'To the {company} Selection Committee,', opening: OPENING,
  examples: 'My experience paragraph.\n\nWhy OtherCo paragraph.', closing: 'Sincerely,\n\nJane Doe',
} }, tpl('answer_bank.example.json'));
fs.writeFileSync(config.resumePath, '%PDF-1.4 fake resume');

let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`); if (!ok) failed++; };
const get = (url: string) => db.select().from(schema.application).where(eq(schema.application.url, normalizeUrl(url))).get()!;
const u = (n: number, q = '') => `http://localhost:4100/jobs/${n}${q}`;

try {
  enqueue([u(1), u(2), u(3), normalizeUrl(u(1, '?utm_source=x'))]);
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
  check('opens a form embedded in an iframe', a8.status === 'ready_to_submit' && !!p8 && p8.url().includes('/embed/job_app') && (await p8.locator('#first_name').inputValue()) === 'Jane', `${a8.status}: ${a8.reason} @ ${p8?.url()}`);
  check('no form anywhere: says so instead of claiming it filled something', a9.status === 'human_review' && /couldn't find the application form/i.test(a9.reason ?? ''), `${a9.status}: ${a9.reason}`);
  check('still nothing submitted after all the navigating', submissions.length === 0 && stats.posts === 0);

  // Re-running does not touch filled applications.
  await processQueue();
  check('re-run leaves filled applications alone', get(u(1)).status === 'ready_to_submit' && submissions.length === 0);

  // Backstop: while the bot is working, even a forced form submission is refused.
  const botCtx = await newApplicationContext();
  const botPage = await botCtx.newPage();
  await botPage.goto(u(1));
  await botPage.evaluate(() => (document.querySelector('form') as HTMLFormElement).submit()).catch(() => {});
  await botPage.waitForTimeout(1000);
  check('bot browser refuses form submissions', stats.posts === 0, `${stats.posts} attempt(s) reached the server`);
  await botCtx.close();

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
