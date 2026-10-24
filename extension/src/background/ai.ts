// The AI, run from the extension's background worker: Jev decides (picks, which fact, letter quality),
// OpenAI writes (cover letters, essays, resume reading). Keys come from Setup. A rule-based stand-in
// answers instead when the "fake" test setting is on, so tests never call the real APIs.
import { TypeSafeClient, choice, noul, score } from '@typesafe-ai/sdk';
import { PROMPTS } from '../shared/prompts.js';
import { hash, type CoverLetterTemplate, type Profile } from '../shared/profile.js';
import { store, type Settings } from '../shared/store.js';
import type { Brain, Context, Fact, JobCtx, Question, WriteKind } from '../shared/types.js';

type PickQ = Question & { candidates: string[] };
const MIN_LETTER_SCORE = 2.5;

// ── Writing (OpenAI) ────────────────────────────────────────────────────────
interface GenerateInput { kind: 'cover_letter' | 'cover_letter_body' | 'paragraph'; profile: Profile; jobDescription: string; company: string; role: string; question?: string; feedback?: string }

const SYSTEM = `You write job application text for the applicant described in PROFILE.
Hard rules:
- Use ONLY facts present in PROFILE (and REFERENCE MATERIAL when given). Never invent employers, titles, dates, numbers, skills, or degrees.
- If the job asks for something the profile lacks, do not claim it; focus on what is true.
- Plain text, first person, no placeholders like [Company], no markdown, no sign-off address block.`;

function userPrompt(i: GenerateInput) {
  const t = i.profile.cover_letter;
  if (i.kind === 'cover_letter_body' && t) {
    return `PROFILE:\n${JSON.stringify({ fields: i.profile.fields, facts: i.profile.facts }, null, 1)}\n\nJOB DESCRIPTION (from the apply page):\n${i.jobDescription.slice(0, 8000)}\n\nTHE LETTER'S FIXED OPENING PARAGRAPH (already written, do not repeat it):\n${t.opening}\n\nTHE APPLICANT'S OWN EXAMPLE MIDDLE PARAGRAPHS (written for a different company; facts in them are true and may be used):\n${t.examples}\n\nTASK: Write the two middle paragraphs of the cover letter for the ${i.role} role at ${i.company}, 170-260 words in total, separated by one blank line.
- Paragraph 1: connect the applicant's real experience (PROFILE and the example paragraphs) to what this job asks for.
- Paragraph 2: why ${i.company} and this role specifically, using details from the job description.
- Match the voice, rhythm and confidence of the example paragraphs and reuse their phrasing where it fits, but replace anything specific to the other company or role.
- Output only the two paragraphs: no greeting, no opening paragraph, no sign-off.${i.feedback ? `\n\nA previous draft was rejected: ${i.feedback}` : ''}`;
  }
  const task = i.kind === 'cover_letter'
    ? `Write a cover letter (180-280 words) for the ${i.role} role at ${i.company}. Connect 2-3 concrete profile facts to the job's needs. End with "${i.profile.fields.full_name ?? ''}".`
    : `Answer this application question in 80-180 words: "${i.question}". Role: ${i.role} at ${i.company}.`;
  const { reference_docs: docs, cover_letter: _letter, guidelines: _g, ...profile } = i.profile;
  const refs = i.kind === 'paragraph' && docs?.length
    ? `\n\nREFERENCE MATERIAL (written or provided by the applicant; facts in it are true and may be used):\n${docs.map((d) => `--- ${d.title || 'Untitled'} ---\n${d.text}`).join('\n\n').slice(0, 40000)}`
    : '';
  return `PROFILE:\n${JSON.stringify(profile, null, 1)}${refs}\n\nJOB DESCRIPTION (from the apply page):\n${i.jobDescription.slice(0, 8000)}\n\nTASK: ${task}${i.feedback ? `\n\nA previous draft was rejected: ${i.feedback}` : ''}`;
}

/** One OpenAI chat call. With a JSON schema, the reply is parsed. */
export async function openai(s: Settings, system: string, user: string, schema?: { name: string; schema: object }): Promise<string> {
  if (!s.openaiKey) throw new Error('add your OpenAI API key in Setup first');
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${s.openaiKey}` },
    body: JSON.stringify({
      model: s.openaiModel || 'gpt-4.1',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      ...(schema ? { response_format: { type: 'json_schema', json_schema: { name: schema.name, strict: true, schema: schema.schema } } } : {}),
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`OpenAI said ${r.status}: ${body?.error?.message ?? 'request failed'}`);
  const text = body?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('OpenAI returned no text');
  return text;
}

async function generate(s: Settings, i: GenerateInput): Promise<string> {
  if (s.fake) {
    if (i.kind === 'cover_letter_body') return `My experience fits the ${i.role} role. ${String(i.profile.facts.summary ?? '')}\n\n${i.company} excites me because of this role.`;
    return i.kind === 'cover_letter'
      ? `Dear ${i.company} team,\n\nI am applying for the ${i.role} role. ${String(i.profile.facts.summary ?? '')}\n\n${i.profile.fields.full_name ?? ''}`
      : `${String(i.profile.facts.summary ?? '')} (answer to: ${i.question})`;
  }
  return openai(s, SYSTEM, userPrompt(i));
}

/** The company and job title named in a pasted job posting. */
export async function jobInfo(s: Settings, jd: string): Promise<{ company: string; role: string }> {
  if (s.fake) return { company: jd.match(/\b(?:[Aa]t|[Jj]oin) ([A-Z][\w&.-]+)/)?.[1] ?? '', role: jd.match(/^(.+?)\n/)?.[1]?.trim() ?? '' };
  const out = await openai(s, 'From the job posting the user sends, give the hiring company\'s name and the job title exactly as the posting states them. Use "" for anything the posting does not state.', jd.slice(0, 12000),
    { name: 'job', schema: { type: 'object', additionalProperties: false, required: ['company', 'role'], properties: { company: { type: 'string' }, role: { type: 'string' } } } });
  return JSON.parse(out);
}

// ── Jev ─────────────────────────────────────────────────────────────────────
const jev = (s: Settings) => {
  if (!s.typesafeKey) throw new Error('add your TypeSafe (Jev) API key in Setup first');
  return new TypeSafeClient({ apiKey: s.typesafeKey });
};

/** 0..4: how relevant and specific a cover letter is to the job description. */
async function letterScore(s: Settings, jd: string, letter: string) {
  if (s.fake) return 3;
  const r = await jev(s).systemOne({
    state: { job_description: jd.slice(0, 8000), cover_letter: letter },
    questions: { quality: score('How relevant and specific is this cover letter to the job description?', [
      'Irrelevant or generic boilerplate.', 'Mostly generic, barely mentions the role.', 'Relevant but thin.',
      'Relevant and specific to the role.', 'Highly specific, clearly tailored, no filler.',
    ]) },
  });
  return r.answers.quality.score as number;
}

// ── Cover letters ───────────────────────────────────────────────────────────
const fill = (t: string, job: Pick<JobCtx, 'company' | 'role'>) => t.replaceAll('{company}', job.company).replaceAll('{role}', job.role);
const template = (p: Profile) => (p.cover_letter?.opening.trim() ? p.cover_letter : undefined);
function assemble(t: CoverLetterTemplate, body: string, job: Pick<JobCtx, 'company' | 'role'>) {
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return [t.header.trim(), date, fill(t.salutation.trim(), job), t.opening.trim(), body.trim(), t.closing.trim()].filter(Boolean).join('\n\n');
}

/** Up to 3 drafts, each scored by Jev for relevance to the job; the best one. */
async function bestDraft(s: Settings, job: Pick<JobCtx, 'company' | 'role' | 'jd'>, profile: Profile) {
  const t = template(profile);
  let feedback: string | undefined;
  let best = { text: '', score: -1 };
  for (let attempt = 0; attempt < 3; attempt++) {
    const draft = await generate(s, { kind: t ? 'cover_letter_body' : 'cover_letter', profile, jobDescription: job.jd, company: job.company, role: job.role, feedback });
    const sc = await letterScore(s, job.jd, t ? assemble(t, draft, job) : draft);
    if (sc > best.score) best = { text: draft, score: sc };
    if (sc >= MIN_LETTER_SCORE) break;
    feedback = `scored ${sc.toFixed(1)}/4 for relevance; make it more specific to this job description.`;
  }
  return best;
}

/** A cover letter for a job: generated once per job and profile version, then reused. */
export async function coverLetter(s: Settings, job: JobCtx, profile: Profile, version: string) {
  const t = template(profile);
  const key = `${t ? 'clb' : 'cl'}:${version}:${hash(job.url)}`;
  let body = await store.cached(key);
  if (!body) {
    const best = await bestDraft(s, job, profile);
    if (best.score < MIN_LETTER_SCORE) throw new Error(`the cover letter scored ${best.score.toFixed(1)}/4 after 3 drafts`);
    body = best.text;
    await store.cache(key, body);
  }
  return t ? assemble(t, body, job) : body;
}

/** The Cover letter page: a letter for a pasted posting, not tied to an application. */
export async function letterForPosting(s: Settings, job: Pick<JobCtx, 'company' | 'role' | 'jd'>, profile: Profile) {
  const t = template(profile);
  const best = await bestDraft(s, job, profile);
  return { text: t ? assemble(t, best.text, job) : best.text, score: best.score, ok: best.score >= MIN_LETTER_SCORE };
}

async function paragraph(s: Settings, job: JobCtx, question: string, profile: Profile, version: string) {
  const key = `pa:${version}:${hash(job.url)}:${hash(question)}`;
  const hit = await store.cached(key);
  if (hit) return hit;
  const text = await generate(s, { kind: 'paragraph', profile, jobDescription: job.jd, company: job.company, role: job.role, question });
  await store.cache(key, text);
  return text;
}

// ── The brains ──────────────────────────────────────────────────────────────
/** What Jev sees with every question: the question, the whole applicant, the guidelines. */
const state = (q: Question, ctx: Context, chosen: string[] = []) => ({
  question: q.prompt,
  ...(q.description ? { question_details: q.description } : {}),
  ...(q.answerBox ? { answer_box: q.answerBox } : {}),
  required: q.required,
  ...(q.multiple ? { select_all_that_apply: true } : {}),
  ...(chosen.length ? { already_chosen: chosen } : {}),
  ...(q.previous ? { previous_question: q.previous } : {}),
  ...(q.feedback ? { form_said_about_last_answer: q.feedback } : {}),
  ...(ctx.portal ? { portal: ctx.portal } : {}),
  job: { company: ctx.job.company, role: ctx.job.role },
  applicant_facts: ctx.facts.map((f) => ({ key: f.key, value: f.value })),
  guidelines: ctx.guidelines,
});

async function write(s: Settings, kind: WriteKind, prompt: string, ctx: Context) {
  return { text: kind === 'cover_letter' ? await coverLetter(s, ctx.job, ctx.profile, ctx.profileVersion) : await paragraph(s, ctx.job, prompt, ctx.profile, ctx.profileVersion) };
}

class JevBrain implements Brain {
  constructor(private s: Settings) {}
  /** One choice per request. "Select all" repeats it, removing what was chosen, until the answer is none. */
  async pick(q: PickQ, ctx: Context) {
    const client = jev(this.s);
    const indexes: number[] = [];
    let confidence = 1;
    for (let round = 0; round < (q.multiple ? q.candidates.length : 1); round++) {
      const criteria: Record<string, string> = { none: q.attach ? PROMPTS.pickFileNone : indexes.length ? PROMPTS.pickNoneMore : PROMPTS.pickNone };
      q.candidates.forEach((c, i) => { if (!indexes.includes(i)) criteria[`o${i}`] = c; });
      const ask = q.attach ? PROMPTS.pickFile : indexes.length ? PROMPTS.pickAnother : PROMPTS.pickOne;
      const r = await client.systemOne({ state: state(q, ctx, indexes.map((i) => q.candidates[i])), questions: { answer: choice(ask, criteria) } });
      const c = r.answers.answer.choice as string;
      if (c === 'none') break;
      indexes.push(Number(c.slice(1)));
      confidence = Math.min(confidence, r.answers.answer.confidence);
    }
    return { indexes, confidence };
  }
  async source(q: Question, ctx: Context) {
    const criteria: Record<string, string> = { needs_writing: PROMPTS.sourceWrite, leave_blank: PROMPTS.sourceBlank, unknown: PROMPTS.sourceUnknown };
    ctx.facts.forEach((f, i) => (criteria[`f${i}`] = `${f.key} (${f.label.slice(0, 60)}): ${f.value.slice(0, 120)}`));
    const r = await jev(this.s).systemOne({ state: state(q, ctx), questions: { source: choice(PROMPTS.source, criteria), cover_letter: noul(PROMPTS.isCoverLetter) } });
    const c = r.answers.source.choice as string;
    const confidence = r.answers.source.confidence;
    if (c === 'needs_writing') return { write: (r.answers.cover_letter.noul >= 0.5 ? 'cover_letter' : 'paragraph') as WriteKind, confidence };
    if (c === 'leave_blank') return { blank: true, confidence };
    if (c === 'unknown') return { confidence };
    return { fact: ctx.facts[Number(c.slice(1))], confidence };
  }
  write(kind: WriteKind, prompt: string, ctx: Context) { return write(this.s, kind, prompt, ctx); }
}

// Offline stand-in (tests only): mirrors what Jev is expected to conclude on the mock forms.
const KEY_RULES: [RegExp, string][] = [
  [/high school/i, 'high_school_grad_year'], [/^(school|university|college)\b/i, 'school'], [/full name/i, 'full_name'],
  [/end date month|graduation month/i, 'graduation_month'], [/start date month/i, 'school_start_month'], [/start date year/i, 'school_start_year'],
  [/\bgpa\b/i, 'gpa'], [/\bact\b/i, 'act_score'], [/\bsat\b/i, 'sat_score'],
  [/street address/i, 'address_street'], [/postal code|zip/i, 'address_zip'], [/mailing address/i, 'mailing_address'],
  [/first name/i, 'first_name'], [/last name/i, 'last_name'], [/e-?mail/i, 'email'],
  [/country (phone )?code|phone code/i, 'country'], [/phone/i, 'phone'],
  [/linkedin/i, 'linkedin_url'], [/github/i, 'github_url'], [/website|portfolio/i, 'website_url'],
  [/location|city/i, 'location_city'], [/country/i, 'country'],
  [/skills/i, 'skills'], [/gender/i, 'gender'], [/pronoun/i, 'pronouns'], [/veteran/i, 'veteran_status'], [/disabilit/i, 'disability_status'],
];
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
const ENTRY_FIELDS: [RegExp, string][] = [
  [/job title|title/i, 'title'], [/company|employer/i, 'company'], [/^from$|start/i, 'start'], [/^to$|end|graduat/i, 'end'],
  [/description|responsibilit/i, 'description'], [/school|university|institution/i, 'school'], [/degree/i, 'degree'], [/field of study|major/i, 'field'], [/gpa/i, 'gpa'],
];
function entryFact(prompt: string, ctx: Context): Fact | undefined {
  const m = prompt.match(/^(.+?)\s+(\d+)\s*>\s*(.+)$/i);
  if (!m) return undefined;
  const kind = /work|job|experience|employ|position/i.test(m[1]) ? 'work_history' : /educ|school|universit/i.test(m[1]) ? 'education' : '';
  const field = ENTRY_FIELDS.find(([re]) => re.test(m[3].trim()))?.[1];
  if (!kind || !field) return undefined;
  return ctx.facts.find((f) => f.key === `${kind}_${m[2]}_${field}`);
}

class FakeBrain implements Brain {
  constructor(private s: Settings) {}
  private fact(ctx: Context, key: string) { return ctx.facts.find((f) => f.key === key && f.value); }
  private screening(prompt: string, ctx: Context): Fact | undefined {
    const p = words(prompt);
    let best: Fact | undefined, sc = 0;
    for (const f of ctx.facts.filter((f) => f.key.startsWith('screening:'))) {
      const n = [...words(f.label)].filter((w) => w.length > 3 && p.has(w)).length;
      if (n > sc) [best, sc] = [f, n];
    }
    return best;
  }
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
    const sections = prompt.match(/how many entries should the "(.+)" section/i);
    if (sections) {
      const n = this.fact(ctx, /work|job|experience|employ/i.test(sections[1]) ? 'work_history_count' : /educ|school/i.test(sections[1]) ? 'education_count' : '')?.value ?? '0';
      return one(candidates.indexOf(n));
    }
    if (/currently work/i.test(prompt)) {
      const m = prompt.match(/(\d+)\s*>/);
      return one(m && this.fact(ctx, `work_history_${m[1]}_end`)?.value === 'present' ? 0 : -1);
    }
    if (/hear about/i.test(prompt)) {
      for (const re of [/linkedin/i, /instagram/i, /job board|social/i, /^other\b/i]) { const i = idx(re); if (i >= 0) return one(i); }
      return one(-1);
    }
    if (q.multiple && /languages?|skills|proficien/i.test(prompt)) {
      const skills = new Set((this.fact(ctx, 'skills')?.value ?? '').toLowerCase().split(/,\s*/));
      return { indexes: candidates.flatMap((c, i) => (skills.has(c.trim().toLowerCase()) ? [i] : [])), confidence: 0.95 };
    }
    if (/resume|\bcv\b/i.test(prompt)) return one(idx(/resume/i));
    if (/transcript/i.test(prompt)) return one(idx(/transcript/i));
    if (/cover letter/i.test(prompt)) return one(idx(/cover letter/i));
    const v = entryFact(prompt, ctx)?.value ?? this.desired(prompt, ctx);
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
    if (/why|describe|tell us/i.test(`${prompt} ${q.description ?? ''}`)) return { write: 'paragraph' as const, confidence: 0.95 };
    if (/\bext(ension)?\b/i.test(prompt)) return { confidence: 0.95 };
    const entry = entryFact(prompt, ctx);
    if (entry) return { fact: entry, confidence: 0.95 };
    const rule = KEY_RULES.find(([re]) => re.test(prompt));
    const fact = (rule && this.fact(ctx, rule[1])) || this.screening(prompt, ctx);
    return fact ? { fact, confidence: 0.95 } : { confidence: 0.95 };
  }
  write(kind: WriteKind, prompt: string, ctx: Context) { return write(this.s, kind, prompt, ctx); }
}

export const makeBrain = (s: Settings): Brain => (s.fake ? new FakeBrain(s) : new JevBrain(s));
