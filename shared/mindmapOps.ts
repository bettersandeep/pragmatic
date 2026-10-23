// Mind map edits as field patches (`n.<id>` keys), usable with updateObjects on any client or the server.
import { newId, type MindmapObj, type MNode } from './model.ts';
import { buildTree, estimateMeasure, layoutMindmap, type Tree } from './mindmapLayout.ts';
import { parseOutline } from './mindmap.ts';

export type Patch = { id: string } & Record<string, unknown>;
const key = (id: string) => `n.${id}` as const;
const node = (o: MindmapObj, id: string): MNode | undefined => { const n = o[key(id)], t = o[`t.${id}`]; return n && typeof t === 'string' ? { ...n, text: t } : n; };
const siblings = (o: MindmapObj, parent: string | null) =>
  Object.entries(o).filter(([k, v]) => k.startsWith('n.') && v && (v as MNode).parent === parent).map(([k, v]) => [k.slice(2), v as MNode] as const).sort((a, b) => a[1].order - b[1].order);

export function addChild(o: MindmapObj, parentId: string, text = ''): { patch: Patch; nodeId: string } {
  const last = siblings(o, parentId).at(-1);
  const nodeId = newId();
  const parent = node(o, parentId);
  return { nodeId, patch: { id: o.id, [key(nodeId)]: { text, parent: parentId, order: (last?.[1].order ?? 0) + 1 }, ...(parent?.collapsed ? { [key(parentId)]: { ...parent, collapsed: false } } : {}) } };
}

export function addSibling(o: MindmapObj, nodeId: string, before = false, text = ''): { patch: Patch; nodeId: string } | null {
  const n = node(o, nodeId);
  if (!n || n.parent === null) return null; // the root has no siblings
  const sibs = siblings(o, n.parent);
  const i = sibs.findIndex(([id]) => id === nodeId);
  const other = before ? sibs[i - 1] : sibs[i + 1];
  const order = other ? (n.order + other[1].order) / 2 : n.order + (before ? -1 : 1);
  const id = newId();
  return { nodeId: id, patch: { id: o.id, [key(id)]: { text, parent: n.parent, order } } };
}

// New node between `nodeId` and its parent.
export function addParent(o: MindmapObj, nodeId: string, text = ''): { patch: Patch; nodeId: string } | null {
  const n = node(o, nodeId);
  if (!n || n.parent === null) return null;
  const id = newId();
  return { nodeId: id, patch: { id: o.id, [key(id)]: { text, parent: n.parent, order: n.order, color: n.color }, [key(nodeId)]: { ...n, parent: id, order: 1 } } };
}

export function deleteNode(o: MindmapObj, nodeId: string): Patch | null {
  const n = node(o, nodeId);
  if (!n || n.parent === null) return null; // delete the whole map instead
  const patch: Patch = { id: o.id };
  const drop = (id: string) => { patch[key(id)] = undefined; patch[`t.${id}`] = undefined; siblings(o, id).forEach(([c]) => drop(c)); };
  drop(nodeId);
  return patch;
}

export const setNode = (o: MindmapObj, nodeId: string, fields: Partial<MNode>): Patch | null => {
  const n = node(o, nodeId);
  // Text also goes to the node's shared text, so live editors and other writers (MCP) agree.
  return n ? { id: o.id, [key(nodeId)]: { ...n, ...fields }, ...(fields.text !== undefined && { [`t.${nodeId}`]: fields.text }) } : null;
};

// Indent: the node becomes the last child of the sibling above it (⌘⌃]). Null when there is none.
export function indentNode(o: MindmapObj, nodeId: string): Patch | null {
  const n = node(o, nodeId);
  if (!n || n.parent === null) return null;
  const sibs = siblings(o, n.parent), i = sibs.findIndex(([id]) => id === nodeId);
  const above = sibs[i - 1];
  if (!above) return null;
  const last = siblings(o, above[0]).at(-1);
  return { id: o.id, [key(nodeId)]: { ...o[key(nodeId)], parent: above[0], order: (last?.[1].order ?? 0) + 1 }, ...(above[1].collapsed ? { [key(above[0])]: { ...o[key(above[0])], collapsed: false } } : {}) };
}

// Outdent: the node moves up a level, right after its parent (⌘⌃[). Null for the root and its children.
export function outdentNode(o: MindmapObj, nodeId: string): Patch | null {
  const n = node(o, nodeId), p = n?.parent ? node(o, n.parent) : undefined;
  if (!n || !p || p.parent === null) return null;
  const sibs = siblings(o, p.parent), i = sibs.findIndex(([id]) => id === n.parent);
  const next = sibs[i + 1];
  return { id: o.id, [key(nodeId)]: { ...o[key(nodeId)], parent: p.parent, order: next ? (p.order + next[1].order) / 2 : p.order + 1 } };
}

// Neighbours for arrow-key navigation, in screen terms for a horizontal map.
export function neighbour(o: MindmapObj, nodeId: string, dir: 'parent' | 'child' | 'prev' | 'next'): string | null {
  const n = node(o, nodeId);
  if (!n) return null;
  if (dir === 'parent') return n.parent;
  if (dir === 'child') return n.collapsed ? null : siblings(o, nodeId)[0]?.[0] ?? null;
  const sibs = siblings(o, n.parent);
  const i = sibs.findIndex(([id]) => id === nodeId);
  return sibs[dir === 'prev' ? i - 1 : i + 1]?.[0] ?? null;
}

export function toOutline(o: MindmapObj, withIds = false): string {
  const tree = buildTree(o);
  if (!tree) return '';
  const lines: string[] = [];
  const walk = (t: Tree, d: number) => {
    lines.push(`${'  '.repeat(d)}${t.node.text}${withIds ? `  [${t.id}]` : ''}`);
    t.children.forEach((c) => walk(c, d + 1));
  };
  walk(tree, 0);
  return lines.join('\n');
}

// A live mind map object from an indented outline. Size is estimated; the browser corrects it.
export function mindmapFromOutline(src: string, at: { x: number; y: number }, z: number, layout: MindmapObj['layout'] = 'horizontal'): MindmapObj {
  const root = parseOutline(src);
  const o = { id: newId(), z, type: 'mindmap', x: at.x, y: at.y, w: 0, h: 0, rx: 0, ry: 0, layout, edge: 'curvy', fontSize: 'm' } as MindmapObj;
  const add = (t: { text: string; children: { text: string; children: unknown[] }[] }, parent: string | null, order: number) => {
    const id = newId();
    (o as Record<string, unknown>)[key(id)] = { text: t.text, parent, order };
    t.children.forEach((c, i) => add(c as never, id, i + 1));
  };
  add(root as never, null, 0);
  const l = layoutMindmap(o, estimateMeasure);
  if (l) Object.assign(o, { w: l.w, h: l.h, rx: l.rx, ry: l.ry });
  return o;
}
