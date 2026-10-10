// Rule-based stand-in for Jev. Used only for offline tests against the mock form.
import { isFileInput, isFillable, type ElementInfo } from '../types.js';
import type { BankEntry } from '../profile.js';
import type { Decider } from './types.js';

const RULES: [RegExp, string][] = [
  [/resume|cv/i, 'resume_file'],
  [/cover letter/i, 'cover_letter'],
  [/gender|race|ethnic|veteran|disabilit|pronoun/i, 'eeo'],
  [/why|describe|tell us/i, 'long_form'],
  [/authori[sz]ed|sponsor|relocat|start date|notice|salary|18/i, 'answer_bank'],
  [/first name/i, 'first_name'],
  [/last name/i, 'last_name'],
  [/e-?mail/i, 'email'],
  [/phone/i, 'phone'],
  [/linkedin/i, 'linkedin_url'],
  [/github/i, 'github_url'],
  [/website|portfolio/i, 'website_url'],
  [/location|city/i, 'location_city'],
];
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);

export class FakeDecider implements Decider {
  async nextAction(ctx: { elements: ElementInfo[] }) {
    const next = ctx.elements.find((e) => !e.handled && (isFillable(e) || isFileInput(e)));
    if (next) return { op: next.tag === 'select' ? 'SELECT' as const : 'TYPE_TEXT' as const, target: next.idx, confidence: 1 };
    const submit = ctx.elements.find((e) => (e.tag === 'button' || e.type === 'submit') && /submit|apply/i.test(e.label));
    if (submit) return { op: 'CLICK' as const, target: submit.idx, confidence: 1 };
    return { op: 'DONE' as const, target: null, confidence: 1 };
  }
  async mapField(field: ElementInfo, keys: string[]) {
    const hit = RULES.find(([re, k]) => re.test(field.label) && (k in { resume_file: 1, cover_letter: 1, eeo: 1, long_form: 1, answer_bank: 1 } || keys.includes(k)));
    const key = hit?.[1] ?? 'unknown';
    return { key, confidence: 0.95, eeo: key === 'eeo' ? 0.99 : 0.01 };
  }
  async pickBankEntry(field: ElementInfo, bank: BankEntry[]) {
    const f = words(field.label);
    let best: BankEntry | null = null, bestScore = 0;
    for (const b of bank) {
      const s = [...words(b.question)].filter((w) => w.length > 3 && f.has(w)).length;
      if (s > bestScore) [best, bestScore] = [b, s];
    }
    return { id: best?.id ?? null, confidence: bestScore >= 1 ? 0.9 : 0.2 };
  }
  async pickOption(_q: string, desired: string, options: string[]) {
    const d = desired.toLowerCase();
    let i = options.findIndex((o) => o.toLowerCase() === d);
    if (i < 0) i = options.findIndex((o) => o.toLowerCase().includes(d) || d.includes(o.toLowerCase()));
    return { index: Math.max(i, 0), confidence: i >= 0 ? 0.95 : 0.1 };
  }
  async isSubmitControl(el: ElementInfo) {
    return /submit|apply/i.test(el.label) ? 0.95 : 0.05;
  }
  async submissionCheck(pageText: string) {
    return { submitted: /thank you|application (was )?(submitted|received)/i.test(pageText) ? 0.97 : 0.05, validationErrors: /required|invalid/i.test(pageText) ? 0.8 : 0.05 };
  }
  async coverLetterScore() {
    return 3;
  }
}
