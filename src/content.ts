// The only two generated artifacts: cover letters and open-ended paragraph answers.
// Cached so retries / resumed runs never pay twice or produce different text.
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { config } from './config.js';
import { db, schema, now } from './db/index.js';
import { hash, type CoverLetterTemplate, type Profile } from './profile.js';
import type { Decider } from './decider/index.js';
import type { Writer } from './writer/index.js';

export interface JobCtx { appId: number; url: string; company: string; role: string; jd: string }

function cached(key: string, make: () => Promise<string>) {
  const hit = db.select().from(schema.generation).where(eq(schema.generation.key, key)).get();
  if (hit) return Promise.resolve(hit.text);
  return make().then((text) => {
    db.insert(schema.generation).values({ key, text, at: now() }).onConflictDoNothing().run();
    return text;
  });
}

const fill = (s: string, job: Pick<JobCtx, 'company' | 'role'>) => s.replaceAll('{company}', job.company).replaceAll('{role}', job.role);

/** Your template around this job's middle paragraphs, dated today. */
function assemble(t: CoverLetterTemplate, body: string, job: Pick<JobCtx, 'company' | 'role'>) {
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return [t.header.trim(), date, fill(t.salutation.trim(), job), t.opening.trim(), body.trim(), t.closing.trim()].filter(Boolean).join('\n\n');
}

type LetterJob = Pick<JobCtx, 'company' | 'role' | 'jd'>;
const template = (profile: Profile) => (profile.cover_letter?.opening.trim() ? profile.cover_letter : undefined);

/** Up to 3 drafts, each scored by the decider for relevance to the job; returns the best. */
async function bestDraft(job: LetterJob, profile: Profile, writer: Writer, decider: Decider) {
  const t = template(profile);
  let feedback: string | undefined;
  let best = { text: '', score: -1 };
  for (let attempt = 0; attempt < 3; attempt++) {
    const draft = await writer.generate({ kind: t ? 'cover_letter_body' : 'cover_letter', profile, jobDescription: job.jd, company: job.company, role: job.role, feedback });
    const s = await decider.coverLetterScore(job.jd, t ? assemble(t, draft, job) : draft);
    if (s > best.score) best = { text: draft, score: s };
    if (s >= config.coverLetterMinScore) break;
    feedback = `scored ${s.toFixed(1)}/4 for relevance; make it more specific to this job description.`;
  }
  return best;
}

/** A cover letter for a pasted job description (the Cover letter page): no application, no caching. */
export async function letterForDescription(job: LetterJob, profile: Profile, writer: Writer, decider: Decider) {
  const t = template(profile);
  const best = await bestDraft(job, profile, writer, decider);
  return { text: t ? assemble(t, best.text, job) : best.text, score: best.score, ok: best.score >= config.coverLetterMinScore };
}

export async function coverLetter(job: JobCtx, profile: Profile, profileVersion: string, writer: Writer, decider: Decider) {
  const t = template(profile);
  // With a template only the middle paragraphs are generated (and cached); the letter is assembled fresh each time so the date is current.
  const key = `${t ? 'clb' : 'cl'}:${profileVersion}:${hash(job.url)}`;
  const generated = await cached(key, async () => {
    const best = await bestDraft(job, profile, writer, decider);
    if (best.score < config.coverLetterMinScore) throw new LowQualityError(`Cover letter scored ${best.score.toFixed(1)}/4 after 3 drafts`);
    return best.text;
  });
  const text = t ? assemble(t, generated, job) : generated;
  fs.mkdirSync(config.lettersDir, { recursive: true });
  const file = path.join(config.lettersDir, `${job.appId}-cover-letter.txt`);
  fs.writeFileSync(file, text);
  return { text, file };
}

export function paragraphAnswer(job: JobCtx, question: string, profile: Profile, profileVersion: string, writer: Writer) {
  const key = `pa:${profileVersion}:${hash(job.url)}:${hash(question)}`;
  return cached(key, () => writer.generate({ kind: 'paragraph', profile, jobDescription: job.jd, company: job.company, role: job.role, question }));
}

export class LowQualityError extends Error {}
