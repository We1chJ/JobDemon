// Applications: every job JobDemon has worked on in this browser, what each needs from you, and activity charts.
// The charts are shadcn-style cards drawn with Recharts (what shadcn's charts use).
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { html, raw } from '../shared/html.js';
import { store, type Action, type HistoryItem, type HistoryStatus } from '../shared/store.js';
import { STATUS, ago, badge, render } from './ui.js';

// ── Numbers for the charts ──────────────────────────────────────────────────
interface Stats {
  totals: { all: number; submitted: number; thisWeek: number; needYou: number };
  heatmap: { date: string; count: number }[]; // submitted per day, last 20 weeks, oldest first, starting on a Sunday
  daily: { date: string; added: number; submitted: number }[]; // last 30 days
  status: { name: string; value: number; tone: string }[];
  portals: { name: string; value: number }[];
  saved: { total: number; thisWeek: number; apps: number; weeks: { week: string; hours: number }[] }; // seconds; hours per week, last 8 weeks
}
// An estimate of what each thing takes by hand, in seconds. Applications from before actions were counted: a flat 15 minutes.
const SECONDS: Record<Action, number> = { typed: 15, picked: 10, ticked: 5, uploaded: 30, pages: 15, written: 300, letters: 1200 };
const FLAT = 900;
function savedBy(a: HistoryItem) {
  if (!a.actions) return a.status === 'in_progress' ? 0 : FLAT;
  const done = { ...a.actions, letters: Math.max(a.actions.letters ?? 0, a.letter ? 1 : 0) };
  return (Object.keys(SECONDS) as Action[]).reduce((n, k) => n + (done[k] ?? 0) * SECONDS[k], 0);
}
const big = (s: number): [string, string] => (s < 3600 ? [String(Math.round(s / 60)), 'minutes'] : [(s / 3600).toFixed(1), 'hours']);
const span = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const localDay = (iso: string) => ymd(new Date(iso));
const portalOf = (a: HistoryItem) => { if (a.portal) return a.portal; try { return new URL(a.url).hostname.replace(/^(www|jobs|careers|job-boards)\./, '').split('.')[0]; } catch { return 'Other'; } };

function computeStats(apps: HistoryItem[]): Stats {
  const submittedOn = new Map<string, number>(), addedOn = new Map<string, number>();
  for (const a of apps) {
    addedOn.set(localDay(a.createdAt), (addedOn.get(localDay(a.createdAt)) ?? 0) + 1);
    if (a.status === 'applied') { const d = localDay(a.submittedAt ?? a.updatedAt); submittedOn.set(d, (submittedOn.get(d) ?? 0) + 1); }
  }
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const back = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
  // GitHub-style grid: 20 full weeks ending this week, each column Sunday..Saturday.
  const heatmap: Stats['heatmap'] = [];
  for (let d = back(7 * 19 + today.getDay()); d <= today; d.setDate(d.getDate() + 1)) heatmap.push({ date: ymd(d), count: submittedOn.get(ymd(d)) ?? 0 });
  const daily: Stats['daily'] = [];
  for (let i = 29; i >= 0; i--) { const k = ymd(back(i)); daily.push({ date: k, added: addedOn.get(k) ?? 0, submitted: submittedOn.get(k) ?? 0 }); }
  const count = (s: HistoryStatus) => apps.filter((a) => a.status === s).length;
  const order: HistoryStatus[] = ['applied', 'filled', 'needs_you', 'in_progress'];
  const status = order.map((s) => ({ name: STATUS[s].label, value: count(s), tone: STATUS[s].tone })).filter((x) => x.value);
  const byPortal = new Map<string, number>();
  for (const a of apps) byPortal.set(portalOf(a), (byPortal.get(portalOf(a)) ?? 0) + 1);
  const portals = [...byPortal].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const top = portals.slice(0, 5);
  if (portals.length > 5) top.push({ name: 'Other', value: portals.slice(5).reduce((n, p) => n + p.value, 0) });
  const weekStart = ymd(back(today.getDay()));
  const savedIn = new Map<string, number>();
  for (const a of apps) { const d = new Date(a.createdAt); d.setDate(d.getDate() - d.getDay()); savedIn.set(ymd(d), (savedIn.get(ymd(d)) ?? 0) + savedBy(a)); }
  const weeks = Array.from({ length: 8 }, (_, i) => { const week = ymd(back(today.getDay() + 7 * (7 - i))); return { week, hours: +((savedIn.get(week) ?? 0) / 3600).toFixed(1) }; });
  return {
    totals: { all: apps.length, submitted: count('applied'), thisWeek: [...submittedOn].filter(([k]) => k >= weekStart).reduce((n, [, v]) => n + v, 0), needYou: count('needs_you') + count('filled') },
    heatmap, daily, status, portals: top,
    saved: { total: [...savedIn.values()].reduce((n, v) => n + v, 0), thisWeek: savedIn.get(weekStart) ?? 0, apps: apps.filter((a) => savedBy(a) > 0).length, weeks },
  };
}

// ── Charts ──────────────────────────────────────────────────────────────────
const TONE: Record<string, string> = { ok: 'var(--ok)', info: 'var(--info)', warn: 'var(--warn)', violet: 'var(--violet)', neutral: 'var(--chart-neutral)', danger: 'var(--danger)' };
const short = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function Card({ title, value, sub, children }: { title: string; value?: string | number; sub?: string; children: ReactNode }) {
  return (
    <div className="cc">
      <div className="cc-head"><span className="cc-title">{title}</span>{value !== undefined && <span className="cc-value">{value}</span>}{sub && <span className="cc-sub">{sub}</span>}</div>
      <div className="cc-body">{children}</div>
    </div>
  );
}

/** shadcn-style tooltip: a small bordered box with one row per series. */
function Tip({ active, payload, label, fmt }: { active?: boolean; payload?: { name: string; value: number; color?: string; payload?: { fill?: string } }[]; label?: string; fmt?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tip">
      {label !== undefined && <div className="tip-l">{fmt ? fmt(label) : label}</div>}
      {payload.map((p) => (
        <div className="tip-r" key={p.name}><i style={{ background: p.color || p.payload?.fill }} />{p.name}<b>{p.value}</b></div>
      ))}
    </div>
  );
}

/** GitHub-style grid: one square per day, columns are weeks. */
function Heatmap({ days }: { days: Stats['heatmap'] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const cell = 11, gap = 3, weeks = Math.ceil(days.length / 7);
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  return (
    <svg className="heat" viewBox={`0 0 ${weeks * (cell + gap)} ${7 * (cell + gap)}`} role="img" aria-label="Applications submitted per day, last 20 weeks">
      {days.map((d, i) => (
        <rect key={d.date} x={Math.floor(i / 7) * (cell + gap)} y={(i % 7) * (cell + gap)} width={cell} height={cell} rx={2} className={`h${level(d.count)}`}>
          <title>{`${d.count} submitted · ${short(d.date)}`}</title>
        </rect>
      ))}
    </svg>
  );
}

/** The headline: how much time JobDemon has given you back, and the last 8 weeks of it. */
function Saved({ s }: { s: Stats['saved'] }) {
  const [value, unit] = big(s.total);
  return (
    <section className="hero" aria-labelledby="saved-h">
      <div className="hero-main">
        <h2 id="saved-h" className="hero-label">Time saved</h2>
        {s.total ? <p className="hero-value">{value} <span>{unit}</span></p> : <p className="hero-empty">Nothing yet. Fill your first application to start the count.</p>}
        {s.total > 0 && <ul className="hero-facts"><li><b>{span(s.thisWeek)}</b> this week</li><li><b>{s.apps}</b> application{s.apps === 1 ? '' : 's'}</li><li><b>{span(s.total / s.apps)}</b> each</li></ul>}
        <p className="hero-note">An estimate, from what JobDemon filled in for you.</p>
      </div>
      {s.total > 0 && <div className="hero-chart" role="img" aria-label={`Hours saved per week, last 8 weeks. This week: ${span(s.thisWeek)}.`}>
        <ResponsiveContainer width="100%" height={132}>
          <BarChart data={s.weeks} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="week" tickFormatter={short} tickLine={false} axisLine={false} minTickGap={24} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <Tooltip content={<Tip fmt={(w) => `Week of ${short(w)}`} />} cursor={{ fill: 'var(--rule)', fillOpacity: 0.4 }} />
            <Bar isAnimationActive={false} dataKey="hours" name="Hours" fill="var(--ok)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>}
    </section>
  );
}

function Charts({ s }: { s: Stats }) {
  const last7 = s.daily.slice(-7).reduce((n, d) => n + d.added, 0);
  return (
    <>
    <Saved s={s.saved} />
    <div className="charts">
      <Card title="Submitted" value={s.totals.submitted} sub={`${s.totals.thisWeek} this week`}>
        <Heatmap days={s.heatmap} />
      </Card>
      <Card title="Last 30 days" value={last7} sub="started this week">
        <ResponsiveContainer width="100%" height={110}>
          <AreaChart data={s.daily} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="gAdd" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--info)" stopOpacity={0.35} /><stop offset="95%" stopColor="var(--info)" stopOpacity={0} /></linearGradient>
              <linearGradient id="gSub" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--ok)" stopOpacity={0.35} /><stop offset="95%" stopColor="var(--ok)" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--rule)" />
            <XAxis dataKey="date" tickFormatter={short} tickLine={false} axisLine={false} minTickGap={40} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <Tooltip content={<Tip fmt={short} />} cursor={{ stroke: 'var(--rule-strong)' }} />
            <Area isAnimationActive={false} type="monotone" dataKey="added" name="Started" stroke="var(--info)" strokeWidth={2} fill="url(#gAdd)" />
            <Area isAnimationActive={false} type="monotone" dataKey="submitted" name="Submitted" stroke="var(--ok)" strokeWidth={2} fill="url(#gSub)" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>
      <Card title="Status" value={s.totals.needYou} sub="waiting on you">
        <div className="donut">
          <ResponsiveContainer width={84} height={84}>
            <PieChart>
              <Tooltip content={<Tip />} />
              <Pie isAnimationActive={false} data={s.status} dataKey="value" nameKey="name" innerRadius={26} outerRadius={40} paddingAngle={2} stroke="none">
                {s.status.map((x) => <Cell key={x.name} fill={TONE[x.tone] ?? TONE.neutral} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <ul className="legend">{s.status.map((x) => <li key={x.name} title={`${x.name}: ${x.value}`}><i style={{ background: TONE[x.tone] ?? TONE.neutral }} /><span>{x.name}</span><b>{x.value}</b></li>)}</ul>
        </div>
      </Card>
      <Card title="Portals" value={s.totals.all} sub="applications">
        <ResponsiveContainer width="100%" height={110}>
          <BarChart data={s.portals} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }} barCategoryGap={3}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={84} interval={0} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <Tooltip content={<Tip />} cursor={{ fill: 'var(--inset)' }} />
            <Bar isAnimationActive={false} dataKey="value" name="Applications" fill="var(--chart-bar)" radius={3} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
    </>
  );
}

// ── The page ────────────────────────────────────────────────────────────────
const YOUR_TURN: HistoryStatus[] = ['needs_you', 'filled'];
const ORDER: HistoryStatus[] = ['needs_you', 'filled', 'in_progress', 'applied'];
const FILTERS: [string, string][] = [['all', 'All'], ['needs_you', 'Needs you'], ['filled', 'Ready to submit'], ['applied', 'Applied']];
const PAGE = 10;
// The full list stays hidden until you open it; its filter and page live in the address.
const link = (p: { s?: string; p?: number }) => `?${new URLSearchParams({ list: '1', ...(p.s && p.s !== 'all' ? { s: p.s } : {}), ...(p.p && p.p > 1 ? { p: String(p.p) } : {}) })}`;

const what = (a: HistoryItem) => (a.status === 'filled' ? 'Filled in · review and submit' : a.needs.length ? `${a.needs.length} field${a.needs.length === 1 ? '' : 's'} need you: ${a.needs.join(' · ')}` : 'Needs a look');
const title = (a: HistoryItem) => html`<a class="app-title" href="${a.url}" target="_blank" rel="noopener">${a.role || 'Untitled role'}</a>${a.company ? html` <span class="muted">· ${a.company}</span>` : ''}`;
const actions = (a: HistoryItem) => html`${a.status === 'applied' ? '' : html`<button class="btn btn-sm btn-x" data-act="applied" data-key="${a.key}" aria-label="Mark submitted" title="Mark submitted">✓</button>`}<button class="btn btn-sm btn-ghost btn-x" data-act="remove" data-key="${a.key}" aria-label="Remove" title="Remove">✕</button>`;
const letter = (a: HistoryItem) => (a.letter ? html`<details class="peek"><summary>Cover letter</summary><div class="peek-body"><pre class="letter">${a.letter}</pre><button class="btn btn-sm" data-copy="${a.letter}">Copy text</button></div></details>` : '');

let root: ReturnType<typeof createRoot> | null = null;
async function draw() {
  const q = new URLSearchParams(location.search);
  const filter = q.get('s') ?? 'all', open = q.get('list') === '1';
  const apps = Object.values(await store.history()).filter((a) => a.status !== 'removed').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const settings = await store.settings(), profile = await store.profile(), resume = await store.file('resume');
  const missing = [!(settings.typesafeKey && settings.openaiKey) && 'add your AI keys', !resume && 'upload your resume', !profile.fields.first_name && 'fill in your profile'].filter(Boolean);
  const shown = apps.filter((a) => filter === 'all' || a.status === filter).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const yourTurn = apps.filter((a) => YOUR_TURN.includes(a.status));
  const n = (s: string) => (s === 'all' ? apps.length : apps.filter((a) => a.status === s).length);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const page = Math.min(pages, Math.max(1, Number(q.get('p')) || 1));

  root?.unmount();
  render('dashboard', html`
${missing.length ? html`<div class="callout t-warn" role="status"><b>Finish Setup first:</b> ${missing.join(', ')}. <a href="setup.html">Setup</a></div>` : ''}
<div id="charts" class="charts-slot" aria-label="Activity"></div>
${yourTurn.length ? html`<section class="sec" aria-labelledby="turn-h">
<div class="sec-head"><h2 id="turn-h">Your turn</h2><span class="muted">${yourTurn.length}</span></div>
<ul class="turn">${yourTurn.map((a) => html`<li><div class="turn-main">${badge(a.status)} ${title(a)}<div class="turn-what">${what(a)}</div>${letter(a)}</div>
<div class="row"><a class="btn btn-primary" href="${a.url}" target="_blank" rel="noopener">Open</a>${actions(a)}</div></li>`)}</ul>
</section>` : ''}
<section class="sec" aria-labelledby="list-h">
<h2 id="list-h" class="sr">Applications</h2>
<p class="note">Open a job application in any tab and use the JobDemon widget on the page (or click the toolbar icon): <b>Fill page</b> fills it and goes on page by page, stopping at Submit.</p>
<a class="btn btn-sm" href="${open ? '?' : link({})}" aria-expanded="${open}">${open ? 'Hide' : 'Show'} all applications <b>${apps.length}</b></a>
${open ? html`<nav class="filters" aria-label="Filter by status">${FILTERS.map(([k, l]) => html`<a href="${link({ s: k })}" ${filter === k ? raw('aria-current="true"') : ''}>${l} <b>${n(k)}</b></a>`)}</nav>
${shown.length ? html`<table class="tbl"><thead><tr><th class="c-status">Status</th><th>Role</th><th class="c-portal">Portal</th><th class="c-when">Updated</th><th class="c-actions"><span class="sr">Actions</span></th></tr></thead><tbody>${shown.slice((page - 1) * PAGE, page * PAGE).map((a) => html`<tr>
<td class="c-status">${badge(a.status)}</td>
<td style="min-width:0">${title(a)}${YOUR_TURN.includes(a.status) ? html`<div class="app-reason">${what(a)}</div>` : ''}</td>
<td class="c-portal">${portalOf(a)}</td>
<td class="c-when">${ago(a.updatedAt)}</td>
<td class="c-actions"><div class="row">${actions(a)}</div></td>
</tr>`)}</tbody></table>
${pages > 1 ? html`<nav class="pager" aria-label="Pages">${page > 1 ? html`<a class="btn btn-sm" href="${link({ s: filter, p: page - 1 })}">‹ Previous</a>` : ''}<span class="muted">Page ${page} of ${pages}</span>${page < pages ? html`<a class="btn btn-sm" href="${link({ s: filter, p: page + 1 })}">Next ›</a>` : ''}</nav>` : ''}` : html`<p class="empty">${apps.length ? 'None with this status.' : 'No applications yet.'}</p>`}` : ''}
</section>`);
  root = createRoot(document.getElementById('charts')!);
  root.render(<Charts s={computeStats(apps)} />);
}

document.addEventListener('click', async (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-act]');
  if (!b?.dataset.key) return;
  const h = await store.history();
  const a = h[b.dataset.key];
  if (!a) return;
  if (b.dataset.act === 'remove' && !confirm('Remove this application from the list?')) return;
  const now = new Date().toISOString();
  h[a.key] = { ...a, status: b.dataset.act === 'applied' ? 'applied' : 'removed', updatedAt: now, ...(b.dataset.act === 'applied' ? { submittedAt: now } : {}) };
  await store.setHistory(h);
});
// Fills and submissions in other tabs show up here as they happen.
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.history) void draw(); });
void draw();
