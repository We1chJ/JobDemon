/** One row of the numbered element table the decider sees. */
export interface ElementInfo {
  idx: number;
  key: string; // stable identity across re-observations (name/id/label)
  tag: string; // input | textarea | select | button | a | combobox | radio | checkgroup
  type: string; // text, email, file, checkbox, radio, submit...
  label: string;
  value: string;
  required: boolean;
  options?: string[]; // for native selects and radio groups
  handled: boolean; // the bot already filled or deliberately skipped it
}

export function describe(e: ElementInfo): string {
  const bits = [`[${e.idx}] ${e.tag}${e.type ? `:${e.type}` : ''}`, `"${e.label.slice(0, 120)}"`];
  if (e.required) bits.push('required');
  if (e.value) bits.push(`value="${e.value.slice(0, 60)}"`);
  if (e.options?.length) bits.push(`options=[${e.options.slice(0, 15).join(' | ')}]`);
  if (e.handled) bits.push('(done)');
  return bits.join(' ');
}

export const OPS = ['CLICK', 'TYPE_TEXT', 'SELECT', 'SCROLL', 'WAIT', 'DONE', 'BLOCKED'] as const;
export type Op = (typeof OPS)[number];

export const isFileInput = (e: ElementInfo) => e.tag === 'input' && e.type === 'file';
export const isFillable = (e: ElementInfo) =>
  e.tag === 'textarea' || e.tag === 'select' || e.tag === 'combobox' || e.tag === 'radio' || e.tag === 'checkgroup' ||
  (e.tag === 'input' && !['submit', 'button', 'hidden', 'reset', 'image'].includes(e.type));

/** "Willing to travel? / Willing to travel?*" -> "Willing to travel?" */
export function cleanLabel(label: string) {
  const parts = [...new Set(label.split(' / ').map((p) => p.replace(/\*+\s*$/, '').trim()).filter((p) => p && !/^placeholder:/i.test(p)))];
  const q = parts.find((p) => p.endsWith('?'));
  return (q ?? parts.sort((a, b) => b.length - a.length)[0] ?? label).slice(0, 200);
}
