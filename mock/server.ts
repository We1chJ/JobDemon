// Mock Greenhouse-style job board for local testing. Nothing here reaches a real employer.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';

export const submissions: { job: string; fields: Record<string, string> }[] = [];
export const stats = { posts: 0 }; // every submission attempt that reached the server, valid or not

const ROLES: Record<string, string> = { '1': 'Backend Engineer', '2': 'Platform Engineer', '3': 'Security Engineer', '4': 'Data Engineer', '5': 'Agent Engineer', '6': 'ML Engineer', '7': 'Frontend Engineer', '8': 'Infra Engineer', '9': 'Mystery Engineer', '10': 'Robotics Engineer', '11': 'Controls Engineer', '12': 'Hardware Engineer', '13': 'Firmware Engineer', '14': 'Test Engineer' };
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

function workdayWizard(job: string) {
  const marks = Array.from({ length: 18 }, (_, i) => `<span data-automation-id="wd-mark-${i}"></span>`).join('');
  return `<!doctype html><html><head><title>Job Application for ${ROLES[job]} at Mockco</title></head><body>${marks}
<h1>${ROLES[job]}</h1><ol data-automation-id="progressBar"><li>My Information</li><li>Application Questions</li><li>Review</li></ol>
<form method="post" action="/jobs/13">
<section id="w1" data-automation-id="step1"><h2>My Information</h2>
<div><label for="first_name">First Name *</label><input id="first_name" name="first_name" required></div>
<div><label for="email">Email *</label><input id="email" name="email" type="email" required></div>
<div data-automation-id="formField-source"><label for="hear">How Did You Hear About Us? *</label>
<div data-automation-id="multiSelectContainer" id="hearbox" style="position:relative"><input id="hear" type="text" placeholder="Search" autocomplete="off">
<div id="hearcover" data-automation-id="promptIcon" style="position:absolute;inset:0"></div></div></div>
<div data-automation-id="formField-phoneCode"><label for="pcode">Country Phone Code *</label>
<div data-automation-id="multiSelectContainer" id="pcodebox" style="position:relative"><input id="pcode" type="text" placeholder="Search" autocomplete="off">
<div id="pcodecover" data-automation-id="promptIcon" style="position:absolute;inset:0"></div></div></div>
<div><label for="zip">Postal Code</label><input id="zip" name="zip"></div>
<div><label for="ext">Phone Extension</label><input id="ext" name="ext"></div>
<div style="display:none"><input type="checkbox" id="tnc"><label for="tnc">Terms and Conditions</label></div>
${job === '14' ? '<div><label for="empid">Employee ID *</label><input id="empid" name="empid"></div>' : ''}
<div id="err" role="alert" hidden></div></section>
<section id="w2" data-automation-id="step2" hidden><h2>Application Questions</h2>
<div><label for="why">Why do you want to work at Mockco? *</label><textarea id="why" name="why" required></textarea></div></section>
<section id="w3" data-automation-id="step3" hidden><h2>Review</h2><p>Check your answers.</p></section>
<footer data-automation-id="pageFooter"><button type="button" id="wnext" data-automation-id="pageFooterNextButton">Save and Continue</button>
<button type="submit" id="wsubmit" data-automation-id="pageFooterSubmitButton" hidden>Submit</button></footer>
</form>
<script>
// Workday-style pickers: options pop up OUTSIDE the field as promptOption divs (no role=option);
// picking a leaf shows a "selectedItem" pill inside the field and clears the search box.
let popup = null;
const close = () => { if (popup) { popup.remove(); popup = null; } };
const open = (input, box, items, onPick) => {
  close(); popup = document.createElement('div'); popup.setAttribute('data-automation-id', 'activeListContainer');
  popup.innerHTML = items.map((t) => '<div data-automation-id="promptOption" data-automation-label="' + t + '">' + t + '</div>').join('');
  document.body.appendChild(popup);
  popup.querySelectorAll('[data-automation-id=promptOption]').forEach((o) => o.onclick = () => onPick(o.dataset.automationLabel));
};
const pill = (box, input, text) => { const p = document.createElement('div'); p.setAttribute('data-automation-id', 'selectedItem'); p.textContent = text; box.insertBefore(p, input); input.value = ''; close(); };
const tree = { 'Job Board': ['LinkedIn', 'Indeed'], 'Social Media': ['Instagram'], 'Other': ['Other', 'Friend or Colleague'] };
const hear = document.getElementById('hear'), hearbox = document.getElementById('hearbox');
// Like Workday, a wrapper covers the search box and catches the click: clicking it opens the list and focuses the box.
const openHear = () => { hear.focus(); open(hear, hearbox, Object.keys(tree), (cat) => open(hear, hearbox, tree[cat], (leaf) => pill(hearbox, hear, leaf))); };
hear.onclick = openHear;
document.getElementById('hearcover').onclick = openHear;
document.getElementById('pcodecover').onclick = () => { document.getElementById('pcode').focus(); close(); };
const codes = ['United States of America (+1)', 'United States Minor Outlying Islands (+1)', 'United Kingdom (+44)', 'India (+91)'];
const pcode = document.getElementById('pcode'), pcodebox = document.getElementById('pcodebox');
pcode.onclick = () => close(); // shows nothing until you search
pcode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); open(pcode, pcodebox, codes.filter((c) => c.toLowerCase().includes(pcode.value.toLowerCase())), (c) => pill(pcodebox, pcode, c)); }
  if (e.key === 'Escape') close();
});
hear.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
let step = 1;
document.getElementById('wnext').onclick = () => {
  const emp = document.getElementById('empid');
  if (emp && !emp.value) { const e = document.getElementById('err'); e.textContent = 'Errors Found: Employee ID is required'; e.hidden = false; return; }
  document.getElementById('w' + step).hidden = true; step++; document.getElementById('w' + step).hidden = false;
  if (step === 3) { document.getElementById('wnext').hidden = true; document.getElementById('wsubmit').hidden = false; }
};
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
  // 13: Workday-style wizard: one address, steps swap in place, one shared "Save and Continue" footer.
  app.get('/jobs/13', (c) => c.html(workdayWizard('13')));
  // 14: same wizard, but a required field the bot can't answer makes "Save and Continue" refuse to move on.
  app.get('/jobs/14', (c) => c.html(workdayWizard('14')));
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
