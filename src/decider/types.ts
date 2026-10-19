import type { ElementInfo, Op } from '../types.js';

/** Where the bot is once a page has no empty fields left. */
export const STAGES = {
  description: 'A job posting or overview. The application form is not on this page yet (it is behind an Apply button, an Application tab, or a link).',
  form_step: 'An application form step whose fields are filled, with a Next / Continue / Save-and-continue button leading to more questions.',
  final: 'The application form is complete; the remaining button would submit it.',
  account: 'A sign-in, sign-up or create-account page.',
  done: 'Nothing left to do here (confirmation, error, or no way forward).',
} as const;
export type Stage = keyof typeof STAGES;

export interface NavContext { url: string; elements: ElementInfo[]; filledHere: number; filledTotal: number; pageText: string; tried?: string[]; notes?: string }

export interface Decider {
  /** Page stage (Choice) + which button/link/tab moves the application forward (Choice). */
  navigate(ctx: NavContext): Promise<{ stage: Stage; target: number | null; confidence: number }>;
  nextAction(ctx: { goal: string; url: string; elements: ElementInfo[]; recent: string[] }): Promise<{ op: Op; target: number | null; confidence: number }>;
  /** Noul: would clicking this element submit the whole application? */
  isSubmitControl(el: ElementInfo, elements: ElementInfo[]): Promise<number>;
  /** Score 0..4: is the cover letter relevant to the JD and grounded? */
  coverLetterScore(jd: string, letter: string): Promise<number>;
}
