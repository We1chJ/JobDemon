// The question-answering abstraction.
//   Page ──read──▶ Question ──answer──▶ Answer ──apply──▶ Page
// Code reads the page into a Question and applies an Answer; the Brain (AI) makes every decision,
// seeing the applicant's whole Context each time. Nothing here knows about any portal or any field.
import type { JobCtx } from '../content.js';
import type { Profile } from '../profile.js';

/** One thing known about the applicant: a profile field, a screening answer, a work-history entry. */
export interface Fact { key: string; label: string; value: string }

/** A file the applicant can attach. The cover letter is written on demand, so it may have no path yet. */
export interface FileSlot { key: 'resume' | 'transcript' | 'cover_letter'; label: string; path?: string }

/** Everything the Brain gets to see, built once per application from Setup. */
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
  /** Written answers. `file` is the cover letter saved to disk, for uploads. */
  write(kind: WriteKind, prompt: string, ctx: Context): Promise<{ text: string; file?: string }>;
}
