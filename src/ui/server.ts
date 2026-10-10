// Local control panel: http://localhost:3000 (bound to 127.0.0.1 only).
// Queue links, run the bot, review results, and edit your profile — all from the browser.
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { html } from 'hono/html';
import { asc, desc, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema, updateApp } from '../db/index.js';
import { enqueue, parseUrls } from '../intake.js';
import { saveProfile, type BankEntry, type Profile } from '../profile.js';
import { processQueue } from '../run.js';
import { layout, icon, badge, flash, ago, STATUS, OPS } from './views.js';
import { SCREENING, OTHER, currentChoice, applyChoices } from './screening.js';
import { FIELD_GROUPS, toForm, fromForm, customFromForm, type Job, type School } from './profileForm.js';
import { draftFromResume } from '../resumeParse.js';

type App = typeof schema.application.$inferSelect;

// One run at a time, inside this server process. Work queued mid-run triggers a follow-up run.
const runState = { running: false, again: false, last: '' };
function startRun() {
  if (runState.running) { runState.again = true; return; }
  runState.running = true;
  runState.again = false;
  processQueue()
    .then((n) => (runState.last = n ? `Last run finished ${n} application${n === 1 ? '' : 's'}.` : 'Nothing was queued.'))
    .catch((e: Error) => (runState.last = `Run failed: ${e.message}`))
    .finally(() => { runState.running = false; if (runState.again) startRun(); });
}

const read = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
const tpl = (f: string) => read(path.join(config.templatesDir, f));
function setupStatus() {
  const prof = read(config.profilePath);
  const bank = read(config.answerBankPath);
  return {
    resume: fs.existsSync(config.resumePath),
    profile: !!prof && prof !== tpl('profile.example.json'),
    bank: !!bank && bank !== tpl('answer_bank.example.json'),
  };
}

const allApps = () => db.select().from(schema.application).orderBy(desc(schema.application.updatedAt)).all();
const version = (apps: App[]) => `${runState.running}:${apps.length}:${apps[0]?.updatedAt ?? ''}`;
const STATUS_ORDER = ['human_review', 'ready_to_submit', 'in_progress', 'queued', 'applied', 'duplicate'];
const FILTERS: [string, string][] = [['all', 'All'], ['human_review', 'Needs you'], ['ready_to_submit', 'Ready'], ['applied', 'Applied'], ['queued', 'Queued'], ['duplicate', 'Skipped']];

const app = new Hono();

// ── Applications ────────────────────────────────────────────────────────────
app.get('/', (c) => {
  const filter = c.req.query('s') ?? 'all';
  const apps = allApps();
  const shown = apps
    .filter((a) => filter === 'all' || a.status === filter || (filter === 'queued' && a.status === 'in_progress'))
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const count = (s: string) => apps.filter((a) => a.status === s).length;
  const setup = setupStatus();
  const missing = [!setup.resume && 'upload your resume', !setup.profile && 'replace the example profile', !setup.bank && 'review the example answers'].filter(Boolean);
  const queued = count('queued');

  const stat = (s: string, n: number) => {
    const m = STATUS[s];
    return html`<a class="card stat t-${m.tone}" href="/?s=${s}" ${filter === s ? html`aria-current="true"` : ''}>
<span class="stat-top">${m.label}${icon(m.icon)}</span><span class="stat-num">${n}</span></a>`;
  };

  return c.html(layout({ title: 'Applications', active: 'apps', live: config.live }, html`
<div class="page-head"><div><h1>Applications</h1>
<p class="lede">${config.live ? 'Live mode: the bot submits applications without asking.' : 'Dry-run: the bot fills each form, then waits for your approval before submitting.'}</p></div></div>

${missing.length ? html`<div class="callout t-warn" role="status">${icon('alert')}<div><b>Finish setup before adding real links.</b> You still need to ${missing.join(', ')}. <a href="/setup">Go to Setup</a></div></div>` : ''}

<section class="card card-pad" aria-labelledby="add-h">
<form method="post" action="/urls">
<div class="card-head">${icon('plus')}<h2 id="add-h">Add job links</h2></div>
<label class="lbl" for="urls">Apply links</label>
<textarea id="urls" name="urls" placeholder="https://job-boards.greenhouse.io/company/jobs/1234567" required></textarea>
<p class="help">One per line, or paste a whole list. Duplicates and tracking parameters are removed.</p>
<div class="row" style="margin-top:14px">
<button class="btn btn-primary" name="run" value="1">${icon('play')}Add &amp; run</button>
<button class="btn">Add to queue</button></div>
</form></section>

<div id="live" data-running="${runState.running ? '1' : '0'}" data-version="${version(apps)}" style="display:grid;gap:20px">
<div class="stats">${stat('human_review', count('human_review'))}${stat('ready_to_submit', count('ready_to_submit'))}${stat('applied', count('applied'))}${stat('queued', queued + count('in_progress'))}</div>

<section class="card runbar" aria-live="polite">
${runState.running
    ? html`<span class="pulse">${icon('loader', 'spin')}Running</span><span class="grow">The bot is working through the queue. This updates by itself.</span>`
    : html`<form method="post" action="/run" class="inline"><button class="btn btn-primary" ${queued ? '' : 'disabled'}>${icon('play')}Run queue${queued ? ` (${queued})` : ''}</button></form>
<span class="grow">${runState.last || (queued ? `${queued} link${queued === 1 ? '' : 's'} waiting.` : 'Queue is empty.')}</span>`}
</section>

<section class="card" aria-labelledby="list-h">
<div class="list-head"><h2 id="list-h">All applications</h2>
<nav class="filters" aria-label="Filter by status">${FILTERS.map(([k, l]) => html`<a href="${k === 'all' ? '/' : `/?s=${k}`}" ${filter === k ? html`aria-current="true"` : ''}>${l}</a>`)}</nav></div>
${shown.length ? html`<ul class="apps">${shown.map(row)}</ul>` : html`<div class="empty">${icon('inbox')}<h3>${apps.length ? 'Nothing here' : 'No applications yet'}</h3><p>${apps.length ? 'No applications have this status.' : 'Paste job links above to get started.'}</p></div>`}
</section>
</div>`));
});

function row(a: App) {
  return html`<li class="app">
<div>${badge(a.status)}</div>
<div style="min-width:0">
<a class="app-title" href="/app/${a.id}">${a.role || 'Untitled role'}${a.company ? html` <span style="font-weight:400;color:var(--muted)">at ${a.company}</span>` : ''}</a>
<div class="app-meta"><span>#${a.id}</span><span>${ago(a.updatedAt)}</span><a href="${a.url}" target="_blank" rel="noopener" title="${a.url}">${icon('external')}${new URL(a.url).host}</a>${a.live && a.status !== 'applied' ? html`<span>Approved</span>` : ''}</div>
${a.reason && a.status !== 'applied' ? html`<div class="app-reason">${a.reason}</div>` : ''}
</div>
<div class="app-actions">${actions(a, true)}</div>
</li>`;
}

function actions(a: App, compact = false) {
  const sm = compact ? ' btn-sm' : '';
  const btn = (act: string, label: unknown, cls = '', confirmMsg = '') =>
    html`<form class="inline" method="post" action="/app/${a.id}/${act}" ${confirmMsg ? html`data-confirm="${confirmMsg}"` : ''}><button class="btn${sm} ${cls}">${label}</button></form>`;
  if (a.status === 'ready_to_submit') return html`${btn('approve', html`${icon('send')}Approve &amp; submit`, 'btn-ok', `Submit this application to ${a.company ?? 'the employer'} for real? This cannot be undone.`)}${btn('applied', 'I submitted it', 'btn-ghost')}`;
  if (a.status === 'human_review') return html`${btn('applied', html`${icon('check')}I submitted it`)}${a.submitClickedAt ? '' : btn('requeue', 'Retry')}${btn('dismiss', 'Dismiss', 'btn-ghost', 'Dismiss this application?')}`;
  return '';
}

app.get('/api/status', (c) => c.json({ running: runState.running, version: version(allApps()) }));

app.post('/urls', async (c) => {
  const body = await c.req.parseBody();
  enqueue(parseUrls(String(body.urls ?? '')));
  if (body.run) startRun();
  return c.redirect('/');
});

app.post('/run', (c) => {
  startRun();
  return c.redirect('/');
});

app.post('/app/:id/:act', (c) => {
  const id = Number(c.req.param('id'));
  const a = db.select().from(schema.application).where(eq(schema.application.id, id)).get();
  if (!a) return c.notFound();
  switch (c.req.param('act')) {
    case 'approve': if (a.status === 'ready_to_submit') { updateApp(id, { live: true, status: 'queued', reason: 'Approved: submitting' }); startRun(); } break;
    case 'applied': updateApp(id, { status: 'applied', reason: 'Marked applied by you', confidence: 1 }); break;
    case 'requeue': if (!a.submitClickedAt) { updateApp(id, { status: 'queued', reason: null, step: 0 }); startRun(); } break;
    case 'dismiss': updateApp(id, { status: 'duplicate', reason: 'Dismissed by you' }); break;
  }
  const back = c.req.header('referer');
  return c.redirect(back && new URL(back).pathname.startsWith('/app/') ? back : '/');
});

// ── Application detail ──────────────────────────────────────────────────────
app.get('/app/:id', (c) => {
  const id = Number(c.req.param('id'));
  const a = db.select().from(schema.application).where(eq(schema.application.id, id)).get();
  if (!a) return c.notFound();
  const steps = db.select().from(schema.stepLog).where(eq(schema.stepLog.applicationId, id)).orderBy(asc(schema.stepLog.id)).all();
  const letter = read(path.join(config.lettersDir, `${id}-cover-letter.txt`));
  const tone = STATUS[a.status]?.tone ?? 'neutral';

  return c.html(layout({ title: a.role ?? `#${id}`, active: 'apps', live: config.live }, html`
<a class="back" href="/">${icon('arrowLeft')}All applications</a>
<div class="page-head"><div>
<div style="margin-bottom:8px">${badge(a.status)}</div>
<h1>${a.role || 'Untitled role'}${a.company ? html` <span style="font-weight:400;color:var(--muted)">at ${a.company}</span>` : ''}</h1>
<p class="lede"><a href="${a.url}" target="_blank" rel="noopener">${a.url}</a></p></div>
<div class="row">${actions(a)}</div></div>

${a.reason ? html`<div class="callout t-${tone}">${icon(STATUS[a.status]?.icon ?? 'alert')}<div><b>${STATUS[a.status]?.label ?? a.status}.</b> ${a.reason}</div></div>` : ''}
${a.submitClickedAt && a.status !== 'applied' ? html`<div class="callout t-danger" role="alert">${icon('shield')}<div><b>Submit was already clicked</b> at ${new Date(a.submitClickedAt).toLocaleString()}. The bot will never click it again for this posting. Check with the company before retrying by hand.</div></div>` : ''}

<section class="card card-pad"><dl class="kv">
<div><dt>Application</dt><dd>#${a.id}</dd></div>
<div><dt>Mode</dt><dd>${a.live || config.live ? 'Submit' : 'Dry-run'}</dd></div>
<div><dt>Confidence</dt><dd>${a.confidence != null ? `${Math.round(a.confidence * 100)}%` : '—'}</dd></div>
<div><dt>Steps</dt><dd>${a.step}</dd></div>
<div><dt>Updated</dt><dd>${ago(a.updatedAt)}</dd></div>
</dl></section>

${letter ? html`<section class="card card-pad"><div class="card-head">${icon('file')}<h2>Cover letter</h2></div><pre class="letter">${letter}</pre></section>` : ''}

<section class="card"><div class="list-head"><h2>Step-by-step trace</h2><span class="help" style="margin:0">${steps.length} step${steps.length === 1 ? '' : 's'}</span></div>
${steps.length ? html`<ol class="timeline">${steps.map((s) => {
    const op = OPS[s.op] ?? { label: s.op, tone: 'neutral' };
    return html`<li class="step"><span class="step-n">${String(s.step).padStart(2, '0')}</span>
<span><span class="badge t-${op.tone}">${op.label}</span></span>
<div>${s.target ? html`<div class="step-target">${s.target}</div>` : ''}${s.detail ? html`<div class="step-detail">${s.detail}</div>` : ''}
${s.screenshot ? html`<details><summary>${icon('image')}Screenshot</summary><img loading="lazy" alt="Page at step ${s.step}" src="/files/${s.screenshot}"></details>` : ''}</div></li>`;
  })}</ol>` : html`<div class="empty">${icon('clock')}<h3>No steps yet</h3><p>This application hasn't been run.</p></div>`}
</section>`));
});

// ── Setup ───────────────────────────────────────────────────────────────────
const loadProfileFile = (): Profile => JSON.parse(read(config.profilePath) || tpl('profile.example.json'));
const loadBankFile = (): BankEntry[] => JSON.parse(read(config.answerBankPath) || tpl('answer_bank.example.json'));
function persist(profile: Profile, bank: BankEntry[]) {
  fs.writeFileSync(config.profilePath, JSON.stringify(profile, null, 2) + '\n');
  fs.writeFileSync(config.answerBankPath, JSON.stringify(bank, null, 2) + '\n');
  saveProfile(profile, bank);
}
const draftPath = () => path.join(config.dataDir, 'profile.draft.json');
const loadDraft = (): Profile | null => { try { return JSON.parse(read(draftPath())); } catch { return null; } };
const clearDraft = () => fs.rmSync(draftPath(), { force: true });
/** Read the uploaded resume into a draft profile shown on Setup for review. Returns an error message or null. */
async function parseIntoDraft(): Promise<string | null> {
  try {
    const draft = await draftFromResume(config.resumePath, loadProfileFile(), !setupStatus().profile);
    fs.writeFileSync(draftPath(), JSON.stringify(draft, null, 2) + '\n');
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
const back = (msg: string, hash = '') => `/setup?msg=${encodeURIComponent(msg)}${hash}`;

const removeBtn = (what: string) =>
  html`<button type="button" class="btn btn-ghost btn-sm rep-remove" aria-label="Remove this ${what}">Remove</button>`;
const jobRow = (j: Job) => html`<div class="rep"><div class="rep-head"><span class="rep-title">Job</span>${removeBtn('job')}</div><div class="fgrid">
<label class="fld"><span>Company</span><input type="text" name="job_company" value="${j.company}" placeholder="Acme Corp"></label>
<label class="fld"><span>Title</span><input type="text" name="job_title" value="${j.title}" placeholder="Software Engineer"></label>
<label class="fld"><span>Start</span><input type="text" name="job_start" value="${j.start}" placeholder="2021-07"></label>
<label class="fld"><span>End</span><input type="text" name="job_end" value="${j.end}" placeholder="present"></label>
<label class="fld wide"><span>Highlights</span><textarea name="job_highlights" rows="3" placeholder="One per line, with numbers where you can. e.g. Cut CI time from 25 to 8 minutes.">${j.highlights.join('\n')}</textarea></label>
</div></div>`;
const eduRow = (e: School) => html`<div class="rep"><div class="rep-head"><span class="rep-title">School</span>${removeBtn('school')}</div><div class="fgrid">
<label class="fld"><span>School</span><input type="text" name="edu_school" value="${e.school}" placeholder="State University"></label>
<label class="fld"><span>Degree</span><input type="text" name="edu_degree" value="${e.degree}" placeholder="BS"></label>
<label class="fld"><span>Field of study</span><input type="text" name="edu_discipline" value="${e.discipline}" placeholder="Computer Science"></label>
<label class="fld"><span>Graduation year</span><input type="text" name="edu_year" value="${e.year}" placeholder="2021" inputmode="numeric"></label>
</div></div>`;
const cqRow = (q: BankEntry) => html`<div class="cq-row"><input type="hidden" name="cq_id" value="${q.id}">
<label class="fld"><span>Question</span><input type="text" name="cq_question" value="${q.question}" placeholder="Are you willing to travel?"></label>
<label class="fld"><span>Answer</span><input type="text" name="cq_answer" value="${q.answer}" placeholder="Yes, up to 25%"></label>
<button type="button" class="btn btn-ghost rep-remove" aria-label="Remove this question">${icon('minus')}</button></div>`;

app.get('/setup', (c) => {
  const st = setupStatus();
  const item = (ok: boolean, label: string, todo: string, href: string) =>
    html`<a class="card check t-${ok ? 'ok' : 'warn'}" href="${href}"><span class="dot">${icon(ok ? 'check' : 'alert')}</span><div>${label}<div class="help" style="margin:0">${ok ? 'Done' : todo}</div></div></a>`;
  const bytes = st.resume ? fs.statSync(config.resumePath).size : 0;
  const size = bytes < 1024 ? `${bytes} bytes` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
  // Don't pre-select the example answers: every choice should be a deliberate click.
  const bank = st.bank ? loadBankFile() : [];
  const custom = loadBankFile().filter((b) => !SCREENING.some((q) => q.id === b.id));
  const draft = loadDraft();
  const pf = toForm(draft ?? loadProfileFile());

  return c.html(layout({ title: 'Setup', active: 'setup', live: config.live }, html`
<div class="page-head"><div><h1>Setup</h1><p class="lede">What the bot knows about you. It never invents anything that isn't here.</p></div></div>
${flash(c.req.query('msg'))}
<div class="checklist">
${item(st.resume, 'Resume', 'Upload a PDF', '#resume-card')}
${item(st.bank, 'Screening answers', 'Not answered yet', '#screening-card')}
${item(st.profile, 'Profile', 'Still the example', '#profile-card')}
</div>

<section class="card card-pad" id="resume-card" aria-labelledby="r-h">
<div class="card-head"><span class="step-num">1</span><h2 id="r-h">Resume</h2></div>
<p class="help" style="margin:0 0 12px">${st.resume ? `Current file: ${path.basename(config.resumePath)}, ${size}. Every application gets this exact file.` : 'Every application gets this exact file, unchanged.'}</p>
<form method="post" action="/setup/resume" enctype="multipart/form-data" class="row">
<label class="lbl sr" for="resume">Resume PDF</label>
<input id="resume" type="file" name="resume" accept=".pdf,application/pdf" required style="flex:1;min-width:220px">
<button class="btn">${icon('upload')}${st.resume ? 'Replace' : 'Upload'}</button></form>
<p class="help" style="margin:10px 0 0">Uploading also reads your resume and fills in the Profile section below for you to check.</p>
${st.resume ? html`<form method="post" action="/setup/parse" style="margin-top:12px"><button class="btn btn-sm">${icon('zap')}Fill profile from current resume</button></form>` : ''}
</section>

<section class="card card-pad" id="screening-card" aria-labelledby="s-h">
<div class="card-head"><span class="step-num">2</span><h2 id="s-h">Screening questions</h2><span class="help progress" style="margin:0 0 0 auto" aria-live="polite"></span></div>
<p class="help" style="margin:0 0 8px">Click an answer for each. The bot uses these word for word whenever a form asks something similar.</p>
<form method="post" action="/setup/screening" id="screening">
${SCREENING.map((q) => {
    const cur = currentChoice(q, bank);
    return html`<fieldset class="q"><legend>${q.question}</legend>${q.help ? html`<p class="help q-help">${q.help}</p>` : ''}
<div class="choices">
${q.options.map((o) => html`<label class="choice"><input type="radio" name="${q.id}" value="${o.answer}" required ${cur.value === o.answer ? html`checked` : ''}>${icon('check', 'tick')}<span>${o.label}</span></label>`)}
${q.other ? html`<label class="choice choice-other"><input type="radio" name="${q.id}" value="${OTHER}" ${cur.value === OTHER ? html`checked` : ''}>${icon('check', 'tick')}<span>Other:</span><input type="text" name="${q.id}__text" value="${cur.other}" placeholder="${q.other}" aria-label="${q.question} (your own answer)"></label>` : ''}
</div></fieldset>`;
  })}
<div class="row" style="margin-top:16px"><button class="btn btn-primary">${icon('check')}Save answers</button></div>
</form>
<div class="adv" id="custom-card">
<h3>Your own questions</h3>
<p class="help" style="margin:4px 0 12px">For questions the list above doesn't cover. Answers are used word for word.</p>
<form method="post" action="/setup/custom">
<div id="cq-rows">${(custom.length ? custom : [{ id: '', question: '', answer: '' }]).map(cqRow)}</div>
<template id="tpl-cq">${cqRow({ id: '', question: '', answer: '' })}</template>
<div class="row"><button type="button" class="btn btn-sm" data-add="cq">${icon('plus')}Add question</button><button class="btn btn-sm btn-primary">${icon('check')}Save your questions</button></div>
</form></div>
</section>

<section class="card card-pad" id="profile-card" aria-labelledby="p-h">
<div class="card-head"><span class="step-num">3</span><h2 id="p-h">Profile</h2></div>
<p class="help" style="margin:0">Typed into application forms exactly as written. Your summary, jobs and education are also the <b>only</b> facts the cover-letter writer may use. The bot never reads your resume PDF, so copy the important parts in here.</p>
${draft ? html`<div class="callout t-info" style="margin-top:14px" role="status">${icon('zap')}<div><b>Filled in from your resume. Nothing is saved yet.</b> Check every field, especially dates and links, then click <b>Save profile</b> at the bottom.
<form method="post" action="/setup/draft/discard" class="inline"><button class="btn btn-ghost btn-sm">Discard draft</button></form></div></div>` : ''}
<form method="post" action="/setup/profile">
${FIELD_GROUPS.map((g) => html`<h3 class="sub">${g.title}</h3><div class="fgrid">${g.fields.map((d) => html`<label class="fld"><span>${d.label}${d.required ? html` <span class="req" aria-hidden="true">*</span>` : ''}</span>
<input type="${d.type ?? 'text'}" name="${d.key}" value="${pf.fields[d.key] ?? ''}" ${d.auto ? html`autocomplete="${d.auto}"` : ''} placeholder="${d.placeholder ?? ''}" ${d.required ? 'required' : ''} ${d.type === 'number' ? html`min="0" max="60"` : ''}></label>`)}</div>`)}
<h3 class="sub">About you</h3>
<div class="fgrid">
<label class="fld wide"><span>Summary</span><textarea name="summary" rows="3" placeholder="Two or three sentences: what you do, for how long, and what you're best at.">${pf.summary}</textarea></label>
<label class="fld wide"><span>Skills</span><input type="text" name="skills" value="${pf.skills}" placeholder="TypeScript, Node.js, PostgreSQL, AWS"><small>Separate with commas.</small></label>
</div>
<h3 class="sub">Work history <small>Most recent first. The first job is used as your current company and title.</small></h3>
<div id="job-rows" class="reps">${pf.jobs.map(jobRow)}</div>
<template id="tpl-job">${jobRow({ company: '', title: '', start: '', end: '', highlights: [] })}</template>
<button type="button" class="btn btn-sm" data-add="job">${icon('plus')}Add job</button>
<h3 class="sub">Education <small>The first entry fills school, degree and graduation-year fields.</small></h3>
<div id="edu-rows" class="reps">${pf.schools.map(eduRow)}</div>
<template id="tpl-edu">${eduRow({ school: '', degree: '', discipline: '', year: '' })}</template>
<button type="button" class="btn btn-sm" data-add="edu">${icon('plus')}Add education</button>
<h3 class="sub">Interests <small>Optional</small></h3>
<label class="fld wide"><span class="sr">Interests</span><textarea name="interests" rows="2" placeholder="What kind of work or products you care about.">${pf.interests}</textarea></label>
<div class="sticky-save"><span class="help" style="margin:0">Saved to data/profile.json on this computer.</span><button class="btn btn-primary">${icon('check')}Save profile</button></div>
</form></section>`));
});

app.post('/setup/screening', async (c) => {
  const form = await c.req.parseBody();
  const { bank, missing } = applyChoices(form, loadBankFile());
  if (missing.length) return c.redirect(back(`Error: nothing was saved because ${missing.length} question${missing.length === 1 ? ' is' : 's are'} unanswered, starting with "${missing[0]}"`, '#screening-card'));
  persist(loadProfileFile(), bank);
  return c.redirect(back(`Saved your ${SCREENING.length} screening answers.`, '#screening-card'));
});

app.post('/setup/custom', async (c) => {
  const r = customFromForm(await c.req.parseBody({ all: true }), loadBankFile());
  if (r.error) return c.redirect(back(`Error: nothing was saved because ${r.error}.`, '#custom-card'));
  persist(loadProfileFile(), r.bank);
  const n = r.bank.filter((b) => !SCREENING.some((q) => q.id === b.id)).length;
  return c.redirect(back(`Saved ${n} question${n === 1 ? '' : 's'} of your own.`, '#custom-card'));
});

app.post('/setup/profile', async (c) => {
  const profile = fromForm(await c.req.parseBody({ all: true }), loadProfileFile());
  const f = profile.fields;
  const missing = [!f.first_name && 'first name', !f.last_name && 'last name', !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email ?? '') && 'a valid email'].filter(Boolean);
  if (missing.length) return c.redirect(back(`Error: nothing was saved because the profile needs ${missing.join(', ')}.`, '#profile-card'));
  persist(profile, loadBankFile());
  clearDraft();
  const jobs = (profile.facts.work_history as unknown[]).length;
  return c.redirect(back(`Saved your profile with ${jobs} job${jobs === 1 ? '' : 's'}.`, '#profile-card'));
});

app.post('/setup/resume', async (c) => {
  const body = await c.req.parseBody();
  const f = body.resume;
  if (!(f instanceof File) || !f.size) return c.redirect(back('Error: choose a PDF file first.', '#resume-card'));
  const buf = Buffer.from(await f.arrayBuffer());
  if (buf.subarray(0, 4).toString() !== '%PDF') return c.redirect(back('Error: that file is not a PDF. Export your resume as PDF and try again.', '#resume-card'));
  fs.writeFileSync(config.resumePath, buf);
  const err = await parseIntoDraft();
  return c.redirect(err
    ? back(`Error: your resume was uploaded, but reading it failed because ${err}. Fill in the profile by hand.`, '#resume-card')
    : back('Resume uploaded and read. Review the Profile section, then click Save profile.', '#profile-card'));
});

app.post('/setup/parse', async (c) => {
  if (!fs.existsSync(config.resumePath)) return c.redirect(back('Error: upload a resume first.', '#resume-card'));
  const err = await parseIntoDraft();
  return c.redirect(err
    ? back(`Error: reading your resume failed because ${err}.`, '#resume-card')
    : back('Resume read. Review the Profile section, then click Save profile.', '#profile-card'));
});

app.post('/setup/draft/discard', (c) => {
  clearDraft();
  return c.redirect(back('Draft discarded. Showing your saved profile.', '#profile-card'));
});

// Serve screenshots/letters from ./data only (no path traversal).
app.get('/files/*', (c) => {
  const rel = decodeURIComponent(c.req.path.slice('/files/'.length));
  const file = path.resolve(config.dataDir, rel);
  if (!file.startsWith(path.resolve(config.dataDir) + path.sep) || !fs.existsSync(file)) return c.notFound();
  return c.body(fs.readFileSync(file), 200, { 'content-type': file.endsWith('.png') ? 'image/png' : 'text/plain; charset=utf-8' });
});

serve({ fetch: app.fetch, port: config.uiPort, hostname: '127.0.0.1' }, (i) => console.log(`JobDemon is running: open http://localhost:${i.port}`));
