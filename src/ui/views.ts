// Presentation layer for the local control panel: theme tokens, icons, layout and small components.
import { html, raw } from 'hono/html';

type Html = ReturnType<typeof html>;

// ── Icons (Lucide-style, 24px grid, 2px stroke) ─────────────────────────────
const PATHS: Record<string, string> = {
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  minus: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
  play: '<path d="M6 3l14 9-14 9V3z"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
};
export const icon = (name: keyof typeof PATHS | string, cls = '') =>
  raw(`<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ''}</svg>`);

// ── Status vocabulary (text + icon + colour, never colour alone) ────────────
export const STATUS: Record<string, { label: string; tone: string; icon: string; hint: string }> = {
  human_review: { label: 'Needs you', tone: 'warn', icon: 'alert', hint: 'The bot stopped and needs a decision' },
  ready_to_submit: { label: 'Filled in', tone: 'info', icon: 'file', hint: 'Filled in and left open in the browser. Submit it yourself.' },
  in_progress: { label: 'Running', tone: 'violet', icon: 'loader', hint: 'The bot is working on it now' },
  queued: { label: 'Queued', tone: 'neutral', icon: 'clock', hint: 'Waiting for the next run' },
  applied: { label: 'Applied', tone: 'ok', icon: 'checkCircle', hint: 'Submitted and confirmed' },
  duplicate: { label: 'Skipped', tone: 'neutral', icon: 'minus', hint: 'Duplicate or dismissed' },
};
export const badge = (status: string) => {
  const s = STATUS[status] ?? { label: status, tone: 'neutral', icon: 'minus', hint: '' };
  return html`<span class="badge t-${s.tone}" title="${s.hint}">${icon(s.icon, status === 'in_progress' ? 'spin' : '')}${s.label}</span>`;
};

export const OPS: Record<string, { label: string; tone: string }> = {
  'TYPE_TEXT:filled': { label: 'Filled', tone: 'ok' }, 'SELECT:filled': { label: 'Chose', tone: 'ok' }, 'CLICK:filled': { label: 'Filled', tone: 'ok' },
  'TYPE_TEXT:skipped': { label: 'Skipped', tone: 'neutral' }, 'SELECT:skipped': { label: 'Skipped', tone: 'neutral' }, 'CLICK:skipped': { label: 'Skipped', tone: 'neutral' },
  'TYPE_TEXT:escalate': { label: 'Missing', tone: 'warn' }, 'SELECT:escalate': { label: 'Missing', tone: 'warn' }, 'CLICK:escalate': { label: 'Missing', tone: 'warn' },
  CLICK: { label: 'Clicked', tone: 'neutral' }, SCROLL: { label: 'Scrolled', tone: 'neutral' }, WAIT: { label: 'Waited', tone: 'neutral' },
  SUBMIT: { label: 'Submitted', tone: 'info' }, VERIFY: { label: 'Verified', tone: 'info' }, APPLIED: { label: 'Applied', tone: 'ok' },
  FILLED: { label: 'Stopped', tone: 'info' }, ESCALATE: { label: 'Needs you', tone: 'warn' }, DUPLICATE: { label: 'Duplicate', tone: 'neutral' },
};

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
  return html`<div class="callout ${bad ? 't-danger' : 't-ok'}" role="${bad ? 'alert' : 'status'}">${icon(bad ? 'alert' : 'checkCircle')}<div>${msg}</div></div>`;
};

// ── Layout ──────────────────────────────────────────────────────────────────
const CSS = `
:root{
  --bg:#F8FAFC;--surface:#FFFFFF;--surface-2:#F1F5F9;--fg:#0F172A;--muted:#475569;--subtle:#64748B;--border:#E2E8F0;--border-strong:#CBD5E1;
  --brand:#1E3A5F;--action:#2563EB;--action-hover:#1D4ED8;--on-action:#FFFFFF;
  --ok:#047857;--warn:#B45309;--info:#1D4ED8;--violet:#6D28D9;--danger:#B91C1C;--neutral:#475569;
  --ring:0 0 0 3px color-mix(in srgb,var(--action) 35%,transparent);
  --shadow:0 1px 2px rgb(15 23 42/.06),0 1px 3px rgb(15 23 42/.08);
  --radius:12px;--radius-sm:8px;
  --font:"Fira Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  --mono:"Fira Code",ui-monospace,SFMono-Regular,Menlo,monospace;
  color-scheme:light dark;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0B1120;--surface:#111827;--surface-2:#1A2333;--fg:#E5E7EB;--muted:#A5B0C2;--subtle:#8B97AB;--border:#243042;--border-strong:#334155;
  --brand:#93C5FD;--action:#2563EB;--action-hover:#3B82F6;
  --ok:#34D399;--warn:#FBBF24;--info:#93C5FD;--violet:#C4B5FD;--danger:#FCA5A5;--neutral:#A5B0C2;
  --shadow:0 1px 2px rgb(0 0 0/.4);
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 var(--font);min-height:100dvh}
a{color:var(--action);text-underline-offset:2px}
@media (prefers-color-scheme:dark){a{color:#93C5FD}}
h1,h2,h3{line-height:1.25;margin:0;letter-spacing:-.01em}
h1{font-size:24px;font-weight:700}h2{font-size:18px;font-weight:600}h3{font-size:15px;font-weight:600}
code,pre,.mono{font-family:var(--mono);font-size:13px}
.ic{width:18px;height:18px;flex:none}
.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.skip{position:absolute;left:-999px;top:8px;background:var(--surface);padding:8px 12px;border-radius:var(--radius-sm);z-index:100}.skip:focus{left:16px}
:focus-visible{outline:none;box-shadow:var(--ring);border-radius:6px}

/* header */
.top{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--surface) 88%,transparent);backdrop-filter:saturate(1.4) blur(8px);border-bottom:1px solid var(--border)}
.top-in{max-width:1120px;margin:0 auto;padding:0 16px;height:60px;display:flex;align-items:center;gap:8px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;color:var(--fg);text-decoration:none;margin-right:auto;font-size:17px}
.logo{width:32px;height:32px;border-radius:9px;background:var(--brand);color:#fff;display:grid;place-items:center}
@media (prefers-color-scheme:dark){.logo{background:#1E3A5F;color:#BFDBFE}}
.logo .ic{width:18px;height:18px}
.nav a{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 12px;border-radius:var(--radius-sm);color:var(--muted);text-decoration:none;font-weight:500;font-size:15px;transition:background .15s,color .15s}
.nav a:hover{background:var(--surface-2);color:var(--fg)}
.nav a[aria-current=page]{background:var(--surface-2);color:var(--fg)}
.mode{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;padding:4px 10px;border-radius:999px;margin-left:8px}
@media (max-width:640px){.nav a span,.mode span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.nav a{padding:0 10px;min-width:44px;justify-content:center}}

main{max-width:1120px;margin:0 auto;padding:24px 16px 64px;display:grid;gap:20px}
.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}
.lede{color:var(--muted);margin:4px 0 0;font-size:15px}

/* surfaces */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow)}
.card-pad{padding:20px}
.card-head{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.card-head .ic{color:var(--subtle)}

/* tones */
.t-ok{--tone:var(--ok)}.t-warn{--tone:var(--warn)}.t-info{--tone:var(--info)}.t-violet{--tone:var(--violet)}.t-danger{--tone:var(--danger)}.t-neutral{--tone:var(--neutral)}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;line-height:1;padding:6px 10px 6px 8px;border-radius:999px;white-space:nowrap;color:var(--tone);background:color-mix(in srgb,var(--tone) 12%,transparent);border:1px solid color-mix(in srgb,var(--tone) 25%,transparent)}
.badge .ic{width:15px;height:15px}
.callout{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:var(--radius);color:var(--fg);background:color-mix(in srgb,var(--tone) 10%,var(--surface));border:1px solid color-mix(in srgb,var(--tone) 30%,transparent)}
.callout>.ic{color:var(--tone);margin-top:2px}
.callout b{font-weight:600}
.callout ul{margin:6px 0 0;padding-left:18px}

/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 16px;border-radius:var(--radius-sm);border:1px solid var(--border-strong);background:var(--surface);color:var(--fg);font:600 15px var(--font);cursor:pointer;text-decoration:none;transition:background .15s,border-color .15s,transform .1s}
.btn:hover{background:var(--surface-2)}
.btn:active{transform:scale(.98)}
.btn-primary{background:var(--action);border-color:var(--action);color:var(--on-action)}
.btn-primary:hover{background:var(--action-hover);border-color:var(--action-hover)}
.btn-ok{background:var(--ok);border-color:var(--ok);color:#fff}
@media (prefers-color-scheme:dark){.btn-ok{background:#047857;border-color:#047857}}
.btn-ok:hover{filter:brightness(1.08)}
.btn-ghost{border-color:transparent;background:transparent;color:var(--muted)}
.btn-ghost:hover{background:var(--surface-2);color:var(--fg)}
.btn-sm{min-height:36px;padding:0 12px;font-size:14px}
.btn[disabled]{opacity:.5;cursor:not-allowed}
.btn[aria-busy=true]{opacity:.7;cursor:progress}.btn[aria-busy=true]::after{content:"";width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite}
.btn .ic{width:17px;height:17px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
form.inline{display:inline}

/* forms */
label.lbl{display:block;font-weight:600;font-size:15px;margin-bottom:6px}
.help{color:var(--muted);font-size:14px;margin:6px 0 0}
textarea,input[type=file],input[type=text],input[type=email],input[type=tel],input[type=url],input[type=number]{width:100%;font:15px/1.5 var(--font);color:var(--fg);background:var(--surface);border:1px solid var(--border-strong);border-radius:var(--radius-sm);padding:12px 14px;transition:border-color .15s,box-shadow .15s}
textarea:focus,input:focus{outline:none;border-color:var(--action);box-shadow:var(--ring)}
textarea{min-height:120px;resize:vertical}
textarea.code{font:13px/1.55 var(--mono);min-height:360px;tab-size:2;background:var(--surface-2)}
input[type=file]{padding:10px}
input[type=file]::file-selector-button{font:600 14px var(--font);border:1px solid var(--border-strong);background:var(--surface-2);color:var(--fg);border-radius:6px;padding:8px 12px;margin-right:12px;cursor:pointer}

/* stats */
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
@media (max-width:760px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
.stat{display:flex;flex-direction:column;gap:6px;padding:16px;text-decoration:none;color:var(--fg);transition:border-color .15s,transform .15s}
.stat:hover{border-color:var(--border-strong)}
.stat[aria-current=true]{border-color:var(--tone);box-shadow:0 0 0 1px var(--tone)}
.stat-top{display:flex;align-items:center;justify-content:space-between;color:var(--tone);font-size:14px;font-weight:600}
.stat-num{font:700 30px/1 var(--font);font-variant-numeric:tabular-nums;letter-spacing:-.02em}

/* run bar */
.runbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px 16px}
.runbar .grow{flex:1;min-width:200px;color:var(--muted);font-size:15px}
.pulse{display:inline-flex;align-items:center;gap:8px;font-weight:600;color:var(--violet)}

/* application list */
.list-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid var(--border);flex-wrap:wrap}
.filters{display:flex;gap:4px;flex-wrap:wrap}
.filters a{min-height:36px;display:inline-flex;align-items:center;padding:0 12px;border-radius:999px;color:var(--muted);text-decoration:none;font-size:14px;font-weight:500}
.filters a:hover{background:var(--surface-2);color:var(--fg)}
.filters a[aria-current=true]{background:var(--fg);color:var(--bg)}
.apps{list-style:none;margin:0;padding:0}
.app{display:grid;grid-template-columns:150px minmax(0,1fr) auto;gap:16px;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);transition:background .15s}
.app:last-child{border-bottom:0}
.app:hover{background:color-mix(in srgb,var(--surface-2) 50%,transparent)}
.app-title{font-weight:600;color:var(--fg);text-decoration:none}
.app-title:hover{text-decoration:underline}
.app-meta{display:flex;gap:6px 14px;flex-wrap:wrap;color:var(--subtle);font-size:13px;margin-top:2px;align-items:center}
.app-meta a{color:var(--subtle);display:inline-flex;align-items:center;gap:4px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.app-meta .ic{width:13px;height:13px}
.app-reason{font-size:14px;color:var(--muted);margin-top:6px}
.app-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
@media (max-width:760px){.app{grid-template-columns:1fr;gap:10px}.app-actions{justify-content:flex-start}}
.empty{text-align:center;padding:56px 20px;color:var(--muted)}
.empty .ic{width:40px;height:40px;color:var(--subtle);margin-bottom:8px}
.empty h3{color:var(--fg);margin-bottom:4px}

/* detail */
.back{display:inline-flex;align-items:center;gap:6px;color:var(--muted);text-decoration:none;font-size:15px;min-height:40px}
.back:hover{color:var(--fg)}
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin:0}
.kv dt{font-size:13px;color:var(--subtle);font-weight:500}.kv dd{margin:2px 0 0;font-weight:600;overflow-wrap:anywhere}
.letter{white-space:pre-wrap;font:15px/1.7 var(--font);margin:0;max-width:72ch}
.timeline{list-style:none;margin:0;padding:0}
.step{display:grid;grid-template-columns:40px 110px minmax(0,1fr);gap:12px;padding:12px 20px;border-top:1px solid var(--border);align-items:start}
.step-n{font:500 13px var(--mono);color:var(--subtle);padding-top:5px;font-variant-numeric:tabular-nums}
.step-target{font-weight:500;overflow-wrap:anywhere}
.step-detail{color:var(--muted);font-size:14px;overflow-wrap:anywhere}
.step details{margin-top:6px}
.step summary{cursor:pointer;color:var(--action);font-size:14px;display:inline-flex;align-items:center;gap:6px;min-height:32px}
@media (prefers-color-scheme:dark){.step summary{color:#93C5FD}}
.step img{display:block;margin-top:8px;max-width:100%;border:1px solid var(--border);border-radius:var(--radius-sm)}
@media (max-width:640px){.step{grid-template-columns:32px 1fr}.step>:last-child{grid-column:1/-1}}

/* setup */
.checklist{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
@media (max-width:760px){.checklist{grid-template-columns:1fr}}
.check{display:flex;gap:10px;align-items:center;padding:14px 16px;font-weight:500}
.check .dot{width:28px;height:28px;border-radius:999px;display:grid;place-items:center;flex:none;color:var(--tone);background:color-mix(in srgb,var(--tone) 14%,transparent)}
.check .dot .ic{width:16px;height:16px}
.step-num{width:28px;height:28px;border-radius:8px;background:var(--surface-2);display:grid;place-items:center;font:600 14px var(--mono);color:var(--muted);flex:none}
.split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}
@media (max-width:900px){.split{grid-template-columns:1fr}}
.sticky-save{position:sticky;bottom:0;z-index:5;margin:20px -16px 0;padding:12px 16px;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(8px);border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:12px;align-items:center}
@media (max-width:640px){.sticky-save .help{display:none}.sticky-save .btn{width:100%}}

/* cover letter peek in the list */
.peek{margin-top:8px}
.peek summary{cursor:pointer;display:inline-flex;align-items:center;gap:6px;color:var(--action);font-size:14px;font-weight:500;min-height:32px;list-style:none}
.peek summary::-webkit-details-marker{display:none}
@media (prefers-color-scheme:dark){.peek summary{color:#93C5FD}}
.peek summary .ic{width:15px;height:15px}
.peek-body{margin-top:6px;padding:14px 16px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface-2)}
.peek-body .letter{font-size:14px;max-height:420px;overflow:auto;margin-bottom:10px}

/* screening questions */
.sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.q{border:0;margin:0;padding:18px 0;border-top:1px solid var(--border);min-width:0}
.q:first-of-type{border-top:0}
.q legend{float:left;width:100%;padding:0;font-weight:600;font-size:16px}
.q-help{clear:both;margin:2px 0 0}
.choices{clear:both;display:flex;flex-wrap:wrap;gap:8px;padding-top:10px}
.choice{position:relative;display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 18px;border:1px solid var(--border-strong);border-radius:999px;background:var(--surface);cursor:pointer;font-weight:500;user-select:none;transition:background .15s,border-color .15s,box-shadow .15s}
.choice:hover{background:var(--surface-2)}
.choice input[type=radio]{position:absolute;opacity:0;width:1px;height:1px;margin:0}
.choice .tick{display:none;width:16px;height:16px;color:var(--action)}
@media (prefers-color-scheme:dark){.choice .tick{color:#93C5FD}}
.choice:has(input[type=radio]:checked){border-color:var(--action);background:color-mix(in srgb,var(--action) 12%,var(--surface));box-shadow:0 0 0 1px var(--action);padding-left:14px}
.choice:has(input[type=radio]:checked) .tick{display:block}
.choice:has(input[type=radio]:focus-visible){box-shadow:var(--ring)}
.choice-other input[type=text]{border:0;border-left:1px solid var(--border-strong);background:transparent;color:var(--fg);font:15px var(--font);padding:0 0 0 10px;height:28px;width:200px;max-width:52vw;outline:none}
.choice-other input[type=text]::placeholder{color:var(--subtle)}
.adv{margin-top:20px;border-top:1px solid var(--border);padding-top:14px}
.adv summary{cursor:pointer;color:var(--muted);font-weight:500;min-height:36px;display:flex;align-items:center}
.adv summary:hover{color:var(--fg)}
section[id]{scroll-margin-top:76px}
a.check{color:var(--fg);text-decoration:none}a.check:hover{border-color:var(--border-strong)}

/* profile form */
.fgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px 16px}
.fld{display:flex;flex-direction:column;gap:6px;font-weight:600;font-size:14px;min-width:0}
.fld.wide{grid-column:1/-1}
.fld small{font-weight:400;color:var(--muted)}
.fld input,.fld textarea{font-weight:400;min-height:44px;padding:10px 12px}
.fld textarea{min-height:auto}
.req{color:var(--danger)}
h3.sub{margin:28px 0 12px;font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
h3.sub small{display:block;text-transform:none;letter-spacing:0;font-weight:400;font-size:14px;margin-top:2px}
.reps{counter-reset:item}
.rep{counter-increment:item;border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px 16px;margin-bottom:12px;background:var(--surface-2)}
.rep-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.rep-title{font-weight:600}.rep-title::after{content:" " counter(item)}
.cq-row{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr) 44px;gap:10px;align-items:end;margin-bottom:10px}
.cq-row .rep-remove{padding:0;width:44px}
@media (max-width:640px){.cq-row{grid-template-columns:1fr 44px}.cq-row .fld:first-of-type{grid-column:1/-1}}
.choice-other input[type=text]:focus{box-shadow:none}
.choice-other input[type=text]{min-height:0;border-radius:0}

@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

const JS = `
// Busy state on submit, confirmation for irreversible actions.
document.addEventListener('submit', (e) => {
  const f = e.target, msg = f.dataset.confirm;
  if (msg && !confirm(msg)) { e.preventDefault(); return; }
  const b = e.submitter; if (b) { setTimeout(() => { b.disabled = true; b.setAttribute('aria-busy', 'true'); }, 0); }
});
// Screening: typing an "Other" answer selects it; show how many are answered.
const sf = document.getElementById('screening');
if (sf) {
  const groups = [...new Set([...sf.querySelectorAll('input[type=radio]')].map((r) => r.name))];
  const prog = document.querySelector('.progress');
  const update = () => { if (prog) prog.textContent = groups.filter((g) => sf.querySelector('input[name="' + g + '"]:checked')).length + ' of ' + groups.length + ' answered'; };
  sf.addEventListener('input', (e) => {
    if (e.target.matches('.choice-other input[type=text]')) {
      const r = e.target.closest('label').querySelector('input[type=radio]');
      r.checked = true; e.target.required = true;
    }
    update();
  });
  sf.addEventListener('change', (e) => {
    if (e.target.type === 'radio') sf.querySelectorAll('.choice-other input[type=text]').forEach((t) => {
      t.required = t.closest('label').querySelector('input[type=radio]').checked;
    });
    update();
  });
  update();
}
// Copy buttons.
document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-copy]');
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; } catch { b.textContent = 'Copy failed'; }
  setTimeout(() => { b.textContent = 'Copy text'; }, 1500);
});
// Typing an "Other" answer anywhere selects its choice.
document.addEventListener('input', (e) => {
  if (e.target.matches && e.target.matches('.choice-other input[type=text]')) {
    const r = e.target.closest('label').querySelector('input[type=radio]');
    if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
  }
});
// Repeatable rows: add from a <template>, remove a row.
document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) {
    const box = document.getElementById(add.dataset.add + '-rows');
    box.append(document.getElementById('tpl-' + add.dataset.add).content.cloneNode(true));
    const first = box.lastElementChild.querySelector('input:not([type=hidden]),textarea');
    if (first) first.focus();
  }
  const rm = e.target.closest('.rep-remove');
  if (rm) rm.closest('.rep, .cq-row').remove();
});
// Live status: while a run is going, refresh only the status area so typed links are never lost.
(async function poll() {
  const el = document.getElementById('live');
  if (!el || el.dataset.running !== '1') return;
  await new Promise((r) => setTimeout(r, 2000));
  try {
    const s = await (await fetch('/api/status')).json();
    if (s.version !== el.dataset.version) {
      const doc = new DOMParser().parseFromString(await (await fetch(location.href)).text(), 'text/html');
      const next = doc.getElementById('live');
      if (next) el.replaceWith(next);
    }
  } catch {}
  poll();
})();
`;

export function layout(opts: { title: string; active: 'apps' | 'setup' | '' }, body: Html | Html[] | string) {
  const mode = html`<span class="mode badge t-ok" title="The bot fills forms but never submits them">${icon('shield')}<span>Fill only</span></span>`;
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${opts.title} · JobDemon</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#1E3A5F"/><g fill="none" stroke="#fff" stroke-width="2" transform="translate(4 4) scale(.67)"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></g></svg>')}">
<style>${raw(CSS)}</style></head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="top-in">
<a class="brand" href="/"><span class="logo">${icon('briefcase')}</span>JobDemon</a>
<nav class="nav" aria-label="Main">
<a href="/" aria-label="Applications" ${opts.active === 'apps' ? raw('aria-current="page"') : ''}>${icon('list')}<span>Applications</span></a>
<a href="/setup" aria-label="Setup" ${opts.active === 'setup' ? raw('aria-current="page"') : ''}>${icon('sliders')}<span>Setup</span></a>
</nav>${mode}
</div></header>
<main id="main">${body}</main>
<script>${raw(JS)}</script>
</body></html>`;
}
