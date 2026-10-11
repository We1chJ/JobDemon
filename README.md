# JobDemon

Local bot that fills in job applications for the links you give it. **It never submits.**
Each filled form is left open in a browser window; you review it and click Submit yourself.
Jev (TypeSafe) decides each browser step, OpenAI writes cover letters and open-ended answers,
and everything else comes from your profile.

## Run it
```
npm start
```
Then open http://localhost:3000. Everything happens in that page:
1. **Setup tab**: upload your resume PDF (it fills your profile for you to check), answer the
   screening questions, and save your profile.
2. **Applications tab**: paste job links (one per line) and click **Add & run**. A browser window
   opens and the bot fills each form in its own tab.
3. Each link ends as:
   - **Filled in**: every field is done and the bot stopped at the Submit button. Click
     **Show filled form**, check it, and submit it yourself in that window.
   - **Needs you**: the bot got stuck (CAPTCHA, login, a question your profile doesn't answer).
     The half-filled form is still open: click **Finish in browser** and complete it.
4. After submitting, click **I submitted it** to mark it applied.

Click a row's title to see every step with screenshots and the cover letter.

Filled forms stay open until you close the browser window or stop the app. If one is gone,
click **Fill again**.

API keys live in `.env` (`TYPESAFE_API_KEY`, `OPENAI_API_KEY`, optional `OPENAI_MODEL`).

Terminal alternative: `npm run apply -- urls.txt` fills a file of links, then waits until you
close the browser window.

## Getting to the form
Links don't have to point straight at the form. The bot works out which situation a page is in:
- **Job posting only**: it clicks the way in ("Apply", an "Application" tab, a link that opens a new tab),
  or opens a form embedded in an iframe.
- **Form with empty fields**: it fills every one.
- **Every field filled, with a Next / Continue button**: it moves to the next step and keeps filling.
- **Final button** (submit, or a review page after filling): it stops and hands the form to you.
- **Sign-in / create-account page**: it hands it to you.

It remembers which clicks it already tried, so it never loops between tabs, and makes at most 10 navigation clicks.

## Safety rules built in
- The bot never clicks a final button (submit, send, apply, finish, complete, confirm) once it has
  filled anything. Before that, "Apply" only opens the application, which is safe.
- Backstop: the bot's browser refuses every form-submission page load, so even a mistaken
  click can't send a classic form. (A site that submits purely with background JavaScript
  isn't covered by this backstop; the first rule still applies.)
- CAPTCHA, login walls, missing required data, EEO questions with no "decline" option and
  low-confidence decisions go to "Needs you".
- Duplicate (company, role, you) postings are skipped.

## Settings (env)
`HEADLESS=1` (hide the browser; forms are filled but you can't see them) · `CONCURRENCY=2` ·
`MAX_STEPS=60` · `DECIDER=fake` / `WRITER=fake` (offline stand-ins)

## Test
`npm run test:e2e` runs the full pipeline against a local mock job board with the offline
stand-ins and a throwaway data folder. `npm run mock` serves that board at http://localhost:4000/jobs/1.
