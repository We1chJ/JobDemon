// The two brains. JevBrain: Jev picks, OpenAI writes. FakeBrain: rule-based stand-in for offline tests.
// Both see the whole Context on every call; neither stores anything between calls.
import { TypeSafeClient, choice, noul } from '@typesafe-ai/sdk';
import { config } from '../config.js';
import { coverLetter, paragraphAnswer } from '../content.js';
import type { Decider } from '../decider/index.js';
import type { Writer } from '../writer/index.js';
import { PROMPTS } from './prompts.js';
import type { Brain, Context, Fact, Question, WriteKind } from './types.js';

type PickQ = Question & { candidates: string[] };

/** Written answers go through the writer (cached per job, cover letters scored by the decider). */
async function writeWith(writer: Writer, decider: Decider, kind: WriteKind, prompt: string, ctx: Context) {
  if (kind === 'cover_letter') return coverLetter(ctx.job, ctx.profile, ctx.profileVersion, writer, decider);
  return { text: await paragraphAnswer(ctx.job, prompt, ctx.profile, ctx.profileVersion, writer) };
}

/** What Jev sees with every question: the question, the whole applicant, the guidelines. */
const state = (q: Question, ctx: Context, chosen: string[] = []) => ({
  question: q.prompt,
  required: q.required,
  ...(q.multiple ? { select_all_that_apply: true } : {}),
  ...(chosen.length ? { already_chosen: chosen } : {}),
  ...(q.previous ? { previous_question: q.previous } : {}),
  ...(ctx.portal ? { portal: ctx.portal } : {}),
  job: { company: ctx.job.company, role: ctx.job.role },
  applicant_facts: ctx.facts.map((f) => ({ key: f.key, value: f.value })),
  guidelines: ctx.guidelines,
});

class JevBrain implements Brain {
  private client = new TypeSafeClient();
  constructor(private decider: Decider, private writer: Writer) {}

  /** One choice per request. "Select all" repeats it, removing what was chosen, until the answer is none:
   *  a single choice judges exclusive options ("None of the above") far better than one yes/no per box. */
  async pick(q: PickQ, ctx: Context) {
    const indexes: number[] = [];
    let confidence = 1;
    for (let round = 0; round < (q.multiple ? q.candidates.length : 1); round++) {
      const criteria: Record<string, string> = { none: q.attach ? PROMPTS.pickFileNone : indexes.length ? PROMPTS.pickNoneMore : PROMPTS.pickNone };
      q.candidates.forEach((c, i) => { if (!indexes.includes(i)) criteria[`o${i}`] = c; });
      const ask = q.attach ? PROMPTS.pickFile : indexes.length ? PROMPTS.pickAnother : PROMPTS.pickOne;
      const r = await this.client.systemOne({ state: state(q, ctx, indexes.map((i) => q.candidates[i])), questions: { answer: choice(ask, criteria) } });
      const c = r.answers.answer.choice;
      if (c === 'none') break;
      indexes.push(Number(c.slice(1)));
      confidence = Math.min(confidence, r.answers.answer.confidence);
    }
    return { indexes, confidence };
  }

  async source(q: Question, ctx: Context) {
    const criteria: Record<string, string> = { needs_writing: PROMPTS.sourceWrite, leave_blank: PROMPTS.sourceBlank, unknown: PROMPTS.sourceUnknown };
    ctx.facts.forEach((f, i) => (criteria[`f${i}`] = `${f.key} (${f.label.slice(0, 60)}): ${f.value.slice(0, 120)}`));
    const r = await this.client.systemOne({
      state: state(q, ctx),
      questions: { source: choice(PROMPTS.source, criteria), cover_letter: noul(PROMPTS.isCoverLetter) },
    });
    const c = r.answers.source.choice;
    const confidence = r.answers.source.confidence;
    if (c === 'needs_writing') return { write: (r.answers.cover_letter.noul >= 0.5 ? 'cover_letter' : 'paragraph') as WriteKind, confidence };
    if (c === 'leave_blank') return { blank: true, confidence };
    if (c === 'unknown') return { confidence };
    return { fact: ctx.facts[Number(c.slice(1))], confidence };
  }

  write(kind: WriteKind, prompt: string, ctx: Context) {
    return writeWith(this.writer, this.decider, kind, prompt, ctx);
  }
}

// ── Offline stand-in (tests only). Mirrors what Jev is expected to conclude on the mock forms. ──
const KEY_RULES: [RegExp, string][] = [
  [/high school/i, 'high_school_grad_year'], [/^school\b/i, 'school'],
  [/end date month|graduation month/i, 'graduation_month'], [/start date month/i, 'school_start_month'], [/start date year/i, 'school_start_year'],
  [/\bgpa\b/i, 'gpa'], [/\bact\b/i, 'act_score'], [/\bsat\b/i, 'sat_score'],
  [/street address/i, 'address_street'], [/postal code|zip/i, 'address_zip'], [/mailing address/i, 'mailing_address'],
  [/first name/i, 'first_name'], [/last name/i, 'last_name'], [/e-?mail/i, 'email'],
  [/country (phone )?code|phone code/i, 'country'], [/phone/i, 'phone'],
  [/linkedin/i, 'linkedin_url'], [/github/i, 'github_url'], [/website|portfolio/i, 'website_url'],
  [/location|city/i, 'location_city'], [/country/i, 'country'],
  [/gender/i, 'gender'], [/pronoun/i, 'pronouns'], [/veteran/i, 'veteran_status'], [/disabilit/i, 'disability_status'],
];
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);

class FakeBrain implements Brain {
  constructor(private decider: Decider, private writer: Writer) {}
  private fact(ctx: Context, key: string) { return ctx.facts.find((f) => f.key === key && f.value); }
  private screening(prompt: string, ctx: Context): Fact | undefined {
    const p = words(prompt);
    let best: Fact | undefined, score = 0;
    for (const f of ctx.facts.filter((f) => f.key.startsWith('screening:'))) {
      const s = [...words(f.label)].filter((w) => w.length > 3 && p.has(w)).length;
      if (s > score) [best, score] = [f, s];
    }
    return best;
  }
  /** What a fact says this question's answer should be, as text. */
  private desired(prompt: string, ctx: Context): string {
    if (/race|ethnic/i.test(prompt)) {
      const race = this.fact(ctx, 'race')?.value, eth = this.fact(ctx, 'ethnicity')?.value;
      if (eth?.startsWith('Yes')) return 'Hispanic or Latino';
      if (race) return eth?.startsWith('No') ? `${race} (Not Hispanic or Latino)` : race;
      return '';
    }
    const rule = KEY_RULES.find(([re]) => re.test(prompt));
    if (rule) return this.fact(ctx, rule[1])?.value ?? '';
    return this.screening(prompt, ctx)?.value ?? '';
  }
  private match(candidates: string[], value: string) {
    const v = value.trim().toLowerCase();
    if (!v) return -1;
    const cs = candidates.map((c) => c.trim().toLowerCase());
    let i = cs.findIndex((c) => c === v);
    // Several start with it ("United States of America", "United States Minor Outlying Islands"): the shortest is the plain one.
    if (i < 0) { const starts = cs.map((c, k) => (c.startsWith(v + ' ') || c.startsWith(v + ',') ? k : -1)).filter((k) => k >= 0); if (starts.length) i = starts.sort((a, b) => cs[a].length - cs[b].length)[0]; }
    if (i < 0) { const has = cs.map((c, k) => (c.length >= 3 && (c.includes(v) || v.includes(c)) ? k : -1)).filter((k) => k >= 0); if (has.length === 1) i = has[0]; }
    return i;
  }

  async pick(q: PickQ, ctx: Context) {
    const { prompt, candidates } = q;
    const idx = (re: RegExp, not?: RegExp) => candidates.findIndex((c) => re.test(c.trim()) && !(not && not.test(c)));
    const one = (i: number) => ({ indexes: i >= 0 ? [i] : [], confidence: 0.95 });
    if (/autofill/i.test(prompt)) return one(-1);
    if (/privacy|code of conduct|terms (and|&|of)|consent/i.test(prompt)) return one(candidates.length === 1 ? 0 : idx(/^(i )?(agree|accept|acknowledge|consent)|^yes\b/i, /\b(not|don.?t|do not)\b/i));
    if (/hear about/i.test(prompt)) return one(idx(/^other\b/i));
    if (q.multiple && /languages?|skills|proficien/i.test(prompt)) {
      const skills = new Set((this.fact(ctx, 'skills')?.value ?? '').toLowerCase().split(/,\s*/));
      return { indexes: candidates.flatMap((c, i) => (skills.has(c.trim().toLowerCase()) ? [i] : [])), confidence: 0.95 };
    }
    if (/resume|\bcv\b/i.test(prompt)) return one(idx(/resume/i));
    if (/transcript/i.test(prompt)) return one(idx(/transcript/i));
    if (/cover letter/i.test(prompt)) return one(idx(/cover letter/i));
    const v = this.desired(prompt, ctx);
    const m = this.match(candidates, v);
    if (m >= 0) return one(m);
    if (/gender|race|ethnic|veteran|disabilit|pronoun/i.test(prompt)) return one(idx(/decline|prefer not|not to (say|answer)/i));
    if (/\b(act|sat)\b/i.test(prompt) && !v) return one(idx(/don.?t have|not taken|no score/i));
    if (/^school\b/i.test(prompt) && v) return one(idx(/^other\b/i));
    if (candidates.length === 1 && /^yes\b/i.test(v)) return one(0);
    return one(-1);
  }

  async source(q: Question, ctx: Context) {
    const { prompt } = q;
    if (/^(if (so|yes)|please (explain|specify)|explain\b)/i.test(prompt) && q.previous && /^(no|none|n\/?a)\b/i.test(q.previous.answer.trim())) return { blank: true, confidence: 0.95 };
    if (/cover letter/i.test(prompt)) return { write: 'cover_letter' as const, confidence: 0.95 };
    if (/why|describe|tell us/i.test(prompt)) return { write: 'paragraph' as const, confidence: 0.95 };
    if (/\bext(ension)?\b/i.test(prompt)) return { confidence: 0.95 };
    const rule = KEY_RULES.find(([re]) => re.test(prompt));
    const fact = (rule && this.fact(ctx, rule[1])) || this.screening(prompt, ctx);
    return fact ? { fact, confidence: 0.95 } : { confidence: 0.95 };
  }

  write(kind: WriteKind, prompt: string, ctx: Context) {
    return writeWith(this.writer, this.decider, kind, prompt, ctx);
  }
}

export function makeBrain(decider: Decider, writer: Writer): Brain {
  return config.decider === 'fake' ? new FakeBrain(decider, writer) : new JevBrain(decider, writer);
}
