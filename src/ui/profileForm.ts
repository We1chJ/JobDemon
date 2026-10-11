// Form <-> profile.json mapping for the Setup page. Unknown keys already in the file are preserved.
import type { BankEntry, Profile } from '../profile.js';
import { SCREENING } from './screening.js';

export interface FieldDef { key: string; label: string; type?: string; auto?: string; placeholder?: string; required?: boolean; wide?: boolean }

export const FIELD_GROUPS: { title: string; help?: string; fields: FieldDef[] }[] = [
  { title: 'Contact', fields: [
    { key: 'first_name', label: 'First name', auto: 'given-name', required: true },
    { key: 'last_name', label: 'Last name', auto: 'family-name', required: true },
    { key: 'preferred_name', label: 'Preferred name', auto: 'nickname', placeholder: 'Optional' },
    { key: 'email', label: 'Email', type: 'email', auto: 'email', required: true },
    { key: 'phone', label: 'Phone', type: 'tel', auto: 'tel', placeholder: '+1 555 010 0000' },
    { key: 'location_city', label: 'City', auto: 'address-level2', placeholder: 'San Francisco, CA' },
    { key: 'country', label: 'Country', auto: 'country-name', placeholder: 'United States' },
    { key: 'mailing_address', label: 'Mailing address', auto: 'street-address', placeholder: '123 Main St, Apt 4, Boston, MA 02115', wide: true },
  ] },
  { title: 'Links', fields: [
    { key: 'linkedin_url', label: 'LinkedIn', type: 'url', placeholder: 'https://www.linkedin.com/in/…' },
    { key: 'github_url', label: 'GitHub', type: 'url', placeholder: 'https://github.com/…' },
    { key: 'website_url', label: 'Website / portfolio', type: 'url', placeholder: 'https://…' },
  ] },
  { title: 'Other', fields: [
    { key: 'years_of_experience', label: 'Years of experience', type: 'number', placeholder: '4' },
    { key: 'how_did_you_hear', label: 'How did you hear about us?', placeholder: 'Company website' },
  ] },
];

/** Every profile field the bot can map a form question to, including the ones derived from the lists. */
export const PROFILE_KEYS = [
  ...FIELD_GROUPS.flatMap((g) => g.fields.map((f) => f.key)),
  'full_name', 'current_company', 'current_title', 'school', 'degree', 'discipline', 'graduation_year',
];

export interface Job { company: string; title: string; start: string; end: string; highlights: string[] }
export interface School { school: string; degree: string; discipline: string; year: string }

const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Read the profile into plain values for the form. */
export function toForm(p: Profile) {
  const f = p.facts ?? {};
  const jobs = (Array.isArray(f.work_history) ? f.work_history : []).map((j: Record<string, unknown>): Job => ({
    company: s(j.company), title: s(j.title), start: s(j.start), end: s(j.end),
    highlights: Array.isArray(j.highlights) ? j.highlights.map(s) : [],
  }));
  const schools = (Array.isArray(f.education) ? f.education : []).map((e: Record<string, unknown>, i: number): School => ({
    school: s(e.school), degree: s(e.degree), year: s(e.year),
    // Older files kept the field of study only in fields.discipline.
    discipline: s(e.discipline) || (i === 0 ? s(p.fields?.discipline) : ''),
  }));
  return {
    fields: p.fields ?? {},
    summary: s(f.summary),
    skills: Array.isArray(f.skills) ? f.skills.map(s).join(', ') : s(f.skills),
    interests: s(f.interests),
    jobs: jobs.length ? jobs : [{ company: '', title: '', start: '', end: '', highlights: [] }],
    schools: schools.length ? schools : [{ school: '', degree: '', discipline: '', year: '' }],
  };
}

type Body = Record<string, unknown>;
const list = (b: Body, k: string): string[] => {
  const v = b[k];
  return v === undefined ? [] : Array.isArray(v) ? v.map((x) => s(x).trim()) : [s(v).trim()];
};

/** Build the profile from the submitted form, keeping any keys the form doesn't know about. */
export function fromForm(b: Body, existing: Profile): Profile {
  const fields: Record<string, string> = { ...(existing.fields ?? {}) };
  for (const g of FIELD_GROUPS) for (const d of g.fields) fields[d.key] = list(b, d.key)[0] ?? '';

  const n = list(b, 'job_company').length;
  const jobs: Job[] = [];
  for (let i = 0; i < n; i++) {
    const j = {
      company: list(b, 'job_company')[i], title: list(b, 'job_title')[i],
      start: list(b, 'job_start')[i] ?? '', end: list(b, 'job_end')[i] ?? '',
      highlights: (list(b, 'job_highlights')[i] ?? '').split('\n').map((h) => h.replace(/^[-•*]\s*/, '').trim()).filter(Boolean),
    };
    if (j.company || j.title) jobs.push(j);
  }
  const m = list(b, 'edu_school').length;
  const schools: School[] = [];
  for (let i = 0; i < m; i++) {
    const e = { school: list(b, 'edu_school')[i], degree: list(b, 'edu_degree')[i] ?? '', discipline: list(b, 'edu_discipline')[i] ?? '', year: list(b, 'edu_year')[i] ?? '' };
    if (e.school || e.degree) schools.push(e);
  }

  // Odd dashes from PDFs (e.g. U+2212 in phone numbers) become a plain hyphen.
  for (const k of Object.keys(fields)) fields[k] = String(fields[k] ?? '').replace(/[\u2010-\u2015\u2212]/g, '-');

  // Derived single-value fields that application forms ask for.
  fields.full_name = [fields.first_name, fields.last_name].filter(Boolean).join(' ');
  fields.current_company = jobs[0]?.company ?? '';
  fields.current_title = jobs[0]?.title ?? '';
  fields.school = schools[0]?.school ?? '';
  fields.degree = schools[0]?.degree ?? '';
  fields.discipline = schools[0]?.discipline ?? '';
  fields.graduation_year = schools[0]?.year ?? '';

  return {
    ...existing, // keeps other sections, e.g. the cover-letter template
    fields,
    facts: {
      ...(existing.facts ?? {}),
      summary: list(b, 'summary')[0] ?? '',
      skills: (list(b, 'skills')[0] ?? '').split(',').map((x) => x.trim()).filter(Boolean),
      interests: list(b, 'interests')[0] ?? '',
      work_history: jobs,
      education: schools,
    },
  };
}

/** Custom (non-built-in) screening answers from the form rows. */
export function customFromForm(b: Body, bank: BankEntry[]): { bank: BankEntry[]; error?: string } {
  const qs = list(b, 'cq_question'), as = list(b, 'cq_answer'), ids = list(b, 'cq_id');
  const builtIn = bank.filter((e) => SCREENING.some((q) => q.id === e.id));
  const used = new Set(builtIn.map((e) => e.id));
  const custom: BankEntry[] = [];
  for (let i = 0; i < qs.length; i++) {
    if (!qs[i] && !as[i]) continue;
    if (!qs[i] || !as[i]) return { bank, error: `"${qs[i] || as[i]}" needs both a question and an answer` };
    let id = ids[i] && !used.has(ids[i]) ? ids[i] : qs[i].toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'custom';
    for (let k = 2; used.has(id); k++) id = `${id.replace(/_\d+$/, '')}_${k}`;
    used.add(id);
    custom.push({ id, question: qs[i], answer: as[i] });
  }
  return { bank: [...builtIn, ...custom] };
}
