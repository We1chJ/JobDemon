// Builds the Context the Brain sees: every fact from Setup, flattened to key / label / value.
// Add a field or a screening question in Setup and it appears here with nothing else to touch.
import type { BankEntry, Profile } from './profile.js';
import { FIELD_GROUPS, PROFILE_HINTS } from './profileForm.js';
import { DEFAULT_GUIDELINES } from './guidelines.js';
import type { Context, Fact, FileSlot, JobCtx } from './types.js';

const FIELD_LABELS = Object.fromEntries(FIELD_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f.label])));
const labelFor = (key: string) => PROFILE_HINTS[key] ?? FIELD_LABELS[key] ?? key.replace(/_/g, ' ');
const str = (v: unknown) => (Array.isArray(v) ? v.map(String).join(', ') : v == null ? '' : String(v));

export function buildContext(profile: Profile, profileVersion: string, bank: BankEntry[], job: JobCtx, has: { resume: boolean; transcript: boolean }, portal?: string): Context {
  const facts: Fact[] = [];
  for (const [key, value] of Object.entries(profile.fields)) if (value) facts.push({ key, label: labelFor(key), value });

  const f = profile.facts;
  if (f.summary) facts.push({ key: 'summary', label: 'Professional summary', value: str(f.summary) });
  if (Array.isArray(f.skills) && f.skills.length) facts.push({ key: 'skills', label: 'Skills', value: str(f.skills) });
  if (f.interests) facts.push({ key: 'interests', label: 'Interests', value: str(f.interests) });
  // One fact per detail, so a form asking for "Job Title" of entry 2 can point at exactly that.
  const entry = (key: string, label: string, parts: [string, string, unknown][]) => {
    for (const [k, l, v] of parts) if (str(v)) facts.push({ key: `${key}_${k}`, label: `${label}: ${l}`, value: str(v) });
  };
  (Array.isArray(f.work_history) ? f.work_history : []).forEach((j: Record<string, unknown>, i) => entry(`work_history_${i + 1}`, `Job ${i + 1}${i === 0 ? ' (most recent)' : ''}`, [
    ['title', 'job title', j.title], ['company', 'company', j.company], ['location', 'location', j.location], ['start', 'start date', j.start],
    ['end', 'end date ("present" = current job)', j.end], ['description', 'description', Array.isArray(j.highlights) ? j.highlights.map(String).join('\n') : j.highlights],
  ]));
  (Array.isArray(f.education) ? f.education : []).forEach((e: Record<string, unknown>, i) => entry(`education_${i + 1}`, `School ${i + 1}${i === 0 ? ' (most recent)' : ''}`, [
    ['school', 'school', e.school], ['degree', 'degree', e.degree], ['field', 'field of study', e.discipline], ['location', 'location', e.location],
    ['start', 'start date', e.start], ['end', 'end / graduation date', e.date || e.year], ['gpa', 'GPA', e.gpa],
  ]));
  const jobs = Array.isArray(f.work_history) ? f.work_history.length : 0, schools = Array.isArray(f.education) ? f.education.length : 0;
  facts.push({ key: 'work_history_count', label: 'Number of jobs in work history', value: String(jobs) });
  facts.push({ key: 'education_count', label: 'Number of schools in education history', value: String(schools) });
  for (const b of bank) facts.push({ key: `screening:${b.id}`, label: b.question, value: b.answer });
  facts.push({ key: 'today', label: "Today's date (e.g. for a form's signature date)", value: new Date().toISOString().slice(0, 10) });

  const files: FileSlot[] = [];
  if (has.resume) files.push({ key: 'resume', label: 'Resume / CV (PDF)', stored: true });
  if (has.transcript) files.push({ key: 'transcript', label: 'Academic transcript (PDF)', stored: true });
  files.push({ key: 'cover_letter', label: 'Cover letter (written for this job)', stored: false });

  const guidelines = profile.guidelines?.length ? profile.guidelines : DEFAULT_GUIDELINES;
  return { facts, files, guidelines, portal, job, profile, profileVersion };
}
