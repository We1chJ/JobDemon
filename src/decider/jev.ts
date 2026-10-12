import { TypeSafeClient, choice, noul, score } from '@typesafe-ai/sdk';
import { describe, isFileInput, isFillable, OPS, type ElementInfo, type Op } from '../types.js';
import type { BankEntry } from '../profile.js';
import { PROFILE_HINTS } from '../ui/profileForm.js';
import { SPECIAL_KEYS, STAGES, type Decider, type NavContext, type Stage } from './types.js';

const MAX_ELEMENTS = 80;

const OP_CRITERIA: Record<Op, string> = {
  CLICK: 'Click a button, link, checkbox or radio option.',
  TYPE_TEXT: 'Fill a text input or textarea, or attach a file to a file input.',
  SELECT: 'Choose an option in a dropdown / combobox.',
  SCROLL: 'Scroll to reveal more of the form.',
  WAIT: 'The page is loading or changing; wait.',
  DONE: 'The page confirms the application was submitted.',
  BLOCKED: 'Cannot continue: CAPTCHA, login wall, error page, or nothing sensible to do.',
};

export class JevDecider implements Decider {
  private client = new TypeSafeClient();

  async nextAction(ctx: { goal: string; url: string; elements: ElementInfo[]; recent: string[] }) {
    // Fields first, so links in a long page never crowd them out of the state.
    const els = [...ctx.elements.filter((e) => isFillable(e) || isFileInput(e)), ...ctx.elements.filter((e) => !isFillable(e) && !isFileInput(e))].slice(0, MAX_ELEMENTS);
    // Only offer fields that still need filling; buttons become candidates once every field is done.
    // (Offering everything made Jev jump straight to "Submit".)
    const pending = ctx.elements.filter((e) => !e.handled && (isFillable(e) || isFileInput(e))).slice(0, MAX_ELEMENTS);
    const candidates = pending.length ? pending : els.filter((e) => !isFillable(e) && !isFileInput(e));
    const targets: Record<string, string> = { none: 'No element (for SCROLL, WAIT, DONE, BLOCKED).' };
    for (const e of candidates) targets[`e${e.idx}`] = describe(e);
    const r = await this.client.systemOne({
      state: {
        goal: ctx.goal,
        url: ctx.url,
        rules: [
          'Work top to bottom. Fill every field not marked (done), required ones first.',
          'Attach the resume to the resume file input with TYPE_TEXT.',
          'Click the final submit/apply button only after every field is (done).',
          'Never click links that leave the application (privacy policy, other jobs).',
        ],
        elements: els.map(describe),
        recent_actions: ctx.recent.slice(-8),
      },
      questions: {
        op: choice('What is the single next operation?', OP_CRITERIA),
        target: choice('Which element should that operation act on?', targets),
      },
    });
    const op = r.answers.op.choice as Op;
    const t = r.answers.target.choice;
    return {
      op: OPS.includes(op) ? op : 'BLOCKED',
      target: t === 'none' ? null : Number(t.slice(1)),
      confidence: Math.min(r.answers.op.confidence, t === 'none' ? 1 : r.answers.target.confidence),
    };
  }

  async navigate(ctx: NavContext) {
    const clickables = ctx.elements.filter((e) => !isFillable(e) && !isFileInput(e)).slice(0, MAX_ELEMENTS);
    const targets: Record<string, string> = { none: 'Nothing to click: no way forward, or the only way forward would submit the application.' };
    for (const e of clickables) targets[`e${e.idx}`] = describe(e);
    const r = await this.client.systemOne({
      state: {
        url: ctx.url,
        application_fields_filled_on_this_page: ctx.filledHere,
        application_fields_filled_so_far: ctx.filledTotal,
        fields_on_this_page: ctx.elements.filter((e) => isFillable(e) || isFileInput(e)).slice(0, 40).map(describe),
        page_text: ctx.pageText.slice(0, 3000),
      },
      questions: {
        stage: choice('Where is the applicant in the job application?', STAGES),
        target: choice('Which button, link or tab moves the application forward: opens the application form, or goes to the next step of it? Never a button that submits the application.', targets),
      },
    });
    const t = r.answers.target.choice;
    return { stage: r.answers.stage.choice as Stage, target: t === 'none' ? null : Number(t.slice(1)), confidence: r.answers.stage.confidence };
  }

  async mapField(field: ElementInfo, profileKeys: string[]) {
    const criteria: Record<string, string> = { ...SPECIAL_KEYS };
    for (const k of profileKeys) criteria[k] = PROFILE_HINTS[k] ?? `Profile field: ${k.replace(/_/g, ' ')}`;
    const r = await this.client.systemOne({
      state: { field: describe(field) },
      questions: {
        key: choice('Which applicant data does this form field ask for?', criteria),
        eeo: noul('Is this a voluntary EEO / demographic / self-identification question?'),
      },
    });
    return { key: r.answers.key.choice, confidence: r.answers.key.confidence, eeo: r.answers.eeo.noul };
  }

  async pickBankEntry(field: ElementInfo, bank: BankEntry[]) {
    if (!bank.length) return { id: null, confidence: 1 };
    const criteria: Record<string, string> = { none: 'No stored answer fits this question.' };
    for (const b of bank) criteria[b.id] = b.question;
    const r = await this.client.systemOne({
      state: { question: describe(field) },
      questions: { entry: choice('Which stored question is this form field asking?', criteria) },
    });
    const id = r.answers.entry.choice;
    return { id: id === 'none' ? null : id, confidence: r.answers.entry.confidence };
  }

  async pickOption(question: string, desired: string, options: string[]) {
    const criteria: Record<string, string> = {};
    options.forEach((o, i) => (criteria[`o${i}`] = o));
    const r = await this.client.systemOne({
      state: { question, intended_answer: desired },
      questions: { option: choice('Which option best matches the intended answer?', criteria) },
    });
    return { index: Number(r.answers.option.choice.slice(1)), confidence: r.answers.option.confidence };
  }

  async isSubmitControl(el: ElementInfo, elements: ElementInfo[]) {
    const r = await this.client.systemOne({
      state: { clicked: describe(el), form: elements.slice(0, MAX_ELEMENTS).map(describe) },
      questions: { submit: noul('Would clicking this element submit the whole job application?') },
    });
    return r.answers.submit.noul;
  }

  async coverLetterScore(jd: string, letter: string) {
    const r = await this.client.systemOne({
      state: { job_description: jd.slice(0, 8000), cover_letter: letter },
      questions: {
        quality: score('How relevant and specific is this cover letter to the job description?', [
          'Irrelevant or generic boilerplate.',
          'Mostly generic, barely mentions the role.',
          'Relevant but thin.',
          'Relevant and specific to the role.',
          'Highly specific, clearly tailored, no filler.',
        ]),
      },
    });
    return r.answers.quality.score;
  }
}
