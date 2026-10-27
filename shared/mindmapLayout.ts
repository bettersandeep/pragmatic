import { BRANCH_COLORS, FONT_SIZES, mindmapNodes, type ColorName, type MindmapObj, type MNode } from './model.ts';
import type { RichJSON } from './richtext.ts';

// `rich`: the node's formatting, when it has any; a measure with a DOM uses it, the estimate below does not.
export type Measure = (text: string, px: number, weight: number, maxW: number, rich?: RichJSON) => { w: number; h: number };

export type LaidNode = {
  id: string; text: string; depth: number; color: ColorName; collapsed: boolean; hidden: number;
  icon?: string; iconDeco?: MNode['iconDeco']; rich?: RichJSON;
  x: number; y: number; w: number; h: number; // relative to the map's top-left
};
export type LaidEdge = { from: string; to: string; d: string; color: ColorName; dash: boolean };
// An icon before a node's text: its size for a font size, and the gap after it.
export const nodeIcon = (px: number) => ({ size: Math.round(px * 1.25), gap: 6 });
export type Layout = { nodes: Map<string, LaidNode>; edges: LaidEdge[]; w: number; h: number; rootId: string; rx: number; ry: number };

const HGAP = 56, VGAP = 10, VGAP_V = 56, HGAP_V = 20, PAD_X = 10, PAD_Y = 8, MAX_W = 300, BORDER = 6;

export type Tree = { id: string; node: MNode; children: Tree[] };

// Rebuild the tree from the flat `n.<id>` fields. Orphans (parent deleted) are dropped.
export function buildTree(o: MindmapObj): Tree | null {
  const all = mindmapNodes(o);
  const kids = new Map<string | null, [string, MNode][]>();
  for (const [id, n] of all) kids.set(n.parent, [...(kids.get(n.parent) ?? []), [id, n]]);
  const root = kids.get(null)?.sort((a, b) => a[1].order - b[1].order)[0];
  if (!root) return null;
  const make = ([id, node]: [string, MNode], seen: Set<string>): Tree => {
    seen.add(id);
    const children = (kids.get(id) ?? []).filter(([c]) => !seen.has(c)).sort((a, b) => a[1].order - b[1].order).map((c) => make(c, seen));
    return { id, node, children };
  };
  return make(root, new Set());
}

const count = (t: Tree): number => t.children.reduce((s, c) => s + 1 + count(c), 0);

export function layoutMindmap(o: MindmapObj, measure: Measure): Layout | null {
  const tree = buildTree(o);
  if (!tree) return null;
  const nodes = new Map<string, LaidNode>();
  const edges: LaidEdge[] = [];
  const base = FONT_SIZES[o.fontSize ?? 'm'];
  const vertical = o.layout === 'vertical';

  // Sizes first.
  const size = new Map<string, { w: number; h: number }>();
  const sizeOf = (t: Tree, depth: number) => {
    const px = depth === 0 ? Math.round(base * 1.2) : base;
    const ic = t.node.icon ? nodeIcon(px) : null;
    const m = measure(t.node.text || ' ', px, depth === 0 ? 600 : 500, MAX_W - (ic ? ic.size + ic.gap : 0), o.rich?.[`t.${t.id}`]);
    // + BORDER: node borders sit inside the box (border-box); a little slack absorbs canvas-vs-DOM rounding.
    const w = m.w + (ic ? ic.size + ic.gap : 0), h = Math.max(m.h, ic?.size ?? 0);
    size.set(t.id, { w: Math.max(depth === 0 ? 80 : 40, w + PAD_X * 2 + BORDER), h: h + PAD_Y * 2 + BORDER });
    if (!t.node.collapsed) t.children.forEach((c) => sizeOf(c, depth + 1));
  };
  sizeOf(tree, 0);

  // Extent of each subtree across the growth direction.
  const span = new Map<string, number>();
  const spanOf = (t: Tree): number => {
    const s = size.get(t.id)!;
    const own = vertical ? s.w : s.h;
    const kids = t.node.collapsed ? [] : t.children;
    const sum = kids.reduce((a, c) => a + spanOf(c), 0) + (vertical ? HGAP_V : VGAP) * Math.max(0, kids.length - 1);
    span.set(t.id, Math.max(own, sum));
    return span.get(t.id)!;
  };
  spanOf(tree);

  const place = (t: Tree, depth: number, main: number, cross: number, color: ColorName) => {
    const s = size.get(t.id)!, sp = span.get(t.id)!;
    const x = vertical ? cross + (sp - s.w) / 2 : main;
    const y = vertical ? main : cross + (sp - s.h) / 2;
    nodes.set(t.id, {
      id: t.id, text: t.node.text, depth, color, collapsed: !!t.node.collapsed, hidden: t.node.collapsed ? count(t) : 0,
      icon: t.node.icon, iconDeco: t.node.iconDeco, rich: o.rich?.[`t.${t.id}`], x, y, w: s.w, h: s.h,
    });
    if (t.node.collapsed) return;
    const kids = t.children;
    const total = kids.reduce((a, c) => a + span.get(c.id)!, 0) + (vertical ? HGAP_V : VGAP) * Math.max(0, kids.length - 1);
    let c = cross + (sp - total) / 2;
    kids.forEach((k, i) => {
      const kc = k.node.color ?? (depth === 0 ? BRANCH_COLORS[i % BRANCH_COLORS.length] : color);
      place(k, depth + 1, vertical ? y + s.h + VGAP_V : x + s.w + HGAP, c, kc);
      c += span.get(k.id)! + (vertical ? HGAP_V : VGAP);
    });
  };
  place(tree, 0, 0, 0, tree.node.color ?? 'default');

  // Edges: in a horizontal map each line runs on as the child's underline (Whimsical style), so a branch is one
  // stroke with no seam; it sits 1px above the box bottom, where the node's 2px border keeps room. Vertical maps
  // join box edges.
  for (const n of nodes.values()) {
    if (n.depth === 0) continue;
    const parentId = o[`n.${n.id}`]?.parent;
    const p = parentId ? nodes.get(parentId) : undefined;
    if (!p) continue;
    let a: { x: number; y: number }, b: { x: number; y: number };
    if (vertical) { a = { x: p.x + p.w / 2, y: p.y + p.h }; b = { x: n.x + n.w / 2, y: n.y }; }
    else { a = { x: p.x + p.w, y: p.depth === 0 ? p.y + p.h / 2 : p.y + p.h - 1 }; b = { x: n.x, y: n.y + n.h - 1 }; }
    let d: string;
    if (o.edge === 'angular') d = vertical
      ? `M${a.x},${a.y} V${(a.y + b.y) / 2} H${b.x} V${b.y}`
      : `M${a.x},${a.y} H${(a.x + b.x) / 2} V${b.y} H${b.x + n.w}`;
    else {
      const k = vertical ? (b.y - a.y) / 2 : (b.x - a.x) / 2;
      d = vertical ? `M${a.x},${a.y} C${a.x},${a.y + k} ${b.x},${b.y - k} ${b.x},${b.y}` : `M${a.x},${a.y} C${a.x + k},${a.y} ${b.x - k},${b.y} ${b.x},${b.y} H${b.x + n.w}`;
    }
    edges.push({ from: p.id, to: n.id, d, color: n.color, dash: !!o[`n.${n.id}`]?.dash });
  }

  let maxX = 0, maxY = 0;
  for (const n of nodes.values()) { maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h); }
  const root = nodes.get(tree.id)!;
  return { nodes, edges, w: Math.ceil(maxX), h: Math.ceil(maxY), rootId: tree.id, rx: root.x, ry: root.y };
}

// Character-count estimate, for the server where no font metrics exist.
export const estimateMeasure: Measure = (text, px, _weight, maxW) => {
  const lines = text.split('\n').flatMap((l) => {
    const perLine = Math.max(1, Math.floor(maxW / (px * 0.55)));
    return l.length > perLine ? Array.from({ length: Math.ceil(l.length / perLine) }, (_, i) => l.slice(i * perLine, (i + 1) * perLine)) : [l];
  });
  return { w: Math.min(maxW, Math.max(...lines.map((l) => l.length)) * px * 0.55), h: lines.length * px * 1.3 };
};
