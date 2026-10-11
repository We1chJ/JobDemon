// Mock Greenhouse-style job board for local testing. Nothing here reaches a real employer.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

export const submissions: { job: string; fields: Record<string, string> }[] = [];
export const stats = { posts: 0 }; // every submission attempt that reached the server, valid or not

const ROLES: Record<string, string> = { '1': 'Backend Engineer', '2': 'Platform Engineer', '3': 'Security Engineer', '4': 'Data Engineer', '5': 'Agent Engineer', '6': 'ML Engineer', '7': 'Frontend Engineer', '8': 'Infra Engineer', '9': 'Mystery Engineer' };
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
<div><label for="cover_letter">Cover Letter</label><textarea id="cover_letter" name="cover_letter"></textarea></div>
<div><label for="linkedin">LinkedIn Profile</label><input id="linkedin" name="linkedin"></div>
<div><label for="auth">Are you legally authorized to work in the United States? *</label>
<select id="auth" name="auth" required><option value="">Select...</option><option>Yes</option><option>No</option></select></div>
<fieldset><legend>Will you now or in the future require visa sponsorship? *</legend>
<label><input type="radio" name="sponsor" value="yes" required> Yes</label><label><input type="radio" name="sponsor" value="no"> No</label></fieldset>
<div><label for="why">Why do you want to work at Mockco? *</label><textarea id="why" name="why" required></textarea></div>
${combo('travel', 'Willing to travel?', ['Yes', 'No'])}
${combo('noncompete', 'Do you have any employment restrictions such as a non-compete?', ['Yes', 'No'], true)}
<div><label for="noncompete_explain">If so, please explain</label><input id="noncompete_explain" name="noncompete_explain"></div>
${extra}
<div><label for="gender">Gender</label><select id="gender" name="gender"><option value="">Select...</option><option>Male</option><option>Female</option><option>Decline To Self Identify</option></select></div>
<button type="submit">Submit Application</button>
</form>${COMBO_JS}</body></html>`;
}

export function mockApp() {
  const app = new Hono();
  app.get('/jobs/1', (c) => c.html(form('1')));
  app.get('/jobs/4', (c) => c.html(form('4')));
  // 5: Ashby-style overview; the form is on a separate "Application" tab.
  app.get('/jobs/5', (c) => c.html(overview('5', '<nav role="tablist"><a role="tab" href="/jobs/5">Overview</a> <a role="tab" href="/jobs/5/application">Application</a></nav>', '<a href="/jobs/5/application">Apply for this Job</a>')));
  app.get('/jobs/5/application', (c) => c.html(form('5', [], `
<div><h3>Autofill from resume</h3><p>Upload your resume here to autofill key application fields.</p><input id="autofill" type="file" tabindex="-1" style="position:absolute;width:1px;height:1px;opacity:0"><button type="button">Upload file</button></div>
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
  app.get('/jobs/7/application', (c) => c.html(form('7')));
  // 8: company careers page embedding the form in an iframe.
  app.get('/jobs/8', (c) => c.html(`<html><head><title>Job Application for ${ROLES['8']} at Mockco</title></head><body><h1>Careers at Mockco</h1><iframe src="/embed/job_app?for=8" width="900" height="1400"></iframe></body></html>`));
  app.get('/embed/job_app', (c) => c.html(form(c.req.query('for') ?? '8')));
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
