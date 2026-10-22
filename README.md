<p align="center">
  <img src="assets/logo.svg" width="120" alt="JobDemon logo: a grinning red demon holding up a resume">
</p>

<h1 align="center">JobDemon</h1>

<p align="center"><b>Paste job links. It fills the applications. You click Submit.</b></p>

JobDemon is a local app that fills in job applications for you, in a real browser you can watch.
It stops at every Submit button and hands the form back, so nothing is ever sent without you.

## Who it's for

Anyone applying to many roles at once (internships, new-grad, career switchers) who is tired of
retyping the same profile, work history and screening answers into every company's portal.

## What it handles

- **Portals:** Workday (its own flow, multi-step, sign-in, Save and Continue), Greenhouse, Lever,
  Ashby, and most other sites through a general-purpose flow.
- **Every kind of question:** text, dropdowns, search lists, checkboxes, radio groups, dates,
  "select all that apply", repeating sections (work history, education), and file uploads.
- **Written answers:** a cover letter per job from your own template, and short essays from your
  profile and notes. Only your facts, nothing invented.
- **Sign-ins:** it waits while you sign in or create the account, then carries on. It never
  touches your password.

## Why use it

- **Hours back.** One Setup page holds your profile, resume, transcript and screening answers;
  every application reuses them.
- **You stay in control.** It never submits. Each form is left open with a small widget:
  *Continue from here*, *Mark submitted*, and the cover letter to copy.
- **You set the rules.** Plain-English guidelines ("always opt in to future openings", "never
  guess demographic questions") steer every answer, with no code to change.
- **Private by default.** Runs on your machine; your profile, files and history stay in `data/`.
- **See what happened.** A dashboard of activity, plus a step-by-step trace for every application.

## Quick start

```bash
npm install
npx playwright install chromium
npm start
```

Add your keys to `.env` (`TYPESAFE_API_KEY`, `OPENAI_API_KEY`), open http://localhost:3000,
fill in **Setup**, then paste job links and click **Start**.

There's also a **Cover letter** page: paste any job posting and get a letter to copy or
download as a PDF.

## Good to know

- AI: Jev (TypeSafe) answers each question; OpenAI (`gpt-4.1` by default, `OPENAI_MODEL` to
  change) writes letters and essays.
- `npm run test:e2e` runs the whole flow against a local mock job board; `npm run test:qa` runs
  the unit tests.
