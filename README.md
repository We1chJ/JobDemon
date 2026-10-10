# JobDemon

Local bot that applies to job URLs you provide. Jev (TypeSafe) decides each browser step,
OpenAI writes cover letters and open-ended answers, everything else comes from your profile.

## Run it
```
npm start
```
Then open http://localhost:3000. Everything happens in that page:
1. **Setup tab**: upload your resume PDF, edit your profile and answer bank, click Save.
2. **Applications tab**: paste job links (one per line) and click **Add links & run**.
3. Each link ends as **ready to submit** (form filled, waiting for you), **human review**
   (the bot couldn't finish; the reason is shown), or **applied**. Click a row's number to see
   every step with screenshots and the cover letter.
4. Click **Approve & submit** on a ready application to submit it for real.

API keys live in `.env` (`TYPESAFE_API_KEY`, `OPENAI_API_KEY`, optional `OPENAI_MODEL`).

**Dry-run is the default.** Nothing is submitted until you approve it. `LIVE=1 npm start`
submits everything without asking. `HEADLESS=0 npm start` shows the browser while it works.

Terminal alternative: `npm run apply -- urls.txt` queues a file of links and runs them.

## Safety rules built in
- CAPTCHA, login walls, missing required data, EEO questions with no "decline" option,
  low-confidence decisions and unverified submits all go to the human-review queue.
- The submit click is recorded *before* clicking; a crashed run never clicks submit again.
- An application counts as `applied` only when Jev confirms the confirmation page (≥ 0.9).
- Duplicate (company, role, you) postings are skipped.

## Settings (env)
`LIVE=1` · `HEADLESS=0` (watch the browser) · `CONCURRENCY=2` · `MAX_STEPS=60` ·
`DECIDER=fake` / `WRITER=fake` (offline stand-ins)

## Test
`npm run test:e2e` runs the full pipeline against a local mock job board with the offline
stand-ins and a throwaway data folder. `npm run mock` serves that board at http://localhost:4000/jobs/1.
