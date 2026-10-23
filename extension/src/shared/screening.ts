// Multiple-choice screening questions for the Setup page. Each one becomes an answer-bank entry
// (same id + question text the bot already matches against).
import type { BankEntry } from './profile.js';

export interface ScreeningQ {
  id: string;
  question: string; // stored in the answer bank; Jev matches form questions against this
  help?: string;
  options: { label: string; answer: string }[];
  other?: string; // placeholder for a free-text "Other" answer
}

export const SCREENING: ScreeningQ[] = [
  { id: 'work_auth_us', question: 'Are you legally authorized to work in the United States?',
    options: [{ label: 'Yes', answer: 'Yes' }, { label: 'No', answer: 'No' }] },
  { id: 'us_person', question: 'Are you a U.S. Person (a U.S. citizen, lawful permanent resident, or protected individual under 8 U.S.C. 1324b(a)(3))?',
    help: 'Often asked for export-control (ITAR / EAR) roles.',
    options: [{ label: 'Yes', answer: 'Yes' }, { label: 'No', answer: 'No' }] },
  { id: 'sponsorship', question: 'Will you now or in the future require visa sponsorship?',
    help: 'Answer Yes if you are on OPT/STEM OPT or will need an H-1B later.',
    options: [{ label: 'No', answer: 'No' }, { label: 'Yes', answer: 'Yes' }] },
  { id: 'relocate', question: 'Are you willing to relocate?',
    options: [{ label: 'Yes', answer: 'Yes' }, { label: 'No', answer: 'No' }, { label: 'Depends on location', answer: 'Open to relocating depending on location' }] },
  { id: 'remote_ok', question: 'Are you open to working in the office / hybrid?',
    options: [{ label: 'Yes, any setup', answer: 'Yes' }, { label: 'Hybrid only', answer: 'Yes, hybrid' }, { label: 'No, remote only', answer: 'No' }] },
  { id: 'notice_period', question: 'When are you available to start work / for employment? (notice period, earliest start date)',
    options: [{ label: 'Immediately', answer: 'Immediately' }, { label: '2 weeks', answer: '2 weeks' }, { label: '1 month', answer: '1 month' }],
    other: 'e.g. After June 2027' },
  { id: 'salary_expectation', question: 'What are your salary expectations?',
    help: 'Used word for word in salary boxes.',
    options: [{ label: 'Open to discussing', answer: 'Open to discussing based on the full compensation package.' }],
    other: 'e.g. $120,000 - $140,000' },
  { id: 'willing_to_travel', question: 'Are you willing to travel for work?',
    options: [{ label: 'Yes', answer: 'Yes' }, { label: 'Occasionally', answer: 'Yes, occasionally' }, { label: 'No', answer: 'No' }],
    other: 'e.g. Up to 25%' },
  { id: 'non_compete', question: 'Do you have any employment restrictions, such as a non-compete agreement?',
    options: [{ label: 'No', answer: 'No' }, { label: 'Yes', answer: 'Yes' }] },
  { id: 'met_at_event', question: 'Did you meet us at a career fair, conference or other event?',
    options: [{ label: 'No', answer: 'No' }, { label: 'Yes', answer: 'Yes' }] },
  { id: 'relatives_at_company', question: 'Do you have a spouse, partner or relatives who work for this company, or any other relationship with it?',
    options: [{ label: 'No', answer: 'No' }, { label: 'Yes', answer: 'Yes' }] },
  { id: 'over_18', question: 'Are you at least 18 years old?',
    options: [{ label: 'Yes', answer: 'Yes' }, { label: 'No', answer: 'No' }] },
  { id: 'privacy_consent', question: 'Do you consent to the privacy policy / processing of your application data?',
    help: 'Many forms require this box to be ticked before you can submit.',
    options: [{ label: 'Yes', answer: 'Yes' }, { label: 'No', answer: 'No' }] },
  { id: 'applied_before', question: 'Have you applied to this company (this role or another role) before, e.g. in the last 12–18 months?',
    options: [{ label: 'No', answer: 'No' }, { label: 'Yes', answer: 'Yes' }] },
  { id: 'further_education', question: 'Are you considering or committed to pursuing further education immediately after completing your current degree?',
    options: [{ label: 'No', answer: 'No' }, { label: 'Yes', answer: 'Yes' }] },
  { id: 'current_offers', question: 'Do you currently have any other job offers?',
    options: [{ label: 'No', answer: 'No' }, { label: 'Yes', answer: 'Yes' }] },
  { id: 'previously_employed', question: 'Have you previously worked for this company?',
    help: 'This answer is used for every company. If you have worked for one you will apply to, those applications will need a manual check.',
    options: [{ label: 'No', answer: 'No' }, { label: 'Yes', answer: 'Yes' }] },
  { id: 'sms_consent', question: 'Do you agree to receive text message (SMS) updates about your job application?',
    help: 'E.g. "Check Yes or No to indicate your agreement to receive text message updates... Message and data rates may apply."',
    options: [{ label: 'Yes', answer: 'Yes, I consent to receiving text messages' }, { label: 'No', answer: 'No, I do not consent to receiving text messages' }] },
  { id: 'spouse_military', question: 'Has your spouse or domestic partner ever served in the U.S. Military?',
    options: [{ label: 'No', answer: 'No' }, { label: 'Yes', answer: 'Yes' }, { label: 'No spouse or partner', answer: 'I do not have a spouse or domestic partner' }] },
];

export const OTHER = '__other';

/** Which option (or "other" text) is currently stored for a question. */
export function currentChoice(q: ScreeningQ, bank: BankEntry[]): { value: string; other: string } {
  const a = bank.find((b) => b.id === q.id)?.answer;
  if (a === undefined) return { value: '', other: '' };
  const hit = q.options.find((o) => o.answer === a);
  if (hit) return { value: hit.answer, other: '' };
  return q.other ? { value: OTHER, other: a } : { value: '', other: '' };
}

/** Merge submitted choices into the bank, keeping any custom entries added by hand. */
export function applyChoices(form: Record<string, unknown>, bank: BankEntry[]): { bank: BankEntry[]; missing: string[] } {
  const out = [...bank];
  const missing: string[] = [];
  for (const q of SCREENING) {
    const v = String(form[q.id] ?? '');
    const answer = v === OTHER ? String(form[`${q.id}__text`] ?? '').trim() : v;
    if (!answer || (v !== OTHER && !q.options.some((o) => o.answer === v))) { missing.push(q.question); continue; }
    const entry = { id: q.id, question: q.question, answer };
    const i = out.findIndex((b) => b.id === q.id);
    if (i >= 0) out[i] = entry; else out.push(entry);
  }
  return { bank: out, missing };
}
