import 'dotenv/config';
import path from 'node:path';

const root = process.cwd();
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');

export const config = {
  dataDir,
  templatesDir: path.join(root, 'data', 'templates'),
  dbPath: path.join(dataDir, 'jobdemon.sqlite'),
  profilePath: path.join(dataDir, 'profile.json'),
  answerBankPath: path.join(dataDir, 'answer_bank.json'),
  resumePath: path.join(dataDir, process.env.RESUME_FILE ?? 'resume.pdf'),
  transcriptPath: path.join(dataDir, 'transcript.pdf'),
  lettersDir: path.join(dataDir, 'letters'),
  tracesDir: path.join(dataDir, 'traces'),

  // The bot never submits. Filled forms stay open in a visible browser window for you to submit.
  // HEADLESS=1 hides the browser (forms are still filled, but you can't see them).
  headless: process.env.HEADLESS === '1',
  concurrency: Number(process.env.CONCURRENCY ?? 1),
  maxSteps: Number(process.env.MAX_STEPS ?? 60),
  signInWaitMs: Number(process.env.SIGNIN_WAIT_MS ?? 20 * 60 * 1000), // how long to wait for you at a sign-in page

  decider: process.env.DECIDER ?? 'jev', // 'jev' | 'fake'
  writer: process.env.WRITER ?? 'openai', // 'openai' | 'fake'
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4.1',

  // Confidence thresholds for Jev gates.
  coverLetterMinScore: 2.5,
  uiPort: Number(process.env.UI_PORT ?? 3000),
};
