// End-to-end test against the mock board, with the fake decider + writer and a throwaway data dir.
// Run: npm run test:e2e   (add DECIDER=jev WRITER=openai to exercise the real APIs)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobdemon-e2e-'));
process.env.DATA_DIR = dir;
process.env.DECIDER ??= 'fake';
process.env.WRITER ??= 'fake';
delete process.env.LIVE;

const { startMock, submissions } = await import('./server.js');
const { config } = await import('../src/config.js');
const { db, schema, updateApp } = await import('../src/db/index.js');
const { saveProfile } = await import('../src/profile.js');
const { enqueue, normalizeUrl } = await import('../src/intake.js');
const { processQueue } = await import('../src/run.js');
const { eq } = await import('drizzle-orm');

const server = startMock(4100);
const tpl = (f: string) => JSON.parse(fs.readFileSync(path.join(config.templatesDir, f), 'utf8'));
saveProfile(tpl('profile.example.json'), tpl('answer_bank.example.json'));
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
  check('dry-run fills job 1 and stops before submit', a1.status === 'ready_to_submit', `${a1.status}: ${a1.reason}`);
  check('dry-run never submits', submissions.length === 0);
  check('CAPTCHA goes to human review', a2.status === 'human_review' && /CAPTCHA/.test(a2.reason ?? ''), `${a2.status}: ${a2.reason}`);
  check('missing required data goes to human review', a3.status === 'human_review' && /clearance/i.test(a3.reason ?? ''), `${a3.status}: ${a3.reason}`);
  check('company/role read off page', a1.company === 'Mockco' && a1.role === 'Backend Engineer', `${a1.company} / ${a1.role}`);

  // Approve job 1 in the UI → submits for real (to the mock) and verifies.
  updateApp(a1.id, { live: true, status: 'queued' });
  await processQueue();
  const done = get(u(1));
  check('approved application is submitted and verified', done.status === 'applied', `${done.status}: ${done.reason}`);
  const s = submissions[0]?.fields ?? {};
  check('mock received exactly one submission', submissions.length === 1);
  check('structured fields mapped from profile', s.first_name === 'Jane' && s.email === 'jane@example.com' && s.linkedin === 'https://www.linkedin.com/in/janedoe', JSON.stringify({ f: s.first_name, e: s.email }));
  check('answer bank used for select + radio', s.auth === 'Yes' && s.sponsor === 'no', `auth=${s.auth} sponsor=${s.sponsor}`);
  check('resume uploaded as-is', /^file:resume\.pdf:\d+$/.test(s.resume ?? ''), s.resume);
  check('cover letter + paragraph generated', (s.cover_letter ?? '').includes('Mockco') && (s.why ?? '').length > 20);
  check('EEO declined, not guessed', s.gender === 'Decline To Self Identify', s.gender);
  check('trace screenshots written', fs.readdirSync(path.join(config.tracesDir, String(done.id))).length > 5);

  // Re-running must not double-submit.
  await processQueue();
  check('re-run does not resubmit', submissions.length === 1);

  // Simulated crash right after clicking submit: must escalate, never click again.
  enqueue([u(1, '?crash=1')]);
  const crashed = get(u(1, '?crash=1'));
  updateApp(crashed.id, { status: 'in_progress', submitClickedAt: new Date().toISOString(), live: true });
  await processQueue();
  check('crash after submit escalates instead of resubmitting', get(u(1, '?crash=1')).status === 'human_review' && submissions.length === 1);
} finally {
  server.close();
  console.log(failed ? `\n${failed} check(s) failed. Data kept at ${dir}` : `\nAll checks passed.`);
  if (!failed) fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
