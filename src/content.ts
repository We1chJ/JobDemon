// The only two generated artifacts: cover letters and open-ended paragraph answers.
// Cached so retries / resumed runs never pay twice or produce different text.
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { config } from './config.js';
import { db, schema, now } from './db/index.js';
import { hash, type Profile } from './profile.js';
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

export async function coverLetter(job: JobCtx, profile: Profile, profileVersion: string, writer: Writer, decider: Decider) {
  const key = `cl:${profileVersion}:${hash(job.url)}`;
  const text = await cached(key, async () => {
    let feedback: string | undefined;
    let best = { text: '', score: -1 };
    for (let attempt = 0; attempt < 3; attempt++) {
      const draft = await writer.generate({ kind: 'cover_letter', profile, jobDescription: job.jd, company: job.company, role: job.role, feedback });
      const s = await decider.coverLetterScore(job.jd, draft);
      if (s > best.score) best = { text: draft, score: s };
      if (s >= config.coverLetterMinScore) break;
      feedback = `scored ${s.toFixed(1)}/4 for relevance; make it more specific to this job description.`;
    }
    if (best.score < config.coverLetterMinScore) throw new LowQualityError(`Cover letter scored ${best.score.toFixed(1)}/4 after 3 drafts`);
    return best.text;
  });
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
