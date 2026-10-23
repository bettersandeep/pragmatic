import { isBox, type BoardObject, type BoxObject, type ConnectorObj, type End, type Side } from './model.ts';

export type Pt = { x: number; y: number };
type Normal = Pt | null;

const NORMAL: Record<Side, Pt> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
const STUB = 24, RADIUS = 10;

export const center = (b: BoxObject): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

export function anchor(b: BoxObject, side: Side): Pt {
  switch (side) {
    case 'top': return { x: b.x + b.w / 2, y: b.y };
    case 'bottom': return { x: b.x + b.w / 2, y: b.y + b.h };
    case 'left': return { x: b.x, y: b.y + b.h / 2 };
    case 'right': return { x: b.x + b.w, y: b.y + b.h / 2 };
  }
}

// The side that faces `toward`, relative to the box's aspect ratio.
export function autoSide(b: BoxObject, toward: Pt): Side {
  const c = center(b), dx = (toward.x - c.x) / Math.max(b.w, 1), dy = (toward.y - c.y) / Math.max(b.h, 1);
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top';
}

type Resolved = { p: Pt; n: Normal; box?: BoxObject };

// Mind map nodes are looked up as "<map id>#<node id>" (the canvas adds their measured boxes);
// without that entry, or when the node is gone, the end falls back to the whole map.
const lookup = (end: End, byId: Map<string, BoardObject>) => (end.id ? (end.node && byId.get(`${end.id}#${end.node}`)) || byId.get(end.id) : undefined);

function resolve(end: End, other: End, byId: Map<string, BoardObject>): Resolved | null {
  const found = lookup(end, byId);
  if (end.id && (!found || !isBox(found))) return null;
  if (!found || !isBox(found)) return { p: { x: end.x ?? 0, y: end.y ?? 0 }, n: null };
  const box = found;
  const o = lookup(other, byId);
  const target = o && isBox(o) ? center(o) : { x: other.x ?? 0, y: other.y ?? 0 };
  const side = end.side ?? autoSide(box, target);
  return { p: anchor(box, side), n: NORMAL[side], box };
}

const add = (a: Pt, b: Pt, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const dominant = (from: Pt, to: Pt): Pt =>
  Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? { x: Math.sign(to.x - from.x) || 1, y: 0 } : { x: 0, y: Math.sign(to.y - from.y) || 1 };

// Drop repeated and collinear points.
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (out.length && dist(out.at(-1)!, p) < 0.5) continue;
    if (out.length >= 2) {
      const a = out.at(-2)!, b = out.at(-1)!;
      if ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - p.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - p.y) < 0.5)) out.pop();
    }
    out.push(p);
  }
  return out;
}

function elbowPoints(a: Resolved, b: Resolved): Pt[] {
  const na = a.n ?? dominant(a.p, b.p), nb = b.n ?? dominant(b.p, a.p);
  const s = a.n ? add(a.p, na, STUB) : a.p, e = b.n ? add(b.p, nb, STUB) : b.p;
  const hs = na.x !== 0, he = nb.x !== 0;
  let mid: Pt[];
  if (hs && he) { const mx = (s.x + e.x) / 2; mid = [{ x: mx, y: s.y }, { x: mx, y: e.y }]; }
  else if (!hs && !he) { const my = (s.y + e.y) / 2; mid = [{ x: s.x, y: my }, { x: e.x, y: my }]; }
  else if (hs) mid = [{ x: e.x, y: s.y }];
  else mid = [{ x: s.x, y: e.y }];
  return simplify([a.p, s, ...mid, e, b.p]);
}

function roundedPath(pts: Pt[]): string {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], prev = pts[i - 1], next = pts[i + 1];
    const r = Math.min(RADIUS, dist(prev, p) / 2, dist(p, next) / 2);
    const a = add(p, { x: (prev.x - p.x) / (dist(prev, p) || 1), y: (prev.y - p.y) / (dist(prev, p) || 1) }, r);
    const b = add(p, { x: (next.x - p.x) / (dist(p, next) || 1), y: (next.y - p.y) / (dist(p, next) || 1) }, r);
    d += ` L${a.x},${a.y} Q${p.x},${p.y} ${b.x},${b.y}`;
  }
  const last = pts.at(-1)!;
  return `${d} L${last.x},${last.y}`;
}

function pointAlong(pts: Pt[], t: number): Pt {
  const total = pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);
  let left = total * t;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (left <= seg) return add(pts[i - 1], { x: (pts[i].x - pts[i - 1].x) / (seg || 1), y: (pts[i].y - pts[i - 1].y) / (seg || 1) }, left);
    left -= seg;
  }
  return pts.at(-1)!;
}

export type Geometry = { d: string; start: Pt; end: Pt; startDir: Pt; endDir: Pt; mid: Pt };

// Path of a connector, or null when a bound object is gone.
export function connectorGeometry(c: Pick<ConnectorObj, 'from' | 'to' | 'route'>, byId: Map<string, BoardObject>): Geometry | null {
  const a = resolve(c.from, c.to, byId), b = resolve(c.to, c.from, byId);
  if (!a || !b) return null;
  const unit = (from: Pt, to: Pt) => { const l = dist(from, to) || 1; return { x: (to.x - from.x) / l, y: (to.y - from.y) / l }; };
  if (c.route === 'curved') {
    const k = Math.max(40, dist(a.p, b.p) / 3);
    const c1 = add(a.p, a.n ?? unit(a.p, b.p), k), c2 = add(b.p, b.n ?? unit(b.p, a.p), k);
    const mid = { x: (a.p.x + 3 * c1.x + 3 * c2.x + b.p.x) / 8, y: (a.p.y + 3 * c1.y + 3 * c2.y + b.p.y) / 8 };
    return { d: `M${a.p.x},${a.p.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.p.x},${b.p.y}`, start: a.p, end: b.p, startDir: unit(c1, a.p), endDir: unit(c2, b.p), mid };
  }
  const pts = c.route === 'straight' ? [a.p, b.p] : elbowPoints(a, b);
  return {
    d: roundedPath(pts), start: a.p, end: b.p,
    startDir: unit(pts[1] ?? b.p, a.p), endDir: unit(pts.at(-2) ?? a.p, b.p), mid: pointAlong(pts, 0.5),
  };
}

// Filled arrowhead with its tip at `tip`, pointing along `dir`.
export function arrowHead(tip: Pt, dir: Pt, size = 11): string {
  const back = add(tip, dir, -size), perp = { x: -dir.y, y: dir.x };
  const l = add(back, perp, size * 0.5), r = add(back, perp, -size * 0.5);
  return `M${tip.x},${tip.y} L${l.x},${l.y} L${r.x},${r.y} Z`;
}
