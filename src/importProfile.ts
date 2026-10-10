// Copies data/profile.json + data/answer_bank.json into SQLite.
// Creates both files from the templates on first run so you can fill them in.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { saveProfile } from './profile.js';

let created = false;
for (const [target, tpl] of [
  [config.profilePath, 'profile.example.json'],
  [config.answerBankPath, 'answer_bank.example.json'],
] as const) {
  if (!fs.existsSync(target)) {
    fs.copyFileSync(path.join(config.templatesDir, tpl), target);
    console.log(`Created ${path.relative(process.cwd(), target)} from the template. Fill it in, then run this again.`);
    created = true;
  }
}
if (!created) {
  const profile = JSON.parse(fs.readFileSync(config.profilePath, 'utf8'));
  const bank = JSON.parse(fs.readFileSync(config.answerBankPath, 'utf8'));
  saveProfile(profile, bank);
  console.log(`Imported profile (${Object.keys(profile.fields).length} fields) and ${bank.length} answer-bank entries.`);
  if (!fs.existsSync(config.resumePath)) console.warn(`Warning: resume not found at ${config.resumePath}`);
}
