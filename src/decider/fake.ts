// Rule-based stand-in for Jev. Used only for offline tests against the mock form.
import { isFileInput, isFillable, type ElementInfo } from '../types.js';
import type { BankEntry } from '../profile.js';
import type { Decider, NavContext } from './types.js';

const RULES: [RegExp, string][] = [
  [/resume|cv/i, 'resume_file'],
  [/cover letter/i, 'cover_letter'],
  [/gender|race|ethnic|veteran|disabilit|pronoun/i, 'eeo'],
  [/high school/i, 'high_school_grad_year'],
  [/^school\b/i, 'school'],
  [/end date month|graduation month/i, 'graduation_month'],
  [/start date month/i, 'school_start_month'],
  [/start date year/i, 'school_start_year'],
  [/\bgpa\b/i, 'gpa'],
  [/\bact\b/i, 'act_score'],
  [/street address/i, 'address_street'],
  [/why|describe|tell us/i, 'long_form'],
  [/authori[sz]ed|sponsor|relocat|start date|notice|salary|18|non-compete|restriction|career fair|relative|spouse|u\.s\. person/i, 'answer_bank'],
  [/mailing address/i, 'mailing_address'],
  [/first name/i, 'first_name'],
  [/last name/i, 'last_name'],
  [/e-?mail/i, 'email'],
  [/phone/i, 'phone'],
  [/linkedin/i, 'linkedin_url'],
  [/github/i, 'github_url'],
  [/website|portfolio/i, 'website_url'],
  [/location|city/i, 'location_city'],
  [/country/i, 'country'],
];
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);

export class FakeDecider implements Decider {
  private calls = 0;
  async nextAction(ctx: { elements: ElementInfo[] }) {
    // FAKE_FLAKY=1 (tests): every other answer is a useless low-confidence scroll with no target.
    if (process.env.FAKE_FLAKY === '1' && this.calls++ % 2 === 0) return { op: 'SCROLL' as const, target: null, confidence: 0.1 };
    const next = ctx.elements.find((e) => !e.handled && (isFillable(e) || isFileInput(e)));
    if (next) return { op: next.tag === 'select' ? 'SELECT' as const : 'TYPE_TEXT' as const, target: next.idx, confidence: 1 };
    const submit = ctx.elements.find((e) => (e.tag === 'button' || e.type === 'submit') && /submit|apply/i.test(e.label));
    if (submit) return { op: 'CLICK' as const, target: submit.idx, confidence: 1 };
    return { op: 'DONE' as const, target: null, confidence: 1 };
  }
  async navigate(ctx: NavContext) {
    const clickables = ctx.elements.filter((e) => !isFillable(e) && !isFileInput(e));
    if (/sign in|log in|create (an )?account/i.test(ctx.pageText) && ctx.elements.some((e) => e.type === 'password')) return { stage: 'account' as const, target: null, confidence: 1 };
    if (ctx.filledHere === 0) {
      const way = clickables.find((e) => /^(apply|application)\b|apply (for|now)/i.test(e.label));
      if (way) return { stage: 'description' as const, target: way.idx, confidence: 1 };
    }
    const next = clickables.find((e) => /^(next|continue|save (and|&) continue)\b/i.test(e.label));
    if (next) return { stage: 'form_step' as const, target: next.idx, confidence: 1 };
    const submit = clickables.find((e) => /submit|apply/i.test(e.label));
    return { stage: submit ? 'final' as const : 'done' as const, target: submit?.idx ?? null, confidence: 1 };
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
  async coverLetterScore() {
    return 3;
  }
}
