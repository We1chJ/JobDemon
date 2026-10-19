// Form <-> profile.json mapping for the Setup page. Unknown keys already in the file are preserved.
import type { Profile } from '../profile.js';

export interface FieldDef { key: string; label: string; type?: string; auto?: string; placeholder?: string; required?: boolean; wide?: boolean; choices?: string[] }

export const FIELD_GROUPS: { title: string; help?: string; fields: FieldDef[] }[] = [
  { title: 'Contact', fields: [
    { key: 'first_name', label: 'First name', auto: 'given-name', required: true },
    { key: 'last_name', label: 'Last name', auto: 'family-name', required: true },
    { key: 'preferred_name', label: 'Preferred name', auto: 'nickname', placeholder: 'Optional' },
    { key: 'email', label: 'Email', type: 'email', auto: 'email', required: true },
    { key: 'phone', label: 'Phone', type: 'tel', auto: 'tel', placeholder: '+1 555 010 0000' },
    { key: 'location_city', label: 'Current location', placeholder: 'Boston, MA' },
  ] },
  { title: 'Mailing address', help: 'Forms asking for one full address get these joined together.', fields: [
    { key: 'address_street', label: 'Street address', auto: 'street-address', placeholder: '123 Main St, Apt 4', wide: true },
    { key: 'address_city', label: 'City', auto: 'address-level2', placeholder: 'Boston' },
    { key: 'address_state', label: 'State', auto: 'address-level1', placeholder: 'MA' },
    { key: 'address_zip', label: 'ZIP / postal code', auto: 'postal-code', placeholder: '02115' },
    { key: 'country', label: 'Country', auto: 'country-name', placeholder: 'United States' },
  ] },
  { title: 'Links', fields: [
    { key: 'linkedin_url', label: 'LinkedIn', type: 'url', placeholder: 'https://www.linkedin.com/in/…' },
    { key: 'github_url', label: 'GitHub', type: 'url', placeholder: 'https://github.com/…' },
    { key: 'website_url', label: 'Website / portfolio', type: 'url', placeholder: 'https://…' },
  ] },
  { title: 'Voluntary self-identification', help: 'Used only for optional demographic questions. Leave a field on "Decline to answer" and the bot picks the form\'s decline option.', fields: [
    { key: 'gender', label: 'Gender', choices: ['Male', 'Female', 'Non-binary'] },
    { key: 'pronouns', label: 'Personal pronouns', choices: ['He/him', 'She/her', 'They/them'] },
    { key: 'veteran_status', label: 'Veteran status', choices: ['No, I am not a protected veteran', 'Yes, I am a protected veteran'] },
    { key: 'disability_status', label: 'Disability', choices: ['No, I do not have a disability', 'Yes, I have a disability'] },
    { key: 'race', label: 'Race', choices: ['Asian', 'White', 'Black or African American', 'Native Hawaiian or Other Pacific Islander', 'American Indian or Alaska Native', 'Two or More Races'] },
    { key: 'ethnicity', label: 'Hispanic or Latino', choices: ['No, not Hispanic or Latino', 'Yes, Hispanic or Latino'] },
  ] },
  { title: 'High school', fields: [
    { key: 'high_school_grad_year', label: 'High school graduation year', placeholder: '2024', type: 'number' },
  ] },
  { title: 'Test scores', help: 'Leave a score blank if you don\'t have one: the bot then picks the form\'s "no score" option.', fields: [
    { key: 'test_score_type', label: 'Tests taken', choices: ['SAT', 'ACT', 'Both SAT and ACT', 'Neither'] },
    { key: 'sat_score', label: 'Best SAT score', placeholder: 'e.g. 1520' },
    { key: 'act_score', label: 'Best ACT score', placeholder: 'e.g. 34' },
  ] },
  { title: 'Work authorization', fields: [
    { key: 'citizenship_status', label: 'Citizenship status', choices: ['U.S. citizen', 'U.S. lawful permanent resident (green card)', 'Asylee or refugee', 'Visa holder (e.g. F-1, OPT, H-1B)', 'Other'] },
  ] },
  { title: 'Other', fields: [
    { key: 'years_of_experience', label: 'Years of experience', type: 'number', placeholder: '4' },
    { key: 'how_did_you_hear', label: 'How did you hear about us?', placeholder: 'Company website' },
  ] },
];

/** Clearer descriptions for the AI where a field name alone is ambiguous. */
export const PROFILE_HINTS: Record<string, string> = {
  graduation_year: 'Year the applicant finishes university / college (education end date year, expected graduation year). Not high school.',
  graduation_month: 'Month the applicant finishes university / college (education end date month, expected graduation month).',
  graduation_date: 'Full date the applicant finishes university / college (education end date, expected graduation date).',
  high_school_grad_year: 'Year the applicant graduated from high school (secondary school).',
  mailing_address: 'Full postal / mailing / home address on one line.',
  address_street: 'Street address line of the applicant\'s mailing / home address (house number and street).',
  address_city: 'City of the applicant\'s mailing / home address.',
  address_state: 'State or province the applicant lives in (state of residence; mailing / home address state).',
  address_zip: 'ZIP / postal code of the applicant\'s mailing / home address.',
  phone: 'The applicant\'s phone number itself. NOT a phone extension and NOT a phone country code.',
  country: 'Country the applicant lives in (country of residence). Also the answer for a phone number\'s country / country code picker.',
  location_city: 'Where the applicant is currently located, as "City, State" (e.g. a "Location" field).',
  gpa: 'GPA / grade point average at university.',
  school_start_month: 'Month the applicant started university (education start date month).',
  school_start_year: 'Year the applicant started university (education start date year).',
  school_start_date: 'Full date the applicant started university (education start date).',
  test_score_type: 'Which standardized test scores the applicant has (SAT, ACT).',
  sat_score: 'Best SAT score.',
  act_score: 'Best ACT score.',
  citizenship_status: 'Citizenship or immigration status (U.S. citizen, permanent resident, visa holder...).',
};

export interface Job { company: string; title: string; start: string; end: string; highlights: string[] }
export interface School { school: string; degree: string; discipline: string; year: string; date: string; start: string; gpa: string }

const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Read the profile into plain values for the form. */
export function toForm(p: Profile) {
  const f = p.facts ?? {};
  const jobs = (Array.isArray(f.work_history) ? f.work_history : []).map((j: Record<string, unknown>): Job => ({
    company: s(j.company), title: s(j.title), start: s(j.start), end: s(j.end),
    highlights: Array.isArray(j.highlights) ? j.highlights.map(s) : [],
  }));
  const schools = (Array.isArray(f.education) ? f.education : []).map((e: Record<string, unknown>, i: number): School => ({
    school: s(e.school), degree: s(e.degree), year: s(e.year), date: s(e.date), start: s(e.start), gpa: s(e.gpa),
    // Older files kept the field of study only in fields.discipline.
    discipline: s(e.discipline) || (i === 0 ? s(p.fields?.discipline) : ''),
  }));
  return {
    fields: p.fields ?? {},
    summary: s(f.summary),
    skills: Array.isArray(f.skills) ? f.skills.map(s).join(', ') : s(f.skills),
    interests: s(f.interests),
    jobs: jobs.length ? jobs : [{ company: '', title: '', start: '', end: '', highlights: [] }],
    schools: schools.length ? schools : [{ school: '', degree: '', discipline: '', year: '', date: '', start: '', gpa: '' }],
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
    const date = list(b, 'edu_date')[i] ?? '';
    // Graduation date (YYYY-MM-DD) wins; older entries only had a year.
    const e = { school: list(b, 'edu_school')[i], degree: list(b, 'edu_degree')[i] ?? '', discipline: list(b, 'edu_discipline')[i] ?? '', year: date ? date.slice(0, 4) : list(b, 'edu_year')[i] ?? '', date,
      start: list(b, 'edu_start')[i] ?? '', gpa: list(b, 'edu_gpa')[i] ?? '' };
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
  fields.gpa = schools[0]?.gpa ?? '';
  // Start is a full date like the end date (older entries stored just YYYY-MM).
  const s0 = schools[0]?.start ?? '';
  const start = s0 ? new Date(`${s0.length === 7 ? `${s0}-01` : s0}T12:00:00`) : null;
  fields.school_start_month = start ? start.toLocaleDateString('en-US', { month: 'long' }) : '';
  fields.school_start_year = start ? String(start.getFullYear()) : '';
  fields.school_start_date = start ? start.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
  // One-line address from the parts (kept as typed if no street is set).
  if (fields.address_street) {
    const cityState = [fields.address_city, [fields.address_state, fields.address_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    fields.mailing_address = [fields.address_street, cityState].filter(Boolean).join(', ');
  }
  const grad = schools[0]?.date ? new Date(`${schools[0].date}T12:00:00`) : null;
  fields.graduation_month = grad ? grad.toLocaleDateString('en-US', { month: 'long' }) : '';
  fields.graduation_date = grad ? grad.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';

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
