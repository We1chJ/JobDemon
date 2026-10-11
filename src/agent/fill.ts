// Decides WHAT value goes into a field. Short/structured values come from the profile or
// answer bank verbatim; only cover letters and open-ended paragraphs are generated.
import type { Page } from 'playwright';
import { cleanLabel, isFileInput, type ElementInfo } from '../types.js';
import { config } from '../config.js';
import { coverLetter, paragraphAnswer, type JobCtx } from '../content.js';
import type { Decider } from '../decider/index.js';
import type { Writer } from '../writer/index.js';
import type { BankEntry, Profile } from '../profile.js';
import * as exec from './executor.js';
import { PROFILE_KEYS } from '../ui/profileForm.js';

/** A question the bot had no answer for. It is saved so you can answer it once on the Setup page. */
export interface NewQuestion { label: string; options: string[]; required: boolean; profileKey?: string }

export type FillResult =
  | { status: 'filled'; detail: string; value?: string }
  | { status: 'skipped'; detail: string; question?: NewQuestion }
  | { status: 'escalate'; detail: string; question?: NewQuestion };

export interface FillDeps {
  page: Page; decider: Decider; writer: Writer; job: JobCtx;
  profile: Profile; profileVersion: string; bank: BankEntry[];
  previousAnswer?: string; // answer of the field just above this one (for "If so, please explain")
}

// Only real demographic questions get the EEO treatment (Jev alone once flagged "Degree").
const DEMOGRAPHIC = /gender|\bsex\b|race|ethnic|hispanic|latin[oax]|veteran|disabilit|pronoun|sexual orientation|transgender|lgbt|demographic|self.?identif/i;
// Follow-ups that only apply when the previous answer was yes.
const FOLLOW_UP = /^(if (so|yes|applicable|you answered yes|you do|you did|other)\b|please (explain|specify|describe|elaborate)\b|explain\b|other,? please)/i;
const SAYS_NO = /^(no|none|n\/?a|not applicable|false)\b/i;
// Profile fields filled from the Profile form's lists; asked about there, not as a new question.
const DERIVED = new Set(['full_name', 'current_company', 'current_title', 'school', 'degree', 'discipline', 'graduation_year'])

const DECLINE = /decline|prefer not|don.?t wish|do not wish|not to (say|answer|disclose)/i;
const MIN_MAP_CONFIDENCE = 0.4;
const isLongText = (e: ElementInfo) => e.tag === 'textarea';
const hasChoices = (e: ElementInfo) => e.tag === 'select' || e.tag === 'radio' || e.tag === 'combobox';
const missing = (e: ElementInfo, why: string): FillResult =>
  e.required ? { status: 'escalate', detail: `Required field "${cleanLabel(e.label)}": ${why}` } : { status: 'skipped', detail: why };

/** No stored answer: report it as a new question (with its choices, if it has any). */
async function unanswered(e: ElementInfo, why: string, d: FillDeps): Promise<FillResult> {
  let options = e.options ?? [];
  if (e.tag === 'combobox') { options = await exec.comboboxOptions(d.page, e); await exec.closeCombobox(d.page); }
  options = options.filter((o) => !PLACEHOLDER.test(o)).slice(0, 30);
  return { ...missing(e, why), question: { label: cleanLabel(e.label), options, required: e.required } } as FillResult;
}

const PLACEHOLDER = /^(select|choose|--|please select)/i;
const matchOption = (options: string[], value: string) => {
  const v = value.trim().toLowerCase();
  const exact = options.findIndex((o) => o.trim().toLowerCase() === v);
  if (exact >= 0) return exact;
  const starts = options.map((o, i) => ({ o: o.toLowerCase(), i })).filter(({ o }) => o.startsWith(v + ' ') || o.startsWith(v + ','));
  return starts.length === 1 ? starts[0].i : -1;
};

export async function fillField(e: ElementInfo, d: FillDeps): Promise<FillResult> {
  const label = cleanLabel(e.label);
  if (FOLLOW_UP.test(label) && !isFileInput(e)) {
    if (d.previousAnswer && SAYS_NO.test(d.previousAnswer.trim())) return { status: 'skipped', detail: `left blank: follow-up to a "${d.previousAnswer}" answer` };
    return missing(e, d.previousAnswer ? `needs your explanation (the answer above is "${d.previousAnswer}")` : 'follow-up to a question above');
  }

  // Sites like Ashby offer an "autofill from resume" upload that rewrites the form; the bot fills fields itself.
  if (isFileInput(e) && /autofill/i.test(label)) return { status: 'skipped', detail: 'left the "autofill from resume" upload alone' };

  const map = await d.decider.mapField(e, [...new Set([...PROFILE_KEYS, ...Object.keys(d.profile.fields)])]);
  let key = map.confidence < MIN_MAP_CONFIDENCE ? 'unknown' : map.key;
  const isEEO = (map.eeo > 0.5 || key === 'eeo') && DEMOGRAPHIC.test(label);
  if (key === 'eeo' && !isEEO) key = 'unknown';

  // EEO / demographic: never guess. Pick an explicit "decline" option or leave blank.
  if (isEEO) {
    const options = e.tag === 'combobox' ? await exec.comboboxOptions(d.page, e) : (e.options ?? []);
    const i = options.findIndex((o) => DECLINE.test(o));
    if (i >= 0) {
      if (e.tag === 'combobox') await exec.pickComboboxOption(d.page, i);
      else await exec.chooseOption(d.page, e, i);
      return { status: 'filled', detail: `EEO: chose "${options[i]}"` };
    }
    if (e.tag === 'combobox') await exec.closeCombobox(d.page);
    return missing(e, 'EEO question with no decline option');
  }

  if (isFileInput(e)) {
    if (key === 'resume_file') {
      await exec.uploadFile(d.page, e, config.resumePath);
      return { status: 'filled', detail: 'uploaded resume' };
    }
    if (key === 'cover_letter') {
      const { file } = await coverLetter(d.job, d.profile, d.profileVersion, d.writer, d.decider);
      await exec.uploadFile(d.page, e, file);
      return { status: 'filled', detail: 'uploaded cover letter' };
    }
    return missing(e, 'unrecognised file upload');
  }

  let value: string | undefined;
  let source = key;
  if (key === 'answer_bank') {
    const pick = await d.decider.pickBankEntry(e, d.bank);
    const entry = pick.confidence >= 0.5 ? d.bank.find((b) => b.id === pick.id) : undefined;
    if (entry) { value = entry.answer; source = `answer_bank:${entry.id}`; }
    else if (isLongText(e)) key = 'long_form';
    else return unanswered(e, 'no stored answer for this question', d);
  }
  if (key === 'cover_letter') {
    value = (await coverLetter(d.job, d.profile, d.profileVersion, d.writer, d.decider)).text;
  } else if (key === 'long_form') {
    if (!isLongText(e) && !(e.tag === 'input' && e.type === 'text')) return missing(e, 'open question on a non-text field');
    value = await paragraphAnswer(d.job, e.label, d.profile, d.profileVersion, d.writer);
  } else if (key === 'resume_file' || key === 'unknown') {
    return unanswered(e, 'no matching profile data', d);
  } else if (value === undefined) {
    value = d.profile.fields[key];
    if (!value) {
      const r = missing(e, `your profile has no ${key.replace(/_/g, ' ')}`);
      return DERIVED.has(key) ? r : { ...r, question: { label, options: [], required: e.required, profileKey: key } } as FillResult;
    }
  }

  if (e.type === 'checkbox') {
    const on = /^(yes|true|checked|agree)/i.test(value);
    await exec.setCheckbox(d.page, e, on);
    return { status: 'filled', detail: `${source}: ${on ? 'checked' : 'unchecked'}` };
  }
  if (hasChoices(e)) return chooseValue(e, value, source, d);
  await exec.typeText(d.page, e, value);
  return { status: 'filled', detail: `${source}: ${value.length > 60 ? `${value.length} chars` : value}`, value };
}

async function chooseValue(e: ElementInfo, value: string, source: string, d: FillDeps): Promise<FillResult> {
  let options: string[];
  let index = -1;
  if (e.tag === 'combobox') {
    // Custom dropdowns: open and read the list first. Only type to search when the list is
    // empty (async search, e.g. city) or cut off (e.g. only the first 100 schools are shown).
    options = await exec.comboboxOptions(d.page, e);
    index = matchOption(options, value);
    if (index < 0 && (options.length === 0 || options.length >= 100)) {
      const found = await exec.comboboxSearch(d.page, e, value);
      if (found.length) { options = found; index = matchOption(options, value); }
      else if (options.length) options = await exec.comboboxReset(d.page, e);
    }
    if (!options.length) { await exec.closeCombobox(d.page); return missing(e, `no options appeared for "${value}"`); }
  } else {
    options = e.options ?? [];
    index = matchOption(options, value);
  }
  if (index < 0) {
    const pick = await d.decider.pickOption(cleanLabel(e.label), value, options);
    if (pick.confidence < 0.5 || PLACEHOLDER.test(options[pick.index] ?? '')) {
      if (e.tag === 'combobox') await exec.closeCombobox(d.page);
      return missing(e, `no option matches "${value}"`);
    }
    index = pick.index;
  }
  if (e.tag === 'combobox') await exec.pickComboboxOption(d.page, index);
  else await exec.chooseOption(d.page, e, index);
  return { status: 'filled', detail: `${source}: chose "${options[index]}"`, value: options[index] };
}
