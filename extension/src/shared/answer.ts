// The whole answering step. One rule for every question:
//   the form offers candidates  → pick among them
//   otherwise                   → pick the fact that answers it, or write it, or leave it
import type { Answer, Brain, Context, Question } from './types.js';

/** An unanswered question is "needs you" when required, otherwise simply left empty. */
export const unanswered = (q: Question, why: string): Answer => (q.required ? { kind: 'unknown', because: why } : { kind: 'skip', because: why });

// The AI chooses among at most this many options at once (Jev's limit is 255).
const MAX_CHOICES = 200;
// "How did you hear about us?" never stays blank: when no option fits, the first one is chosen.
const HEARD = /how (did|do) you (hear|learn|find out) about|where did you (hear|learn|find out) about/i;
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []);
/** The options of a very long list closest to a known answer, plus any "Other" / "not listed" option. */
function shortlist(options: string[], want: string, keep = 40) {
  const w = words(want);
  const scored = options.map((o, i) => ({ i, n: [...words(o)].filter((x) => w.has(x)).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, keep).map((x) => x.i);
  const other = options.flatMap((o, i) => (/^other\b|not (listed|in (the|this) list)|none of (the|these)/i.test(o.trim()) && !scored.includes(i) ? [i] : []));
  return [...scored, ...other];
}

export async function answerQuestion(q: Question, ctx: Context, brain: Brain): Promise<Answer> {
  if (q.candidates && q.candidates.length > MAX_CHOICES) {
    // A very long list (every university in the world): find the answer as text, then choose among the options closest to it.
    const s = await brain.source({ ...q, candidates: undefined }, ctx);
    if (!s.fact) return unanswered(q, `the list has ${q.candidates.length} options and nothing in your data names the answer`);
    const near = shortlist(q.candidates, s.fact.value);
    if (!near.length) return unanswered(q, `nothing in the list of ${q.candidates.length} is close to "${s.fact.value}"`);
    const a = await answerQuestion({ ...q, candidates: near.map((i) => q.candidates![i]) }, ctx, brain);
    return a.kind === 'pick' ? { ...a, indexes: a.indexes.map((i) => near[i]) } : a;
  }
  if (q.candidates) {
    if (!q.candidates.length) return unanswered(q, 'the form offered no options');
    const r = await brain.pick(q as Question & { candidates: string[] }, ctx);
    if (!r.indexes.length) return HEARD.test(q.prompt) ? { kind: 'pick', indexes: [0], because: `no option fits, so the first: "${q.candidates[0]}"` } : unanswered(q, 'no option fits your data');
    return { kind: 'pick', indexes: r.indexes, confidence: r.confidence, because: `chose ${r.indexes.map((i) => `"${q.candidates![i]}"`).join(', ')} (confidence ${r.confidence.toFixed(2)})` };
  }
  const s = await brain.source(q, ctx);
  // A required question can't stay blank: it's left for you instead.
  if (s.blank) return q.required ? unanswered(q, 'the AI would leave it blank, but the form requires an answer') : { kind: 'skip', because: 'left blank on purpose' };
  if (s.fact) return { kind: 'text', value: s.fact.value, because: s.fact.key };
  if (s.write) {
    const w = await brain.write(s.write, q.prompt, ctx);
    return { kind: 'text', value: w.text, file: w.file, because: s.write === 'cover_letter' ? 'cover letter' : 'written answer' };
  }
  return unanswered(q, 'nothing in your data answers this');
}
