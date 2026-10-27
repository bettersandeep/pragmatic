import * as Y from 'yjs';

// Rich text of board objects: a Y.XmlFragment in ProseMirror's shape (the web editor binds it with y-prosemirror).
// Blocks: paragraph, bullet_list / ordered_list > list_item > paragraph. Inline: text, hard_break, mention {id, label}.
// Marks are attributes on the text, named like the ProseMirror marks: bold, italic, underline, strike, link {href}.
// Everything here works on the Yjs data alone, so the server, MCP and tests need no editor.
export const MARKS = ['bold', 'italic', 'underline', 'strike', 'link'] as const;
export type Mark = (typeof MARKS)[number];
export type ListKind = 'bullet_list' | 'ordered_list';

export const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// Only web and mail links; anything else (javascript:, data:) is not a link.
export const safeHref = (href: unknown) => (typeof href === 'string' && /^(https?:\/\/|mailto:)/i.test(href.trim()) ? href.trim() : null);

type Inline = { text: string; marks?: Record<string, unknown> } | { br: true } | { mention: { id: string; label: string } };
type Block = { p: Inline[] } | { list: ListKind; items: Block[][] };
// A plain JSON copy of rich text (clipboard, templates, tests).
export type RichJSON = Block[];

const kids = (n: Y.XmlFragment | Y.XmlElement) => n.toArray() as (Y.XmlElement | Y.XmlText)[];

function inlineOf(p: Y.XmlElement): Inline[] {
  const out: Inline[] = [];
  for (const c of kids(p)) {
    if (c instanceof Y.XmlText) {
      for (const d of c.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[])
        if (typeof d.insert === 'string') out.push(d.attributes && Object.keys(d.attributes).length ? { text: d.insert, marks: d.attributes } : { text: d.insert });
    } else if (c.nodeName === 'hard_break') out.push({ br: true });
    else if (c.nodeName === 'mention') out.push({ mention: { id: String(c.getAttribute('id') ?? ''), label: String(c.getAttribute('label') ?? '') } });
  }
  return out;
}

function blockOf(el: Y.XmlElement): Block | null {
  if (el.nodeName === 'paragraph') return { p: inlineOf(el) };
  if (el.nodeName === 'bullet_list' || el.nodeName === 'ordered_list')
    return { list: el.nodeName, items: kids(el).filter((li): li is Y.XmlElement => li instanceof Y.XmlElement).map((li) => kids(li).flatMap((b) => (b instanceof Y.XmlElement ? [blockOf(b)!].filter(Boolean) : []))) };
  return null;
}

export const richToJSON = (f: Y.XmlFragment): RichJSON => kids(f).flatMap((el) => (el instanceof Y.XmlElement ? [blockOf(el)].filter((b): b is Block => !!b) : []));

function inlineEls(inl: Inline[]): (Y.XmlText | Y.XmlElement)[] {
  const out: (Y.XmlText | Y.XmlElement)[] = [];
  let text: Y.XmlText | null = null, at = 0;
  for (const i of inl) {
    if ('text' in i) {
      if (!text) { text = new Y.XmlText(); at = 0; out.push(text); }
      text.insert(at, i.text, i.marks ?? {});
      at += i.text.length;
      continue;
    }
    text = null;
    const el = new Y.XmlElement('br' in i ? 'hard_break' : 'mention');
    if ('mention' in i) { el.setAttribute('id', i.mention.id); el.setAttribute('label', i.mention.label); }
    out.push(el);
  }
  return out;
}

function blockEl(b: Block): Y.XmlElement {
  if ('p' in b) { const p = new Y.XmlElement('paragraph'); p.insert(0, inlineEls(b.p)); return p; }
  const list = new Y.XmlElement(b.list);
  list.insert(0, (b.items.length ? b.items : [[{ p: [] }]]).map((blocks) => {
    const li = new Y.XmlElement('list_item');
    li.insert(0, (blocks.length ? blocks : [{ p: [] }]).map(blockEl));
    return li;
  }));
  return list;
}

// Replace the content of `f` (in one transaction when it is in a document).
export function setRich(f: Y.XmlFragment, json: RichJSON, origin?: unknown) {
  const run = () => { f.delete(0, f.length); f.insert(0, (json.length ? json : [{ p: [] }]).map(blockEl)); };
  if (f.doc) f.doc.transact(run, origin); else run();
}

// Turns `t` into `next` with one delete and one insert around the common prefix and suffix,
// so edits elsewhere in the text (by others) are kept. Works on Y.XmlText too (it is a Y.Text).
export function applyTextDiff(t: Y.Text, next: string, origin?: unknown) {
  // An XmlText's toString() carries its formatting as tags; the characters are in its delta.
  const cur = t instanceof Y.XmlText ? (t.toDelta() as { insert: unknown }[]).map((d) => (typeof d.insert === 'string' ? d.insert : '')).join('') : t.toString();
  if (cur === next) return;
  let a = 0;
  while (a < cur.length && a < next.length && cur[a] === next[a]) a++;
  let b = 0;
  while (b < cur.length - a && b < next.length - a && cur[cur.length - 1 - b] === next[next.length - 1 - b]) b++;
  const run = () => { if (cur.length - a - b) t.delete(a, cur.length - a - b); if (next.length - a - b) t.insert(a, next.slice(a, next.length - b)); };
  if (t.doc && origin !== undefined) t.doc.transact(run, origin); else run();
}

// Plain text into rich text with the smallest change: unchanged lines stay, one changed line is diffed in place
// (its formatting outside the change stays, and others' typing merges), other changes replace those lines.
// Content with lists, mentions or breaks is replaced whole.
export function setPlain(f: Y.XmlFragment, text: string, origin?: unknown) {
  const paras = kids(f);
  const simple = paras.every((p) => p instanceof Y.XmlElement && p.nodeName === 'paragraph' && kids(p).every((c) => c instanceof Y.XmlText));
  if (!simple || !paras.length) { if (plainOf(f) !== text) setRich(f, plainToJSON(text), origin); return; }
  const old = (paras as Y.XmlElement[]).map((p) => inlineOf(p).map((i) => ('text' in i ? i.text : '')).join('')), next = text.split('\n');
  let a = 0;
  while (a < old.length && a < next.length && old[a] === next[a]) a++;
  let b = 0;
  while (b < old.length - a && b < next.length - a && old[old.length - 1 - b] === next[next.length - 1 - b]) b++;
  const gone = old.length - a - b, added = next.slice(a, next.length - b);
  if (!gone && !added.length) return;
  const run = () => {
    if (gone === 1 && added.length === 1) {
      const p = paras[a] as Y.XmlElement, ts = kids(p) as Y.XmlText[];
      if (ts.length === 1) return applyTextDiff(ts[0], added[0]);
      p.delete(0, p.length);
      p.insert(0, inlineEls(added[0] ? [{ text: added[0] }] : []));
      return;
    }
    if (gone) f.delete(a, gone);
    f.insert(a, added.map((line) => blockEl({ p: line ? [{ text: line }] : [] })));
  };
  if (f.doc) f.doc.transact(run, origin); else run();
}

export const plainToJSON = (text: string): RichJSON => text.split('\n').map((line) => ({ p: line ? [{ text: line }] : [] }));

// Plain text: one line per paragraph or list item ("- " / "1. ", nested items indented), mentions as "@Name".
export function plainOf(f: Y.XmlFragment | RichJSON): string {
  const lines: string[] = [];
  const inline = (inl: Inline[]) => inl.map((i) => ('text' in i ? i.text : 'br' in i ? '\n' : `@${i.mention.label}`)).join('');
  const walk = (blocks: Block[], indent: string) => {
    for (const b of blocks) {
      if ('p' in b) { lines.push(indent + inline(b.p)); continue; }
      b.items.forEach((item, n) => {
        const mark = b.list === 'ordered_list' ? `${n + 1}. ` : '- ';
        item.forEach((inner, k) => {
          if ('p' in inner) lines.push(indent + (k === 0 ? mark : ' '.repeat(mark.length)) + inline(inner.p));
          else walk([inner], indent + '  ');
        });
      });
    }
  };
  walk(Array.isArray(f) ? f : richToJSON(f), '');
  return lines.join('\n');
}

const texts = (n: Y.XmlFragment | Y.XmlElement): Y.XmlText[] => kids(n).flatMap((c) => (c instanceof Y.XmlText ? [c] : texts(c)));

// Whole-object formatting (the context bar with an object selected but not being edited).
export function formatAll(f: Y.XmlFragment, mark: Mark, value: Record<string, unknown> | null, origin?: unknown) {
  const run = () => { for (const t of texts(f)) t.format(0, t.length, { [mark]: value }); };
  if (f.doc) f.doc.transact(run, origin); else run();
}
// True when every character has the mark (and there is text).
export function hasMarkEverywhere(f: Y.XmlFragment, mark: Mark) {
  const ops = texts(f).flatMap((t) => t.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]).filter((d) => typeof d.insert === 'string' && d.insert);
  return ops.length > 0 && ops.every((d) => d.attributes?.[mark] != null);
}

// Whole-object list toggle: every paragraph becomes an item of one list of `kind`; with null, lists become paragraphs.
export function setListAll(f: Y.XmlFragment, kind: ListKind | null, origin?: unknown) {
  const paras: Block[] = [];
  const flat = (blocks: Block[]) => { for (const b of blocks) { if ('p' in b) paras.push(b); else b.items.forEach(flat); } };
  flat(richToJSON(f));
  setRich(f, kind ? [{ list: kind, items: paras.map((p) => [p]) }] : paras, origin);
}
export const listKindOf = (f: Y.XmlFragment): ListKind | null => {
  const top = kids(f).filter((c): c is Y.XmlElement => c instanceof Y.XmlElement);
  return top.length && top.every((el) => el.nodeName === top[0].nodeName) && (top[0].nodeName === 'bullet_list' || top[0].nodeName === 'ordered_list') ? top[0].nodeName as ListKind : null;
};

// People mentioned in content that a change added (for notifications).
export function addedMentions(e: Y.YEvent<Y.AbstractType<unknown>>): string[] {
  const ids = new Set<string>();
  const visit = (n: unknown) => {
    if (n instanceof Y.XmlElement) {
      if (n.nodeName === 'mention' && n.getAttribute('id')) ids.add(String(n.getAttribute('id')));
      kids(n).forEach(visit);
    }
  };
  for (const item of e.changes.added) for (const c of item.content.getContent()) visit(c);
  return [...ids];
}

// The same questions on the JSON copy (no document needed, nothing converted): for the context bar's states.
const jsonTexts = (blocks: RichJSON): { text: string; marks?: Record<string, unknown> }[] =>
  blocks.flatMap((b) => ('p' in b ? b.p.filter((i): i is { text: string; marks?: Record<string, unknown> } => 'text' in i && !!i.text) : b.items.flatMap(jsonTexts)));
export const jsonHasMark = (blocks: RichJSON | undefined, mark: Mark) => { const t = blocks ? jsonTexts(blocks) : []; return t.length > 0 && t.every((i) => i.marks?.[mark] != null); };
export const jsonListKind = (blocks: RichJSON | undefined): ListKind | null =>
  blocks?.length && blocks.every((b) => 'list' in b && b.list === (blocks[0] as { list?: ListKind }).list) ? (blocks[0] as { list: ListKind }).list : null;
