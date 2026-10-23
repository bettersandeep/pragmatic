import * as Y from 'yjs';
import type { BoardObject } from './model.ts';
import { applyTextDiff, plainOf, richToJSON, setPlain, setRich, plainToJSON, type RichJSON } from './richtext.ts';

// One Y.Map per object, so two people changing different fields of the same object both win.
export const objectsOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('objects');
// Mermaid requests from Claude. They need a DOM to lay out, so an open tab converts them.
export const pendingOf = (doc: Y.Doc) => doc.getMap<string>('pending');

export type Patch = { id: string } & Record<string, unknown>;

// An object as plain data. A rich text field gives its plain text, and its formatting under `rich`.
export function objectJSON(m: Y.Map<unknown>): BoardObject {
  const o: Record<string, unknown> = {};
  let rich: Record<string, RichJSON> | undefined;
  for (const [k, v] of m) {
    if (v instanceof Y.XmlFragment) { o[k] = plainOf(v); (rich ??= {})[k] = richToJSON(v); }
    else o[k] = v instanceof Y.AbstractType ? v.toJSON() : v;
  }
  if (rich) o.rich = rich;
  return o as BoardObject;
}

export const readObjects = (doc: Y.Doc): BoardObject[] =>
  [...objectsOf(doc).values()].map(objectJSON).sort((a, b) => a.z - b.z);

export const maxZ = (doc: Y.Doc) => Math.max(0, ...[...objectsOf(doc).values()].map((m) => (m.get('z') as number) ?? 0));

// Rich text (bold, lists, links, mentions; a Y.XmlFragment edited with ProseMirror): the text of shapes,
// stickies and text objects, and mind map nodes (t.<node>).
export const isRichField = (type: unknown, key: string) =>
  (key === 'text' && (type === 'shape' || type === 'sticky' || type === 'text')) || (type === 'mindmap' && key.startsWith('t.'));
// Other text people type is shared plain text (Y.Text): two people typing in the same box both keep every character.
// Titles of sections, frames, stacks and links stay plain strings; they are short and rarely edited together.
export const isTextField = (type: unknown, key: string) =>
  !isRichField(type, key) && ((key === 'text' && type !== 'mindmap' && type !== 'table') || (type === 'task' && (key === 'title' || key === 'desc'))
  || (type === 'table' && key.startsWith('c.')));

export { applyTextDiff } from './richtext.ts';

// The shared text of a field, made from the plain string the first time it is edited.
export function textOf(doc: Y.Doc, id: string, key: string, origin?: unknown): Y.Text | null {
  const m = objectsOf(doc).get(id);
  if (!m || !isTextField(m.get('type'), key)) return null;
  const v = m.get(key);
  if (v instanceof Y.Text) return v;
  // A mind map node's shared text starts from the text in its node record.
  const start = typeof v === 'string' ? v : key.startsWith('t.') ? ((m.get(`n.${key.slice(2)}`) as { text?: string } | undefined)?.text ?? '') : '';
  const t = new Y.Text(start);
  doc.transact(() => m.set(key, t), origin);
  return t;
}

// The rich text of a field, made from its plain text the first time it is edited (boards from before rich text
// hold a Y.Text or a string there). ponytail: two people opening the same old field at once both convert it and
// one conversion wins; the editor rebinds to the winner (web/src/engine/ObjectView.tsx RichField).
export function richOf(doc: Y.Doc, id: string, key: string, origin?: unknown): Y.XmlFragment | null {
  const m = objectsOf(doc).get(id);
  if (!m || !isRichField(m.get('type'), key)) return null;
  const v = m.get(key);
  if (v instanceof Y.XmlFragment) return v;
  const plain = v instanceof Y.Text ? v.toString() : typeof v === 'string' ? v
    : key.startsWith('t.') ? ((m.get(`n.${key.slice(2)}`) as { text?: string } | undefined)?.text ?? '') : '';
  const f = new Y.XmlFragment();
  doc.transact(() => { m.set(key, f); setRich(f, plainToJSON(plain)); }, origin);
  return f;
}

// Replace the content of one XML fragment (doc blocks, a card description) with a copy of another's.
export function copyFragment(from: Y.XmlFragment, to: Y.XmlFragment) {
  to.delete(0, to.length);
  to.insert(0, from.toArray().map((n) => (n as Y.XmlElement).clone()));
}

// A copy of a field value for another document (Y types belong to one document).
export const portable = (v: unknown) => (v instanceof Y.AbstractType ? (v as Y.Text).clone() : v);

// A new connector between two objects sits just below the lower of them, like Whimsical, so lines pass under
// shapes instead of over their text. Arrange can still bring it forward later.
function connectorZ(o: BoardObject, batch: Map<string, BoardObject>, map: Y.Map<Y.Map<unknown>>): number {
  if (o.type !== 'connector') return o.z;
  const zOf = (id?: string) => (id ? (batch.get(id)?.z ?? (map.get(id)?.get('z') as number | undefined)) : undefined);
  const ends = [zOf(o.from.id), zOf(o.to.id)].filter((z): z is number => z !== undefined);
  return ends.length ? Math.min(...ends) - 0.5 : o.z;
}

export function addObjects(doc: Y.Doc, objs: BoardObject[], origin?: unknown) {
  doc.transact(() => {
    const map = objectsOf(doc), batch = new Map(objs.map((o) => [o.id, o]));
    for (const raw of objs) {
      const { rich, ...o } = { ...raw, z: connectorZ(raw, batch, map) } as BoardObject;
      const m = new Y.Map<unknown>();
      map.set(o.id, m);
      for (const [k, v] of Object.entries(o)) {
        if (v === undefined) continue;
        if (typeof v === 'string' && isRichField(o.type, k)) { const f = new Y.XmlFragment(); m.set(k, f); setRich(f, rich?.[k] ?? plainToJSON(v)); }
        else m.set(k, typeof v === 'string' && isTextField(o.type, k) ? new Y.Text(v) : v);
      }
    }
  }, origin);
}

// Writes only fields that changed; `undefined` removes a field.
export function updateObjects(doc: Y.Doc, patches: Patch[], origin?: unknown) {
  doc.transact(() => {
    const map = objectsOf(doc);
    for (const { id, ...fields } of patches) {
      const m = map.get(id);
      if (!m) continue;
      const rich = (fields as { rich?: Record<string, RichJSON> }).rich;
      for (const [k, v] of Object.entries(fields)) {
        if (k === 'rich') continue;
        const cur = m.get(k);
        if (cur instanceof Y.XmlFragment && typeof v === 'string') { if (rich?.[k]) setRich(cur, rich[k]); else setPlain(cur, v); }
        else if (cur instanceof Y.Text && typeof v === 'string') applyTextDiff(cur, v);
        else if (v === undefined) m.delete(k);
        else if (JSON.stringify(m.get(k)) !== JSON.stringify(v)) m.set(k, v);
      }
    }
  }, origin);
}

// Deleting an object also deletes connectors bound to it. Returns every deleted id.
export function deleteObjects(doc: Y.Doc, ids: string[], origin?: unknown): string[] {
  const map = objectsOf(doc);
  const gone = new Set(ids.filter((id) => map.has(id)));
  // A task stack takes its cards with it.
  for (const [id, m] of map) if (m.get('type') === 'task' && gone.has(m.get('stack') as string)) gone.add(id);
  for (const [id, m] of map) {
    if (m.get('type') !== 'connector') continue;
    const from = m.get('from') as { id?: string }, to = m.get('to') as { id?: string };
    if ((from.id && gone.has(from.id)) || (to.id && gone.has(to.id))) gone.add(id);
  }
  doc.transact(() => gone.forEach((id) => map.delete(id)), origin);
  return [...gone];
}

// Plain text of rich-text parts (doc blocks, card descriptions): the XML without its tags.
const fragmentText = (f: Y.XmlFragment) => f.toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Plain text of a board or doc, for search.
export const searchText = (doc: Y.Doc) => [fragmentText(doc.getXmlFragment('blocks')), boardText(doc)].filter(Boolean).join('\n');
const boardText = (doc: Y.Doc) =>
  readObjects(doc).map((o) => ['title', 'text', 'desc', 'url'].map((k) => (k in o ? (o as Record<string, unknown>)[k] : '') ?? '').join(' ')).join('\n').replace(/\s+\n/g, '\n').trim();
