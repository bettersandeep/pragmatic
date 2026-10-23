// Excalidraw elements (from .excalidraw files or @excalidraw/mermaid-to-excalidraw output)
// -> pragmatic board objects.
import { FONT_SIZES, NEUTRAL, PALETTE, newId, type BoardObject, type ColorName, type FontSize, type Route } from './model.ts';

type El = Record<string, any>;

const rgb = (hex: string) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};


// Nearest palette color by RGB distance; grays and unknowns fall back to `fallback`.
export function nearestColor(hex: string | undefined, fallback: ColorName): ColorName {
  if (!hex || !/^#[0-9a-f]{3,8}$/i.test(hex)) return fallback;
  const [r, g, b] = rgb(hex);
  if (Math.max(r, g, b) - Math.min(r, g, b) < 24) return fallback; // grayscale
  let best = fallback, dist = Infinity;
  for (const [name, c] of Object.entries(PALETTE) as [ColorName, (typeof PALETTE)[ColorName]][]) {
    if (NEUTRAL.has(name)) continue; // a colored input maps to a colored palette entry
    for (const ref of [c.base, c.fill]) {
      const [R, G, B] = rgb(ref);
      const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2;
      if (d < dist) { dist = d; best = name; }
    }
  }
  return best;
}

export const nearestFontSize = (px: number | undefined): FontSize =>
  (Object.entries(FONT_SIZES) as [FontSize, number][]).reduce((best, [k, v]) =>
    Math.abs(v - (px ?? 18)) < Math.abs(FONT_SIZES[best] - (px ?? 18)) ? k : best, 'm' as FontSize);

const transparent = (c: string | undefined) => !c || c === 'transparent' || /^#[0-9a-f]{6}00$/i.test(c);

export function fromExcalidraw(elements: El[], { z0 = 1, boundRoute = 'straight' as Route } = {}): BoardObject[] {
  const live = elements.filter((e) => !e.isDeleted);
  const labelOf = new Map<string, string>();
  for (const e of live) if (e.type === 'text' && e.containerId) labelOf.set(e.containerId, e.originalText ?? e.text ?? '');
  const ids = new Map<string, string>();
  const byRef = new Map(live.map((e) => [e.id, e]));
  const out: BoardObject[] = [];
  let z = z0;

  for (const e of live) {
    const text = e.label?.text ?? labelOf.get(e.id) ?? '';
    const box = { x: e.x ?? 0, y: e.y ?? 0, w: e.width ?? 160, h: e.height ?? 72 };
    if (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond') {
      const id = newId();
      ids.set(e.id, id);
      const filled = !transparent(e.backgroundColor);
      out.push({
        id, z: z++, type: 'shape', ...box, shape: e.type === 'ellipse' ? 'oval' : e.type === 'diamond' ? 'diamond' : 'rect',
        color: nearestColor(filled ? e.backgroundColor : e.strokeColor, 'white'), deco: e.strokeStyle === 'dashed' ? 'dash' : 'outline',
        text, fontSize: nearestFontSize(e.label?.fontSize ?? 18), align: 'center',
      });
    } else if (e.type === 'text' && !e.containerId) {
      const id = newId();
      ids.set(e.id, id);
      const t = e.originalText ?? e.text ?? '';
      const lines = t.split('\n');
      out.push({
        id, z: z++, type: 'text', x: box.x, y: box.y,
        w: e.width ?? Math.max(...lines.map((l: string) => l.length)) * (e.fontSize ?? 18) * 0.6 + 8,
        h: e.height ?? lines.length * (e.fontSize ?? 18) * 1.35,
        text: t, color: nearestColor(e.strokeColor, 'default'), fontSize: nearestFontSize(e.fontSize), align: e.textAlign ?? 'left',
      });
    } else if (e.type === 'frame') {
      const id = newId();
      ids.set(e.id, id);
      out.push({ id, z: z++, type: 'section', ...box, title: e.name ?? 'Section', color: 'light-gray', deco: 'outline' });
    }
  }

  // Second pass: connectors, now that shape ids are known.
  for (const e of live) {
    if (e.type !== 'arrow' && e.type !== 'line') continue;
    const pts: number[][] = e.points?.length ? e.points : [[0, 0], [e.width ?? 100, e.height ?? 0]];
    const fromRef = e.startBinding?.elementId ?? e.start?.id, toRef = e.endBinding?.elementId ?? e.end?.id;
    const p0 = { x: e.x + pts[0][0], y: e.y + pts[0][1] }, p1 = { x: e.x + pts.at(-1)![0], y: e.y + pts.at(-1)![1] };
    // Keep a binding only when the end really touches the shape. Sequence-diagram messages are
    // "bound" to the actor header but sit far below it, so they stay free at their own height.
    const touches = (ref: string | undefined, p: { x: number; y: number }) => {
      const el = ref ? byRef.get(ref) : undefined, pad = 16;
      return !!el && ids.has(ref!) && p.x >= el.x - pad && p.x <= el.x + (el.width ?? 0) + pad && p.y >= el.y - pad && p.y <= el.y + (el.height ?? 0) + pad;
    };
    const from = touches(fromRef, p0) ? { id: ids.get(fromRef)! } : p0;
    const to = touches(toRef, p1) ? { id: ids.get(toRef)! } : p1;
    out.push({
      id: newId(), z: z++, type: 'connector', from, to,
      route: e.elbowed ? 'elbow' : 'id' in from || 'id' in to ? boundRoute : 'straight',
      startCap: e.startArrowhead ? 'arrow' : 'none',
      endCap: e.type === 'line' ? (e.endArrowhead ? 'arrow' : 'none') : e.endArrowhead === null ? 'none' : 'arrow',
      color: nearestColor(e.strokeColor, 'silver'), dash: e.strokeStyle === 'dashed' || e.strokeStyle === 'dotted',
      text: e.label?.text ?? labelOf.get(e.id) ?? '',
    });
  }
  return out;
}
