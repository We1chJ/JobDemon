// A tiny `html` template tag: interpolated values are escaped, nested html`` results and arrays are not.
export class Html { constructor(readonly s: string) {} toString() { return this.s; } }
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const part = (v: unknown): string => (v instanceof Html ? v.s : Array.isArray(v) ? v.map(part).join('') : v == null || v === false ? '' : esc(String(v)));
export const html = (strings: TemplateStringsArray, ...values: unknown[]) => new Html(strings.reduce((out, s, i) => out + s + (i < values.length ? part(values[i]) : ''), ''));
export const raw = (s: string) => new Html(s);
