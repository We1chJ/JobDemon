// Presentation layer for the local control panel: a plain, document-like tool. System font, one column,
// hairline rules, text status labels. No cards, shadows, or decorative icons.
import fs from 'node:fs';
import path from 'node:path';
import { html, raw } from 'hono/html';

/** The JobDemon logo (assets/logo.svg), used as the browser-tab icon. */
const LOGO = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'assets', 'logo.svg'), 'utf8');

type Html = ReturnType<typeof html>;

// ── Status vocabulary (text + colour; the text carries the meaning) ─────────
export const STATUS: Record<string, { label: string; tone: string; hint: string }> = {
  waiting_for_you: { label: 'Sign in needed', tone: 'warn', hint: 'Sign in or create your account in the browser window; the bot then carries on' },
  human_review: { label: 'Needs you', tone: 'warn', hint: 'The bot stopped and needs a decision' },
  ready_to_submit: { label: 'Ready to submit', tone: 'info', hint: 'Filled in and left open in the browser. Check it and click Submit yourself.' },
  in_progress: { label: 'Running', tone: 'violet', hint: 'The bot is working on it now' },
  queued: { label: 'Queued', tone: 'neutral', hint: 'Waiting for the next run' },
  applied: { label: 'Applied', tone: 'ok', hint: 'Submitted and confirmed' },
  duplicate: { label: 'Skipped', tone: 'neutral', hint: 'Duplicate or dismissed' },
};
export const badge = (status: string) => {
  const s = STATUS[status] ?? { label: status, tone: 'neutral', hint: '' };
  return html`<span class="st t-${s.tone}" title="${s.hint}">${s.label}</span>`;
};

export const OPS: Record<string, { label: string; tone: string }> = {
  'TYPE_TEXT:filled': { label: 'Filled', tone: 'ok' }, 'SELECT:filled': { label: 'Chose', tone: 'ok' }, 'CLICK:filled': { label: 'Filled', tone: 'ok' },
  'TYPE_TEXT:skipped': { label: 'Skipped', tone: 'neutral' }, 'SELECT:skipped': { label: 'Skipped', tone: 'neutral' }, 'CLICK:skipped': { label: 'Skipped', tone: 'neutral' },
  'TYPE_TEXT:escalate': { label: 'Missing', tone: 'warn' }, 'SELECT:escalate': { label: 'Missing', tone: 'warn' }, 'CLICK:escalate': { label: 'Missing', tone: 'warn' },
  CLICK: { label: 'Clicked', tone: 'neutral' }, SCROLL: { label: 'Scrolled', tone: 'neutral' }, WAIT: { label: 'Waited', tone: 'neutral' }, WAIT_FOR_YOU: { label: 'Sign in', tone: 'warn' },
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
  return html`<div class="callout ${bad ? 't-danger' : 't-ok'}" role="${bad ? 'alert' : 'status'}">${msg}</div>`;
};

// ── Layout ──────────────────────────────────────────────────────────────────
const CSS = `
:root{
  --bg:#FFFFFF;--fg:#1A1A1A;--muted:#5F5F5F;--rule:#DCDCDC;--rule-strong:#B4B4B4;--inset:#F4F4F2;
  --link:#0B57D0;--ok:#1B7F3B;--warn:#9A5B00;--info:#0B57D0;--violet:#6B3FA0;--danger:#B3261E;--neutral:#5F5F5F;
  --chart-neutral:#A3A3A3;--chart-bar:#3F3F3F;--h0:#EFEFEC;--h1:#C6E9CF;--h2:#8FD19E;--h3:#4CAF6A;--h4:#1B7F3B;
  --font:system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  color-scheme:light dark;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#151515;--fg:#E8E8E8;--muted:#9C9C9C;--rule:#2F2F2F;--rule-strong:#4C4C4C;--inset:#1F1F1F;
  --link:#8AB4F8;--ok:#5DBB73;--warn:#E0A24A;--info:#8AB4F8;--violet:#C3A5F0;--danger:#F28B82;--neutral:#9C9C9C;
  --chart-neutral:#6B6B6B;--chart-bar:#D4D4D4;--h0:#232323;--h1:#12391F;--h2:#1D5C31;--h3:#2E8A4A;--h4:#5DBB73;
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 var(--font);min-height:100dvh}
@media (max-width:640px){body{font-size:16px}}
a{color:var(--link);text-underline-offset:2px}
h1,h2,h3{line-height:1.3;margin:0}
h1{font-size:22px;font-weight:600}h2{font-size:17px;font-weight:600}h3{font-size:15px;font-weight:600}
code,pre,.mono{font-family:var(--mono);font-size:13px}
.muted{color:var(--muted)}
.skip{position:absolute;left:-999px;top:8px;background:var(--bg);padding:8px 12px;border:1px solid var(--rule-strong);z-index:100}.skip:focus{left:16px}
:focus-visible{outline:2px solid var(--link);outline-offset:2px}

/* header */
.top{border-bottom:1px solid var(--rule)}
.top-in{max-width:960px;margin:0 auto;padding:10px 20px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.brand{font-weight:700;color:var(--fg);text-decoration:none;display:inline-flex;align-items:center;gap:8px;align-self:center}
.brand img{display:block;height:30px;width:auto}
.nav{display:flex;gap:16px}
.nav a{color:var(--muted);text-decoration:none;padding:4px 0}
.nav a:hover{color:var(--fg)}
.nav a[aria-current=page]{color:var(--fg);font-weight:600;text-decoration:underline;text-underline-offset:6px}
.mode{margin-left:auto;color:var(--muted);font-size:13px}
@media (max-width:640px){.mode{display:none}}

main{max-width:960px;margin:0 auto;padding:8px 20px 64px}
.page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:20px 0 8px}
.sec{padding:24px 0;border-top:1px solid var(--rule)}
.sec:first-of-type,.page-head+.sec,.callout+.sec{border-top:0}
.sec-head{display:flex;align-items:baseline;gap:12px;margin-bottom:10px;flex-wrap:wrap}
.sec-head .muted{font-size:13px}
.note{color:var(--muted);margin:0 0 12px;max-width:72ch}

/* tones */
.t-ok{--tone:var(--ok)}.t-warn{--tone:var(--warn)}.t-info{--tone:var(--info)}.t-violet{--tone:var(--violet)}.t-danger{--tone:var(--danger)}.t-neutral{--tone:var(--neutral)}
.st{color:var(--tone);font-weight:600;font-size:13px;white-space:nowrap}
.callout{border:1px solid var(--rule);border-left:3px solid var(--tone);padding:10px 14px;margin:12px 0;max-width:80ch}
.callout b{font-weight:600}
.callout ul{margin:6px 0 0;padding-left:18px}

/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;padding:0 12px;border:1px solid var(--rule-strong);border-radius:4px;background:var(--bg);color:var(--fg);font:500 14px/1 var(--font);cursor:pointer;text-decoration:none;white-space:nowrap}
.btn:hover{background:var(--inset)}
.btn-primary{background:var(--fg);border-color:var(--fg);color:var(--bg)}
.btn-primary:hover{opacity:.88;background:var(--fg)}
.btn-ghost{border-color:transparent;color:var(--muted)}
.btn-ghost:hover{color:var(--fg);background:var(--inset)}
.btn-sm{min-height:30px;padding:0 10px;font-size:13px}
.btn-x{min-width:30px;padding:0 8px;font-size:15px;line-height:1}
.btn[disabled]{opacity:.45;cursor:not-allowed}
.btn[aria-busy=true]{opacity:.6;cursor:progress}
@media (max-width:640px){.btn{min-height:44px}.btn-sm{min-height:40px}}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
form.inline{display:inline}

/* forms */
label.lbl{display:block;font-weight:500;margin-bottom:6px}
.help{color:var(--muted);font-size:14px;margin:6px 0 0}
textarea,select,input[type=file],input[type=text],input[type=email],input[type=tel],input[type=url],input[type=number],input[type=date],input[type=month]{width:100%;font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--rule-strong);border-radius:4px;padding:8px 10px}
textarea:focus,input:focus,select:focus{outline:2px solid var(--link);outline-offset:0;border-color:var(--link)}
textarea{min-height:100px;resize:vertical}
input[type=file]{padding:6px}
input[type=file]::file-selector-button{font:500 14px var(--font);border:1px solid var(--rule-strong);background:var(--inset);color:var(--fg);border-radius:4px;padding:6px 10px;margin-right:10px;cursor:pointer}

/* run line */
.runline{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);margin-top:24px}
.runline .grow{flex:1;min-width:200px;color:var(--muted)}
.running{color:var(--violet);font-weight:600}

/* application table */
.filters{display:flex;gap:4px 16px;flex-wrap:wrap;margin:16px 0 8px;font-size:14px}
.filters a{color:var(--muted);text-decoration:none;padding:4px 0}
.filters a:hover{color:var(--fg)}
.filters a[aria-current=true]{color:var(--fg);font-weight:600;text-decoration:underline;text-underline-offset:6px}
.filters a b{font-weight:inherit;color:var(--fg)}
.tbl{width:100%;border-collapse:collapse}
.tbl th{text-align:left;font-weight:500;font-size:13px;color:var(--muted);padding:8px 10px 8px 0;border-bottom:1px solid var(--rule-strong)}
.tbl td{padding:12px 10px 12px 0;border-bottom:1px solid var(--rule);vertical-align:top}
.tbl td:last-child,.tbl th:last-child{padding-right:0}
.c-status{width:120px}.c-portal{width:120px;color:var(--muted);font-size:14px}.c-when{width:90px;color:var(--muted);font-size:14px;white-space:nowrap}
.c-portal a{color:inherit}
.c-actions{text-align:right;width:1%;white-space:nowrap}
.c-actions .row{justify-content:flex-end;flex-wrap:nowrap}
.app-title{color:var(--fg);font-weight:600;text-decoration:none}
.app-title:hover{text-decoration:underline}
.app-meta{color:var(--muted);font-size:13px;margin-top:2px}
.app-reason{font-size:14px;color:var(--muted);margin-top:4px;max-width:70ch}
@media (max-width:760px){
  .tbl thead{display:none}
  .tbl tr{display:grid;grid-template-columns:1fr;gap:4px;padding:12px 0;border-bottom:1px solid var(--rule)}
  .tbl td{display:block;padding:0;border:0;width:auto}
  .c-portal,.c-when{display:inline-block}
  .c-when::before{content:"· "}
  .c-actions{text-align:left;margin-top:6px}.c-actions .row{justify-content:flex-start}
}
.empty{color:var(--muted);padding:24px 0}

/* chart row (shadcn-style cards) */
.charts-slot{min-height:182px;margin-top:20px}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.cc{border:1px solid var(--rule);border-radius:10px;padding:12px 14px 10px;background:var(--bg);display:flex;flex-direction:column;gap:8px;min-width:0;overflow:hidden}
.cc-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.cc-title{font-size:13px;color:var(--muted);flex-basis:100%}
.cc-value{font-size:24px;font-weight:600;line-height:1.1;font-variant-numeric:tabular-nums}
.cc-sub{font-size:12px;color:var(--muted)}
.cc-body{min-height:110px;display:flex;align-items:center}
.cc-body>*{flex:1;min-width:0}
.heat{width:100%;height:auto;max-height:110px}
.heat .h0{fill:var(--h0)}.heat .h1{fill:var(--h1)}.heat .h2{fill:var(--h2)}.heat .h3{fill:var(--h3)}.heat .h4{fill:var(--h4)}
.donut{display:flex;align-items:center;gap:10px}
.donut>div{flex:none}
.legend{list-style:none;margin:0;padding:0;font-size:12px;display:grid;grid-template-columns:minmax(0,1fr);gap:2px;flex:1;min-width:0}
.legend li{display:flex;align-items:center;gap:6px;white-space:nowrap;min-width:0}
.legend i,.tip i{display:inline-block;width:8px;height:8px;border-radius:2px;flex:none}
.legend span{overflow:hidden;text-overflow:ellipsis;min-width:0}
.legend b{margin-left:auto;padding-left:6px;font-weight:500;font-variant-numeric:tabular-nums}
.tip{background:var(--bg);border:1px solid var(--rule-strong);border-radius:6px;padding:6px 8px;font-size:12px;box-shadow:0 4px 12px rgb(0 0 0/.12);min-width:120px}
.tip-l{color:var(--muted);margin-bottom:2px}
.tip-r{display:flex;align-items:center;gap:6px}.tip-r b{margin-left:auto;font-weight:600;font-variant-numeric:tabular-nums}
.recharts-surface:focus,.recharts-wrapper:focus,.recharts-sector:focus{outline:none}

/* add + run bar */
.sec.bar{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;padding:16px 0}
.addbar{display:flex;gap:8px;flex:1;min-width:260px;align-items:flex-start}
.addbar textarea{min-height:36px;height:36px;padding:7px 10px;resize:vertical;flex:1}
.addbar textarea:focus{height:96px}
select.mini{width:auto;min-height:36px;padding:4px 8px;font-size:14px}

/* your turn */
.turn{list-style:none;margin:0;padding:0}
.turn li{display:flex;gap:16px;justify-content:space-between;align-items:flex-start;padding:12px 0;border-top:1px solid var(--rule)}
.turn li:first-child{border-top:0}
.turn-main{min-width:0}
.turn-main .st{margin-right:6px}
.turn-what{color:var(--muted);font-size:14px;margin-top:4px;max-width:70ch}
.turn .row{flex:none;justify-content:flex-end}
@media (max-width:640px){.turn li{flex-direction:column;gap:8px}.turn .row{justify-content:flex-start}}
.app-reason{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.plain{margin:0;padding-left:18px}
.trace-wrap>summary{cursor:pointer;list-style:none;display:flex;align-items:baseline;gap:10px}
.trace-wrap>summary::-webkit-details-marker{display:none}
.trace-wrap>summary::before{content:"▸";color:var(--muted);font-size:13px}
.trace-wrap[open]>summary::before{content:"▾"}
.trace-wrap[open]>summary{margin-bottom:10px}

/* detail */
.back{color:var(--muted);text-decoration:none;display:inline-block;padding:16px 0 0}
.back:hover{color:var(--fg)}
.kv{display:flex;flex-wrap:wrap;gap:6px 28px;margin:0;font-size:14px}
.kv div{display:flex;gap:6px}.kv dt{color:var(--muted)}.kv dd{margin:0;font-weight:500;overflow-wrap:anywhere}
.letter{white-space:pre-wrap;font:inherit;line-height:1.65;margin:0;max-width:70ch}
.trace{width:100%;border-collapse:collapse}
.trace td{padding:8px 12px 8px 0;border-top:1px solid var(--rule);vertical-align:top}
.trace td:last-child{padding-right:0}
.step-n{font-family:var(--mono);font-size:13px;color:var(--muted);width:32px;font-variant-numeric:tabular-nums}
.step-op{width:90px}
.step-target{font-weight:500;overflow-wrap:anywhere}
.step-detail{color:var(--muted);font-size:14px;overflow-wrap:anywhere}
.trace details{margin-top:4px}
.trace summary{cursor:pointer;color:var(--link);font-size:14px;display:inline-block;padding:2px 0}
.trace img{display:block;margin-top:8px;max-width:100%;border:1px solid var(--rule)}

/* setup */
.setup{display:grid;grid-template-columns:190px minmax(0,1fr);gap:36px;align-items:start}
.setup-nav{position:sticky;top:16px;display:flex;flex-direction:column;gap:2px;padding-top:24px}
.setup-nav a{display:block;padding:7px 10px;border-left:2px solid transparent;color:var(--muted);text-decoration:none;font-size:14px}
.setup-nav a:hover{color:var(--fg)}
.setup-nav a[aria-current=true]{color:var(--fg);border-left-color:var(--fg);font-weight:600}
.nav-s{display:block;font-size:12px;font-weight:400;color:var(--muted)}
.nav-s.ok{color:var(--ok)}.nav-s.todo{color:var(--warn)}
@media (max-width:900px){
  .setup{grid-template-columns:1fr;gap:0}
  .setup-nav{position:static;flex-direction:row;overflow-x:auto;gap:4px;padding:8px 0;border-bottom:1px solid var(--rule)}
  .setup-nav a{border-left:0;border-bottom:2px solid transparent;white-space:nowrap;padding:6px 8px}
  .setup-nav a[aria-current=true]{border-bottom-color:var(--fg)}
}
.setup-body .sec:first-child{border-top:0}
.unsaved.dirty{color:var(--warn);font-weight:600}
.split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}
@media (max-width:900px){.split{grid-template-columns:1fr}}
.sticky-save{position:sticky;bottom:0;z-index:5;margin:20px -20px 0;padding:12px 20px;background:var(--bg);border-top:1px solid var(--rule);display:flex;justify-content:flex-end;gap:12px;align-items:center}
@media (max-width:640px){.sticky-save .help{display:none}.sticky-save .btn{width:100%}}

/* cover letter peek in the list */
.peek{margin-top:6px}
.peek summary{cursor:pointer;color:var(--link);font-size:14px;display:inline-block;padding:2px 0}
.peek-body{margin-top:6px;padding:12px 14px;border:1px solid var(--rule);background:var(--inset)}
.peek-body .letter{font-size:14px;max-height:420px;overflow:auto;margin-bottom:10px}

/* screening questions */
.sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.q{border:0;margin:0;padding:16px 0;border-top:1px solid var(--rule);min-width:0}
.q:first-of-type{border-top:0}
.q legend{float:left;width:100%;padding:0;font-weight:500}
.q-help{clear:both;margin:2px 0 0}
.choices{clear:both;display:flex;flex-wrap:wrap;gap:8px;padding-top:10px}
.choice{position:relative;display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:0 12px;border:1px solid var(--rule-strong);border-radius:4px;background:var(--bg);cursor:pointer;user-select:none;font-size:14px}
@media (max-width:640px){.choice{min-height:44px}}
.choice:hover{background:var(--inset)}
.choice input[type=radio]{position:absolute;opacity:0;width:1px;height:1px;margin:0}
.choice:has(input[type=radio]:checked){background:var(--fg);color:var(--bg);border-color:var(--fg);font-weight:600}
.choice:has(input[type=radio]:focus-visible){outline:2px solid var(--link);outline-offset:2px}
.choice-other input[type=text]{border:0;border-left:1px solid var(--rule-strong);border-radius:0;background:transparent;color:inherit;font:inherit;padding:0 0 0 10px;height:24px;width:200px;max-width:52vw;outline:none;font-weight:400}
.choice-other input[type=text]:focus{outline:none;border-color:currentColor}
.choice:has(input[type=radio]:checked) input[type=text]{border-left-color:currentColor}
.choice-other input[type=text]::placeholder{color:inherit;opacity:.6}
section[id]{scroll-margin-top:16px}

/* profile form */
.fgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px 16px}
.fld{display:flex;flex-direction:column;gap:4px;font-size:14px;font-weight:500;min-width:0}
.fld.wide{grid-column:1/-1}
.fld small{font-weight:400;color:var(--muted)}
.fld input,.fld textarea,.fld select{font-weight:400;min-height:36px}
.fld textarea{min-height:auto}
.req{color:var(--danger)}
h3.sub{margin:24px 0 10px;font-size:15px;font-weight:600}
h3.sub small{display:block;font-weight:400;font-size:14px;color:var(--muted)}
.tag{font-size:12px;font-weight:500;color:var(--muted);border:1px solid var(--rule-strong);border-radius:3px;padding:1px 6px;margin-left:6px;vertical-align:middle}
.reps{counter-reset:item}
.rep{counter-increment:item;border:1px solid var(--rule);border-radius:4px;padding:12px 14px 14px;margin-bottom:10px}
.rep-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.rep-title{font-weight:600}.rep-title::after{content:" " counter(item)}
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
// Settings that save as soon as they change.
document.addEventListener('change', (e) => { if (e.target.matches && e.target.matches('[data-autosubmit]')) e.target.form.requestSubmit(); });
// Copy buttons.
document.addEventListener('click', async (e) => {
  const b = e.target.closest && (e.target.closest('[data-copy]') || e.target.closest('[data-copy-from]'));
  if (!b) return;
  const text = b.dataset.copyFrom ? document.getElementById(b.dataset.copyFrom).value : b.dataset.copy;
  try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; } catch { b.textContent = 'Copy failed'; }
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
  if (rm) rm.closest('.rep').remove();
});
// Live status: while a run is going, refresh only the live sections so typed links are never lost.
(async function poll() {
  const live = () => [...document.querySelectorAll('[data-live]')];
  if (!live().some((el) => el.dataset.running === '1')) return;
  await new Promise((r) => setTimeout(r, 2000));
  try {
    const s = await (await fetch('/api/status')).json();
    if (live().some((el) => s.version !== el.dataset.version)) {
      const doc = new DOMParser().parseFromString(await (await fetch(location.href)).text(), 'text/html');
      for (const el of live()) { const next = doc.getElementById(el.id); if (next) el.replaceWith(next); }
    }
  } catch {}
  poll();
})();
// Setup: highlight the section in view, and say when there are unsaved changes.
const nav = document.querySelector('.setup-nav');
if (nav) {
  const links = [...nav.querySelectorAll('a')];
  const secs = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  const mark = () => {
    const y = window.scrollY + 120;
    let cur = secs[0];
    for (const s of secs) if (s.offsetTop <= y) cur = s;
    links.forEach((a) => a.getAttribute('href') === '#' + cur.id ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current'));
  };
  addEventListener('scroll', mark, { passive: true }); mark();
  const form = document.getElementById('setup-form'), note = document.querySelector('.unsaved');
  let dirty = false;
  form.addEventListener('input', () => { if (!dirty) { dirty = true; note.textContent = 'Unsaved changes'; note.classList.add('dirty'); } });
  form.addEventListener('submit', () => { dirty = false; });
  addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
}
`;

export function layout(opts: { title: string; active: 'apps' | 'setup' | 'letter' | '' }, body: Html | Html[] | string) {
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${opts.title} · JobDemon</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(LOGO)}">
<style>${raw(CSS)}</style></head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="top-in">
<a class="brand" href="/"><img src="data:image/svg+xml,${encodeURIComponent(LOGO)}" alt="" width="26" height="30">JobDemon</a>
<nav class="nav" aria-label="Main">
<a href="/" ${opts.active === 'apps' ? raw('aria-current="page"') : ''}>Applications</a>
<a href="/letter" ${opts.active === 'letter' ? raw('aria-current="page"') : ''}>Cover letter</a>
<a href="/setup" ${opts.active === 'setup' ? raw('aria-current="page"') : ''}>Setup</a>
</nav>
<span class="mode" title="The bot fills forms but never submits them">Fills forms, never submits</span>
</div></header>
<main id="main">${body}</main>
<script>${raw(JS)}</script>
</body></html>`;
}
