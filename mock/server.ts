// Mock Greenhouse-style job board for local testing. Nothing here reaches a real employer.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

export const submissions: { job: string; fields: Record<string, string> }[] = [];

const ROLES: Record<string, string> = { '1': 'Backend Engineer', '2': 'Platform Engineer', '3': 'Security Engineer' };
const JD = `<div id="content"><p>Mockco builds payment infrastructure.</p>
<p>You will design TypeScript services on Node.js and PostgreSQL, own CI, and work with AWS.</p>
<p>Requirements: 3+ years backend experience, TypeScript, SQL.</p></div>`;

function form(job: string, errors: string[] = [], extra = '') {
  return `<!doctype html><html><head><title>Job Application for ${ROLES[job]} at Mockco</title></head><body>
<h1>${ROLES[job]}</h1>${JD}
${errors.length ? `<div class="errors" role="alert">${errors.map((e) => `<p>${e} is required</p>`).join('')}</div>` : ''}
<form id="application-form" method="post" enctype="multipart/form-data" action="/jobs/${job}">
<div><label for="first_name">First Name *</label><input id="first_name" name="first_name" required></div>
<div><label for="last_name">Last Name *</label><input id="last_name" name="last_name" required></div>
<div><label for="email">Email *</label><input id="email" name="email" type="email" required></div>
<div><label for="phone">Phone</label><input id="phone" name="phone"></div>
<div><label for="resume">Resume/CV *</label><input id="resume" name="resume" type="file" required></div>
<div><label for="cover_letter">Cover Letter</label><textarea id="cover_letter" name="cover_letter"></textarea></div>
<div><label for="linkedin">LinkedIn Profile</label><input id="linkedin" name="linkedin"></div>
<div><label for="auth">Are you legally authorized to work in the United States? *</label>
<select id="auth" name="auth" required><option value="">Select...</option><option>Yes</option><option>No</option></select></div>
<fieldset><legend>Will you now or in the future require visa sponsorship? *</legend>
<label><input type="radio" name="sponsor" value="yes" required> Yes</label><label><input type="radio" name="sponsor" value="no"> No</label></fieldset>
<div><label for="why">Why do you want to work at Mockco? *</label><textarea id="why" name="why" required></textarea></div>
${extra}
<div><label for="gender">Gender</label><select id="gender" name="gender"><option value="">Select...</option><option>Male</option><option>Female</option><option>Decline To Self Identify</option></select></div>
<button type="submit">Submit Application</button>
</form></body></html>`;
}

export function mockApp() {
  const app = new Hono();
  app.get('/jobs/1', (c) => c.html(form('1')));
  // Has a visible CAPTCHA widget: must go to the human queue.
  app.get('/jobs/2', (c) => c.html(form('2', [], '<iframe src="https://www.google.com/recaptcha/api2/anchor?k=x&size=normal" width="304" height="78"></iframe>')));
  // Asks for something the profile doesn't have: must go to the human queue.
  app.get('/jobs/3', (c) => c.html(form('3', [], '<div><label for="clearance">Security clearance ID number *</label><input id="clearance" name="clearance" required></div>')));
  app.post('/jobs/:job', async (c) => {
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
