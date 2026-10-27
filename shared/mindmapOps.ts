// Mind map edits as field patches (`n.<id>` keys), usable with updateObjects on any client or the server.
import { newId, type MindmapObj, type MNode } from './model.ts';
import { buildTree, estimateMeasure, layoutMindmap, type Tree } from './mindmapLayout.ts';
import { parseOutline, type OutlineNode } from './mindmap.ts';

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

// ⌥↑ / ⌥↓: the node swaps places with the sibling before (-1) or after (1) it. Null at either end.
export function moveNode(o: MindmapObj, nodeId: string, delta: -1 | 1): Patch | null {
  const n = node(o, nodeId);
  if (!n || n.parent === null) return null;
  const sibs = siblings(o, n.parent), other = sibs[sibs.findIndex(([id]) => id === nodeId) + delta];
  if (!other) return null;
  return { id: o.id, [key(nodeId)]: { ...o[key(nodeId)], order: other[1].order }, [key(other[0])]: { ...o[key(other[0])], order: n.order } };
}

// ⇧⌘/: fold every branch under the node, or unfold them all when all are folded. The node itself opens.
export function foldAll(o: MindmapObj, nodeId: string): Patch | null {
  const inner: string[] = [];
  const walk = (t: Tree) => t.children.forEach((c) => { if (c.children.length) { inner.push(c.id); walk(c); } });
  const t = subtree(o, nodeId);
  if (t) walk(t);
  if (!inner.length) return null;
  const fold = inner.some((id) => !o[key(id)].collapsed);
  const patch: Patch = { id: o.id, [key(nodeId)]: { ...o[key(nodeId)], collapsed: false } };
  for (const id of inner) patch[key(id)] = { ...o[key(id)], collapsed: fold };
  return patch;
}

// Pasted or imported outline trees as the last children of a node.
export function addTrees(o: MindmapObj, parentId: string, trees: OutlineNode[]): Patch | null {
  const parent = o[key(parentId)];
  if (!parent || !trees.length) return null;
  const patch: Patch = { id: o.id, ...(parent.collapsed ? { [key(parentId)]: { ...parent, collapsed: false } } : {}) };
  const add = (t: OutlineNode, p: string, order: number) => {
    const id = newId();
    patch[key(id)] = { text: t.text, parent: p, order };
    t.children.forEach((c, i) => add(c, id, i + 1));
  };
  const last = siblings(o, parentId).at(-1)?.[1].order ?? 0;
  trees.forEach((t, i) => add(t, parentId, last + i + 1));
  return patch;
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

const subtree = (o: MindmapObj, nodeId: string): Tree | null => {
  const find = (t: Tree): Tree | null => (t.id === nodeId ? t : t.children.map(find).find(Boolean) ?? null);
  const t = buildTree(o);
  return t && find(t);
};

// The map, or the branch from `nodeId`, as an indented outline.
export function toOutline(o: MindmapObj, withIds = false, nodeId?: string): string {
  const tree = nodeId ? subtree(o, nodeId) : buildTree(o);
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
export const mindmapFromOutline = (src: string, at: { x: number; y: number }, z: number, layout: MindmapObj['layout'] = 'horizontal') =>
  mindmapFromTree(parseOutline(src), at, z, layout);

export function mindmapFromTree(root: OutlineNode, at: { x: number; y: number }, z: number, layout: MindmapObj['layout'] = 'horizontal'): MindmapObj {
  const o = { id: newId(), z, type: 'mindmap', x: at.x, y: at.y, w: 0, h: 0, rx: 0, ry: 0, layout, edge: 'curvy', fontSize: 'm' } as MindmapObj;
  const add = (t: OutlineNode, parent: string | null, order: number) => {
    const id = newId();
    (o as Record<string, unknown>)[key(id)] = { text: t.text, parent, order };
    t.children.forEach((c, i) => add(c, id, i + 1));
  };
  add(root, null, 0);
  const l = layoutMindmap(o, estimateMeasure);
  if (l) Object.assign(o, { w: l.w, h: l.h, rx: l.rx, ry: l.ry });
  return o;
}
