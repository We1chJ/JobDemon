// The extension's own pages (Setup, Dashboard, Cover letter): header, status vocabulary, and page behaviour.
import LOGO from '../../../assets/logo.svg';
import { html, raw, type Html } from '../shared/html.js';
import type { HistoryStatus } from '../shared/store.js';

const ICON = `data:image/svg+xml,${encodeURIComponent(LOGO)}`;

export const STATUS: Record<HistoryStatus, { label: string; tone: string; hint: string }> = {
  needs_you: { label: 'Needs you', tone: 'warn', hint: 'Some fields were left for you' },
  filled: { label: 'Ready to submit', tone: 'info', hint: 'Filled in. Check it and click Submit yourself.' },
  in_progress: { label: 'Started', tone: 'violet', hint: 'JobDemon started on it' },
  applied: { label: 'Applied', tone: 'ok', hint: 'You marked it submitted' },
  removed: { label: 'Removed', tone: 'neutral', hint: 'Removed from the list' },
};
export const badge = (s: HistoryStatus) => html`<span class="st t-${STATUS[s]?.tone ?? 'neutral'}" title="${STATUS[s]?.hint ?? ''}">${STATUS[s]?.label ?? s}</span>`;

export function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export const flash = (msg?: string) => {
  if (!msg) return '';
  const bad = msg.startsWith('Error');
  return html`<div class="callout ${bad ? 't-danger' : 't-ok'}" role="${bad ? 'alert' : 'status'}">${msg}</div>`;
};

/** Draw a page: the header plus its body. */
export function render(active: 'dashboard' | 'letter' | 'setup', body: Html) {
  const link = (page: string, label: string) => html`<a href="${page}.html" ${active === page ? raw('aria-current="page"') : ''}>${label}</a>`;
  document.body.innerHTML = html`<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="top-in">
<a class="brand" href="dashboard.html"><img src="${ICON}" alt="" width="26" height="30">JobDemon</a>
<nav class="nav" aria-label="Main">${link('dashboard', 'Applications')}${link('letter', 'Cover letter')}${link('setup', 'Setup')}</nav>
<span class="mode" title="JobDemon fills forms. It submits only if you turn on Auto-submit (⋯ menu on the bar), and only a form with nothing left for you">Fills forms, you decide on submit</span>
</div></header>
<main id="main">${body}</main>`.s;
  const icon = document.querySelector<HTMLLinkElement>('link[rel=icon]') ?? document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }));
  icon.href = ICON;
}

/** Copy buttons: data-copy="text" or data-copy-from="textarea id". */
document.addEventListener('click', async (e) => {
  const b = (e.target as Element).closest?.<HTMLElement>('[data-copy], [data-copy-from]');
  if (!b) return;
  const text = b.dataset.copyFrom ? (document.getElementById(b.dataset.copyFrom) as HTMLTextAreaElement).value : b.dataset.copy ?? '';
  try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; } catch { b.textContent = 'Copy failed'; }
  setTimeout(() => { b.textContent = 'Copy text'; }, 1500);
});

/** Save a text as a PDF file in Downloads. */
export function download(name: string, bytes: Uint8Array, type = 'application/pdf') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
