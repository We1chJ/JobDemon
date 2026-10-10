import OpenAI from 'openai';
import { config } from '../config.js';
import type { Profile } from '../profile.js';

export interface GenerateInput {
  kind: 'cover_letter' | 'paragraph';
  profile: Profile;
  jobDescription: string;
  company: string;
  role: string;
  question?: string; // for paragraph answers
  feedback?: string; // set on regeneration after a low quality score
}
export interface Writer { generate(input: GenerateInput): Promise<string> }

const SYSTEM = `You write job application text for the applicant described in PROFILE.
Hard rules:
- Use ONLY facts present in PROFILE. Never invent employers, titles, dates, numbers, skills, or degrees.
- If the job asks for something the profile lacks, do not claim it; focus on what is true.
- Plain text, first person, no placeholders like [Company], no markdown, no sign-off address block.`;

function userPrompt(i: GenerateInput) {
  const task = i.kind === 'cover_letter'
    ? `Write a cover letter (180-280 words) for the ${i.role} role at ${i.company}. Connect 2-3 concrete profile facts to the job's needs. End with "${i.profile.fields.full_name ?? ''}".`
    : `Answer this application question in 80-180 words: "${i.question}". Role: ${i.role} at ${i.company}.`;
  return `PROFILE:\n${JSON.stringify(i.profile, null, 1)}\n\nJOB DESCRIPTION (from the apply page):\n${i.jobDescription.slice(0, 8000)}\n\nTASK: ${task}${i.feedback ? `\n\nA previous draft was rejected: ${i.feedback}` : ''}`;
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
}

class FakeWriter implements Writer {
  async generate(i: GenerateInput) {
    return i.kind === 'cover_letter'
      ? `Dear ${i.company} team,\n\nI am applying for the ${i.role} role. ${String(i.profile.facts.summary ?? '')}\n\n${i.profile.fields.full_name ?? ''}`
      : `${String(i.profile.facts.summary ?? '')} (answer to: ${i.question})`;
  }
}

export function makeWriter(): Writer {
  return config.writer === 'fake' ? new FakeWriter() : new OpenAIWriter();
}
