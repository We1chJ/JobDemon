// Builds the Context the Brain sees: every fact from Setup, flattened to key / label / value.
// Add a field or a screening question in Setup and it appears here with nothing else to touch.
import fs from 'node:fs';
import { config } from '../config.js';
import type { JobCtx } from '../content.js';
import type { BankEntry, Profile } from '../profile.js';
import { FIELD_GROUPS, PROFILE_HINTS } from '../ui/profileForm.js';
import { DEFAULT_GUIDELINES } from './guidelines.js';
import type { Context, Fact, FileSlot } from './types.js';

const FIELD_LABELS = Object.fromEntries(FIELD_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f.label])));
const labelFor = (key: string) => PROFILE_HINTS[key] ?? FIELD_LABELS[key] ?? key.replace(/_/g, ' ');
const str = (v: unknown) => (Array.isArray(v) ? v.map(String).join(', ') : v == null ? '' : String(v));

export function buildContext(profile: Profile, profileVersion: string, bank: BankEntry[], job: JobCtx, portal?: string): Context {
  const facts: Fact[] = [];
  for (const [key, value] of Object.entries(profile.fields)) if (value) facts.push({ key, label: labelFor(key), value });

  const f = profile.facts;
  if (f.summary) facts.push({ key: 'summary', label: 'Professional summary', value: str(f.summary) });
  if (Array.isArray(f.skills) && f.skills.length) facts.push({ key: 'skills', label: 'Skills', value: str(f.skills) });
  if (f.interests) facts.push({ key: 'interests', label: 'Interests', value: str(f.interests) });
  (Array.isArray(f.work_history) ? f.work_history : []).forEach((j: Record<string, unknown>, i) => {
    const highlights = Array.isArray(j.highlights) ? j.highlights.map(String).join('; ') : '';
    facts.push({ key: `work_history_${i + 1}`, label: i === 0 ? 'Most recent job' : `Earlier job ${i + 1}`, value: `${j.title} at ${j.company} (${j.start} to ${j.end})${highlights ? `: ${highlights}` : ''}` });
  });
  (Array.isArray(f.education) ? f.education : []).forEach((e: Record<string, unknown>, i) => {
    const bits = [e.degree, e.discipline, e.school, e.start && `from ${e.start}`, (e.date || e.year) && `until ${e.date || e.year}`, e.gpa && `GPA ${e.gpa}`].filter(Boolean);
    facts.push({ key: `education_${i + 1}`, label: i === 0 ? 'Most recent education' : `Earlier education ${i + 1}`, value: bits.join(', ') });
  });
  for (const b of bank) facts.push({ key: `screening:${b.id}`, label: b.question, value: b.answer });

  const files: FileSlot[] = [];
  if (fs.existsSync(config.resumePath)) files.push({ key: 'resume', label: 'Resume / CV (PDF)', path: config.resumePath });
  if (fs.existsSync(config.transcriptPath)) files.push({ key: 'transcript', label: 'Academic transcript (PDF)', path: config.transcriptPath });
  files.push({ key: 'cover_letter', label: 'Cover letter (written for this job)' });

  const guidelines = profile.guidelines?.length ? profile.guidelines : DEFAULT_GUIDELINES;
  return { facts, files, guidelines, portal, job, profile, profileVersion };
}
