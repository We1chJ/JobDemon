// Setup: everything JobDemon knows about you, kept in this browser. It never invents anything that isn't here.
import { html, raw } from '../shared/html.js';
import { DEFAULT_GUIDELINES } from '../shared/guidelines.js';
import { EMPTY_PROFILE, type Profile } from '../shared/profile.js';
import { FIELD_GROUPS, fromForm, toForm, type Job, type School } from '../shared/profileForm.js';
import { SCREENING, OTHER, applyChoices, currentChoice } from '../shared/screening.js';
import { exportBackup, importBackup, store, toBase64, type FileKey, type StoredFile } from '../shared/store.js';
import { draftFromResume } from './resume.js';
import { download, flash, render } from './ui.js';

const size = (n: number) => (n < 1024 ? `${n} bytes` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const loadDraft = async () => ((await chrome.storage.local.get('draft')).draft as Profile | undefined) ?? null;
const setDraft = (p: Profile | null) => (p ? chrome.storage.local.set({ draft: p }) : chrome.storage.local.remove('draft'));

const refRow = (r: { title: string; text: string }) => html`<div class="rep"><div class="rep-head"><span class="rep-title">Document</span><button type="button" class="btn btn-ghost btn-sm rep-remove" aria-label="Remove this document">Remove</button></div><div class="fgrid">
<label class="fld wide"><span>Title</span><input type="text" name="ref_title" value="${r.title}" placeholder="e.g. Smart-glasses streaming project"></label>
<label class="fld wide"><span>Text</span><textarea name="ref_text" rows="8" placeholder="Paste the document or notes here.">${r.text}</textarea></label>
</div></div>`;
const removeBtn = (what: string) => html`<button type="button" class="btn btn-ghost btn-sm rep-remove" aria-label="Remove this ${what}">Remove</button>`;
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

async function draw(msg?: string, hash?: string) {
  const [saved, bank, settings, resume, transcript, draft] = await Promise.all([store.profile(), store.bank(), store.settings(), store.file('resume'), store.file('transcript'), loadDraft()]);
  const answered = SCREENING.filter((q) => currentChoice(q, bank).value).length;
  const refs = saved.reference_docs ?? [];
  const cl = saved.cover_letter ?? { header: '', salutation: 'To the {company} Selection Committee,', opening: '', examples: '', closing: 'Sincerely,' };
  const letterSet = !!(cl.opening && cl.examples);
  const pf = toForm(draft ?? saved);
  const guidelines = saved.guidelines ?? [];
  const hasProfile = !!saved.fields.first_name;
  const keysSet = !!(settings.typesafeKey && settings.openaiKey);
  const nav = (href: string, label: string, state: string, ok: boolean | null) =>
    html`<a href="${href}"><span class="nav-l">${label}</span><span class="nav-s ${ok === null ? '' : ok ? 'ok' : 'todo'}">${state}</span></a>`;
  const fileLine = (f: StoredFile | null, what: string) => (f ? `Current file: ${f.name}, ${size(f.size)}.` : what);

  render('setup', html`
<div class="page-head"><div><h1>Setup</h1><p class="note" style="margin:4px 0 0">Everything JobDemon knows about you, kept in this browser only. It never invents anything that isn't on this page.</p></div></div>
${flash(msg)}
<div class="setup">
<nav class="setup-nav" aria-label="Setup sections">
${nav('#keys-card', '1. AI keys', keysSet ? 'set' : 'missing', keysSet)}
${nav('#resume-card', '2. Files', resume ? (transcript ? 'resume + transcript' : 'resume uploaded') : 'resume missing', !!resume)}
${nav('#screening-card', '3. Screening', `${answered} of ${SCREENING.length} answered`, answered === SCREENING.length)}
${nav('#profile-card', '4. Profile', draft ? 'draft to review' : hasProfile ? 'saved' : 'empty', draft ? false : hasProfile)}
${nav('#refs-card', '5. Reference material', refs.length ? `${refs.length} document${refs.length === 1 ? '' : 's'}` : 'optional', null)}
${nav('#letter-card', '6. Cover letter', letterSet ? 'set' : 'not set', letterSet)}
${nav('#guidelines-card', '7. Guidelines', guidelines.length ? 'customised' : 'defaults', null)}
${nav('#backup-card', '8. Backup', 'import / export', null)}
</nav>
<div class="setup-body">

<section class="sec" id="keys-card" aria-labelledby="k-h">
<h2 id="k-h">1. AI keys</h2>
<p class="note">Jev (TypeSafe) makes every choice on a form; OpenAI writes cover letters and essay answers and reads your resume. The keys stay in this browser and are sent only to those two services.</p>
<form id="keys-form" class="fgrid">
<label class="fld"><span>TypeSafe (Jev) API key</span><input type="password" name="typesafeKey" value="${settings.typesafeKey}" autocomplete="off" placeholder="ts_…"></label>
<label class="fld"><span>OpenAI API key</span><input type="password" name="openaiKey" value="${settings.openaiKey}" autocomplete="off" placeholder="sk-…"></label>
<label class="fld"><span>OpenAI model</span><input type="text" name="openaiModel" value="${settings.openaiModel}" placeholder="gpt-4.1"></label>
<div class="fld" style="justify-content:flex-end"><button class="btn">Save keys</button></div>
</form>
</section>

<section class="sec" id="resume-card" aria-labelledby="r-h">
<h2 id="r-h">2. Files</h2>
<h3 class="sub">Resume <small>${fileLine(resume, 'Required. Every application gets this exact file, unchanged.')}${resume ? ' Every application gets this exact file.' : ''}</small></h3>
<div class="row"><label class="lbl sr" for="resume">Resume PDF</label>
<input id="resume" type="file" data-file="resume" accept=".pdf,application/pdf" style="flex:1;min-width:220px"></div>
<p class="help" style="margin:8px 0 0">Choosing a file uploads it and reads it into the Profile section for you to check.${resume ? html` <button type="button" class="btn btn-ghost btn-sm" data-act="parse">Read it again</button>` : ''}</p>
<h3 class="sub">Transcript <small>Optional. ${fileLine(transcript, 'Attached wherever a form asks for one.')}</small></h3>
<div class="row"><label class="lbl sr" for="transcript">Transcript PDF</label>
<input id="transcript" type="file" data-file="transcript" accept=".pdf,application/pdf" style="flex:1;min-width:220px"></div>
</section>

<form id="setup-form">
<section class="sec" id="screening-card" aria-labelledby="s-h">
<div class="sec-head"><h2 id="s-h">3. Screening questions</h2><span class="muted progress" style="margin-left:auto" aria-live="polite"></span></div>
<p class="note" style="margin-bottom:4px">Click an answer for each. JobDemon uses these word for word whenever a form asks something similar. Unanswered ones are left for you on the form.</p>
<div id="screening">
${SCREENING.map((q) => {
    const cur = currentChoice(q, bank);
    return html`<fieldset class="q"><legend>${q.question}</legend>${q.help ? html`<p class="help q-help">${q.help}</p>` : ''}
<div class="choices">
${q.options.map((o) => html`<label class="choice"><input type="radio" name="${q.id}" value="${o.answer}" ${cur.value === o.answer ? raw('checked') : ''}><span>${o.label}</span></label>`)}
${q.other ? html`<label class="choice choice-other"><input type="radio" name="${q.id}" value="${OTHER}" ${cur.value === OTHER ? raw('checked') : ''}><span>Other:</span><input type="text" name="${q.id}__text" value="${cur.other}" placeholder="${q.other}" aria-label="${q.question} (your own answer)"></label>` : ''}
</div></fieldset>`;
  })}
</div>
</section>

<section class="sec" id="profile-card" aria-labelledby="p-h">
<h2 id="p-h">4. Profile</h2>
<p class="note">Typed into forms exactly as written. Your summary, jobs and education are also the <b>only</b> facts the cover-letter writer may use.</p>
${draft ? html`<div class="callout t-info" role="status"><b>Read from your resume. Not saved yet.</b> Check every field, especially dates and links, then click <b>Save setup</b> at the bottom.
<button type="button" class="btn btn-ghost btn-sm" data-act="discard">Discard and show the saved profile</button></div>` : ''}
${FIELD_GROUPS.map((g) => html`<h3 class="sub">${g.title}${g.help ? html`<small>${g.help}</small>` : ''}</h3><div class="fgrid">${g.fields.map((d) => html`<label class="fld${d.wide ? ' wide' : ''}"><span>${d.label}${d.required ? html` <span class="req" aria-hidden="true">*</span>` : ''}</span>
${d.choices
    ? html`<select name="${d.key}"><option value="">${g.title === 'Voluntary self-identification' ? 'Decline to answer' : 'Not set'}</option>${d.choices.map((o) => html`<option ${pf.fields[d.key] === o ? raw('selected') : ''}>${o}</option>`)}</select>`
    : html`<input type="${d.type ?? 'text'}" name="${d.key}" value="${pf.fields[d.key] ?? ''}" ${d.auto ? html`autocomplete="${d.auto}"` : ''} placeholder="${d.placeholder ?? ''}" ${d.required ? raw('required') : ''} ${d.type === 'number' ? (d.key.endsWith('_year') ? raw('min="1950" max="2100"') : raw('min="0" max="60"')) : ''}>`}</label>`)}</div>`)}
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
<h2 id="rf-h">5. Reference material</h2>
<p class="note">Optional. Paste anything that helps answer open-ended questions ("Why us?", "Describe a time…"): project write-ups, a personal statement, notes. JobDemon may use facts from these, and only these plus your profile.</p>
<div id="ref-rows" class="reps">${(refs.length ? refs : [{ title: '', text: '' }]).map(refRow)}</div>
<template id="tpl-ref">${refRow({ title: '', text: '' })}</template>
<button type="button" class="btn btn-sm" data-add="ref">Add document</button>
</section>

<section class="sec" id="letter-card" aria-labelledby="cl-h">
<h2 id="cl-h">6. Cover letter</h2>
<p class="note">Every application gets this letter. Your opening paragraph is used word for word; the middle paragraphs are rewritten for each job from your examples, in your voice. Today's date is added automatically.</p>
<div class="fgrid" style="margin-top:12px">
<label class="fld wide"><span>Header</span><textarea name="header" rows="2" placeholder="Your name&#10;email | phone | links">${cl.header}</textarea><small>Used exactly as written.</small></label>
<label class="fld wide"><span>Greeting</span><input type="text" name="salutation" value="${cl.salutation}" placeholder="To the {company} Selection Committee,"><small><code>{company}</code> and <code>{role}</code> are filled in for each job.</small></label>
<label class="fld wide"><span>Opening paragraph <span class="tag">Fixed</span></span><textarea name="opening" rows="7" placeholder="The paragraph you want on every letter.">${cl.opening}</textarea><small>Never changed by JobDemon.</small></label>
<label class="fld wide"><span>Example middle paragraphs <span class="tag">Rewritten per job</span></span><textarea name="examples" rows="10" placeholder="Two paragraphs from a letter you've written: your experience, then why this company.">${cl.examples}</textarea><small>JobDemon writes new versions for each job in this voice, using only facts from here and your profile.</small></label>
<label class="fld wide"><span>Sign-off</span><textarea name="closing" rows="3" placeholder="Sincerely,&#10;&#10;Your name">${cl.closing}</textarea></label>
</div>
</section>

<section class="sec" id="guidelines-card" aria-labelledby="g-h">
<h2 id="g-h">7. Guidelines</h2>
<p class="note">Plain-language rules the AI reads with every question, next to your profile and screening answers. One per line. Nothing in the code enforces them: they steer every answer. Delete all lines and save to go back to the defaults.</p>
<label class="lbl sr" for="guidelines">Guidelines</label>
<textarea id="guidelines" name="guidelines" rows="14">${(guidelines.length ? guidelines : DEFAULT_GUIDELINES).join('\n')}</textarea>
</section>

<div class="sticky-save"><span class="help unsaved" style="margin:0" aria-live="polite">All changes saved</span><button class="btn btn-primary">Save setup</button></div>
</form>

<section class="sec" id="backup-card" aria-labelledby="b-h">
<h2 id="b-h">8. Backup</h2>
<p class="note">One file with your Setup, files and application history (never your API keys). Import one to move JobDemon to another browser, or to bring in your data from the old JobDemon app (<code>npm run export</code>).</p>
<div class="row"><button type="button" class="btn" data-act="export">Export backup</button>
<label class="btn" for="import">Import backup…</label><input id="import" type="file" accept=".json,application/json" class="sr"></div>
</section>
</div></div>`);
  wire();
  if (hash) document.querySelector(hash)?.scrollIntoView();
}

// ── Saving ──────────────────────────────────────────────────────────────────
/** The form as the old server saw it: a key → value, or → [values] when it repeats. */
function body(form: HTMLFormElement) {
  const b: Record<string, unknown> = {};
  for (const [k, v] of new FormData(form)) {
    const s = String(v).replace(/\r\n/g, '\n');
    b[k] = k in b ? ([] as unknown[]).concat(b[k], s) : s;
  }
  // Repeating rows are always lists, even with one row.
  for (const k of Object.keys(b)) if (/^(job|edu|ref)_/.test(k) && !Array.isArray(b[k])) b[k] = [b[k]];
  return b;
}

/** One save for the screening, profile, reference, letter and guideline sections. */
async function saveSetup(form: HTMLFormElement) {
  const b = body(form);
  const one = (k: string) => String(([] as unknown[]).concat(b[k] ?? [])[0] ?? '').trim();
  const many = (k: string) => ([] as unknown[]).concat(b[k] ?? []).map((v) => String(v).trim());
  const profile = fromForm(b, await store.profile());
  const f = profile.fields;
  const missing = [!f.first_name && 'first name', !f.last_name && 'last name', !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email ?? '') && 'a valid email'].filter(Boolean);
  if (missing.length) return draw(`Error: nothing was saved because the profile needs ${missing.join(', ')}.`, '#profile-card');

  const { bank, missing: unanswered } = applyChoices(b, await store.bank());
  const titles = many('ref_title'), texts = many('ref_text');
  profile.reference_docs = texts.map((text, i) => ({ title: titles[i] ?? '', text })).filter((d) => d.text);
  profile.cover_letter = { header: one('header'), salutation: one('salutation'), opening: one('opening'), examples: one('examples'), closing: one('closing') };
  const lines = one('guidelines').split('\n').map((l) => l.trim()).filter(Boolean);
  profile.guidelines = JSON.stringify(lines) === JSON.stringify(DEFAULT_GUIDELINES) ? [] : lines; // unchanged defaults stay "defaults"
  await store.setProfile(profile);
  await store.setBank(bank);
  await setDraft(null);
  dirty = false;

  const jobs = (profile.facts.work_history as unknown[]).length;
  const parts = [`${SCREENING.length - unanswered.length} of ${SCREENING.length} screening answers`, `${jobs} job${jobs === 1 ? '' : 's'}`];
  const warn = !profile.cover_letter.opening || !profile.cover_letter.examples ? ' The cover letter is not set yet: until both the opening and the example paragraphs are filled in, JobDemon writes a plain letter from your profile.' : '';
  return draw(`Saved: ${parts.join(', ')}.${warn}`);
}

async function readResume(bytes: Uint8Array, uploaded: boolean) {
  try {
    const current = await store.profile();
    await setDraft(await draftFromResume(await store.settings(), bytes, current.fields.first_name ? current : EMPTY_PROFILE));
    return draw(`${uploaded ? 'Resume uploaded and read' : 'Resume read'}. Check the Profile section, then click Save setup.`, '#profile-card');
  } catch (e) {
    return draw(`Error: ${uploaded ? 'your resume was uploaded, but ' : ''}reading it failed because ${(e as Error).message}. Fill in the profile by hand.`, '#resume-card');
  }
}

async function upload(key: FileKey, file: File) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(buf.subarray(0, 4)) !== '%PDF') return draw(`Error: that file is not a PDF. Export your ${key} as PDF and try again.`, '#resume-card');
  await store.setFile(key, { name: file.name, type: 'application/pdf', size: file.size, data: toBase64(buf.buffer) });
  if (key === 'resume') { await draw('Resume uploaded. Reading it…', '#resume-card'); return readResume(buf, true); }
  return draw('Transcript uploaded. It is attached wherever a form asks for one.', '#resume-card');
}

// ── Page behaviour ──────────────────────────────────────────────────────────
let dirty = false;
function wire() {
  const form = document.getElementById('setup-form') as HTMLFormElement;
  const note = document.querySelector('.unsaved')!;
  form.addEventListener('submit', (e) => { e.preventDefault(); void saveSetup(form); });
  form.addEventListener('input', () => { if (!dirty) { dirty = true; note.textContent = 'Unsaved changes'; note.classList.add('dirty'); } });
  document.getElementById('keys-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = new FormData(e.target as HTMLFormElement);
    await store.setSettings({ typesafeKey: String(b.get('typesafeKey') ?? '').trim(), openaiKey: String(b.get('openaiKey') ?? '').trim(), openaiModel: String(b.get('openaiModel') ?? '').trim() || 'gpt-4.1' });
    void draw('Keys saved.', '#keys-card');
  });
  document.querySelectorAll<HTMLInputElement>('input[data-file]').forEach((i) => i.addEventListener('change', () => { if (i.files?.[0]) void upload(i.dataset.file as FileKey, i.files[0]); }));
  document.getElementById('import')!.addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try { await importBackup(JSON.parse(await f.text())); await setDraft(null); void draw('Imported: your Setup, files and history are in. Check the sections below.'); }
    catch (err) { void draw(`Error: couldn't import because ${(err as Error).message}.`, '#backup-card'); }
  });

  // Screening: typing an "Other" answer selects it; show how many are answered.
  const sf = document.getElementById('screening')!;
  const groups = [...new Set([...sf.querySelectorAll<HTMLInputElement>('input[type=radio]')].map((r) => r.name))];
  const prog = document.querySelector('.progress');
  const update = () => { if (prog) prog.textContent = `${groups.filter((g) => sf.querySelector(`input[name="${g}"]:checked`)).length} of ${groups.length} answered`; };
  sf.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('.choice-other input[type=text]')) { const r = t.closest('label')!.querySelector<HTMLInputElement>('input[type=radio]')!; r.checked = true; t.required = true; }
    update();
  });
  sf.addEventListener('change', (e) => {
    if ((e.target as HTMLInputElement).type === 'radio') sf.querySelectorAll<HTMLInputElement>('.choice-other input[type=text]').forEach((t) => { t.required = t.closest('label')!.querySelector<HTMLInputElement>('input[type=radio]')!.checked; });
    update();
  });
  update();

  // Highlight the section in view.
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.setup-nav a')];
  const secs = links.map((a) => document.querySelector<HTMLElement>(a.getAttribute('href')!)).filter((s): s is HTMLElement => !!s);
  const mark = () => {
    const y = window.scrollY + 120;
    let cur = secs[0];
    for (const s of secs) if (s.offsetTop <= y) cur = s;
    links.forEach((a) => (a.getAttribute('href') === `#${cur.id}` ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
  };
  onscroll = mark;
  mark();
}

document.addEventListener('click', async (e) => {
  const t = e.target as Element;
  // Repeatable rows: add from a <template>, remove a row.
  const add = t.closest<HTMLElement>('[data-add]');
  if (add) {
    const box = document.getElementById(`${add.dataset.add}-rows`)!;
    box.append((document.getElementById(`tpl-${add.dataset.add}`) as HTMLTemplateElement).content.cloneNode(true));
    box.lastElementChild?.querySelector<HTMLElement>('input:not([type=hidden]),textarea')?.focus();
  }
  const rm = t.closest('.rep-remove');
  if (rm) { rm.closest('.rep')!.remove(); dirty = true; }
  const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
  if (act === 'discard') { await setDraft(null); void draw('Draft discarded. Showing your saved profile.', '#profile-card'); }
  if (act === 'parse') {
    const f = await store.file('resume');
    if (f) { await draw('Reading your resume…', '#resume-card'); void readResume(Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0)), false); }
  }
  if (act === 'export') download(`jobdemon-backup-${new Date().toISOString().slice(0, 10)}.json`, new TextEncoder().encode(JSON.stringify(await exportBackup(), null, 1)), 'application/json');
});
addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

void draw(new URLSearchParams(location.search).get('msg') ?? undefined);
