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

export type FillResult =
  | { status: 'filled'; detail: string; value?: string }
  | { status: 'skipped'; detail: string }
  | { status: 'escalate'; detail: string };

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
// Consent to a privacy statement, terms or code of conduct: always agree. Deliberately narrow, so
// "Do you agree to relocate?" or "I certify that..." (factual claims) are NOT treated as consent.
const CONSENT = /privacy (statement|policy|notice)|candidate (privacy|notice)|terms (and|&) conditions|terms of (use|service)|code of conduct|data (processing|protection)|consent to|\bi (have read|agree|accept|acknowledge)\b|please (read and )?(accept|acknowledge)/i;
const AGREE_OPTION = /^(i )?(agree|accept|acknowledge|confirm|consent)/i;
const SKILL_QUESTION = /programming languages?|languages? (you|are you)|proficien|technolog(y|ies) (you|are you)|frameworks? (you|are you)/i;
// Test scores left blank in Setup mean "I don't have one".
const NO_SCORE = new Set(['sat_score', 'act_score']);
// Demographic questions you chose to answer in Setup (anything else is declined).
function selfIdAnswer(label: string, f: Record<string, string>): string {
  if (/pronoun/i.test(label)) return f.pronouns ?? '';
  if (/gender|\bsex\b/i.test(label)) return f.gender ?? '';
  if (/veteran/i.test(label)) return f.veteran_status ?? '';
  if (/disabilit/i.test(label)) return f.disability_status ?? '';
  // "Are you Hispanic or Latino?" on its own
  if (/hispanic|latin[oax]/i.test(label) && !/race/i.test(label)) return f.ethnicity ?? '';
  if (/race|ethnic/i.test(label)) {
    // Combined race/ethnicity lists ("Hispanic or Latino", "Asian (Not Hispanic or Latino)", ...)
    if (f.ethnicity?.startsWith('Yes')) return 'Hispanic or Latino';
    if (f.race) return f.ethnicity?.startsWith('No') ? `${f.race} (Not Hispanic or Latino)` : f.race;
  }
  return '';
}

const DECLINE = /decline|prefer not|don.?t wish|do not wish|not to (say|answer|disclose)|choose not to/i;
const MIN_MAP_CONFIDENCE = 0.4;
const isLongText = (e: ElementInfo) => e.tag === 'textarea';
const hasChoices = (e: ElementInfo) => e.tag === 'select' || e.tag === 'radio' || e.tag === 'combobox';
const missing = (e: ElementInfo, why: string): FillResult =>
  e.required ? { status: 'escalate', detail: `Required field "${cleanLabel(e.label)}": ${why}` } : { status: 'skipped', detail: why };

const PLACEHOLDER = /^(select|choose|--|please select)/i;
const matchOption = (options: string[], value: string) => {
  const v = value.trim().toLowerCase();
  const exact = options.findIndex((o) => o.trim().toLowerCase() === v);
  if (exact >= 0) return exact;
  const starts = options.map((o, i) => ({ o: o.toLowerCase(), i })).filter(({ o }) => o.startsWith(v + ' ') || o.startsWith(v + ','));
  if (starts.length === 1) return starts[0].i;
  // A single option that contains the whole value, e.g. "Smith College of Design" in "John Q. Smith College of Design".
  const contains = v.length >= 6 ? options.map((o, i) => ({ o: o.toLowerCase(), i })).filter(({ o }) => o.includes(v)) : [];
  return contains.length === 1 ? contains[0].i : -1;
};

export async function fillField(e: ElementInfo, d: FillDeps): Promise<FillResult> {
  const label = cleanLabel(e.label);
  if (FOLLOW_UP.test(label) && !isFileInput(e)) {
    if (d.previousAnswer && SAYS_NO.test(d.previousAnswer.trim())) return { status: 'skipped', detail: `left blank: follow-up to a "${d.previousAnswer}" answer` };
    return missing(e, d.previousAnswer ? `needs your explanation (the answer above is "${d.previousAnswer}")` : 'follow-up to a question above');
  }

  // Sites like Ashby offer an "autofill from resume" upload that rewrites the form; the bot fills fields itself.
  if (isFileInput(e) && /autofill/i.test(label)) return { status: 'skipped', detail: 'left the "autofill from resume" upload alone' };

  if (CONSENT.test(label) || CONSENT.test(e.label)) return agree(e, d);

  // "Which languages / skills are you proficient in?" checkbox lists: tick the ones in your Skills.
  if (e.type === 'checkbox' && SKILL_QUESTION.test(e.label)) {
    const option = e.label.split(' / ')[0].trim().toLowerCase();
    const skills = (Array.isArray(d.profile.facts.skills) ? d.profile.facts.skills : []).map((s) => String(s).toLowerCase());
    const have = !!option && skills.some((s) => s === option || s.split(/[\s/,()]+/).includes(option));
    await exec.setCheckbox(d.page, e, have);
    return { status: 'filled', detail: `skills list: ${have ? 'ticked' : 'left unticked'} "${option}"`, value: have ? 'checked' : '' };
  }

  const map = await d.decider.mapField(e, [...new Set([...PROFILE_KEYS, ...Object.keys(d.profile.fields)])]);
  let key = map.confidence < MIN_MAP_CONFIDENCE ? 'unknown' : map.key;
  const isEEO = (map.eeo > 0.5 || key === 'eeo') && DEMOGRAPHIC.test(label);
  if (key === 'eeo' && !isEEO) key = 'unknown';

  // EEO / demographic: never guess. Use the answer you set in Setup, otherwise the form's "decline" option.
  if (isEEO) {
    const options = e.tag === 'combobox' ? await exec.comboboxOptions(d.page, e) : (e.options ?? []);
    const mine = selfIdAnswer(label, d.profile.fields);
    if (mine && options.length) {
      let j = matchOption(options, mine);
      if (j < 0) {
        const pick = await d.decider.pickOption(label, mine, options);
        if (pick.confidence >= 0.5 && !DECLINE.test(options[pick.index] ?? '')) j = pick.index;
      }
      if (j >= 0) {
        if (e.tag === 'combobox') await exec.pickComboboxOption(d.page, j);
        else await exec.chooseOption(d.page, e, j);
        return { status: 'filled', detail: `self-identification: chose "${options[j]}"`, value: options[j] };
      }
    }
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
    else return missing(e, 'no stored answer for this question');
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
    if (!value && NO_SCORE.has(key) && hasChoices(e)) value = "I don't have this score / not taken";
    if (!value) return missing(e, `your profile has no ${key.replace(/_/g, ' ')}`);
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

/** Privacy statements, terms, codes of conduct: tick the box or pick the agreeing option. */
async function agree(e: ElementInfo, d: FillDeps): Promise<FillResult> {
  if (e.type === 'checkbox') {
    await exec.setCheckbox(d.page, e, true);
    return { status: 'filled', detail: 'consent: checked', value: 'checked' };
  }
  if (hasChoices(e)) {
    const options = e.tag === 'combobox' ? await exec.comboboxOptions(d.page, e) : (e.options ?? []);
    let i = options.findIndex((o) => AGREE_OPTION.test(o.trim()));
    if (i < 0) i = options.findIndex((o) => /^yes\b/i.test(o.trim()));
    if (i < 0) {
      if (e.tag === 'combobox') await exec.closeCombobox(d.page);
      return missing(e, 'consent question with no agreeing option');
    }
    if (e.tag === 'combobox') await exec.pickComboboxOption(d.page, i);
    else await exec.chooseOption(d.page, e, i);
    return { status: 'filled', detail: `consent: chose "${options[i]}"`, value: options[i] };
  }
  await exec.typeText(d.page, e, 'I agree');
  return { status: 'filled', detail: 'consent: typed "I agree"', value: 'I agree' };
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
      // Your school isn't in their list (e.g. a small college missing from a long list): "Other" is the honest answer.
      if (source === 'school') {
        const others = e.tag === 'combobox' ? await exec.comboboxSearch(d.page, e, 'Other') : options;
        const o = others.findIndex((x) => /^other\b/i.test(x.trim()));
        if (o >= 0) {
          if (e.tag === 'combobox') await exec.pickComboboxOption(d.page, o);
          else await exec.chooseOption(d.page, e, o);
          return { status: 'filled', detail: `school: "${value}" isn't in their list, chose "${others[o]}"`, value: others[o] };
        }
      }
      if (e.tag === 'combobox') await exec.closeCombobox(d.page);
      return missing(e, `no option matches "${value}"`);
    }
    index = pick.index;
  }
  if (e.tag === 'combobox') await exec.pickComboboxOption(d.page, index);
  else await exec.chooseOption(d.page, e, index);
  return { status: 'filled', detail: `${source}: chose "${options[index]}"`, value: options[index] };
}
