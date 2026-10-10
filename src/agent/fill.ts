// Decides WHAT value goes into a field. Short/structured values come from the profile or
// answer bank verbatim; only cover letters and open-ended paragraphs are generated.
import type { Page } from 'playwright';
import { isFileInput, type ElementInfo } from '../types.js';
import { config } from '../config.js';
import { coverLetter, paragraphAnswer, type JobCtx } from '../content.js';
import type { Decider } from '../decider/index.js';
import type { Writer } from '../writer/index.js';
import type { BankEntry, Profile } from '../profile.js';
import * as exec from './executor.js';

export type FillResult =
  | { status: 'filled'; detail: string }
  | { status: 'skipped'; detail: string }
  | { status: 'escalate'; detail: string };

export interface FillDeps {
  page: Page; decider: Decider; writer: Writer; job: JobCtx;
  profile: Profile; profileVersion: string; bank: BankEntry[];
}

const DECLINE = /decline|prefer not|don.?t wish|do not wish|not to (say|answer|disclose)/i;
const MIN_MAP_CONFIDENCE = 0.4;
const isLongText = (e: ElementInfo) => e.tag === 'textarea';
const hasChoices = (e: ElementInfo) => e.tag === 'select' || e.tag === 'radio' || e.tag === 'combobox';
const missing = (e: ElementInfo, why: string): FillResult =>
  e.required ? { status: 'escalate', detail: `Required field "${e.label}": ${why}` } : { status: 'skipped', detail: why };

export async function fillField(e: ElementInfo, d: FillDeps): Promise<FillResult> {
  const map = await d.decider.mapField(e, Object.keys(d.profile.fields));
  let key = map.confidence < MIN_MAP_CONFIDENCE ? 'unknown' : map.key;

  // EEO / demographic: never guess. Pick an explicit "decline" option or leave blank.
  if (map.eeo > 0.5 || key === 'eeo') {
    const i = (e.options ?? []).findIndex((o) => DECLINE.test(o));
    if (i >= 0) {
      await exec.chooseOption(d.page, e, i);
      return { status: 'filled', detail: `EEO: chose "${e.options![i]}"` };
    }
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
    else return missing(e, 'no matching answer-bank entry');
  }
  if (key === 'cover_letter') {
    value = (await coverLetter(d.job, d.profile, d.profileVersion, d.writer, d.decider)).text;
  } else if (key === 'long_form') {
    if (!isLongText(e) && !(e.tag === 'input' && e.type === 'text')) return missing(e, 'open question on a non-text field');
    value = await paragraphAnswer(d.job, e.label, d.profile, d.profileVersion, d.writer);
  } else if (key === 'resume_file' || key === 'unknown') {
    return missing(e, 'no matching profile data');
  } else if (value === undefined) {
    value = d.profile.fields[key];
    if (!value) return missing(e, `profile field "${key}" is empty`);
  }

  if (e.type === 'checkbox') {
    const on = /^(yes|true|checked|agree)/i.test(value);
    await exec.setCheckbox(d.page, e, on);
    return { status: 'filled', detail: `${source}: ${on ? 'checked' : 'unchecked'}` };
  }
  if (hasChoices(e)) return chooseValue(e, value, source, d);
  await exec.typeText(d.page, e, value);
  return { status: 'filled', detail: `${source}: ${value.length > 60 ? `${value.length} chars` : value}` };
}

async function chooseValue(e: ElementInfo, value: string, source: string, d: FillDeps): Promise<FillResult> {
  const options = e.tag === 'combobox' ? await exec.openCombobox(d.page, e, value) : (e.options ?? []);
  if (e.tag === 'combobox' && !options.length) return { status: 'filled', detail: `${source}: typed "${value}" (no suggestions)` };
  const real = options.map((o, i) => ({ o, i })).filter(({ o }) => !/^(select|choose|--|please select)/i.test(o));
  const exact = real.find(({ o }) => o.toLowerCase() === value.toLowerCase());
  let index = exact?.i;
  if (index === undefined) {
    const pick = await d.decider.pickOption(e.label, value, options);
    if (pick.confidence < 0.5) return missing(e, `no option matches "${value}"`);
    index = pick.index;
  }
  if (e.tag === 'combobox') await exec.pickComboboxOption(d.page, index);
  else await exec.chooseOption(d.page, e, index);
  return { status: 'filled', detail: `${source}: chose "${options[index]}"` };
}
