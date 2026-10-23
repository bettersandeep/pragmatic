import { isBox, type BoardObject, type End } from './model.ts';

export type Rect = { x: number; y: number; w: number; h: number };

// Bounds of boxes and of free connector ends.
export function bounds(objs: BoardObject[]): Rect | null {
  const pts: [number, number][] = [];
  for (const o of objs) {
    if (isBox(o)) pts.push([o.x, o.y], [o.x + o.w, o.y + o.h]);
    else for (const end of [o.from, o.to]) if (end.x !== undefined && end.y !== undefined) pts.push([end.x, end.y]);
  }
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const shiftEnd = (e: End, dx: number, dy: number): End => (e.x === undefined || e.y === undefined ? e : { ...e, x: e.x + dx, y: e.y + dy });

export function translate(objs: BoardObject[], dx: number, dy: number): BoardObject[] {
  return objs.map((o) => (isBox(o) ? { ...o, x: o.x + dx, y: o.y + dy } : { ...o, from: shiftEnd(o.from, dx, dy), to: shiftEnd(o.to, dx, dy) }));
}

// Put a new batch at (x, y), or to the right of the existing content, or at the origin.
export function placeBatch(batch: BoardObject[], existing: BoardObject[], at: { x?: number; y?: number } = {}, gap = 160): BoardObject[] {
  const b = bounds(batch);
  if (!b) return batch;
  const e = bounds(existing);
  const x = at.x ?? (e ? e.x + e.w + gap : 0);
  const y = at.y ?? (e ? e.y : 0);
  return translate(batch, x - b.x, y - b.y);
}
