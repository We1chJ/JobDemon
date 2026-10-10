import type { ElementInfo, Op } from '../types.js';
import type { BankEntry } from '../profile.js';

/** Special mapping targets besides the profile's own field keys. */
export const SPECIAL_KEYS = {
  resume_file: 'A file upload asking for the resume / CV.',
  cover_letter: 'A cover letter field (text box or file upload).',
  answer_bank: 'A short screening question (yes/no, authorization, sponsorship, start date, salary, relocation...).',
  long_form: 'An open-ended question needing a written paragraph ("Why us?", "Describe a time...").',
  eeo: 'A voluntary EEO / demographic question (gender, race, veteran, disability, pronouns).',
  unknown: 'None of the above, or the profile has no matching data.',
} as const;

export interface Decider {
  nextAction(ctx: { goal: string; url: string; elements: ElementInfo[]; recent: string[] }): Promise<{ op: Op; target: number | null; confidence: number }>;
  /** Field mapping (Choice) + EEO gate (Noul). */
  mapField(field: ElementInfo, profileKeys: string[]): Promise<{ key: string; confidence: number; eeo: number }>;
  pickBankEntry(field: ElementInfo, bank: BankEntry[]): Promise<{ id: string | null; confidence: number }>;
  pickOption(question: string, desired: string, options: string[]): Promise<{ index: number; confidence: number }>;
  /** Noul: would clicking this element submit the whole application? */
  isSubmitControl(el: ElementInfo, elements: ElementInfo[]): Promise<number>;
  /** Noul gates after a submit click. */
  submissionCheck(pageText: string, url: string): Promise<{ submitted: number; validationErrors: number }>;
  /** Score 0..4: is the cover letter relevant to the JD and grounded? */
  coverLetterScore(jd: string, letter: string): Promise<number>;
}
