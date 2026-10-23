// The question-answering abstraction.
//   Page ──read──▶ Question ──answer──▶ Answer ──apply──▶ Page
// The content script reads the page into a Question and applies an Answer; the Brain (AI, in the background)
// makes every decision, seeing the applicant's whole Context each time. Nothing here knows about any portal.
import type { Profile } from './profile.js';

/** The job the page is for, read off the page. */
export interface JobCtx { url: string; company: string; role: string; jd: string }

/** One thing known about the applicant: a profile field, a screening answer, a work-history entry. */
export interface Fact { key: string; label: string; value: string }

/** A file the applicant can attach. The cover letter is written on demand, so it may have no stored file yet. */
export interface FileSlot { key: 'resume' | 'transcript' | 'cover_letter'; label: string; stored: boolean }

/** Everything the Brain gets to see, built from Setup for one job. */
export interface Context {
  facts: Fact[];
  files: FileSlot[];
  guidelines: string[];
  portal?: string;
  job: JobCtx;
  profile: Profile;
  profileVersion: string;
}

export interface Question {
  prompt: string;
  /** The form's own options (or the applicant's files for an upload). Absent for free text. */
  candidates?: string[];
  /** "Select all that apply". */
  multiple?: boolean;
  /** The candidates are the applicant's files, and the question is which one to attach. */
  attach?: boolean;
  required: boolean;
  /** The question just above this one, for follow-ups like "If so, please explain". */
  previous?: { prompt: string; answer: string };
  /** What the form said about the last answer (e.g. a validation error), when asking again. */
  feedback?: string;
}

export type Answer =
  | { kind: 'pick'; indexes: number[]; because: string }
  | { kind: 'text'; value: string; because: string; file?: string }
  | { kind: 'skip'; because: string }
  | { kind: 'unknown'; because: string };

export type WriteKind = 'cover_letter' | 'paragraph';

/** The AI. Jev picks; OpenAI writes; the fake brain stands in for both in tests. */
export interface Brain {
  /** Which candidates are true for the applicant. Empty = none of them. */
  pick(q: Question & { candidates: string[] }, ctx: Context): Promise<{ indexes: number[]; confidence: number }>;
  /** Free text: the fact that answers it, or that it needs writing, or that it should stay blank. */
  source(q: Question, ctx: Context): Promise<{ fact?: Fact; write?: WriteKind; blank?: boolean; confidence: number }>;
  /** Written answers. `file` is set when a cover letter was saved as a file to attach. */
  write(kind: WriteKind, prompt: string, ctx: Context): Promise<{ text: string; file?: string }>;
}
