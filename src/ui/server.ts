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
import { layout, badge, flash, ago, STATUS, OPS } from './views.js';
import { SCREENING, OTHER, currentChoice, applyChoices } from './screening.js';
import { FIELD_GROUPS, toForm, fromForm, type Job, type School } from './profileForm.js';
import { draftFromResume } from '../resumeParse.js';
import { isFormOpen, showForm, letterPath, openFormPage } from '../agent/browser.js';
import { fillPage } from '../portals/fillPage.js';
import { portalName, continueApplication } from '../portals/index.js';
import { makeDecider } from '../decider/index.js';
import { makeWriter } from '../writer/index.js';
import { DEFAULT_GUIDELINES } from '../qa/guidelines.js';
import { loadSettings, saveSettings, MAX_CONCURRENCY } from '../settings.js';

type App = typeof schema.application.$inferSelect;

// One run at a time. Requests that arrive mid-run wait for it: a full run, or just the chosen applications.
const runState = { running: false, again: false, waiting: new Set<number>(), last: '' };
/** Run the whole queue, or only the given application(s). */
function startRun(onlyIds?: number[]) {
  if (runState.running) {
    if (onlyIds) onlyIds.forEach((id) => runState.waiting.add(id)); else runState.again = true;
    return;
  }
  runState.running = true;
  processQueue(onlyIds)
    .then((n) => (runState.last = n ? `Last run finished ${n} application${n === 1 ? '' : 's'}.` : ''))
    .catch((e: Error) => (runState.last = `Run failed: ${e.message}`))
    .finally(() => {
      runState.running = false;
      if (runState.again) { runState.again = false; runState.waiting.clear(); startRun(); }
      else if (runState.waiting.size) { const ids = [...runState.waiting]; runState.waiting.clear(); startRun(ids); }
    });
}

// "Fill this page" / "Continue from here" in progress (application id -> what it's doing), and the last fill result.
const working = new Map<number, string>();
const fillResult = new Map<number, string>();
const busy = () => runState.running || working.size > 0;

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
const version = (apps: App[]) => `${runState.running}:${[...working.keys()].join('.')}:${fillResult.size}:${apps.length}:${apps[0]?.updatedAt ?? ''}`;
const STATUS_ORDER = ['waiting_for_you', 'human_review', 'ready_to_submit', 'in_progress', 'queued', 'applied', 'duplicate'];
const YOUR_TURN = ['waiting_for_you', 'human_review', 'ready_to_submit'];
const FILTERS: [string, string][] = [['all', 'All'], ['waiting_for_you', 'Sign in'], ['human_review', 'Needs you'], ['ready_to_submit', 'Ready to submit'], ['applied', 'Applied'], ['queued', 'Queued'], ['duplicate', 'Skipped']];

/** One sentence: what you do next with this application. */
function whatToDo(a: App) {
  if (a.status === 'waiting_for_you') return 'Sign in or create your account in the browser window. The bot carries on by itself once you are in.';
  if (a.status === 'ready_to_submit') return 'Every field is filled. Check it in the browser window and click Submit yourself, then mark it submitted here.';
  if (a.status === 'human_review') {
    if (/couldn't find the application form/i.test(a.reason ?? '')) return 'The bot could not find the form. Open the page: it may need a click the bot did not recognise, or a sign-in.';
    const needs = (a.reason?.match(/"[^"]+"/g) ?? []).length;
    return `${needs ? `${needs} field${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} your answer. ` : ''}Finish it in the browser window and submit it yourself, then mark it submitted here.`;
  }
  return '';
}

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
  const missing = [!setup.resume && 'upload your resume', !setup.profile && 'replace the example profile', !setup.bank && 'answer the screening questions'].filter(Boolean);
  const queued = count('queued');
  const yourTurn = apps.filter((a) => YOUR_TURN.includes(a.status)).sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const n = (s: string) => (s === 'all' ? apps.length : s === 'queued' ? queued + count('in_progress') : count(s));
  const { concurrency } = loadSettings();

  return c.html(layout({ title: 'Applications', active: 'apps' }, html`
<div class="page-head"><h1>Applications</h1></div>
${flash(c.req.query('msg'))}
${missing.length ? html`<div class="callout t-warn" role="status"><b>Finish Setup before adding real links.</b> You still need to ${missing.join(', ')}. <a href="/setup">Go to Setup</a></div>` : ''}

<section class="sec" id="turn" data-live data-running="${busy() ? '1' : '0'}" data-version="${version(apps)}" aria-labelledby="turn-h">
<div class="sec-head"><h2 id="turn-h">Your turn</h2><span class="muted">${yourTurn.length ? `${yourTurn.length} waiting for you` : ''}</span></div>
${yourTurn.length ? html`<ul class="turn">${yourTurn.map((a) => html`<li>
<div class="turn-main">${badge(a.status)} <a class="app-title" href="/app/${a.id}">${a.role || 'Untitled role'}</a>${a.company ? html` <span class="muted">at ${a.company}</span>` : ''}
<div class="turn-what">${whatToDo(a)}</div>${fillResult.has(a.id) ? html`<div class="turn-what">${fillResult.get(a.id)}</div>` : ''}</div>
<div class="row">${actions(a)}</div></li>`)}</ul>`
    : html`<p class="empty" style="padding:8px 0 0">Nothing needs you right now. ${apps.length ? 'Finished forms appear here as the bot stops at each Submit button.' : 'Add job links below to begin.'}</p>`}
</section>

<section class="sec" aria-labelledby="add-h">
<form method="post" action="/urls">
<h2 id="add-h">Add job links</h2>
<p class="note">One per line. They wait in the queue until you click <b>Start</b> below (all of them) or <b>Run</b> on one. The bot stops at every Submit button for you.</p>
<label class="lbl sr" for="urls">Job links</label>
<textarea id="urls" name="urls" placeholder="https://job-boards.greenhouse.io/company/jobs/1234567" required></textarea>
<div class="row" style="margin-top:12px"><button class="btn btn-primary">Add to queue</button></div>
</form>
<form method="post" action="/settings" class="row" style="margin-top:12px">
<label for="concurrency" class="muted" style="font-size:14px">Fill</label>
<select id="concurrency" name="concurrency" data-autosubmit style="width:auto;min-height:32px;padding:4px 8px">${Array.from({ length: MAX_CONCURRENCY }, (_, i) => i + 1).map((k) => html`<option value="${k}" ${k === concurrency ? 'selected' : ''}>${k}</option>`)}</select>
<span class="muted" style="font-size:14px">application${concurrency === 1 ? '' : 's'} at a time, each in its own tab.${runState.running ? ' Takes effect on the next run.' : ''}</span>
<noscript><button class="btn btn-sm">Save</button></noscript>
</form></section>

<section class="sec" id="all" data-live data-running="${busy() ? '1' : '0'}" data-version="${version(apps)}" aria-labelledby="list-h">
<div class="sec-head"><h2 id="list-h">All applications</h2>
<span class="muted" aria-live="polite">${runState.running
    ? html`<span class="running">Running</span> · ${queued} still queued · this page updates by itself`
    : queued ? html`${queued} queued <form method="post" action="/run" class="inline"><button class="btn btn-sm btn-primary" style="margin-left:8px">Start (${queued})</button></form>` : runState.last}</span></div>
<nav class="filters" aria-label="Filter by status">${FILTERS.map(([k, l]) => html`<a href="${k === 'all' ? '/' : `/?s=${k}`}" ${filter === k ? html`aria-current="true"` : ''}>${l} <b>${n(k)}</b></a>`)}</nav>
${shown.length ? html`<table class="tbl"><thead><tr><th class="c-status">Status</th><th>Application</th><th class="c-portal">Portal</th><th class="c-when">Updated</th><th class="c-actions"><span class="sr">Actions</span></th></tr></thead><tbody>${shown.map(row)}</tbody></table>` : html`<p class="empty">${apps.length ? 'No applications have this status.' : 'No applications yet.'}</p>`}
</section>`));
});

function row(a: App) {
  return html`<tr>
<td class="c-status">${badge(a.status)}</td>
<td style="min-width:0">
<a class="app-title" href="/app/${a.id}">${a.role || 'Untitled role'}</a>${a.company ? html` <span class="muted">at ${a.company}</span>` : ''}
<div class="app-meta">#${a.id}${isFormOpen(a.id) ? ' · open in browser' : ''}</div>
${a.reason && a.status !== 'applied' ? html`<div class="app-reason" title="${a.reason}">${a.reason}</div>` : ''}
${fillResult.has(a.id) ? html`<div class="app-reason">${fillResult.get(a.id)}</div>` : ''}
${letterPeek(a.id)}
</td>
<td class="c-portal"><a href="${a.url}" target="_blank" rel="noopener" title="${a.url}">${portalName(a.url) ?? new URL(a.url).host}</a></td>
<td class="c-when">${ago(a.updatedAt)}</td>
<td class="c-actions"><div class="row">${actions(a, true)}</div></td>
</tr>`;
}

/** The cover letter the bot generated for this application, to cross-check. */
function letterPeek(id: number) {
  const text = read(letterPath(id));
  if (!text) return '';
  return html`<details class="peek"><summary>Cover letter</summary>
<div class="peek-body"><pre class="letter">${text}</pre>
<button type="button" class="btn btn-sm" data-copy="${text}">Copy text</button></div></details>`;
}

/** The same four verbs everywhere: Open form · Run / Run again · Mark submitted · Remove. */
function actions(a: App, compact = false) {
  const sm = compact ? ' btn-sm' : '';
  const btn = (act: string, label: string, cls = '', confirmMsg = '') =>
    html`<form class="inline" method="post" action="/app/${a.id}/${act}" ${confirmMsg ? html`data-confirm="${confirmMsg}"` : ''}><button class="btn${sm} ${cls}">${label}</button></form>`;
  const remove = btn('dismiss', 'Remove', 'btn-ghost', 'Remove this application from the list?');
  // Fills the empty fields on the page the tab shows now; only once the bot has handed the tab to you.
  // Both act on the tab the bot handed to you: fill just this page, or carry on through the next pages to Submit.
  const fillHere = working.has(a.id) ? html`<span class="muted" style="font-size:14px">${working.get(a.id)}</span>`
    : isFormOpen(a.id) ? html`${btn('resume', 'Continue from here')}${btn('fillpage', 'Fill this page')}` : '';
  if (a.status === 'queued') return html`${btn('runone', 'Run', 'btn-primary')}${remove}`;
  if (a.status === 'in_progress') return '';
  if (a.status === 'applied') return '';
  if (a.status === 'duplicate') return btn('requeue', 'Run again');
  const open = isFormOpen(a.id)
    ? btn('show', a.status === 'waiting_for_you' ? 'Open sign-in' : 'Open form', 'btn-primary')
    : btn('requeue', 'Run again', 'btn-primary');
  return html`${open}${fillHere}${a.status === 'waiting_for_you' ? '' : btn('applied', 'Mark submitted')}${remove}`;
}

app.get('/api/status', (c) => c.json({ running: busy(), version: version(allApps()) }));

app.post('/urls', async (c) => {
  const body = await c.req.parseBody();
  const { added, skipped } = enqueue(parseUrls(String(body.urls ?? '')));
  // Adding only queues: nothing starts until you click Start (all) or Run (one).
  const msg = added ? `Added ${added} link${added === 1 ? '' : 's'} to the queue${skipped ? ` (${skipped} already in the list)` : ''}. Click Start to run the queue, or Run on one application.` : 'Nothing new: those links are already in the list.';
  return c.redirect(`/?msg=${encodeURIComponent(msg)}`);
});

app.post('/settings', async (c) => {
  saveSettings({ concurrency: Number((await c.req.parseBody()).concurrency) });
  const { concurrency } = loadSettings();
  return c.redirect(`/?msg=${encodeURIComponent(`Saved: ${concurrency} application${concurrency === 1 ? '' : 's'} at a time.${runState.running ? ' Takes effect on the next run.' : ''}`)}`);
});

app.post('/run', (c) => {
  startRun();
  return c.redirect('/');
});

app.post('/app/:id/:act', async (c) => {
  const id = Number(c.req.param('id'));
  const a = db.select().from(schema.application).where(eq(schema.application.id, id)).get();
  if (!a) return c.notFound();
  switch (c.req.param('act')) {
    case 'show':
      if (!(await showForm(id))) return c.redirect(`/?msg=${encodeURIComponent('Error: that form is no longer open (the browser was closed or the app restarted). Click Run again.')}`);
      break;
    case 'applied': updateApp(id, { status: 'applied', reason: 'Marked submitted by you', confidence: 1 }); break;
    case 'requeue': updateApp(id, { status: 'queued', reason: null, step: 0 }); startRun([id]); break;
    case 'runone': if (a.status === 'queued') startRun([id]); break;
    case 'dismiss': updateApp(id, { status: 'duplicate', reason: 'Removed by you' }); break;
    case 'fillpage': {
      const page = isFormOpen(id) ? openFormPage(id) : null;
      if (!page) return c.redirect(`/?msg=${encodeURIComponent('Error: that form is no longer open (the browser was closed or the app restarted). Click Run again.')}`);
      if (working.has(id)) break;
      working.set(id, 'Filling this page…');
      fillResult.delete(id);
      fillPage(id, page)
        .then((m) => fillResult.set(id, m))
        .catch((e: Error) => fillResult.set(id, `Error: ${e.message.split('\n')[0]}`))
        .finally(() => working.delete(id));
      break;
    }
    case 'resume': {
      if (!isFormOpen(id)) return c.redirect(`/?msg=${encodeURIComponent('Error: that form is no longer open (the browser was closed or the app restarted). Click Run again.')}`);
      if (working.has(id) || a.status === 'in_progress') break;
      working.set(id, 'Continuing from this page…');
      fillResult.delete(id);
      continueApplication(a, makeDecider(), makeWriter())
        .catch((e: Error) => updateApp(id, { status: 'human_review', reason: `Error: ${e.message.split('\n')[0]}` }))
        .finally(() => working.delete(id));
      break;
    }
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
  const filled = steps.filter((s) => s.op.endsWith(':filled')).length;
  const skipped = steps.filter((s) => s.op.endsWith(':skipped')).length;
  const needs = [...new Set(steps.filter((s) => s.op.endsWith(':escalate') && s.target).map((s) => s.target!.split(' / ')[0]))];
  const todo = whatToDo(a);

  return c.html(layout({ title: a.role ?? `#${id}`, active: 'apps' }, html`
<a class="back" href="/">← All applications</a>
<div class="page-head"><div>
<div style="margin-bottom:4px">${badge(a.status)}</div>
<h1>${a.role || 'Untitled role'}${a.company ? html` <span class="muted" style="font-weight:400">at ${a.company}</span>` : ''}</h1>
<p class="note" style="margin:4px 0 0"><a href="${a.url}" target="_blank" rel="noopener">${a.url}</a></p></div>
<div class="row">${actions(a)}</div></div>

${todo ? html`<div class="callout t-${tone}"><b>What to do.</b> ${todo}</div>` : a.reason ? html`<div class="callout t-${tone}">${a.reason}</div>` : ''}

<dl class="kv" style="margin:8px 0 0">
<div><dt>Filled</dt><dd>${filled}</dd></div>
<div><dt>Left empty</dt><dd>${skipped}</dd></div>
<div><dt>Need you</dt><dd>${needs.length}</dd></div>
<div><dt>Form</dt><dd>${isFormOpen(a.id) ? 'Open in browser' : 'Not open'}</dd></div>
<div><dt>Updated</dt><dd>${ago(a.updatedAt)}</dd></div>
</dl>

${needs.length ? html`<section class="sec" style="margin-top:24px"><h2>Needs your answer</h2>
<p class="note">The bot found nothing in your Setup for these. Fill them in the browser window, or add the answer in Setup and click Run again.</p>
<ul class="plain">${needs.map((t) => html`<li>${t}</li>`)}</ul></section>` : ''}

${letter ? html`<section class="sec"${needs.length ? '' : html` style="margin-top:24px"`}><div class="sec-head"><h2>Cover letter</h2><button type="button" class="btn btn-sm" style="margin-left:auto" data-copy="${letter}">Copy text</button></div><pre class="letter">${letter}</pre></section>` : ''}

<section class="sec"${letter || needs.length ? '' : html` style="margin-top:24px"`}>
<details class="trace-wrap"><summary><h2 style="display:inline">Step-by-step trace</h2> <span class="muted">${steps.length} step${steps.length === 1 ? '' : 's'}</span></summary>
${steps.length ? html`<table class="trace">${steps.map((s) => {
    const op = OPS[s.op] ?? { label: s.op, tone: 'neutral' };
    return html`<tr><td class="step-n">${String(s.step).padStart(2, '0')}</td>
<td class="step-op"><span class="st t-${op.tone}">${op.label}</span></td>
<td>${s.target ? html`<div class="step-target">${s.target}</div>` : ''}${s.detail ? html`<div class="step-detail">${s.detail}</div>` : ''}
${s.screenshot ? html`<details><summary>Screenshot</summary><img loading="lazy" alt="Page at step ${s.step}" src="/files/${s.screenshot}"></details>` : ''}</td></tr>`;
  })}</table>` : html`<p class="empty">No steps yet. This application hasn't been run.</p>`}
</details></section>`));
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
function fileSize(f: string) {
  const bytes = fs.statSync(f).size;
  return bytes < 1024 ? `${bytes} bytes` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
const back = (msg: string, hash = '') => `/setup?msg=${encodeURIComponent(msg)}${hash}`;

const refRow = (r: { title: string; text: string }) => html`<div class="rep"><div class="rep-head"><span class="rep-title">Document</span>${html`<button type="button" class="btn btn-ghost btn-sm rep-remove" aria-label="Remove this document">Remove</button>`}</div><div class="fgrid">
<label class="fld wide"><span>Title</span><input type="text" name="ref_title" value="${r.title}" placeholder="e.g. Smart-glasses streaming project"></label>
<label class="fld wide"><span>Text</span><textarea name="ref_text" rows="8" placeholder="Paste the document or notes here.">${r.text}</textarea></label>
</div></div>`;
const removeBtn = (what: string) =>
  html`<button type="button" class="btn btn-ghost btn-sm rep-remove" aria-label="Remove this ${what}">Remove</button>`;
const jobRow = (j: Job) => html`<div class="rep"><div class="rep-head"><span class="rep-title">Job</span>${removeBtn('job')}</div><div class="fgrid">
<label class="fld"><span>Company</span><input type="text" name="job_company" value="${j.company}" placeholder="Acme Corp"></label>
<label class="fld"><span>Title</span><input type="text" name="job_title" value="${j.title}" placeholder="Software Engineer"></label>
<label class="fld"><span>Location</span><input type="text" name="job_location" value="${j.location}" placeholder="Boston, MA"></label>
<label class="fld"><span>Start</span><input type="text" name="job_start" value="${j.start}" placeholder="2021-07"></label>
<label class="fld"><span>End</span><input type="text" name="job_end" value="${j.end}" placeholder="present"></label>
<label class="fld wide"><span>Highlights</span><textarea name="job_highlights" rows="3" placeholder="One per line, with numbers where you can. e.g. Cut CI time from 25 to 8 minutes.">${j.highlights.join('\n')}</textarea></label>
</div></div>`;
const eduRow = (e: School) => html`<div class="rep"><div class="rep-head"><span class="rep-title">School</span>${removeBtn('school')}</div><div class="fgrid">
<label class="fld"><span>School</span><input type="text" name="edu_school" value="${e.school}" placeholder="State University"></label>
<label class="fld"><span>Degree</span><input type="text" name="edu_degree" value="${e.degree}" placeholder="BS"></label>
<label class="fld"><span>Field of study</span><input type="text" name="edu_discipline" value="${e.discipline}" placeholder="Computer Science"></label>
<label class="fld"><span>Location</span><input type="text" name="edu_location" value="${e.location}" placeholder="Needham, MA"></label>
<label class="fld"><span>Start date</span><input type="date" name="edu_start" value="${e.start.length === 7 ? `${e.start}-01` : e.start}"><small>Fills start-date questions.</small></label>
<label class="fld"><span>End / graduation date</span><input type="date" name="edu_date" value="${e.date}"><input type="hidden" name="edu_year" value="${e.year}"><small>Fills end-date and graduation questions.</small></label>
<label class="fld"><span>GPA</span><input type="text" name="edu_gpa" value="${e.gpa}" placeholder="3.8" inputmode="decimal"></label>
</div></div>`;

app.get('/setup', (c) => {
  const st = setupStatus();
  const hasTranscript = fs.existsSync(config.transcriptPath);
  // Don't pre-select the example answers: every choice should be a deliberate click.
  const bank = st.bank ? loadBankFile() : [];
  const answered = SCREENING.filter((q) => currentChoice(q, bank).value).length;
  const draft = loadDraft();
  const saved = loadProfileFile();
  const refs = saved.reference_docs ?? [];
  const cl = saved.cover_letter ?? { header: '', salutation: 'To the {company} Selection Committee,', opening: '', examples: '', closing: 'Sincerely,' };
  const letterSet = !!(cl.opening && cl.examples);
  const pf = toForm(draft ?? saved);
  const guidelines = saved.guidelines ?? [];

  // The left-hand map of the page: each section with where it stands.
  const nav = (href: string, label: string, state: string, ok: boolean | null) =>
    html`<a href="${href}"><span class="nav-l">${label}</span><span class="nav-s ${ok === null ? '' : ok ? 'ok' : 'todo'}">${state}</span></a>`;

  return c.html(layout({ title: 'Setup', active: 'setup' }, html`
<div class="page-head"><div><h1>Setup</h1><p class="note" style="margin:4px 0 0">Everything the bot knows about you. It never invents anything that isn't on this page.</p></div></div>
${flash(c.req.query('msg'))}
<div class="setup">
<nav class="setup-nav" aria-label="Setup sections">
${nav('#resume-card', '1. Files', st.resume ? (hasTranscript ? 'resume + transcript' : 'resume uploaded') : 'resume missing', st.resume)}
${nav('#screening-card', '2. Screening', `${answered} of ${SCREENING.length} answered`, answered === SCREENING.length)}
${nav('#profile-card', '3. Profile', draft ? 'draft to review' : st.profile ? 'saved' : 'still the example', draft ? false : st.profile)}
${nav('#refs-card', '4. Reference material', refs.length ? `${refs.length} document${refs.length === 1 ? '' : 's'}` : 'optional', null)}
${nav('#letter-card', '5. Cover letter', letterSet ? 'set' : 'not set', letterSet)}
${nav('#guidelines-card', '6. Guidelines', guidelines.length ? 'customised' : 'defaults', null)}
</nav>
<div class="setup-body">

<section class="sec" id="resume-card" aria-labelledby="r-h">
<h2 id="r-h">1. Files</h2>
<h3 class="sub">Resume <small>${st.resume ? `Current file: ${path.basename(config.resumePath)}, ${fileSize(config.resumePath)}. Every application gets this exact file.` : 'Required. Every application gets this exact file, unchanged.'}</small></h3>
<form method="post" action="/setup/resume" enctype="multipart/form-data" class="row">
<label class="lbl sr" for="resume">Resume PDF</label>
<input id="resume" type="file" name="resume" accept=".pdf,application/pdf" required style="flex:1;min-width:220px">
<button class="btn">${st.resume ? 'Replace' : 'Upload'}</button></form>
<p class="help" style="margin:8px 0 0">Uploading also reads the resume into the Profile section for you to check.${st.resume ? html` <button form="parse-form" class="btn btn-ghost btn-sm">Read it again</button>` : ''}</p>
<h3 class="sub">Transcript <small>Optional. ${hasTranscript ? `Current file: transcript.pdf, ${fileSize(config.transcriptPath)}.` : 'Attached wherever a form asks for one.'}</small></h3>
<form method="post" action="/setup/transcript" enctype="multipart/form-data" class="row">
<label class="lbl sr" for="transcript">Transcript PDF</label>
<input id="transcript" type="file" name="transcript" accept=".pdf,application/pdf" required style="flex:1;min-width:220px">
<button class="btn">${hasTranscript ? 'Replace' : 'Upload'}</button></form>
</section>
<form id="parse-form" method="post" action="/setup/parse"></form>
<form id="discard-form" method="post" action="/setup/draft/discard"></form>

<form id="setup-form" method="post" action="/setup">
<section class="sec" id="screening-card" aria-labelledby="s-h">
<div class="sec-head"><h2 id="s-h">2. Screening questions</h2><span class="muted progress" style="margin-left:auto" aria-live="polite"></span></div>
<p class="note" style="margin-bottom:4px">Click an answer for each. The bot uses these word for word whenever a form asks something similar. Unanswered ones are left for you on the form.</p>
<div id="screening">
${SCREENING.map((q) => {
    const cur = currentChoice(q, bank);
    return html`<fieldset class="q"><legend>${q.question}</legend>${q.help ? html`<p class="help q-help">${q.help}</p>` : ''}
<div class="choices">
${q.options.map((o) => html`<label class="choice"><input type="radio" name="${q.id}" value="${o.answer}" ${cur.value === o.answer ? 'checked' : ''}><span>${o.label}</span></label>`)}
${q.other ? html`<label class="choice choice-other"><input type="radio" name="${q.id}" value="${OTHER}" ${cur.value === OTHER ? 'checked' : ''}><span>Other:</span><input type="text" name="${q.id}__text" value="${cur.other}" placeholder="${q.other}" aria-label="${q.question} (your own answer)"></label>` : ''}
</div></fieldset>`;
  })}
</div>
</section>

<section class="sec" id="profile-card" aria-labelledby="p-h">
<h2 id="p-h">3. Profile</h2>
<p class="note">Typed into forms exactly as written. Your summary, jobs and education are also the <b>only</b> facts the cover-letter writer may use.</p>
${draft ? html`<div class="callout t-info" role="status"><b>Read from your resume. Not saved yet.</b> Check every field, especially dates and links, then click <b>Save setup</b> at the bottom.
<button form="discard-form" class="btn btn-ghost btn-sm">Discard and show the saved profile</button></div>` : ''}
${FIELD_GROUPS.map((g) => html`<h3 class="sub">${g.title}${g.help ? html`<small>${g.help}</small>` : ''}</h3><div class="fgrid">${g.fields.map((d) => html`<label class="fld${d.wide ? ' wide' : ''}"><span>${d.label}${d.required ? html` <span class="req" aria-hidden="true">*</span>` : ''}</span>
${d.choices
    ? html`<select name="${d.key}"><option value="">${g.title === 'Voluntary self-identification' ? 'Decline to answer' : 'Not set'}</option>${d.choices.map((o) => html`<option ${pf.fields[d.key] === o ? 'selected' : ''}>${o}</option>`)}</select>`
    : html`<input type="${d.type ?? 'text'}" name="${d.key}" value="${pf.fields[d.key] ?? ''}" ${d.auto ? html`autocomplete="${d.auto}"` : ''} placeholder="${d.placeholder ?? ''}" ${d.required ? 'required' : ''} ${d.type === 'number' ? (d.key.endsWith('_year') ? html`min="1950" max="2100"` : html`min="0" max="60"`) : ''}>`}</label>`)}</div>`)}
<h3 class="sub">About you</h3>
<div class="fgrid">
<label class="fld wide"><span>Summary</span><textarea name="summary" rows="3" placeholder="Two or three sentences: what you do, for how long, and what you're best at.">${pf.summary}</textarea></label>
<label class="fld wide"><span>Skills</span><input type="text" name="skills" value="${pf.skills}" placeholder="TypeScript, Node.js, PostgreSQL, AWS"><small>Separate with commas.</small></label>
</div>
<h3 class="sub">Work history <small>Most recent first. The first job is used as your current company and title.</small></h3>
<div id="job-rows" class="reps">${pf.jobs.map(jobRow)}</div>
<template id="tpl-job">${jobRow({ company: '', title: '', location: '', start: '', end: '', highlights: [] })}</template>
<button type="button" class="btn btn-sm" data-add="job">Add job</button>
<h3 class="sub">Education <small>The first entry fills school, degree and graduation-year fields.</small></h3>
<div id="edu-rows" class="reps">${pf.schools.map(eduRow)}</div>
<template id="tpl-edu">${eduRow({ school: '', degree: '', discipline: '', location: '', year: '', date: '', start: '', gpa: '' })}</template>
<button type="button" class="btn btn-sm" data-add="edu">Add education</button>
<h3 class="sub">Interests <small>Optional</small></h3>
<label class="fld wide"><span class="sr">Interests</span><textarea name="interests" rows="2" placeholder="What kind of work or products you care about.">${pf.interests}</textarea></label>
</section>

<section class="sec" id="refs-card" aria-labelledby="rf-h">
<h2 id="rf-h">4. Reference material</h2>
<p class="note">Optional. Paste anything that helps answer open-ended questions ("Why us?", "Describe a time…"): project write-ups, a personal statement, notes. The bot may use facts from these, and only these plus your profile.</p>
<div id="ref-rows" class="reps">${(refs.length ? refs : [{ title: '', text: '' }]).map(refRow)}</div>
<template id="tpl-ref">${refRow({ title: '', text: '' })}</template>
<button type="button" class="btn btn-sm" data-add="ref">Add document</button>
</section>

<section class="sec" id="letter-card" aria-labelledby="cl-h">
<h2 id="cl-h">5. Cover letter</h2>
<p class="note">Every application gets this letter. Your opening paragraph is used word for word; the middle paragraphs are rewritten for each job from your examples, in your voice. Today's date is added automatically.</p>
<div class="fgrid" style="margin-top:12px">
<label class="fld wide"><span>Header</span><textarea name="header" rows="2" placeholder="Your name&#10;email | phone | links">${cl.header}</textarea><small>Used exactly as written.</small></label>
<label class="fld wide"><span>Greeting</span><input type="text" name="salutation" value="${cl.salutation}" placeholder="To the {company} Selection Committee,"><small><code>{company}</code> and <code>{role}</code> are filled in for each job.</small></label>
<label class="fld wide"><span>Opening paragraph <span class="tag">Fixed</span></span><textarea name="opening" rows="7" placeholder="The paragraph you want on every letter.">${cl.opening}</textarea><small>Never changed by the bot.</small></label>
<label class="fld wide"><span>Example middle paragraphs <span class="tag">Rewritten per job</span></span><textarea name="examples" rows="10" placeholder="Two paragraphs from a letter you've written: your experience, then why this company.">${cl.examples}</textarea><small>The bot writes new versions for each job in this voice, using only facts from here and your profile.</small></label>
<label class="fld wide"><span>Sign-off</span><textarea name="closing" rows="3" placeholder="Sincerely,&#10;&#10;Your name">${cl.closing}</textarea></label>
</div>
</section>

<section class="sec" id="guidelines-card" aria-labelledby="g-h">
<h2 id="g-h">6. Guidelines</h2>
<p class="note">Plain-language rules the AI reads with every question, next to your profile and screening answers. One per line. Nothing in the code enforces them: they steer every answer. Delete all lines and save to go back to the defaults.</p>
<label class="lbl sr" for="guidelines">Guidelines</label>
<textarea id="guidelines" name="guidelines" rows="14">${(guidelines.length ? guidelines : DEFAULT_GUIDELINES).join('\n')}</textarea>
</section>

<div class="sticky-save"><span class="help unsaved" style="margin:0" aria-live="polite">All changes saved</span><button class="btn btn-primary">Save setup</button></div>
</form>
</div></div>`));
});

/** One save for sections 2–6. Partial screening answers are fine: unanswered ones are left for you on the form. */
app.post('/setup', async (c) => {
  const b = await c.req.parseBody({ all: true });
  const one = (k: string) => String(([] as unknown[]).concat(b[k] ?? [])[0] ?? '').replace(/\r\n/g, '\n').trim();
  const many = (k: string) => ([] as unknown[]).concat(b[k] ?? []).map((v) => String(v).replace(/\r\n/g, '\n').trim());

  const profile = fromForm(b, loadProfileFile());
  const f = profile.fields;
  const missing = [!f.first_name && 'first name', !f.last_name && 'last name', !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email ?? '') && 'a valid email'].filter(Boolean);
  if (missing.length) return c.redirect(back(`Error: nothing was saved because the profile needs ${missing.join(', ')}.`, '#profile-card'));

  const { bank, missing: unanswered } = applyChoices(b, loadBankFile());
  const titles = many('ref_title'), texts = many('ref_text');
  profile.reference_docs = texts.map((text, i) => ({ title: titles[i] ?? '', text })).filter((d) => d.text);
  profile.cover_letter = { header: one('header'), salutation: one('salutation'), opening: one('opening'), examples: one('examples'), closing: one('closing') };
  const lines = one('guidelines').split('\n').map((l) => l.trim()).filter(Boolean);
  profile.guidelines = JSON.stringify(lines) === JSON.stringify(DEFAULT_GUIDELINES) ? [] : lines; // unchanged defaults stay "defaults"
  persist(profile, bank);
  clearDraft();

  const parts = [`${SCREENING.length - unanswered.length} of ${SCREENING.length} screening answers`, `${(profile.facts.work_history as unknown[]).length} job${(profile.facts.work_history as unknown[]).length === 1 ? '' : 's'}`];
  const warn = !profile.cover_letter.opening || !profile.cover_letter.examples ? ' The cover letter is not set yet: until both the opening and the example paragraphs are filled in, the bot writes a plain letter from your profile.' : '';
  return c.redirect(back(`Saved: ${parts.join(', ')}.${warn}`));
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
    : back('Resume uploaded and read. Check the Profile section, then click Save setup.', '#profile-card'));
});

app.post('/setup/transcript', async (c) => {
  const f = (await c.req.parseBody()).transcript;
  if (!(f instanceof File) || !f.size) return c.redirect(back('Error: choose a PDF file first.', '#resume-card'));
  const buf = Buffer.from(await f.arrayBuffer());
  if (buf.subarray(0, 4).toString() !== '%PDF') return c.redirect(back('Error: that file is not a PDF. Export your transcript as PDF and try again.', '#resume-card'));
  fs.writeFileSync(config.transcriptPath, buf);
  return c.redirect(back('Transcript uploaded. It is attached wherever a form asks for one.', '#resume-card'));
});

app.post('/setup/parse', async (c) => {
  if (!fs.existsSync(config.resumePath)) return c.redirect(back('Error: upload a resume first.', '#resume-card'));
  const err = await parseIntoDraft();
  return c.redirect(err
    ? back(`Error: reading your resume failed because ${err}.`, '#resume-card')
    : back('Resume read. Check the Profile section, then click Save setup.', '#profile-card'));
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
