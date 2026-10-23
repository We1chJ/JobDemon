// The whole answering step. One rule for every question:
//   the form offers candidates  → pick among them
//   otherwise                   → pick the fact that answers it, or write it, or leave it
import type { Answer, Brain, Context, Question } from './types.js';

/** An unanswered question is "needs you" when required, otherwise simply left empty. */
export const unanswered = (q: Question, why: string): Answer => (q.required ? { kind: 'unknown', because: why } : { kind: 'skip', because: why });

export async function answerQuestion(q: Question, ctx: Context, brain: Brain): Promise<Answer> {
  if (q.candidates) {
    if (!q.candidates.length) return unanswered(q, 'the form offered no options');
    const r = await brain.pick(q as Question & { candidates: string[] }, ctx);
    if (!r.indexes.length) return unanswered(q, 'no option fits your data');
    return { kind: 'pick', indexes: r.indexes, because: `chose ${r.indexes.map((i) => `"${q.candidates![i]}"`).join(', ')}` };
  }
  const s = await brain.source(q, ctx);
  if (s.blank) return { kind: 'skip', because: 'left blank on purpose' };
  if (s.fact) return { kind: 'text', value: s.fact.value, because: s.fact.key };
  if (s.write) {
    const w = await brain.write(s.write, q.prompt, ctx);
    return { kind: 'text', value: w.text, file: w.file, because: s.write === 'cover_letter' ? 'cover letter' : 'written answer' };
  }
  return unanswered(q, 'nothing in your data answers this');
}
