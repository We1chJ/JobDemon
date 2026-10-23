// The applicant's data, as edited on the Setup page and stored in the extension.

/** Your cover letter. Only the middle paragraphs are rewritten for each job. */
export interface CoverLetterTemplate {
  header: string; // name + contact lines, used as written
  salutation: string; // {company} and {role} are filled in, e.g. "To the {company} Selection Committee,"
  opening: string; // first paragraph, used word for word on every letter
  examples: string; // your own middle paragraphs: the style and content guide for each job's version
  closing: string; // e.g. "Sincerely,\n\nJane Doe"
}

export interface Profile {
  fields: Record<string, string>;
  facts: Record<string, unknown>;
  cover_letter?: CoverLetterTemplate;
  /** Documents you pasted in Setup; open-ended answers may draw on them. */
  reference_docs?: { title: string; text: string }[];
  /** Plain-language rules the AI reads with every question. Empty = the defaults. */
  guidelines?: string[];
}
export interface BankEntry { id: string; question: string; answer: string }

export const EMPTY_PROFILE: Profile = { fields: {}, facts: { summary: '', work_history: [], education: [], skills: [], interests: '' } };

/** A short, stable fingerprint (cache keys for written answers). */
export function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
