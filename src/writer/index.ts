import OpenAI from 'openai';
import { config } from '../config.js';
import type { Profile } from '../profile.js';

export interface GenerateInput {
  kind: 'cover_letter' | 'cover_letter_body' | 'paragraph';
  profile: Profile;
  jobDescription: string;
  company: string;
  role: string;
  question?: string; // for paragraph answers
  feedback?: string; // set on regeneration after a low quality score
}
export interface Writer {
  generate(input: GenerateInput): Promise<string>;
  /** The company and role named in a pasted job description. */
  jobInfo(jd: string): Promise<{ company: string; role: string }>;
}

const JOB_INFO_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['company', 'role'],
  properties: { company: { type: 'string' }, role: { type: 'string' } },
};

const SYSTEM = `You write job application text for the applicant described in PROFILE.
Hard rules:
- Use ONLY facts present in PROFILE (and REFERENCE MATERIAL when given). Never invent employers, titles, dates, numbers, skills, or degrees.
- If the job asks for something the profile lacks, do not claim it; focus on what is true.
- Plain text, first person, no placeholders like [Company], no markdown, no sign-off address block.`;

export function userPrompt(i: GenerateInput) {
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
  const { reference_docs: docs, cover_letter: _letter, ...profile } = i.profile;
  // Open-ended answers may also draw on the reference material you pasted in Setup.
  const refs = i.kind === 'paragraph' && docs?.length
    ? `\n\nREFERENCE MATERIAL (written or provided by the applicant; facts in it are true and may be used):\n${docs.map((d) => `--- ${d.title || 'Untitled'} ---\n${d.text}`).join('\n\n').slice(0, 40000)}`
    : '';
  return `PROFILE:\n${JSON.stringify(profile, null, 1)}${refs}\n\nJOB DESCRIPTION (from the apply page):\n${i.jobDescription.slice(0, 8000)}\n\nTASK: ${task}${i.feedback ? `\n\nA previous draft was rejected: ${i.feedback}` : ''}`;
}

class OpenAIWriter implements Writer {
  private client = new OpenAI();
  async generate(i: GenerateInput) {
    const r = await this.client.chat.completions.create({
      model: config.openaiModel,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userPrompt(i) }],
    });
    const text = r.choices[0]?.message?.content?.trim();
    if (!text) throw new Error('Writer returned empty text');
    return text;
  }
  async jobInfo(jd: string) {
    const r = await this.client.chat.completions.create({
      model: config.openaiModel,
      messages: [
        { role: 'system', content: 'From the job posting the user sends, give the hiring company\'s name and the job title exactly as the posting states them. Use "" for anything the posting does not state.' },
        { role: 'user', content: jd.slice(0, 12000) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'job', strict: true, schema: JOB_INFO_SCHEMA } },
    });
    return JSON.parse(r.choices[0]?.message?.content || '{"company":"","role":""}') as { company: string; role: string };
  }
}

class FakeWriter implements Writer {
  async generate(i: GenerateInput) {
    if (i.kind === 'cover_letter_body') return `My experience fits the ${i.role} role. ${String(i.profile.facts.summary ?? '')}\n\n${i.company} excites me because of this role.`;
    return i.kind === 'cover_letter'
      ? `Dear ${i.company} team,\n\nI am applying for the ${i.role} role. ${String(i.profile.facts.summary ?? '')}\n\n${i.profile.fields.full_name ?? ''}`
      : `${String(i.profile.facts.summary ?? '')} (answer to: ${i.question})`;
  }
  async jobInfo(jd: string) {
    return { company: jd.match(/\b(?:[Aa]t|[Jj]oin) ([A-Z][\w&.-]+)/)?.[1] ?? '', role: jd.match(/^(.+?)\n/)?.[1]?.trim() ?? '' };
  }
}

export function makeWriter(): Writer {
  return config.writer === 'fake' ? new FakeWriter() : new OpenAIWriter();
}
