// Rule-based stand-in for Jev. Used only for offline tests against the mock form.
import { isFileInput, isFillable, type ElementInfo } from '../types.js';
import type { Decider, NavContext } from './types.js';

export class FakeDecider implements Decider {
  private calls = 0;
  async nextAction(ctx: { elements: ElementInfo[] }) {
    // FAKE_FLAKY=1 (tests): every other answer is a useless low-confidence scroll with no target.
    if (process.env.FAKE_FLAKY === '1' && this.calls++ % 2 === 0) return { op: 'SCROLL' as const, target: null, confidence: 0.1 };
    const next = ctx.elements.find((e) => !e.handled && (isFillable(e) || isFileInput(e)));
    if (next) return { op: next.tag === 'select' ? 'SELECT' as const : 'TYPE_TEXT' as const, target: next.idx, confidence: 1 };
    const submit = ctx.elements.find((e) => (e.tag === 'button' || e.type === 'submit') && /submit|apply/i.test(e.label));
    if (submit) return { op: 'CLICK' as const, target: submit.idx, confidence: 1 };
    return { op: 'DONE' as const, target: null, confidence: 1 };
  }
  async navigate(ctx: NavContext) {
    const clickables = ctx.elements.filter((e) => !isFillable(e) && !isFileInput(e) && !ctx.tried?.includes(e.label));
    if (/sign in|log in|create (an )?account/i.test(ctx.pageText) && ctx.elements.some((e) => e.type === 'password')) return { stage: 'account' as const, target: null, confidence: 1 };
    if (ctx.filledHere === 0) {
      const way = clickables.find((e) => /^(apply|application)\b|apply (for|now)/i.test(e.label));
      if (way) return { stage: 'description' as const, target: way.idx, confidence: 1 };
    }
    const next = clickables.find((e) => /^(next|continue|save (and|&) continue)\b/i.test(e.label));
    if (next) return { stage: 'form_step' as const, target: next.idx, confidence: 1 };
    const submit = clickables.find((e) => /submit|apply/i.test(e.label));
    return { stage: submit ? 'final' as const : 'done' as const, target: submit?.idx ?? null, confidence: 1 };
  }

  async isSubmitControl(el: ElementInfo) {
    return /submit|apply/i.test(el.label) ? 0.95 : 0.05;
  }
  async coverLetterScore() {
    return 3;
  }
}
