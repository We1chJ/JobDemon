// Reads the resume PDF and turns it into a draft profile. You review the draft before saving,
// because these values get typed into real applications.
import { extractText, getDocumentProxy } from 'unpdf';
import { openai } from '../background/ai.js';
import type { Profile } from '../shared/profile.js';
import { FIELD_GROUPS, fromForm } from '../shared/profileForm.js';
import type { Settings } from '../shared/store.js';

const FIELD_KEYS = ['first_name', 'last_name', 'preferred_name', 'email', 'phone', 'location_city', 'country', 'linkedin_url', 'github_url', 'website_url', 'years_of_experience'] as const;

interface Parsed {
  fields: Record<(typeof FIELD_KEYS)[number], string>;
  summary: string;
  skills: string[];
  interests: string;
  work_history: { company: string; title: string; start: string; end: string; highlights: string[] }[];
  education: { school: string; degree: string; discipline: string; year: string; start: string; gpa: string }[];
}

const str = { type: 'string' } as const;
const obj = (props: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const SCHEMA = obj({
  fields: obj(Object.fromEntries(FIELD_KEYS.map((k) => [k, str]))),
  summary: str,
  skills: { type: 'array', items: str },
  interests: str,
  work_history: { type: 'array', items: obj({ company: str, title: str, start: str, end: str, highlights: { type: 'array', items: str } }) },
  education: { type: 'array', items: obj({ school: str, degree: str, discipline: str, year: str, start: str, gpa: str }) },
});

const PROMPT = (today: string) => `Extract the applicant's details from the resume text the user sends.
Rules:
- Copy facts exactly as written. Never invent, guess, or embellish. Use "" (or []) for anything not in the resume.
- Links: full URLs. Add "https://" if the resume shows a bare domain such as linkedin.com/in/x.
- work_history: professional roles, most recent first. Dates as YYYY-MM when the month is known, else YYYY. Use "present" for current roles.
- highlights: that role's bullet points, keeping the original wording and numbers.
- education: most recent first. degree = the degree type (e.g. "BS", "MBA"); discipline = the field of study; year = graduation year; start = start month as YYYY-MM (or ""); gpa = as written (e.g. "3.8/4.0"), or "".
- summary: use the resume's own summary/objective if it has one; otherwise write at most 2 plain sentences using only facts from the resume.
- years_of_experience: whole years from the earliest full-time professional role to ${today}, or "" if dates are missing. Do not count internships.
- interests: only if the resume lists interests.`;

export async function pdfText(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

async function extract(s: Settings, text: string): Promise<Parsed> {
  if (s.fake) {
    // Offline stand-in for tests: pull the obvious bits with regexes.
    const first = text.split('\n')[0]?.trim().split(/\s+/) ?? [];
    const blank = Object.fromEntries(FIELD_KEYS.map((k) => [k, ''])) as Parsed['fields'];
    return {
      fields: { ...blank, first_name: first[0] ?? '', last_name: first.slice(1).join(' '), email: text.match(/[^\s@]+@[^\s@]+\.[a-z]{2,}/i)?.[0] ?? '' },
      summary: '', skills: [], interests: '', work_history: [], education: [],
    };
  }
  return JSON.parse(await openai(s, PROMPT(new Date().toISOString().slice(0, 7)), text.slice(0, 30000), { name: 'resume', schema: SCHEMA })) as Parsed;
}

/**
 * Build a draft profile from the resume. Values found in the resume replace the current ones;
 * anything the resume doesn't mention is kept.
 */
export async function draftFromResume(s: Settings, bytes: Uint8Array, base: Profile): Promise<Profile> {
  const text = await pdfText(bytes);
  if (text.length < 50) throw new Error('no readable text found in the PDF (is it a scanned image?)');
  const p = await extract(s, text);

  // Reuse the Setup form's builder so derived fields (full name, current job, school…) stay consistent.
  const body: Record<string, unknown> = {};
  for (const g of FIELD_GROUPS) for (const d of g.fields) body[d.key] = (p.fields as Record<string, string>)[d.key] || base.fields[d.key] || '';
  const facts = base.facts as Record<string, unknown>;
  body.summary = p.summary || String(facts.summary ?? '');
  body.skills = (p.skills.length ? p.skills : Array.isArray(facts.skills) ? facts.skills : []).join(', ');
  body.interests = p.interests || String(facts.interests ?? '');
  const jobs = p.work_history.length ? p.work_history : (facts.work_history as Parsed['work_history'] | undefined) ?? [];
  body.job_company = jobs.map((j) => j.company);
  body.job_title = jobs.map((j) => j.title);
  body.job_location = jobs.map((j) => (j as { location?: string }).location ?? '');
  body.job_start = jobs.map((j) => j.start);
  body.job_end = jobs.map((j) => j.end);
  body.job_highlights = jobs.map((j) => (j.highlights ?? []).join('\n'));
  const edu = p.education.length ? p.education : (facts.education as Parsed['education'] | undefined) ?? [];
  body.edu_school = edu.map((e) => e.school);
  body.edu_degree = edu.map((e) => e.degree);
  body.edu_discipline = edu.map((e) => e.discipline ?? '');
  body.edu_location = edu.map((e) => (e as { location?: string }).location ?? '');
  body.edu_year = edu.map((e) => e.year);
  body.edu_date = edu.map((e) => (e as { date?: string }).date ?? '');
  body.edu_start = edu.map((e) => (e as { start?: string }).start ?? '');
  body.edu_gpa = edu.map((e) => (e as { gpa?: string }).gpa ?? '');
  return fromForm(body, base);
}
