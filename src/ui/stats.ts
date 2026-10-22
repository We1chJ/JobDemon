// Numbers for the charts on the Applications page, computed from the application table.
// "Submitted on" is when an application was marked submitted (its last update while status is applied).
import { db, schema } from '../db/index.js';
import { portalName } from '../portals/index.js';
import { STATUS } from './views.js';

export interface Stats {
  totals: { all: number; submitted: number; thisWeek: number; needYou: number; queued: number };
  heatmap: { date: string; count: number }[]; // submitted per day, last 20 weeks, oldest first, starting on a Sunday
  daily: { date: string; added: number; submitted: number }[]; // last 30 days
  status: { name: string; value: number; tone: string }[];
  portals: { name: string; value: number }[];
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const localDay = (iso: string) => ymd(new Date(iso));

export function computeStats(): Stats {
  const apps = db.select().from(schema.application).all();
  const submittedOn = new Map<string, number>(), addedOn = new Map<string, number>();
  for (const a of apps) {
    addedOn.set(localDay(a.createdAt), (addedOn.get(localDay(a.createdAt)) ?? 0) + 1);
    if (a.status === 'applied') submittedOn.set(localDay(a.updatedAt), (submittedOn.get(localDay(a.updatedAt)) ?? 0) + 1);
  }
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const back = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };

  // GitHub-style grid: 20 full weeks ending this week, each column Sunday..Saturday.
  const start = back(7 * 19 + today.getDay());
  const heatmap: Stats['heatmap'] = [];
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) heatmap.push({ date: ymd(d), count: submittedOn.get(ymd(d)) ?? 0 });

  const daily: Stats['daily'] = [];
  for (let i = 29; i >= 0; i--) { const k = ymd(back(i)); daily.push({ date: k, added: addedOn.get(k) ?? 0, submitted: submittedOn.get(k) ?? 0 }); }

  const count = (s: string) => apps.filter((a) => a.status === s).length;
  const order = ['applied', 'ready_to_submit', 'human_review', 'waiting_for_you', 'in_progress', 'queued', 'duplicate'];
  const status = order.map((s) => ({ name: STATUS[s]?.label ?? s, value: count(s), tone: STATUS[s]?.tone ?? 'neutral' })).filter((x) => x.value);

  const byPortal = new Map<string, number>();
  for (const a of apps) { if (a.status === 'duplicate') continue; let p = 'Other'; try { p = portalName(a.url) ?? new URL(a.url).hostname.replace(/^(www|jobs|careers|job-boards)\./, '').split('.')[0]; } catch {} byPortal.set(p, (byPortal.get(p) ?? 0) + 1); }
  const portals = [...byPortal].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const top = portals.slice(0, 5);
  if (portals.length > 5) top.push({ name: 'Other', value: portals.slice(5).reduce((n, p) => n + p.value, 0) });

  const weekStart = ymd(back(today.getDay()));
  return {
    totals: {
      all: apps.filter((a) => a.status !== 'duplicate').length,
      submitted: count('applied'),
      thisWeek: [...submittedOn].filter(([k]) => k >= weekStart).reduce((n, [, v]) => n + v, 0),
      needYou: count('human_review') + count('waiting_for_you') + count('ready_to_submit'),
      queued: count('queued') + count('in_progress'),
    },
    heatmap, daily, status, portals: top,
  };
}
