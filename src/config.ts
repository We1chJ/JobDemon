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
  lettersDir: path.join(dataDir, 'letters'),
  tracesDir: path.join(dataDir, 'traces'),

  // Safety: dry-run fills everything but never clicks the final submit.
  // Set LIVE=1 to submit for real, or approve single applications from the review UI.
  live: process.env.LIVE === '1',
  headless: process.env.HEADLESS !== '0',
  concurrency: Number(process.env.CONCURRENCY ?? 1),
  maxSteps: Number(process.env.MAX_STEPS ?? 60),

  decider: process.env.DECIDER ?? 'jev', // 'jev' | 'fake'
  writer: process.env.WRITER ?? 'openai', // 'openai' | 'fake'
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4.1',

  // Confidence thresholds for Jev gates.
  submitConfirmThreshold: 0.9,
  coverLetterMinScore: 2.5,
  uiPort: Number(process.env.UI_PORT ?? 3000),
};
