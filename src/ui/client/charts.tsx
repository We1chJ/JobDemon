// The chart row on the Applications page: shadcn-style cards drawn with Recharts (what shadcn's charts use).
// Bundled by the server with esbuild at start-up and served as /assets/charts.js; data comes in the page.
import { createRoot } from 'react-dom/client';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ReactNode } from 'react';
import type { Stats } from '../stats.js';

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

function Charts({ s }: { s: Stats }) {
  const last7 = s.daily.slice(-7).reduce((n, d) => n + d.added, 0);
  return (
    <div className="charts">
      <Card title="Submitted" value={s.totals.submitted} sub={`${s.totals.thisWeek} this week`}>
        <Heatmap days={s.heatmap} />
      </Card>
      <Card title="Last 30 days" value={last7} sub="added this week">
        <ResponsiveContainer width="100%" height={110}>
          <AreaChart data={s.daily} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="gAdd" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--info)" stopOpacity={0.35} /><stop offset="95%" stopColor="var(--info)" stopOpacity={0} /></linearGradient>
              <linearGradient id="gSub" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--ok)" stopOpacity={0.35} /><stop offset="95%" stopColor="var(--ok)" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--rule)" />
            <XAxis dataKey="date" tickFormatter={short} tickLine={false} axisLine={false} minTickGap={40} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <Tooltip content={<Tip fmt={short} />} cursor={{ stroke: 'var(--rule-strong)' }} />
            <Area isAnimationActive={false} type="monotone" dataKey="added" name="Added" stroke="var(--info)" strokeWidth={2} fill="url(#gAdd)" />
            <Area isAnimationActive={false} type="monotone" dataKey="submitted" name="Submitted" stroke="var(--ok)" strokeWidth={2} fill="url(#gSub)" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>
      <Card title="Status" value={s.totals.needYou} sub="need you">
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
  );
}

const root = document.getElementById('charts');
const data = document.getElementById('stats-data');
if (root && data) createRoot(root).render(<Charts s={JSON.parse(data.textContent || '{}') as Stats} />);
