// Your job search as a flow chart: applications on the left, where they went on the right (rejected, ghosted,
// interview rounds, offers). You type the numbers; nothing here is worked out from your applications.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { store, type Flow } from '../shared/store.js';

// What a first-time chart starts with: the usual stages, every number blank. Ghosted takes the rest of the applications.
const STARTER: Flow[] = [
  { from: 'Applications', to: 'Rejected', value: 0 },
  { from: 'Applications', to: 'Ghosted', value: 0, rest: true },
  { from: 'Applications', to: '1st round', value: 0 },
  { from: '1st round', to: '2nd round', value: 0 },
  { from: '2nd round', to: 'Offer', value: 0 },
  { from: 'Offer', to: 'Accepted', value: 0 },
];
const OUTCOMES = ['Ghosted', 'Rejected', 'Withdrew', 'Declined'];
const STAGES = ['Applications', 'Rejected', 'Ghosted', 'Withdrew', '1st round', '2nd round', '3rd round', '4th round', '5th round', '6th round', 'Offer', 'Accepted', 'Declined'];

// Each kind of stage keeps its color wherever it sits; anything else is neutral (the label names it either way).
function colorOf(name: string) {
  const n = name.toLowerCase();
  if (/^applications?$|^applied$/.test(n)) return 'var(--f1)';
  if (/reject/.test(n)) return 'var(--f7)';
  if (/ghost|no (reply|response)/.test(n)) return 'var(--f5)';
  if (/withdr/.test(n)) return 'var(--f4)';
  if (/round|interview|screen|onsite|assessment/.test(n)) return 'var(--f2)';
  if (/offer/.test(n)) return 'var(--f3)';
  if (/accept/.test(n)) return 'var(--f6)';
  if (/declin/.test(n)) return 'var(--f8)';
  return 'var(--chart-neutral)';
}

// ── Layout ─────────────────────────────────────────────────────────────────
// A band that skips columns (Applications → Ghosted) is threaded through a placeholder in each column it crosses.
// Placeholders take up room like stages do, so the band goes around the stages in between instead of over them.
interface Node { name: string; color: string; depth: number; value: number; x: number; y: number; h: number; ins: Seg[]; outs: Seg[]; pass?: Link }
interface Link { id: number; s: Node; t: Node; value: number; w: number; segs: Seg[] }
interface Seg { link: Link; s: Node; t: Node; sy: number; ty: number }
// Room between two stages (their labels need it), between a stage and a band going past it, and between two bands.
const NODE_W = 12, GAP = 46, BY_LABEL = 26, BY_BAND = 3;
/** How wide a stage's label is, measured in the page's font: its number (20px bold) over its name (13px). */
const pen = document.createElement('canvas').getContext('2d');
const textW = (s: string, font: string) => { if (!pen) return s.length * 8; pen.font = `${font} ${getComputedStyle(document.body).fontFamily}`; return pen.measureText(s).width; };
const labelW = (n: Node) => Math.max(textW(String(n.value), '650 20px'), textW(n.name, '13px')) + 6;
const gapBetween = (a: Node, b: Node) => (a.pass && b.pass ? BY_BAND : a.pass || b.pass ? BY_LABEL : GAP);
const mid = (n: Node) => n.y + n.h / 2;

/** Where everything goes. The chart is as wide as it needs to be for no label to reach the next column; wider than
 * the card, it scrolls sideways. */
function layout(flows: Flow[], avail: number) {
  const named = new Map<string, Node>(), links: Link[] = [];
  const blank = (name: string, depth = 0): Node => ({ name, color: colorOf(name), depth, value: 0, x: 0, y: 0, h: 0, ins: [], outs: [] });
  const node = (name: string) => named.get(name) ?? named.set(name, blank(name)).get(name)!;
  // A flow that would loop back (B → A after A → B) can't be drawn left to right: it's left out.
  const reaches = (a: Node, b: Node): boolean => a === b || a.outs.some((x) => reaches(x.t, b));
  for (const f of flows) {
    const from = f.from.trim(), to = f.to.trim();
    if (!from || !to || from === to || !(f.value > 0)) continue;
    const s = node(from), t = node(to);
    if (reaches(t, s)) continue;
    const l: Link = { id: links.length, s, t, value: f.value, w: 0, segs: [] };
    const seg: Seg = { link: l, s, t, sy: 0, ty: 0 };
    links.push(l); s.outs.push(seg); t.ins.push(seg);
  }
  const real = [...named.values()];
  for (let i = 0; i < real.length; i++) for (const l of links) l.t.depth = Math.max(l.t.depth, l.s.depth + 1);
  for (const n of real) n.value = Math.max(n.ins.reduce((a, x) => a + x.link.value, 0), n.outs.reduce((a, x) => a + x.link.value, 0));
  // Each band, one hop per column.
  for (const n of real) { n.ins = []; n.outs = []; }
  const all = [...real];
  for (const l of links) {
    let prev = l.s;
    for (let d = l.s.depth + 1; d <= l.t.depth; d++) {
      const next = d === l.t.depth ? l.t : { ...blank(`${l.s.name}→${l.t.name}`, d), value: l.value, pass: l };
      if (next !== l.t) all.push(next);
      const seg: Seg = { link: l, s: prev, t: next, sy: 0, ty: 0 };
      l.segs.push(seg); prev.outs.push(seg); next.ins.push(seg);
      prev = next;
    }
  }
  const cols = Math.max(0, ...real.map((n) => n.depth)) + 1;
  const column = Array.from({ length: cols }, (_, d) => all.filter((n) => n.depth === d));
  // An ending that collects from several stages (Ghosted) gets its own lane along an edge of the chart: its bands
  // ride the edge, the earliest outermost, and each later stage's band drops in beside them without crossing any.
  // The first such ending takes the bottom edge, the next the top, and so on.
  const collectors = real.filter((n) => !n.outs.length && n.ins.length >= 2).sort((a, b) => b.value - a.value);
  const lane = (n: Node) => { const t = n.pass ? n.pass.t : n; const i = collectors.indexOf(t); return i < 0 ? null : { bottom: i % 2 === 0, rank: Math.floor(i / 2), from: n.pass ? n.pass.s.depth : -1 }; };
  const toLanes = (c: Node[]) => {
    const edge = (bottom: boolean) => c.filter((n) => lane(n)?.bottom === bottom).sort((a, b) => {
      const x = lane(a)!, y = lane(b)!;
      // Bottom edge: inner lanes (later stages, then the ending itself) first, outermost last. Top edge: the mirror.
      const order = x.rank - y.rank || y.from - x.from;
      return bottom ? order : -order;
    });
    c.splice(0, c.length, ...edge(false), ...c.filter((n) => !lane(n)), ...edge(true));
  };
  // How badly bands cross between two neighbouring columns (a wide band crossing counts for more).
  const crossings = (d: number) => {
    if (d < 0 || d + 1 >= cols) return 0;
    const segs = column[d].flatMap((n) => n.outs), pos = (n: Node) => column[n.depth].indexOf(n);
    let sum = 0;
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j];
      if (a.s === b.s || a.t === b.t) continue;
      if ((pos(a.s) - pos(b.s)) * (pos(a.t) - pos(b.t)) < 0) sum += 1 + Math.min(a.link.value, b.link.value);
    }
    return sum;
  };
  const cost = () => column.reduce((a, _, d) => a + crossings(d), 0);
  let best = { cost: Infinity, order: column.map((c) => [...c]) };
  const keep = () => { const now = cost(); if (now < best.cost) best = { cost: now, order: column.map((c) => [...c]) }; return now; };
  // Order each column: each thing near the average place of what it connects to, swept left to right and back. Every
  // sweep's result (with the lanes) is scored, and the best one is kept.
  const at = (n: Node) => column[n.depth].indexOf(n);
  const centre = (n: Node, side: 'ins' | 'outs') => {
    const segs = n[side];
    const v = segs.reduce((a, x) => a + x.link.value, 0);
    return v ? segs.reduce((a, x) => a + at(side === 'ins' ? x.s : x.t) * x.link.value, 0) / v : at(n);
  };
  column.forEach(toLanes);
  keep();
  for (let sweep = 0; sweep < 16 && best.cost > 0; sweep++) {
    const down = sweep % 2 === 0;
    for (let k = 1; k < cols; k++) {
      const d = down ? k : cols - 1 - k;
      const key = new Map(column[d].map((n) => [n, centre(n, down ? 'ins' : 'outs')]));
      column[d].sort((a, b) => key.get(a)! - key.get(b)!);
      toLanes(column[d]);
    }
    keep();
  }
  best.order.forEach((o, d) => column[d].splice(0, column[d].length, ...o));
  // A job search has only a few stages per column, so when there aren't too many ways to order them, every way is
  // tried and the one with the fewest crossings wins (ties keep the order above). Lanes stay where they are.
  const perms = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
  const choices = column.map((c) => perms(c.filter((n) => !lane(n))));
  if (best.cost > 0 && choices.reduce((a, c) => a * c.length, 1) <= 5000) {
    const put = (d: number, order: Node[]) => { const top = column[d].filter((n) => lane(n)?.bottom === false), bottom = column[d].filter((n) => lane(n)?.bottom === true); column[d].splice(0, column[d].length, ...top, ...order, ...bottom); };
    const walk = (d: number) => {
      if (best.cost === 0) return;
      if (d === cols) { keep(); return; }
      for (const order of choices[d]) { put(d, order); walk(d + 1); }
    };
    walk(0);
    best.order.forEach((o, d) => column[d].splice(0, column[d].length, ...o));
  }
  // Heights: the fullest column fills the chart.
  const tallest = Math.max(1, ...column.map((c) => c.filter((n) => !n.pass).length));
  const H = Math.max(320, tallest * 80);
  const gaps = (c: Node[]) => c.slice(1).reduce((a, n, i) => a + gapBetween(c[i], n), 0);
  const k = Math.min(...column.map((c) => (c.length ? (H - gaps(c)) / c.reduce((a, n) => a + n.value, 0) : Infinity)));
  for (const n of all) n.h = Math.max(2, n.value * k);
  for (const l of links) l.w = Math.max(1, l.value * k);
  // Labels: the first column's on its left, every other column's on its right, in the space before the next column.
  const widest = (ns: Node[]) => Math.max(0, ...ns.filter((n) => !n.pass).map(labelW));
  const left = cols > 1 ? widest(column[0]) + 10 : 0, right = widest(column[cols - 1]) + 10;
  const between = Math.max(72, ...Array.from({ length: Math.max(0, cols - 2) }, (_, i) => widest(column[i + 1]) + 16));
  const W = Math.max(avail, left + right + NODE_W + (cols - 1) * (between + NODE_W));
  const x0 = left, x1 = W - right - NODE_W;
  for (const n of all) n.x = cols > 1 ? x0 + (n.depth * (x1 - x0)) / (cols - 1) : (W - NODE_W) / 2;
  // Vertical places, keeping each column's order: level with what it connects to, never overlapping, inside the chart.
  const settle = (c: Node[]) => {
    let y = 0;
    c.forEach((n, i) => { if (i) y += gapBetween(c[i - 1], n); n.y = Math.max(y, n.y); y = n.y + n.h; });
    let bottom = H;
    for (let i = c.length - 1; i >= 0; i--) { c[i].y = Math.min(c[i].y, bottom - c[i].h); if (i) bottom = c[i].y - gapBetween(c[i - 1], c[i]); }
    if (c.length && c[0].y < 0) { let top = 0; c.forEach((n, i) => { if (i) top += gapBetween(c[i - 1], n); n.y = Math.max(n.y, top); top = n.y + n.h; }); }
  };
  column.forEach((c) => { let y = (H - c.reduce((a, n) => a + n.h, 0) - gaps(c)) / 2; c.forEach((n, i) => { if (i) y += gapBetween(c[i - 1], n); n.y = y; y += n.h; }); });
  const toward = (n: Node, side: 'ins' | 'outs') => {
    const segs = n[side], v = segs.reduce((a, x) => a + x.link.value, 0);
    return v ? segs.reduce((a, x) => a + mid(side === 'ins' ? x.s : x.t) * x.link.value, 0) / v - n.h / 2 : n.y;
  };
  for (let pass = 0; pass < 6; pass++) {
    const down = pass % 2 === 0;
    for (let k2 = 1; k2 < cols; k2++) {
      const c = column[down ? k2 : cols - 1 - k2];
      for (const n of c) n.y = toward(n, down ? 'ins' : 'outs');
      settle(c);
    }
  }
  // Where each band leaves and arrives on a stage: in the order of what's at its other end, so they don't cross there.
  for (const n of all) {
    let y = n.y;
    for (const x of [...n.outs].sort((a, b) => mid(a.t) - mid(b.t))) { x.sy = y; y += x.link.w; }
    y = n.y;
    for (const x of [...n.ins].sort((a, b) => mid(a.s) - mid(b.s))) { x.ty = y; y += x.link.w; }
  }
  return { nodes: real, links, H, W };
}

/** A band's outline: down its top edge hop by hop (straight through each column it passes), back along its bottom. */
const band = (l: Link) => {
  const curve = (sx: number, sy: number, tx: number, ty: number) => { const m = (sx + tx) / 2; return `C${m},${sy} ${m},${ty} ${tx},${ty}`; };
  const first = l.segs[0];
  let d = `M${first.s.x + NODE_W},${first.sy}`;
  for (const x of l.segs) { d += curve(x.s.x + NODE_W, x.sy, x.t.x, x.ty); if (x.t.pass) d += `L${x.t.x + NODE_W},${x.ty}`; }
  for (const x of [...l.segs].reverse()) {
    if (x.t.pass || x === l.segs.at(-1)) d += `L${x.t.x + (x.t.pass ? NODE_W : 0)},${x.ty + l.w}`;
    if (x.t.pass) d += `L${x.t.x},${x.ty + l.w}`;
    d += curve(x.t.x, x.ty + l.w, x.s.x + NODE_W, x.sy + l.w);
  }
  return `${d}Z`;
};
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '');

// ── The chart ──────────────────────────────────────────────────────────────
type Hover = { x: number; y: number; up: boolean; left: boolean; title: string; lines: string[] } | null;

function Sankey({ flows }: { flows: Flow[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<Hover>(null);
  const [lit, setLit] = useState<{ link?: number; node?: string } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const { nodes, links, H, W } = useMemo(() => layout(flows, width), [flows, width]);
  const start = nodes.filter((n) => !n.ins.length).reduce((a, n) => a + n.value, 0);
  const on = (l: Link) => !lit || lit.link === l.id || lit.node === l.s.name || lit.node === l.t.name;
  const tip = (e: MouseEvent, title: string, lines: string[]) => {
    const r = box.current!.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    setHover({ x: x + box.current!.scrollLeft, y, up: y > r.height / 2, left: x > r.width - 200, title, lines });
  };
  const leave = () => { setHover(null); setLit(null); };
  const PADY = 24;
  return (
    <div className="fl-chart" ref={box} onMouseLeave={leave}>
      {width > 0 && (
        <svg width={W} height={H + PADY * 2} viewBox={`0 ${-PADY} ${W} ${H + PADY * 2}`} role="img" aria-label={`Job search: ${links.map((l) => `${l.s.name} to ${l.t.name}, ${l.value}`).join('; ')}`}>
          <defs>
            {links.map((l) => (
              <linearGradient key={l.id} id={`fl-g${l.id}`} gradientUnits="userSpaceOnUse" x1={l.s.x + NODE_W} x2={l.t.x} y1={0} y2={0}>
                <stop offset="0" stopColor={l.s.color} /><stop offset="1" stopColor={l.t.color} />
              </linearGradient>
            ))}
          </defs>
          {links.map((l) => (
            <path key={l.id} d={band(l)} fill={`url(#fl-g${l.id})`} className={`fl-band${on(l) ? '' : ' fl-dim'}${lit?.link === l.id ? ' fl-lit' : ''}`}
              onMouseMove={(e) => { setLit({ link: l.id }); tip(e, `${l.s.name} → ${l.t.name}`, [`${l.value}`, `${pct(l.value, l.s.value)} of ${l.s.name}`]); }} />
          ))}
          {nodes.map((n) => {
            const share = n.ins.length && start ? [`${pct(n.value, start)} of all applications`] : [];
            return (
              <g key={n.name} className="fl-node" onMouseMove={(e) => { setLit({ node: n.name }); tip(e, n.name, [`${n.value}`, ...share]); }}>
                <rect x={n.x} y={n.y} width={NODE_W} height={n.h} rx={3} fill={n.color} />
                <rect x={n.x - 8} y={n.y - 4} width={NODE_W + 16} height={n.h + 8} fill="transparent" />
              </g>
            );
          })}
          {/* Labels last, so no band or bar is ever drawn over them; each has an outline in the card's color. */}
          <g className="fl-labels" aria-hidden="true">
            {nodes.map((n) => {
              const left = n.depth === 0 && nodes.some((m) => m.depth > 0);
              const tx = left ? n.x - 10 : n.x + NODE_W + 10, cy = n.y + n.h / 2, anchor = left ? 'end' : 'start';
              return (
                <g key={n.name}>
                  <text x={tx} y={cy - 3} textAnchor={anchor} className="fl-num">{n.value}</text>
                  <text x={tx} y={cy + 14} textAnchor={anchor} className="fl-name">{n.name}</text>
                </g>
              );
            })}
          </g>
        </svg>
      )}
      {hover && (
        <div className={`tip fl-tip${hover.up ? ' fl-up' : ''}${hover.left ? ' fl-left' : ''}`} style={{ left: hover.x, top: hover.y }}>
          <div className="tip-l">{hover.title}</div>
          <div className="fl-tip-v">{hover.lines[0]}</div>
          {hover.lines.slice(1).map((s) => <div key={s} className="tip-l">{s}</div>)}
        </div>
      )}
    </div>
  );
}

// ── Lines marked "Rest" ────────────────────────────────────────────────────
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** A stage nothing flows into (Applications): its total has to be typed on its Rest line. */
const starts = (rows: Flow[], stage: string) => !rows.some((r) => r.value > 0 || r.rest ? same(r.to, stage) : false);
/** Every line's number, with each Rest line worked out: how many reached its stage (or the total you typed), minus
 * the stage's other lines. Worked out a few times over, since one stage's rest can feed the next. */
function resolve(rows: Flow[]) {
  const v = rows.map((r) => (r.rest ? 0 : r.value));
  const short = rows.map(() => 0);
  for (let pass = 0; pass < rows.length + 1; pass++) {
    rows.forEach((r, i) => {
      if (!r.rest) return;
      const into = rows.reduce((a, x, j) => a + (j !== i && same(x.to, r.from) ? v[j] : 0), 0);
      const total = into || r.total || 0;
      const others = rows.reduce((a, x, j) => a + (j !== i && same(x.from, r.from) ? v[j] : 0), 0);
      v[i] = Math.max(0, total - others);
      short[i] = total ? Math.max(0, others - total) : 0;
    });
  }
  return { values: v, short };
}

// ── The card: chart, and the numbers you type ──────────────────────────────
export function Funnel() {
  const [rows, setRows] = useState<Flow[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<number | null>(null); // the line whose "send the rest to…" menu is open
  useEffect(() => {
    if (menu === null) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element).closest('.fl-restwrap')) setMenu(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [menu]);
  const focusLast = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { void store.funnel().then((f) => { setRows(f ?? STARTER); if (!f?.some((r) => r.value > 0 || r.total)) setEditing(true); }); }, []);
  // Saved as you type.
  useEffect(() => {
    if (!rows) return;
    const t = setTimeout(() => void store.setFunnel(rows), 250);
    return () => clearTimeout(t);
  }, [rows]);
  useEffect(() => {
    if (!focusLast.current) return;
    focusLast.current = false;
    [...(list.current?.querySelectorAll<HTMLInputElement>('input[data-f=to]') ?? [])].at(-1)?.focus();
  }, [rows]);
  if (!rows) return null;
  const { values, short } = resolve(rows);
  const flows = rows.map((r, i) => ({ from: r.from, to: r.to, value: values[i] }));
  const drawn = flows.filter((r) => r.from.trim() && r.to.trim() && r.value > 0);
  const firsts = new Set(drawn.map((r) => r.from.trim()).filter((n) => !drawn.some((r) => same(r.to, n))));
  const total = drawn.filter((r) => firsts.has(r.from.trim())).reduce((a, r) => a + r.value, 0);
  const names = [...new Set([...STAGES, ...rows.flatMap((r) => [r.from.trim(), r.to.trim()])].filter(Boolean))];
  const change = (i: number, patch: Partial<Flow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // "Send the rest of this stage to…": the stage's one Rest line points there (made if it has none, right after the
  // stage's other lines). A line already going there becomes the Rest line instead of a second one.
  const sendRest = (i: number, to: string) => {
    const from = rows[i].from, dest = to.trim();
    setMenu(null);
    if (!dest) return;
    const there = rows.findIndex((r) => same(r.from, from) && same(r.to, dest));
    const marked = rows.map((r, j) => (same(r.from, from) ? { ...r, rest: j === there } : r));
    if (there >= 0) return setRows(marked.map((r, j) => (j === there ? { ...r, value: 0, total: r.total ?? rows.find((x) => x.rest && same(x.from, from))?.total } : r)));
    const total = rows.find((r) => r.rest && same(r.from, from))?.total;
    const old = rows.findIndex((r) => r.rest && same(r.from, from));
    if (old >= 0) return setRows(rows.map((r, j) => (j === old ? { ...r, to: dest } : r)));
    const after = rows.reduce((at, r, j) => (same(r.from, from) ? j : at), i);
    setRows([...marked.slice(0, after + 1), { from, to: dest, value: 0, rest: true, total }, ...marked.slice(after + 1)]);
  };
  const stopRest = (i: number) => setRows(rows.map((r, j) => (j === i ? { ...r, rest: false } : r)));
  const add = () => { focusLast.current = true; setRows([...rows, { from: rows.at(-1)?.to || 'Applications', to: '', value: 0 }]); };
  return (
    <section className="cc fl" aria-labelledby="fl-h">
      <div className="fl-head">
        <div className="cc-head">
          <span id="fl-h" className="cc-title">Your job search</span>
          {total > 0 && <><span className="cc-value">{total}</span><span className="cc-sub">applications</span></>}
        </div>
        <button type="button" className={`btn btn-sm${editing ? ' btn-primary' : ''}`} aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit numbers'}</button>
      </div>
      {drawn.length ? <Sankey flows={flows} /> : <p className="fl-empty">Type how many went where below, and the chart draws itself.</p>}
      {editing && (
        <div className="fl-edit" ref={list}>
          <p className="fl-help">Each line is one arrow: from a stage, to the next, and how many. Use the same name to connect lines. Press <b>Rest</b> on a line and pick where everyone left over from that stage went (Ghosted, Rejected…): it's worked out for you.</p>
          <div className="fl-row fl-cols" aria-hidden="true"><span>From</span><span /><span>To</span><span>How many</span><span /><span /></div>
          {rows.map((r, i) => {
            const needsTotal = r.rest && starts(rows, r.from);
            return (
              <div className="fl-line" key={i}>
                <div className="fl-row">
                  <input list="fl-stages" value={r.from} aria-label={`Line ${i + 1}: from`} placeholder="Applications" onChange={(e) => change(i, { from: e.target.value })} />
                  <span className="fl-arrow" aria-hidden="true">→</span>
                  <input data-f="to" list="fl-stages" value={r.to} aria-label={`Line ${i + 1}: to`} placeholder="Rejected" onChange={(e) => change(i, { to: e.target.value })} />
                  {r.rest
                    ? <output className="fl-restv" aria-label={`Line ${i + 1}: the rest, ${values[i]}`}>{values[i]}<small>the rest</small></output>
                    : <input type="number" min={0} inputMode="numeric" value={r.value || ''} placeholder="0" aria-label={`Line ${i + 1}: how many`}
                        onChange={(e) => change(i, { value: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                        onKeyDown={(e) => { if (e.key === 'Enter' && i === rows.length - 1) add(); }} />}
                  <div className="fl-restwrap">
                    {r.rest
                      ? <button type="button" className="btn btn-sm fl-rest-b on" aria-pressed="true" title="This line takes the rest. Click to type its number yourself." onClick={() => stopRest(i)}>Rest</button>
                      : <button type="button" className="btn btn-sm fl-rest-b" aria-expanded={menu === i} aria-haspopup="menu" title={`Send the rest of ${r.from.trim() || 'this stage'} somewhere`} onClick={() => setMenu(menu === i ? null : i)}>Rest</button>}
                    {menu === i && (
                      <div className="fl-menu" role="menu" aria-label={`Send the rest of ${r.from.trim() || 'this stage'} to`}>
                        <div className="fl-menu-h">Send the rest of <b>{r.from.trim() || 'this stage'}</b> to</div>
                        {OUTCOMES.map((o) => <button type="button" role="menuitem" key={o} onClick={() => sendRest(i, o)}>{o}</button>)}
                        <input placeholder="Somewhere else…" aria-label="Somewhere else" onKeyDown={(e) => { if (e.key === 'Enter') sendRest(i, (e.target as HTMLInputElement).value); }} />
                      </div>
                    )}
                  </div>
                  <button type="button" className="btn btn-sm btn-ghost btn-x" aria-label={`Remove line ${i + 1}`} title="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
                </div>
                {needsTotal && (
                  <label className="fl-total">How many {r.from.trim() || 'in this stage'} in total?
                    <input type="number" min={0} inputMode="numeric" value={r.total || ''} placeholder="0" onChange={(e) => change(i, { total: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                  </label>
                )}
                {short[i] > 0 && <p className="fl-problem" role="status">⚠ {r.from.trim()}'s other lines add up to {short[i]} more than its total.</p>}
              </div>
            );
          })}
          <datalist id="fl-stages">{names.map((n) => <option key={n} value={n} />)}</datalist>
          <div className="fl-actions">
            <button type="button" className="btn btn-sm" onClick={add}>+ Add a line</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { if (confirm('Start over with the usual stages and no numbers?')) setRows(STARTER); }}>Start over</button>
          </div>
        </div>
      )}
    </section>
  );
}
