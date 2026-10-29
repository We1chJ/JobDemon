<p align="center">
  <img src="assets/logo.svg" width="120" alt="JobDemon logo: a grinning red demon holding up a resume">
</p>

<h1 align="center">JobDemon</h1>

<p align="center"><b>Open a job application. It fills it in. You click Submit.</b></p>

JobDemon is a Chrome extension that fills in job applications for you, right in the tab you have open.
It stops at every Submit button, so nothing is ever sent without you.

## Who it's for

Anyone applying to many roles at once (internships, new-grad, career switchers) who is tired of
retyping the same profile, work history and screening answers into every company's portal.

## What it handles

- **Portals:** Workday (multi-step, sign-in, Save and Continue), Greenhouse, Lever, Ashby, and most
  other sites, including forms embedded in a company's careers page.
- **Every kind of question:** text, dropdowns, search lists, checkboxes, radio groups, dates,
  "select all that apply", repeating sections (work history, education), and file uploads.
- **Written answers:** a cover letter per job from your own template, and short essays from your
  profile and notes. Only your facts, nothing invented.
- **Sign-ins:** it waits while you sign in or create the account, then carries on. It never
  touches your password.

## Why use it

- **Hours back.** One Setup page holds your profile, resume, transcript and screening answers;
  every application reuses them.
- **You stay in control.** A small bar tucked at the side of the page: *Fill page* fills it and goes
  on page by page, stopping at Submit, which you click yourself (JobDemon notices and marks it
  applied). Point at any field for a button that fills just that one. It never submits, unless you
  turn on *Auto-submit* in the ⋯ menu: then it clicks Submit, but only when nothing is left for you.
- **You set the rules.** Plain-English guidelines ("always opt in to future openings", "never
  guess demographic questions") steer every answer, with no code to change.
- **Private by default.** No server: your profile, files, keys and history stay in your browser.
- **See what happened.** A dashboard of every application and your activity.

## Quick start

```bash
npm install
npm run build
```

In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick
`extension/dist`. Setup opens: add your API keys (TypeSafe and OpenAI), upload your resume, and
fill in the rest. Then open any job application and use the JobDemon widget (or click the toolbar
icon to show it).

There's also a **Cover letter** page: paste any job posting and get a letter to copy or
download as a PDF.

**Coming from the old app?** `npm run export` writes `data/jobdemon-backup.json`; import it in
Setup → Backup. Your keys aren't in it: add them in Setup.

## Good to know

- AI: Jev (TypeSafe) answers each question; OpenAI (`gpt-4.1` by default, changeable in Setup)
  writes letters and essays and reads your resume.
- After changing the code, run `npm run build` and click the reload icon on JobDemon in
  `chrome://extensions`.
- `npm run test:ext` loads the extension in Chromium and runs it against a local mock job board.
