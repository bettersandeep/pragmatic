import { frameScreen, isBox, type BoardObject, type BoxObject } from '../../../shared/model.ts';
export { cloneObjects, withInnerConnectors } from '../../../shared/clone.ts';
import { bounds, type Rect } from '../../../shared/layout.ts';
import { connectorGeometry, type Pt } from '../../../shared/route.ts';

export const byIdOf = (objs: BoardObject[]) => new Map(objs.map((o) => [o.id, o]));

const inside = (p: Pt, r: Rect, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
export const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
export const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const SECTION_TITLE_H = 28;

// Topmost box under the point. Sections only catch their title strip and border,
// so clicks inside a section reach the canvas (marquee) like in Whimsical.
export function hitBox(p: Pt, objs: BoardObject[], zoom: number): BoxObject | undefined {
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i];
    if (!isBox(o)) continue;
    if (o.type === 'section') {
      const band = 6 / zoom;
      const title = { x: o.x, y: o.y - SECTION_TITLE_H / zoom, w: Math.min(o.w, 260), h: SECTION_TITLE_H / zoom };
      if (inside(p, title) || (inside(p, o, band) && !inside(p, { x: o.x + band, y: o.y + band, w: o.w - 2 * band, h: o.h - 2 * band }))) return o;
      continue;
    }
    if (o.type === 'frame') {
      // The screen stays clickable for marquee selection of the components on it.
      const band = 6 / zoom, s = frameScreen(o);
      const title = { x: o.x, y: o.y - SECTION_TITLE_H / zoom, w: Math.min(o.w, 260), h: SECTION_TITLE_H / zoom };
      const x1 = Math.max(s.x, o.x + band), y1 = Math.max(s.y, o.y + band), x2 = Math.min(s.x + s.w, o.x + o.w - band), y2 = Math.min(s.y + s.h, o.y + o.h - band);
      if (inside(p, title) || (inside(p, o) && !inside(p, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }))) return o;
      continue;
    }
    if (o.type === 'mindmap') continue; // hit through its node elements instead
    if (o.type === 'draw') {
      const r = 8 / zoom + o.size / 2, sx = o.w / o.w0, sy = o.h / o.h0;
      if (!inside(p, o, r)) continue;
      for (let j = 0; j < o.points.length; j += 2) if (Math.hypot(o.x + o.points[j] * sx - p.x, o.y + o.points[j + 1] * sy - p.y) < r) return o;
      continue;
    }
    if (inside(p, o)) return o;
  }
}

// Box objects fully inside a section or frame move with it. A section also carries frames; a frame carries only content.
export const sectionContents = (s: BoxObject, objs: BoardObject[]) =>
  objs.filter((o): o is BoxObject => isBox(o) && o.id !== s.id && o.type !== 'section' && (s.type === 'section' || o.type !== 'frame') && contains(s, o));

export function objectBounds(o: BoardObject, byId: Map<string, BoardObject>): Rect | null {
  if (isBox(o)) return o;
  const g = connectorGeometry(o, byId);
  if (!g) return null;
  const x = Math.min(g.start.x, g.end.x, g.mid.x), y = Math.min(g.start.y, g.end.y, g.mid.y);
  return { x, y, w: Math.max(g.start.x, g.end.x, g.mid.x) - x, h: Math.max(g.start.y, g.end.y, g.mid.y) - y };
}

export function selectionBounds(ids: string[], byId: Map<string, BoardObject>): Rect | null {
  const rects = ids.map((id) => byId.get(id)).filter(Boolean).map((o) => objectBounds(o!, byId)).filter(Boolean) as Rect[];
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

const CLIP = 'pragmatic/objects:';
export const serialize = (objs: BoardObject[]) => CLIP + JSON.stringify(objs);
export const deserialize = (text: string): BoardObject[] | null => {
  if (!text.startsWith(CLIP)) return null;
  try { return JSON.parse(text.slice(CLIP.length)); } catch { return null; }
};

export type Guides = { x: number[]; y: number[] };

// Snap a moving rectangle to the edges and centers of other boxes.
export function snapRect(r: Rect, others: Rect[], zoom: number): { dx: number; dy: number; guides: Guides } {
  const tol = 6 / zoom;
  const xs = [r.x, r.x + r.w / 2, r.x + r.w], ys = [r.y, r.y + r.h / 2, r.y + r.h];
  let bestX: { d: number; line: number } | null = null, bestY: { d: number; line: number } | null = null;
  for (const o of others) {
    for (const line of [o.x, o.x + o.w / 2, o.x + o.w]) for (const v of xs) {
      const d = line - v;
      if (Math.abs(d) <= tol && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, line };
    }
    for (const line of [o.y, o.y + o.h / 2, o.y + o.h]) for (const v of ys) {
      const d = line - v;
      if (Math.abs(d) <= tol && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, line };
    }
  }
  return { dx: bestX?.d ?? 0, dy: bestY?.d ?? 0, guides: { x: bestX ? [bestX.line] : [], y: bestY ? [bestY.line] : [] } };
}

export { bounds };
