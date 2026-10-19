// Unit tests for the answering pipeline: a Question plus a scripted Brain in, an Answer out. No browser.
// Run: npm run test:qa
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion } from '../src/qa/answer.js';
import type { Brain, Context, Question } from '../src/qa/types.js';

const ctx = { facts: [{ key: 'graduation_date', label: 'Graduation date', value: '2028-05-15' }], files: [], guidelines: [] } as unknown as Context;

/** A Brain that answers exactly as scripted, and records what it was asked. */
function scripted(s: { pick?: number[]; fact?: number; write?: 'cover_letter' | 'paragraph'; blank?: boolean }) {
  const asked: string[] = [];
  const brain: Brain = {
    async pick(q) { asked.push(`pick:${q.candidates.join('|')}`); return { indexes: s.pick ?? [], confidence: 1 }; },
    async source() { asked.push('source'); return { fact: s.fact != null ? ctx.facts[s.fact] : undefined, write: s.write, blank: s.blank, confidence: 1 }; },
    async write(kind, prompt) { asked.push(`write:${kind}`); return { text: `written for "${prompt}"`, file: kind === 'cover_letter' ? '/tmp/letter.txt' : undefined }; },
  };
  return { brain, asked };
}
const q = (over: Partial<Question> = {}): Question => ({ prompt: 'Expected graduation date', required: true, ...over });

test('with candidates, the Brain picks among them and nothing else is asked', async () => {
  const { brain, asked } = scripted({ pick: [2] });
  const a = await answerQuestion(q({ candidates: ['2026', '2027', '2028'] }), ctx, brain);
  assert.deepEqual(a, { kind: 'pick', indexes: [2], because: 'chose "2028"' });
  assert.deepEqual(asked, ['pick:2026|2027|2028']);
});

test('select-all keeps every index the Brain returned', async () => {
  const { brain } = scripted({ pick: [0, 2] });
  const a = await answerQuestion(q({ candidates: ['TypeScript', 'Java', 'SQL'], multiple: true }), ctx, brain);
  assert.equal(a.kind, 'pick');
  assert.deepEqual((a as { indexes: number[] }).indexes, [0, 2]);
});

test('no fitting option: required becomes "needs you", optional is simply skipped', async () => {
  const { brain } = scripted({ pick: [] });
  assert.equal((await answerQuestion(q({ candidates: ['A', 'B'] }), ctx, brain)).kind, 'unknown');
  assert.equal((await answerQuestion(q({ candidates: ['A', 'B'], required: false }), ctx, brain)).kind, 'skip');
});

test('free text: a fact is typed verbatim, never rewritten', async () => {
  const { brain, asked } = scripted({ fact: 0 });
  const a = await answerQuestion(q(), ctx, brain);
  assert.deepEqual(a, { kind: 'text', value: '2028-05-15', because: 'graduation_date' });
  assert.deepEqual(asked, ['source']);
});

test('free text that needs writing goes to write(), with the cover-letter file when it is one', async () => {
  const { brain, asked } = scripted({ write: 'cover_letter' });
  const a = await answerQuestion(q({ prompt: 'Cover letter' }), ctx, brain);
  assert.equal(a.kind, 'text');
  assert.equal((a as { file?: string }).file, '/tmp/letter.txt');
  assert.deepEqual(asked, ['source', 'write:cover_letter']);
});

test('"leave blank" is a deliberate skip even on a required field', async () => {
  const { brain } = scripted({ blank: true });
  assert.deepEqual(await answerQuestion(q({ prompt: 'If so, please explain' }), ctx, brain), { kind: 'skip', because: 'left blank on purpose' });
});

test('nothing answers it: required is "needs you"', async () => {
  const { brain } = scripted({});
  assert.equal((await answerQuestion(q(), ctx, brain)).kind, 'unknown');
});
