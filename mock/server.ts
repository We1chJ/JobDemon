// Mock Greenhouse-style job board for local testing. Nothing here reaches a real employer.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';

export const submissions: { job: string; fields: Record<string, string> }[] = [];
export const stats = { posts: 0 }; // every submission attempt that reached the server, valid or not

const ROLES: Record<string, string> = { '1': 'Backend Engineer', '2': 'Platform Engineer', '3': 'Security Engineer', '4': 'Data Engineer', '5': 'Agent Engineer', '6': 'ML Engineer', '7': 'Frontend Engineer', '8': 'Infra Engineer', '9': 'Mystery Engineer', '10': 'Robotics Engineer', '11': 'Controls Engineer', '12': 'Hardware Engineer', '13': 'Firmware Engineer', '14': 'Test Engineer', '15': 'Systems Engineer', '16': 'Careers Site Engineer', '17': 'Embedded Form Engineer' };
const JD = `<div id="content"><p>Mockco builds payment infrastructure.</p>
<p>You will design TypeScript services on Node.js and PostgreSQL, own CI, and work with AWS.</p>
<p>Requirements: 3+ years backend experience, TypeScript, SQL.</p></div>`;

// A react-select style custom dropdown: visible combobox input, hidden required helper, options on click.
const combo = (id: string, label: string, options: string[], required = false) => `
<div class="cb"><label for="${id}">${label}${required ? ' *' : ''}</label>
<input id="${id}" role="combobox" aria-autocomplete="list" autocomplete="off" ${required ? 'aria-required="true"' : ''}>
<input name="${id}" tabindex="-1" aria-hidden="true" style="opacity:0;height:1px;width:1px" ${required ? 'required' : ''} placeholder="Select...">
<div role="listbox" hidden>${options.map((o) => `<div role="option">${o}</div>`).join('')}</div></div>`;
const COMBO_JS = `<script>
document.querySelectorAll('.cb').forEach((cb) => {
  const input = cb.querySelector('[role=combobox]'), hidden = cb.querySelector('[aria-hidden]'), list = cb.querySelector('[role=listbox]');
  const filter = () => list.querySelectorAll('[role=option]').forEach((o) => { o.hidden = !o.textContent.toLowerCase().includes(input.value.toLowerCase()); });
  input.addEventListener('click', () => { list.hidden = false; filter(); });
  input.addEventListener('input', () => { list.hidden = false; filter(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') list.hidden = true; });
  list.addEventListener('click', (e) => { const o = e.target.closest('[role=option]'); if (!o) return; input.value = hidden.value = o.textContent; list.hidden = true; });
});
</script>`;
const COUNTRIES = ['United States +1', 'Afghanistan +93', 'Canada +1', 'India +91', 'United Kingdom +44'];

// Workday look-alike: widgets are built the way Workday builds them (formField containers, data-automation-id,
// button dropdowns with a listbox, search lists with promptOption pop-ups, Month/Year spinbuttons, Add sections).
const WD_MARKS = Array.from({ length: 18 }, (_, i) => `<span data-automation-id="wd-mark-${i}"></span>`).join('');
const wdHead = (job: string) => `<!doctype html><html><head><title>${ROLES[job]} - Mockco Careers</title>
<style>.wd-pop{position:absolute;background:#fff;border:1px solid #888;z-index:10}.wd-pop div,.wd-pop li{padding:4px 8px;cursor:pointer;list-style:none}
[data-automation-id=errorMessage]{color:#b00}</style></head><body>${WD_MARKS}`;

function workdayPosting(job: string) {
  return `${wdHead(job)}<h1 data-automation-id="jobPostingHeader">${ROLES[job]}</h1>${JD}
<a role="button" href="#" data-automation-id="adventureButton" id="apply">Apply</a>
<div id="startDialog" hidden data-automation-id="startApplicationModal"><h2>Start Your Application</h2>
<a role="button" href="/jobs/${job}/apply" data-automation-id="autofillWithResume">Autofill with Resume</a>
<a role="button" href="/jobs/${job}/apply" data-automation-id="applyManually">Apply Manually</a></div>
<script>document.getElementById('apply').onclick = (e) => { e.preventDefault(); document.getElementById('startDialog').hidden = false; };</script></body></html>`;
}

function workdaySignIn(job: string) {
  return `${wdHead(job)}<div data-automation-id="signInContent"><h2>Sign In</h2>
<form method="post" action="/wdlogin?job=${job}"><label for="em">Email Address</label><input id="em" name="email" type="email" data-automation-id="email">
<label for="pw">Password</label><input id="pw" name="password" type="password" data-automation-id="password">
<button type="submit" data-automation-id="signInSubmitButton">Sign In</button></form>
<a href="#" data-automation-id="createAccountLink">Create Account</a></div></body></html>`;
}

const ff = (id: string, label: string, required: boolean, widget: string) =>
  `<div data-automation-id="formField-${id}"><label for="${id}">${label}${required ? '<abbr>*</abbr>' : ''}</label>${widget}<div data-automation-id="errorMessage" hidden></div></div>`;
const wdText = (id: string, label: string, required = false, area = false) =>
  ff(id, label, required, area ? `<textarea id="${id}" ${required ? 'aria-required="true"' : ''}></textarea>` : `<input id="${id}" type="text" data-automation-id="${id}" ${required ? 'aria-required="true"' : ''}>`);
const wdSelect = (id: string, label: string, options: string[], required = false) =>
  ff(id, label, required, `<button type="button" id="${id}" aria-haspopup="listbox" data-automation-id="${id}" data-options="${options.join('|')}" ${required ? 'aria-required="true"' : ''}>Select One</button>`);
const wdSearch = (id: string, label: string, required = false) =>
  ff(id, label, required, `<div data-automation-id="multiselectInputContainer" class="wd-search" data-search="${id}" style="position:relative">
<input id="${id}" type="text" placeholder="Search" data-automation-id="searchBox" ${required ? 'aria-required="true"' : ''}>
<div data-automation-id="promptIcon" class="cover" style="position:absolute;inset:0"></div></div>`);
const wdDate = (id: string, label: string, parts: string[], required = false) =>
  // Like Workday: the real boxes are hidden under a drawn display ("MM/YYYY"), so they can't be clicked.
  ff(id, label, required, `<div data-automation-id="dateInputWrapper" style="position:relative">${parts.map((p) =>
    `<input data-automation-id="dateSection${p}-input" role="spinbutton" aria-label="${p}" style="position:absolute;left:-9999px;width:1px;height:1px" ${required ? 'aria-required="true"' : ''}>`).join('')}
<div data-automation-id="dateSectionDisplay">${parts.map((p) => p === 'Year' ? 'YYYY' : p === 'Month' ? 'MM' : 'DD').join('/')}</div></div>`);
const wdCheck = (id: string, label: string, required = false) =>
  ff(id, '', required, `<input type="checkbox" id="${id}" ${required ? 'aria-required="true"' : ''}><label for="${id}">${label}</label>`);
const wdRadio = (id: string, label: string, options: string[], required = false) =>
  `<div data-automation-id="formField-${id}"><fieldset><legend>${label}${required ? '<abbr>*</abbr>' : ''}</legend>
${options.map((o, k) => `<input type="radio" name="${id}" id="${id}-${k}" value="${o}" ${required ? 'aria-required="true"' : ''}><label for="${id}-${k}">${o}</label>`).join('')}</fieldset><div data-automation-id="errorMessage" hidden></div></div>`;

const workEntry = (n: number) => `<div class="entry"><h4>Work Experience ${n}</h4><button type="button" class="del">Delete</button>
${wdText(`jobTitle-${n}`, 'Job Title', true)}${wdText(`companyName-${n}`, 'Company', true)}
${wdCheck(`currentlyWorkHere-${n}`, 'I currently work here')}${wdDate(`startDate-${n}`, 'From', ['Month', 'Year'], true)}</div>`;
const eduEntry = (n: number) => `<div class="entry"><h4>Education ${n}</h4><button type="button" class="del">Delete</button>
${wdText(`school-${n}`, 'School or University', true)}${wdSelect(`degree-${n}`, 'Degree', ['High School Diploma', 'BS Computer Science', 'MS Computer Science'], true)}</div>`;

function workdayApply(job: string) {
  const steps = ['My Information', 'My Experience', 'Application Questions', 'Voluntary Disclosures', 'Review'];
  return `${wdHead(job)}<h1>${ROLES[job]}</h1>
<ol data-automation-id="progressBar">${steps.map((s, i) => `<li data-step="${i}">${s}</li>`).join('')}</ol>
<div data-automation-id="errorBanner" id="banner" role="alert" hidden></div>
<section class="wd-step" data-name="My Information"><h2>My Information</h2>
${wdSearch('source', 'How Did You Hear About Us?', true)}
${wdText('legalNameSection_firstName', 'First Name', true)}${wdText('legalNameSection_lastName', 'Last Name', true)}
${wdSelect('countryDropdown', 'Country', ['United States of America', 'Canada', 'India'], true)}
${wdSearch('phoneCode', 'Country Phone Code', true)}${wdText('phoneNumber', 'Phone Number', true)}
${wdText('postalCode', 'Postal Code')}${wdText('extension', 'Phone Extension')}
${wdCheck('preferredCheckbox', 'I have a preferred name')}
<div style="display:none">${wdCheck('tnc', 'Terms and Conditions')}</div>
${job === '14' ? wdText('employeeId', 'Employee ID', true) : ''}</section>
<section class="wd-step" data-name="My Experience" hidden><h2>My Experience</h2>
<div data-automation-id="workExperienceSection"><h3>Work Experience</h3><div class="entries" data-kind="work"></div><button type="button" data-automation-id="Add" class="add">Add</button></div>
<div data-automation-id="educationSection"><h3>Education</h3><div class="entries" data-kind="edu"></div><button type="button" data-automation-id="Add" class="add">Add</button></div>
${wdSearch('skills', 'Type to Add Skills')}
<div data-automation-id="resumeSection"><h3>Resume/CV</h3><input type="file" data-automation-id="file-upload-input-ref" id="resume" style="opacity:0;position:absolute;width:1px;height:1px">
<div data-automation-id="file-upload-drop-zone">Drop file here or <button type="button" data-automation-id="select-files">Select file</button></div><div id="uploaded"></div></div></section>
<section class="wd-step" data-name="Application Questions" hidden><h2>Application Questions</h2>
${wdRadio('workAuth', 'Are you legally authorized to work in the United States?', ['Yes', 'No'], true)}
${wdText('why', 'Why do you want to work at Mockco?', true, true)}</section>
<section class="wd-step" data-name="Voluntary Disclosures" hidden><h2>Voluntary Disclosures</h2>
${wdSelect('gender', 'Gender', ['Male', 'Female', 'I decline to self-identify'])}
${wdCheck('termsAndConditions', 'I have read and consent to the Terms and Conditions', true)}</section>
<section class="wd-step" data-name="Review" hidden><h2>Review</h2><p>Check your answers.</p></section>
<footer data-automation-id="pageFooter"><button type="button" id="wnext" data-automation-id="pageFooterNextButton">Save and Continue</button>
<button type="button" id="wsubmit" data-automation-id="pageFooterSubmitButton" hidden>Submit</button></footer>
<script>
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
let popup = null;
const closePop = () => { if (popup) { popup.remove(); popup = null; } };
const openPop = (anchor, items, onPick, attr = 'data-automation-id="promptOption"', role = '') => {
  closePop(); popup = document.createElement(role ? 'ul' : 'div'); popup.className = 'wd-pop';
  if (role) popup.setAttribute('role', 'listbox'); else popup.setAttribute('data-automation-id', 'activeListContainer');
  popup.innerHTML = items.map((t) => role ? '<li role="option">' + t + '</li>' : '<div ' + attr + ' data-automation-label="' + t + '">' + t + '</div>').join('');
  const r = anchor.getBoundingClientRect(); popup.style.left = (r.left + scrollX) + 'px'; popup.style.top = (r.bottom + scrollY) + 'px';
  document.body.appendChild(popup);
  [...popup.children].forEach((o) => o.onclick = () => onPick(o.textContent));
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
// Button dropdowns.
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[aria-haspopup=listbox]'); if (!b) return;
  openPop(b, b.dataset.options.split('|'), (t) => { b.textContent = t; closePop(); }, '', 'listbox');
});
// Search lists: "source" is a two-level tree that opens on click; "phoneCode" shows nothing until you search.
const tree = { 'Job Board': ['LinkedIn', 'Indeed'], 'Social Media': ['Instagram', 'Facebook'], 'Other': ['Other'] };
const skillList = ['TypeScript', 'Node.js', 'PostgreSQL', 'AWS', 'Java', 'Leadership', 'Communication'];
const codes = ['United States of America (+1)', 'United States Minor Outlying Islands (+1)', 'United Kingdom (+44)', 'India (+91)'];
const pill = (box, t) => { const p = document.createElement('div'); p.setAttribute('data-automation-id', 'selectedItem'); p.textContent = t; box.insertBefore(p, box.firstChild); $('input', box).value = ''; closePop(); };
$$('.wd-search').forEach((box) => {
  const input = $('input', box), which = box.dataset.search;
  const open = () => { input.focus(); if (which === 'source') openPop(box, Object.keys(tree), (cat) => openPop(box, tree[cat], (leaf) => pill(box, leaf)));
    else if (which === 'skills') openPop(box, ['Leadership', 'Communication'], (t) => pill(box, t)); else closePop(); };
  $('.cover', box).onclick = open;
  input.onclick = open;
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return; e.preventDefault();
    const list = which === 'phoneCode' ? codes : which === 'skills' ? skillList : Object.values(tree).flat();
    openPop(box, list.filter((c) => c.toLowerCase().includes(input.value.toLowerCase())), (t) => pill(box, t));
  });
});
// Repeating sections.
const tpl = { work: ${JSON.stringify(workEntry(0))}, edu: ${JSON.stringify(eduEntry(0))} };
$$('button.add').forEach((add) => add.onclick = () => {
  const list = $('.entries', add.parentElement), n = list.children.length + 1;
  const html = tpl[list.dataset.kind].replaceAll(' 0<', ' ' + n + '<').replaceAll('-0"', '-' + n + '"');
  list.insertAdjacentHTML('beforeend', html);
});
document.addEventListener('click', (e) => { if (e.target.matches('.del')) e.target.closest('.entry').remove(); });
$('#resume').onchange = () => { $('#uploaded').innerHTML = '<span data-automation-id="file-upload-successful">' + $('#resume').files[0].name + '</span>'; };
// Steps: Save and Continue checks the required fields first, like Workday.
let at = 0;
const showStep = () => {
  $$('.wd-step').forEach((s, i) => (s.hidden = i !== at));
  $$('[data-step]').forEach((li, i) => li.toggleAttribute('data-current', i === at));
  $$('[data-automation-id=progressBarActiveStep]').forEach((n) => n.removeAttribute('data-automation-id'));
  $('[data-step="' + at + '"]').setAttribute('data-automation-id', 'progressBarActiveStep');
  const last = at === $$('.wd-step').length - 1;
  $('#wnext').hidden = last; $('#wsubmit').hidden = !last;
};
const empty = (f) => {
  const req = f.querySelector('[aria-required=true]'); if (!req) return false;
  if (f.querySelector('.wd-search')) return !f.querySelector('[data-automation-id=selectedItem]');
  if (f.querySelector('button[aria-haspopup]')) return f.querySelector('button[aria-haspopup]').textContent === 'Select One';
  if (f.querySelector('input[type=radio]')) return !f.querySelector('input[type=radio]:checked');
  if (f.querySelector('input[type=checkbox]')) return !f.querySelector('input[type=checkbox]').checked;
  return [...f.querySelectorAll('input, textarea')].some((i) => !i.value.trim());
};
$('#wnext').onclick = () => {
  const step = $$('.wd-step')[at];
  const bad = [...step.querySelectorAll('[data-automation-id^=formField-]')].filter((f) => f.offsetParent !== null && empty(f));
  $$('[data-automation-id=errorMessage]').forEach((m) => (m.hidden = true));
  if (bad.length) {
    bad.forEach((f) => { const m = $('[data-automation-id=errorMessage]', f); m.textContent = 'The field ' + $('label, legend', f).textContent.replace('*', '') + ' is required and must have a value.'; m.hidden = false; });
    $('#banner').textContent = 'Errors Found: ' + bad.length + ' error' + (bad.length > 1 ? 's' : ''); $('#banner').hidden = false; return;
  }
  $('#banner').hidden = true; at++; showStep();
};
showStep();
</script></body></html>`;
}

// The same application built a different way: standard markup only (labels, ARIA roles and states),
// none of Workday's own names. The flow must get through both versions unchanged.
function altPosting(job: string) {
  return `${wdHead(job)}<main><h1>${ROLES[job]}</h1>${JD}<button type="button" id="apply">Apply</button>
<div id="start" role="dialog" aria-label="Start your application" hidden><h2>Start your application</h2><a role="button" href="/jobs/${job}/apply">Apply Manually</a></div></main>
<script>document.getElementById('apply').onclick = () => { document.getElementById('start').hidden = false; };</script></body></html>`;
}

const aq = (id: string, label: string, required: boolean, control: string) =>
  `<div class="q"><label id="${id}-l" for="${id}">${label}${required ? '<span aria-hidden="true"> *</span>' : ''}</label>${control}<p id="${id}-err" class="msg" hidden></p></div>`;
const aText = (id: string, label: string, required = false, area = false) =>
  aq(id, label, required, area ? `<textarea id="${id}" ${required ? 'required' : ''} aria-describedby="${id}-err"></textarea>` : `<input id="${id}" type="text" ${required ? 'required' : ''} aria-describedby="${id}-err">`);
const aList = (id: string, label: string, options: string[], required = false) =>
  aq(id, label, required, `<button type="button" id="${id}" class="lb" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${id}-l" data-options="${options.join('|')}" ${required ? 'aria-required="true"' : ''} aria-describedby="${id}-err">Select an option</button>`);
const aCombo = (id: string, label: string, required = false) =>
  aq(id, label, required, `<div class="chips"></div><input id="${id}" class="cmb" role="combobox" aria-autocomplete="list" aria-expanded="false" ${required ? 'aria-required="true"' : ''} aria-describedby="${id}-err">`);
const aCheck = (id: string, label: string, required = false) =>
  `<div class="q"><div role="checkbox" class="box" id="${id}" tabindex="0" aria-checked="false" aria-labelledby="${id}-l" ${required ? 'aria-required="true"' : ''} aria-describedby="${id}-err"></div><span id="${id}-l">${label}${required ? ' *' : ''}</span><p id="${id}-err" class="msg" hidden></p></div>`;
const aDate = (id: string, label: string) =>
  `<div class="q"><label id="${id}-l">${label} *</label><span class="drawn">MM/YYYY</span>
<input role="spinbutton" class="sp" aria-labelledby="${id}-l" aria-valuemin="1" aria-valuemax="12" aria-required="true" style="position:absolute;left:-9999px;width:1px;height:1px">
<input role="spinbutton" class="sp" aria-labelledby="${id}-l" aria-valuemin="1900" aria-valuemax="2100" aria-required="true" style="position:absolute;left:-9999px;width:1px;height:1px"><p class="msg" hidden></p></div>`;
const altJob = (n: number) => `<div class="item"><h4>Job ${n}</h4><button type="button" class="rm">Remove</button>
${aText(`title-${n}`, 'Title', true)}${aText(`employer-${n}`, 'Employer', true)}${aCheck(`current-${n}`, 'I currently work here')}${aDate(`start-${n}`, 'Start date')}</div>`;
const altSchool = (n: number) => `<div class="item"><h4>School ${n}</h4><button type="button" class="rm">Remove</button>
${aText(`inst-${n}`, 'Institution', true)}${aList(`deg-${n}`, 'Degree', ['High School Diploma', 'BS Computer Science', 'MS Computer Science'], true)}</div>`;

function altApply(job: string) {
  const steps = ['My Information', 'My Experience', 'Application Questions', 'Voluntary Disclosures', 'Review'];
  return `${wdHead(job)}<style>.box{display:inline-block;width:16px;height:16px;border:1px solid #333}.box[aria-checked=true]{background:#333}.q{margin:8px 0;position:relative}</style>
<main><h1>${ROLES[job]}</h1><ol aria-label="Progress">${steps.map((s, i) => `<li>${s}</li>`).join('')}</ol>
<div id="banner" role="alert" hidden></div>
<section class="st"><h2>My Information</h2>
${aCombo('heard', 'How did you hear about us?', true)}${aText('fname', 'First Name', true)}${aText('lname', 'Last Name', true)}
${aList('ctry', 'Country', ['United States of America', 'Canada', 'India'], true)}${aCombo('dial', 'Country Phone Code', true)}
${aText('tel', 'Phone Number', true)}${aText('zip', 'Postal Code')}${aText('ext', 'Phone Extension')}${aCheck('pref', 'I have a preferred name')}</section>
<section class="st" hidden><h2>My Experience</h2>
<section><h3>Work History</h3><div class="items" data-kind="job"></div><button type="button" class="more">Add another</button></section>
<section><h3>Schools</h3><div class="items" data-kind="school"></div><button type="button" class="more">Add another</button></section>
${aCombo('skills', 'Skills')}
<div class="q"><label for="cv">Resume</label><input type="file" id="cv" style="display:none"><button type="button" onclick="document.getElementById('cv').click()">Choose file</button><span id="cvname"></span></div></section>
<section class="st" hidden><h2>Application Questions</h2>
<div class="q" role="radiogroup" aria-labelledby="auth-l" aria-required="true"><span id="auth-l">Are you legally authorized to work in the United States? *</span>
<label><input type="radio" name="auth" value="Yes"> Yes</label><label><input type="radio" name="auth" value="No"> No</label></div>
${aText('motive', 'Why do you want to work at Mockco?', true, true)}</section>
<section class="st" hidden><h2>Voluntary Disclosures</h2>
<div class="q"><label for="sex">Gender</label><select id="sex"><option value="">Select an option</option><option>Male</option><option>Female</option><option>Prefer not to say</option></select></div>
${aCheck('agree', 'I agree to the privacy notice', true)}</section>
<section class="st" hidden><h2>Review</h2><p>Check your answers.</p></section>
<footer><button type="button" id="back">Back</button><button type="button" id="go">Next</button><button type="button" id="send" hidden>Submit application</button></footer></main>
<script>
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
let pop = null;
const close = () => { if (pop) { pop.remove(); pop = null; } $$('[aria-expanded=true]').forEach((e) => e.setAttribute('aria-expanded', 'false')); };
const show = (anchor, items, onPick) => {
  close(); anchor.setAttribute('aria-expanded', 'true');
  pop = document.createElement('ul'); pop.setAttribute('role', 'listbox'); pop.style.cssText = 'position:absolute;background:#fff;border:1px solid #888;z-index:9;list-style:none;padding:0';
  pop.innerHTML = items.map((t) => '<li role="option" aria-selected="false" style="padding:4px 8px;cursor:pointer">' + t + '</li>').join('');
  const r = anchor.getBoundingClientRect(); pop.style.left = (r.left + scrollX) + 'px'; pop.style.top = (r.bottom + scrollY) + 'px';
  document.body.appendChild(pop); [...pop.children].forEach((o) => o.onclick = () => onPick(o.textContent));
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
document.addEventListener('click', (e) => {
  const b = e.target.closest('button.lb'); if (b) show(b, b.dataset.options.split('|'), (t) => { b.textContent = t; close(); });
  const c = e.target.closest('[role=checkbox]'); if (c) c.setAttribute('aria-checked', String(c.getAttribute('aria-checked') !== 'true'));
  if (e.target.matches('.rm')) e.target.closest('.item').remove();
});
const tree = { 'Job Board': ['LinkedIn', 'Indeed'], 'Social Media': ['Instagram', 'Facebook'], 'Other': ['Other'] };
const lists = { dial: ['United States of America (+1)', 'United States Minor Outlying Islands (+1)', 'India (+91)'], skills: ['TypeScript', 'Node.js', 'PostgreSQL', 'AWS', 'Java', 'Leadership'] };
const chip = (input, t) => { const s = document.createElement('span'); s.setAttribute('role', 'option'); s.setAttribute('aria-selected', 'true'); s.textContent = t; input.parentElement.querySelector('.chips').appendChild(s); input.value = ''; close(); };
$$('input.cmb').forEach((input) => {
  const id = input.id;
  input.addEventListener('click', () => {
    if (id === 'heard') show(input, Object.keys(tree), (cat) => show(input, tree[cat], (leaf) => chip(input, leaf)));
    else if (id === 'skills') show(input, ['Leadership', 'Communication'], (t) => chip(input, t));
    else close();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return; e.preventDefault();
    const all = id === 'heard' ? Object.values(tree).flat() : lists[id];
    show(input, all.filter((x) => x.toLowerCase().includes(input.value.toLowerCase())), (t) => chip(input, t));
  });
});
const tpl = { job: ${JSON.stringify(altJob(0))}, school: ${JSON.stringify(altSchool(0))} };
$$('button.more').forEach((b) => b.onclick = () => {
  const list = b.parentElement.querySelector('.items'), n = list.children.length + 1;
  list.insertAdjacentHTML('beforeend', tpl[list.dataset.kind].replaceAll(' 0<', ' ' + n + '<').replaceAll('-0"', '-' + n + '"'));
});
$('#cv').onchange = () => { $('#cvname').textContent = $('#cv').files[0].name; };
let at = 0;
const render = () => {
  $$('section.st').forEach((s, i) => (s.hidden = i !== at));
  $$('ol li').forEach((li, i) => (i === at ? li.setAttribute('aria-current', 'step') : li.removeAttribute('aria-current')));
  const last = at === $$('section.st').length - 1; $('#go').hidden = last; $('#send').hidden = !last;
};
const missing = (q) => {
  const req = q.matches('[aria-required=true]') ? q : q.querySelector('[required], [aria-required=true]'); if (!req) return null;
  if (req.matches('[role=radiogroup]')) return req.querySelector('input:checked') ? null : req;
  if (req.matches('[role=checkbox]')) return req.getAttribute('aria-checked') === 'true' ? null : req;
  if (req.matches('button.lb')) return req.textContent === 'Select an option' ? req : null;
  if (req.matches('input.cmb')) return q.querySelector('.chips [role=option]') ? null : req;
  if (req.matches('.sp')) return [...q.querySelectorAll('.sp')].every((s) => s.value) ? null : req;
  return req.value.trim() ? null : req;
};
$('#go').onclick = () => {
  const bad = $$('.q', $$('section.st')[at]).map(missing).filter(Boolean);
  $$('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid')); $$('.msg').forEach((m) => (m.hidden = true));
  if (bad.length) {
    bad.forEach((c) => { c.setAttribute('aria-invalid', 'true'); const m = document.getElementById(c.getAttribute('aria-describedby')) || c.closest('.q').querySelector('.msg'); if (m) { m.textContent = 'This field is required.'; m.hidden = false; } });
    $('#banner').textContent = bad.length + ' required field' + (bad.length > 1 ? 's are' : ' is') + ' missing.'; $('#banner').hidden = false; return;
  }
  $('#banner').hidden = true; at++; render();
};
render();
</script></body></html>`;
}

function signIn(job: string) {
  return `<!doctype html><html><head><title>Job Application for ${ROLES[job]} at Mockco</title></head><body>
<h1>Sign in to Mockco Careers</h1><p>Sign in or create an account to apply for ${ROLES[job]}.</p>
<form method="post" action="/login?job=${job}"><label for="em">Email</label><input id="em" name="email" type="email">
<label for="pw">Password</label><input id="pw" name="password" type="password"><button type="submit">Sign In</button></form></body></html>`;
}

function overview(job: string, tabs: string, applyLink: string) {
  return `<!doctype html><html><head><title>Job Application for ${ROLES[job]} at Mockco</title></head><body>
${tabs}<h1>${ROLES[job]}</h1>${JD}<footer><a href="/privacy">Privacy Policy</a> <a href="/security">Security</a></footer>${applyLink}</body></html>`;
}

function multiStep() {
  return `<!doctype html><html><head><title>Job Application for ${ROLES['6']} at Mockco</title></head><body><h1>${ROLES['6']}</h1>${JD}
<form method="post" action="/jobs/6" enctype="multipart/form-data">
<section id="s1"><h2>Step 1 of 2</h2>
<div><label for="first_name">First Name *</label><input id="first_name" name="first_name" required></div>
<div><label for="email">Email *</label><input id="email" name="email" type="email" required></div>
<button type="button" id="next1">Next</button></section>
<section id="s2" hidden><h2>Step 2 of 2</h2>
<div><label for="why">Why do you want to work at Mockco? *</label><textarea id="why" name="why" required></textarea></div>
<button type="button" id="next2">Next</button></section>
<section id="s3" hidden><h2>Review your application</h2><p>Check everything before submitting.</p>
<button type="submit">Submit application</button></section>
</form>
<script>
const show = (a, b) => { document.getElementById(a).hidden = true; document.getElementById(b).hidden = false; };
document.getElementById('next1').onclick = () => show('s1', 's2');
document.getElementById('next2').onclick = () => show('s2', 's3');
</script></body></html>`;
}

function form(job: string, errors: string[] = [], extra = '') {
  return `<!doctype html><html><head><title>Job Application for ${ROLES[job]} at Mockco</title></head><body>
<h1>${ROLES[job]}</h1>${JD}
${errors.length ? `<div class="errors" role="alert">${errors.map((e) => `<p>${e} is required</p>`).join('')}</div>` : ''}
<form id="application-form" method="post" enctype="multipart/form-data" action="/jobs/${job}">
<div><label for="first_name">First Name *</label><input id="first_name" name="first_name" required></div>
<div><label for="last_name">Last Name *</label><input id="last_name" name="last_name" required></div>
<div><label for="email">Email *</label><input id="email" name="email" type="email" required></div>
<div><label for="phone">Phone</label><input id="phone" name="phone"></div>
${combo('country', 'Country', COUNTRIES, true)}
<div><label for="resume">Resume/CV *</label><input id="resume" name="resume" type="file" required></div>
<div><label for="transcript">Unofficial Transcript</label><input id="transcript" name="transcript" type="file"></div>
<div><label for="cover_letter">Cover Letter</label><textarea id="cover_letter" name="cover_letter"></textarea></div>
<div><label for="linkedin">LinkedIn Profile</label><input id="linkedin" name="linkedin"></div>
<div><label for="auth">Are you legally authorized to work in the United States? *</label>
<select id="auth" name="auth" required><option value="">Select...</option><option>Yes</option><option>No</option></select></div>
<fieldset><legend>Will you now or in the future require visa sponsorship? *</legend>
<label><input type="radio" name="sponsor" value="yes" required> Yes</label><label><input type="radio" name="sponsor" value="no"> No</label></fieldset>
<div><label for="why">Why do you want to work at Mockco? *</label><textarea id="why" name="why" required></textarea></div>
${combo('travel', 'Willing to travel?', ['Yes', 'No'])}
<div><label><input type="checkbox" id="privacy" name="privacy" required> I have read and agree to the Privacy Statement *</label></div>
<div><label for="conduct">Interview Code of Conduct *</label><select id="conduct" name="conduct" required><option value="">Select...</option><option>I do not agree</option><option>I agree</option></select></div>
${combo('noncompete', 'Do you have any employment restrictions such as a non-compete?', ['Yes', 'No'], true)}
<div><label for="noncompete_explain">If so, please explain</label><input id="noncompete_explain" name="noncompete_explain"></div>
${extra}
<div><label for="gender">Gender</label><select id="gender" name="gender"><option value="">Select...</option><option>Male</option><option>Female</option><option>Decline To Self Identify</option></select></div>
<button type="submit">Submit Application</button>
</form>${COMBO_JS}</body></html>`;
}

export function mockApp() {
  const app = new Hono();
  // Job 1 carries invisible reCAPTCHA like Ashby: hidden iframes that must NOT count as a CAPTCHA.
  app.get('/jobs/1', (c) => c.html(form('1', [], '<iframe src="https://www.recaptcha.net/recaptcha/enterprise/anchor?k=x" width="256" height="60" style="visibility:hidden"></iframe><iframe src="https://www.recaptcha.net/recaptcha/enterprise/bframe?k=x" width="1200" height="150" style="visibility:hidden"></iframe>')));
  app.get('/jobs/4', (c) => c.html(form('4')));
  // 5: Ashby-style overview; the form is on a separate "Application" tab.
  app.get('/jobs/5', (c) => c.html(overview('5', '<nav role="tablist"><a role="tab" href="/jobs/5">Overview</a> <a role="tab" href="/jobs/5/application">Application</a></nav>', '<a href="/jobs/5/application">Apply for this Job</a>')));
  app.get('/jobs/5/application', (c) => c.html(form('5', [], `
<div><h3>Autofill from resume</h3><p>Upload your resume here to autofill key application fields.</p><input id="autofill" type="file" tabindex="-1" style="position:absolute;width:1px;height:1px;opacity:0"><button type="button">Upload file</button></div>
<div data-field-path="vet"><fieldset><label for="vet">Veteran Status</label>
<div><input type="radio" id="vet-0" name="vet"><label for="vet-0">I identify as one or more of the classifications of protected veteran listed above</label></div>
<div><input type="radio" id="vet-1" name="vet"><label for="vet-1">I am not a protected veteran</label></div>
<div><input type="radio" id="vet-2" name="vet"><label for="vet-2">I decline to self-identify for protected veteran status</label></div></fieldset></div>
<div><label for="startmonth">Start date month</label><select id="startmonth" name="startmonth"><option value="">Select...</option>${['January','February','March','April','May','June','July','August','September','October','November','December'].map((m) => `<option>${m}</option>`).join('')}</select></div>
<div><label for="startyear">Start date year</label><input id="startyear" name="startyear"></div>
<div><label for="gpa">GPA</label><input id="gpa" name="gpa"></div>
<div><label for="school">School</label><select id="school" name="school"><option value="">Select...</option><option>Harvard University</option><option>Other</option></select></div>
<div><label for="hs">When did you graduate from High School? *</label><input id="hs" name="hs" required></div>
<div><label for="street">Street address</label><input id="street" name="street"></div>
<div><label for="enddate">End date month</label><select id="enddate" name="enddate"><option value="">Select...</option>${['January','February','March','April','May','June','July','August','September','October','November','December'].map((m) => `<option>${m}</option>`).join('')}</select></div>
<div data-field-path="fair"><label for="fair">Did you meet Mockco at a career fair?</label>
<div><button type="button" aria-pressed="false" data-option="yes">Yes</button><button type="button" aria-pressed="false" data-option="no">No</button><input type="checkbox" tabindex="-1" name="fair"></div></div>
<div data-field-path="race"><fieldset><label for="race">Race</label>
<div><input type="radio" id="race-0" name="race"><label for="race-0">Hispanic or Latino</label></div>
<div><input type="radio" id="race-1" name="race"><label for="race-1">White (Not Hispanic or Latino)</label></div>
<div><input type="radio" id="race-2" name="race"><label for="race-2">Asian (Not Hispanic or Latino)</label></div>
<div><input type="radio" id="race-3" name="race"><label for="race-3">I decline to self-identify</label></div></fieldset></div>
<div><label for="pronouns">Personal Pronouns *</label><select id="pronouns" name="pronouns" required><option value="">Select...</option><option>He/Him</option><option>She/Her</option><option>They/Them</option></select></div>
<fieldset><legend>Please indicate which of the following programming languages you are proficient in</legend>
<label><input type="checkbox" id="lang-java" name="lang"> Java</label><label><input type="checkbox" id="lang-ts" name="lang"> TypeScript</label><label><input type="checkbox" id="lang-cobol" name="lang"> COBOL</label></fieldset>
<div><label for="act">Provide your best result on ACT</label><select id="act" name="act"><option value="">Select...</option><option>36</option><option>35</option><option>I don't have this score</option></select></div>
<div data-field-path="usp"><label for="usp">Are you a U.S. Person, defined as a U.S. Citizen, a lawful permanent resident, or a protected individual under 8 U.S.C. 1324b(a)(3)?</label>
<div><button type="button" aria-pressed="false" data-option="yes">Yes</button><button type="button" aria-pressed="false" data-option="no">No</button><input type="checkbox" tabindex="-1" name="usp"></div></div>
<div data-field-path="q18"><label for="q18">Are you at least 18 years old?</label>
<div><button type="button" aria-pressed="false" data-option="yes">Yes</button><button type="button" aria-pressed="false" data-option="no">No</button><input type="checkbox" tabindex="-1" name="q18"></div></div>
<script>document.querySelectorAll('[data-option]').forEach((b) => b.onclick = () => {
  b.parentElement.querySelectorAll('[data-option]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  b.parentElement.querySelector('input').checked = b.dataset.option === 'yes';
});</script>`)));
  // 6: multi-step form: step 1 -> Next -> step 2 -> Next -> review page with only a Submit button.
  app.get('/jobs/6', (c) => c.html(multiStep()));
  // 7: "Apply now" opens the form in a new tab.
  app.get('/jobs/7', (c) => c.html(overview('7', '', '<a href="/jobs/7/application" target="_blank">Apply now</a>')));
  app.get('/jobs/7/application', (c) => c.html(form('7', [], `<ul><li class="application-question custom-question"><div class="application-label"><div class="text">Are you able to work from our Boulder office?</div></div>
<div class="application-field"><ul><li><label><input type="radio" name="cards[q1]" value="Yes"><span>Yes</span></label></li><li><label><input type="radio" name="cards[q1]" value="No"><span>No</span></label></li></ul></div></li></ul>`)));
  // 8: company careers page embedding the form in an iframe.
  app.get('/jobs/8', (c) => c.html(`<html><head><title>Job Application for ${ROLES['8']} at Mockco</title></head><body><h1>Careers at Mockco</h1><iframe src="/embed/job_app?for=8" width="900" height="1400"></iframe></body></html>`));
  app.get('/embed/job_app', (c) => c.html(form(c.req.query('for') ?? '8')));
  // 10 + 11: behind a sign-in wall (Workday / iCIMS style). Signing in once works for both.
  for (const job of ['10', '11']) {
    app.get(`/jobs/${job}`, (c) => (getCookie(c, 'mock_session') ? c.html(form(job)) : c.html(signIn(job))));
  }
  app.post('/login', async (c) => {
    const body = await c.req.parseBody();
    if (!body.email || !body.password) return c.html(signIn(c.req.query('job') ?? '10'));
    setCookie(c, 'mock_session', '1', { path: '/' });
    return c.redirect(`/jobs/${c.req.query('job') ?? '10'}`);
  });
  // 12: Workday-style: "Apply" opens a pop-up on the same page with start options; the form has a bot trap.
  app.get('/jobs/12', (c) => c.html(overview('12', '', `<button type="button" id="apply12">Apply</button>
<div id="modal" hidden role="dialog"><h2>Start Your Application</h2><a href="/jobs/12/application">Autofill with Resume</a> <a href="/jobs/12/application">Apply Manually</a></div>
<script>document.getElementById('apply12').onclick = () => { document.getElementById('modal').hidden = false; };</script>`)));
  app.get('/jobs/12/application', (c) => c.html(form('12', [], '<div><label for="trap">Enter website. This input is for robots only, do not enter if you\'re human.</label><input id="trap" name="trap"></div>')));
  // 13: Workday look-alike: posting -> Apply -> start options -> sign-in wall -> five-step application.
  // 14: same, but a required field the bot can't answer makes "Save and Continue" refuse to move on.
  for (const job of ['13', '14']) {
    app.get(`/jobs/${job}`, (c) => c.html(workdayPosting(job)));
    app.get(`/jobs/${job}/apply`, (c) => (getCookie(c, 'wd_session') ? c.html(workdayApply(job)) : c.html(workdaySignIn(job))));
  }
  // 17: a careers page with its own job search (a GET form) above an embedded application form, like Pinterest's.
  app.get('/jobs/17', (c) => c.html(`<html><head><title>${ROLES['17']} | Mockco Careers</title></head><body>
<form method="get" action="/jobs/"><label for="kw">Keywords:</label><input id="kw" name="search" placeholder="Search job title, skill, or keyword"><label for="loc">Location:</label><input id="loc" name="location"><button>Search</button></form>
<h1>${ROLES['17']}</h1>${JD}<iframe src="/embed/job_app?for=17" width="900" height="1400"></iframe></body></html>`));
  // 16: a company careers page (not Workday) whose Apply opens the Workday application in a new tab.
  app.get('/jobs/16', (c) => c.html(overview('16', '', '<a href="/jobs/16/apply" target="_blank">Apply now</a>')));
  app.get('/jobs/16/apply', (c) => (getCookie(c, 'wd_session') ? c.html(workdayApply('16')) : c.html(workdaySignIn('16'))));
  // 15: the same application built with standard markup only (no Workday names), behind the same sign-in.
  app.get('/jobs/15', (c) => c.html(altPosting('15')));
  app.get('/jobs/15/apply', (c) => (getCookie(c, 'wd_session') ? c.html(altApply('15')) : c.html(workdaySignIn('15'))));
  app.post('/wdlogin', async (c) => {
    const body = await c.req.parseBody();
    const job = c.req.query('job') ?? '13';
    if (!body.email || !body.password) return c.html(workdaySignIn(job));
    setCookie(c, 'wd_session', '1', { path: '/' });
    return c.redirect(`/jobs/${job}/apply`);
  });
  // 9: a posting with no way into an application.
  app.get('/jobs/9', (c) => c.html(overview('9', '', '<p>Applications are closed.</p>')));
  // Has a visible CAPTCHA widget: must go to the human queue.
  app.get('/jobs/2', (c) => c.html(form('2', [], '<iframe src="https://www.google.com/recaptcha/api2/anchor?k=x&size=normal" width="304" height="78"></iframe>')));
  // Asks for something the profile doesn't have: must go to the human queue.
  app.get('/jobs/3', (c) => c.html(form('3', [], '<div><label for="clearance">Security clearance ID number *</label><input id="clearance" name="clearance" required></div><div><label for="address">Current Mailing Address *</label><input id="address" name="address" required></div>')));
  app.post('/jobs/:job', async (c) => {
    stats.posts++;
    const body = await c.req.parseBody();
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) fields[k] = typeof v === 'string' ? v : `file:${(v as File).name}:${(v as File).size}`;
    const missing = ['first_name', 'last_name', 'email', 'auth', 'sponsor', 'why'].filter((k) => !fields[k]);
    if (!fields.resume || fields.resume.endsWith(':0')) missing.push('resume');
    if (missing.length) return c.html(form(c.req.param('job'), missing));
    submissions.push({ job: c.req.param('job'), fields });
    return c.html('<html><head><title>Thank you</title></head><body><h1>Thank you for applying!</h1><p>Your application was submitted to Mockco.</p></body></html>');
  });
  app.get('/submissions', (c) => c.json(submissions));
  return app;
}

export function startMock(port = 4000) {
  return serve({ fetch: mockApp().fetch, port, hostname: '127.0.0.1' });
}

if (process.argv[1]?.endsWith('mock/server.ts')) {
  startMock();
  console.log('Mock job board: http://localhost:4000/jobs/1 (2 = CAPTCHA, 3 = missing data)');
}
