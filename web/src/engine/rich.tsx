import { createPortal } from 'react-dom';
import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { Schema, type MarkType, type NodeType } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey, TextSelection, type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, chainCommands, exitCode, toggleMark } from 'prosemirror-commands';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import { inputRules, wrappingInputRule } from 'prosemirror-inputrules';
import { initProseMirrorDoc, ySyncPlugin } from 'y-prosemirror';
import { escapeHtml, safeHref, type ListKind, type Mark, type RichJSON } from '../../../shared/richtext.ts';
import { api, type Person } from '../api.ts';

// Rich text of board objects: ProseMirror on the object's Y.XmlFragment (see shared/richtext.ts for the data).
// Node and mark names match shared/richtext.ts, so the server and the whole-object commands read the same data.
export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
    bullet_list: { content: 'list_item+', group: 'block', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] },
    ordered_list: { content: 'list_item+', group: 'block', parseDOM: [{ tag: 'ol' }], toDOM: () => ['ol', 0] },
    list_item: { content: 'paragraph block*', defining: true, parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
    mention: {
      inline: true, group: 'inline', atom: true, selectable: false, attrs: { id: {}, label: {} },
      parseDOM: [{ tag: 'span.mention', getAttrs: (d) => ({ id: (d as HTMLElement).dataset.user, label: (d as HTMLElement).textContent?.replace(/^@/, '') }) }],
      toDOM: (n) => ['span', { class: 'mention', 'data-user': n.attrs.id }, `@${n.attrs.label}`],
    },
  },
  // Order = nesting order in the DOM (outermost first); the static view below nests the same way.
  marks: {
    link: {
      attrs: { href: {} }, inclusive: false,
      parseDOM: [{ tag: 'a[href]', getAttrs: (d) => (safeHref((d as HTMLElement).getAttribute('href')) ? { href: (d as HTMLElement).getAttribute('href') } : false) }],
      toDOM: (m) => ['a', { href: safeHref(m.attrs.href) ?? undefined, target: '_blank', rel: 'noopener noreferrer' }, 0],
    },
    bold: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
    italic: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
    underline: { parseDOM: [{ tag: 'u' }], toDOM: () => ['u', 0] },
    strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }], toDOM: () => ['s', 0] },
  },
});

// --- static view (not editing): React from the JSON copy, the same DOM as the editor --------------------------
type Inline = RichJSON[number] extends infer B ? (B extends { p: infer I } ? I extends (infer X)[] ? X : never : never) : never;
const MARK_TAGS: [Mark, (c: ReactNode, v: Record<string, unknown>) => ReactNode][] = [
  ['link', (c, v) => { const href = safeHref(v.href); return href ? <a href={href} title={href} target="_blank" rel="noopener noreferrer">{c}</a> : c; }],
  ['bold', (c) => <strong>{c}</strong>], ['italic', (c) => <em>{c}</em>], ['underline', (c) => <u>{c}</u>], ['strike', (c) => <s>{c}</s>],
];
function inlineView(inl: Inline[]) {
  return inl.map((i, k) => {
    if ('br' in i) return <br key={k} />;
    if ('mention' in i) return <span key={k} className="mention" data-user={i.mention.id}>@{i.mention.label}</span>;
    let node: ReactNode = i.text;
    for (const [m, wrap] of [...MARK_TAGS].reverse()) if (i.marks?.[m] != null) node = wrap(node, i.marks[m] as Record<string, unknown>);
    return <Fragment key={k}>{node}</Fragment>;
  });
}
function blocksView(blocks: RichJSON): ReactNode {
  return blocks.map((b, k) => {
    if ('p' in b) return <p key={k}>{b.p.length ? inlineView(b.p) : <br />}</p>;
    const L = b.list === 'ordered_list' ? 'ol' : 'ul';
    return <L key={k}>{b.items.map((item, n) => <li key={n}>{blocksView(item)}</li>)}</L>;
  });
}
export const RichView = ({ json }: { json: RichJSON }) => <>{blocksView(json)}</>;

// The same markup as HTML text, for measuring (measure.ts).
const esc = escapeHtml;
export function richHTML(blocks: RichJSON): string {
  const inline = (inl: Inline[]) => inl.map((i) => {
    if ('br' in i) return '<br>';
    if ('mention' in i) return `<span class="mention">@${esc(i.mention.label)}</span>`;
    let h = esc(i.text);
    for (const [mk, tag] of [['strike', 's'], ['underline', 'u'], ['italic', 'em'], ['bold', 'strong'], ['link', 'a']] as const) if (i.marks?.[mk] != null) h = `<${tag}>${h}</${tag}>`;
    return h;
  }).join('');
  return blocks.map((b) => ('p' in b ? `<p>${b.p.length ? inline(b.p) : '<br>'}</p>`
    : `<${b.list === 'ordered_list' ? 'ol' : 'ul'}>${b.items.map((it) => `<li>${richHTML(it)}</li>`).join('')}</${b.list === 'ordered_list' ? 'ol' : 'ul'}>`)).join('');
}
// True when the text needs more than a plain measure (marks, lists, mentions, breaks).
export const isFormatted = (blocks: RichJSON) => blocks.some((b) => !('p' in b) || b.p.some((i) => !('text' in i) || (i.marks && Object.keys(i.marks).length)));

// --- the active editor, for the context bar ---------------------------------------------------------------------
type Active = { view: EditorView; key: string } | null;
let active: Active = null, version = 0;
const listeners = new Set<() => void>();
const changed = () => { version++; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
// Re-renders on every change of the active editor (selection, marks).
export function useActiveEditor() {
  useSyncExternalStore(subscribe, () => version);
  return active;
}
// A command waiting for an editor that is about to open (context bar Link or @ on an object not being edited).
let pending: ((v: EditorView) => void) | null = null;
export const whenEditorOpens = (fn: (v: EditorView) => void) => { pending = fn; };
// Asks the context bar to open one of its menus: the link field (⌘K in text), the node icon picker (⇧X).
const barListeners = new Set<(pop: string) => void>();
export const requestBarPop = (pop: string) => barListeners.forEach((l) => l(pop));
export function useBarRequests(open: (pop: string) => void) {
  const fn = useRef(open);
  fn.current = open;
  useEffect(() => { const l = (p: string) => fn.current(p); barListeners.add(l); return () => { barListeners.delete(l); }; }, []);
}
const requestLink = () => requestBarPop('link');

const m = schema.marks, n = schema.nodes;
export const markActive = (s: EditorState, type: MarkType) => {
  const { from, $from, to, empty } = s.selection;
  return empty ? !!type.isInSet(s.storedMarks ?? $from.marks()) : s.doc.rangeHasMark(from, to, type);
};
const listOf = (s: EditorState): NodeType | null => {
  for (let d = s.selection.$from.depth; d > 0; d--) { const t = s.selection.$from.node(d).type; if (t === n.bullet_list || t === n.ordered_list) return t; }
  return null;
};
export const inList = (s: EditorState) => listOf(s) !== null;
export const activeList = (s: EditorState): ListKind | null => (listOf(s)?.name as ListKind | undefined) ?? null;

export const commands = {
  mark: (view: EditorView, mark: Mark) => { toggleMark(m[mark])(view.state, view.dispatch); view.focus(); },
  // The same list again lifts the items out; another kind changes the list's type.
  list: (view: EditorView, kind: ListKind) => {
    const cur = listOf(view.state), type = n[kind];
    if (cur === type) liftListItem(n.list_item)(view.state, view.dispatch);
    else if (cur) {
      const { $from } = view.state.selection;
      for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === cur) { view.dispatch(view.state.tr.setNodeMarkup($from.before(d), type)); break; }
    } else wrapInList(type)(view.state, view.dispatch);
    view.focus();
  },
  // A link on the selection, or on the word at the caret; null removes it.
  link: (view: EditorView, href: string | null) => {
    let { from, to } = view.state.selection;
    const tr = view.state.tr;
    if (from === to) {
      const { $from } = view.state.selection, text = $from.parent.textContent, at = $from.parentOffset;
      let a = at, b = at;
      while (a > 0 && /\S/.test(text[a - 1])) a--;
      while (b < text.length && /\S/.test(text[b])) b++;
      from = $from.start() + a; to = $from.start() + b;
    }
    const safe = href && safeHref(/^[\w-]+\.[\w.-]+/.test(href) && !/^[a-z]+:/i.test(href) ? `https://${href}` : href);
    if (from === to && safe) tr.insertText(safe, from).addMark(from, from + safe.length, m.link.create({ href: safe }));
    else { tr.removeMark(from, to, m.link); if (safe) tr.addMark(from, to, m.link.create({ href: safe })); }
    view.dispatch(tr);
    view.focus();
  },
  linkAt: (s: EditorState) => (m.link.isInSet(s.selection.$from.marks()) ?? m.link.isInSet(s.selection.$to.marks()))?.attrs.href as string | undefined,
  mention: (view: EditorView) => { view.dispatch(view.state.tr.insertText(view.state.selection.empty && /\S$/.test(view.state.selection.$from.parent.textBetween(0, view.state.selection.$from.parentOffset)) ? ' @' : '@')); view.focus(); },
};

// --- @mentions ------------------------------------------------------------------------------------------------
type MentionState = { from: number; query: string } | null;
const mentionKey = new PluginKey<MentionState>('mention');
const mentionPlugin = () => new Plugin<MentionState>({
  key: mentionKey,
  state: {
    init: () => null,
    apply: (_tr, _v, _old, s) => {
      const { $from, empty } = s.selection;
      if (!empty) return null;
      const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 40), $from.parentOffset, undefined, '￼');
      const hit = before.match(/(?:^|\s)@([\w.-]{0,30})$/);
      return hit ? { from: $from.pos - hit[1].length - 1, query: hit[1] } : null;
    },
  },
});
let people: Promise<Person[]> | null = null;
const loadPeople = () => (people ??= api.users().catch(() => []));

// --- the editor ---------------------------------------------------------------------------------------------------
// The rich text of an object's field, for editing (Canvas provides it; null for people who cannot edit).
export const RichSource = createContext<((id: string, key: string) => Y.XmlFragment | null) | null>(null);
// The board's undo, so ⌘Z inside text undoes with everything else the person did.
export const RichUndo = createContext<{ undo: () => void; redo: () => void } | null>(null);

type EditorProps = {
  fragment: Y.XmlFragment; field: string; className?: string; selectAll?: boolean; placeholder?: string;
  onDone: () => void; onResize?: (w: number, h: number) => void;
  // A key the caller takes (mind map: Enter adds a sibling). True = taken; the editor closes without onDone.
  onKey?: (e: KeyboardEvent, view: EditorView) => boolean;
};

export function RichEditor({ fragment, field, className, selectAll, placeholder, onDone, onResize, onKey }: EditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const undo = useContext(RichUndo);
  const props = useRef({ onDone, onKey, onResize, undo });
  props.current = { onDone, onKey, onResize, undo };
  const [mention, setMention] = useState<{ state: NonNullable<MentionState>; list: Person[]; pick: number; at: { x: number; y: number } } | null>(null);
  const mentionRef = useRef(mention);
  mentionRef.current = mention;

  useLayoutEffect(() => {
    const el = ref.current!;
    let done = false, view: EditorView;
    const finish = () => { if (done) return; done = true; props.current.onDone(); };
    const report = () => { const r = props.current.onResize; if (r) r(Math.ceil(el.scrollWidth) + 2, Math.ceil(el.scrollHeight)); };
    const pickMention = (p: Person) => {
      const st = mentionKey.getState(view.state);
      if (!st) return;
      view.dispatch(view.state.tr.replaceWith(st.from, view.state.selection.from, n.mention.create({ id: p.id, label: p.name })).insertText(' '));
      setMention(null);
      view.focus();
    };
    const syncMention = () => {
      const st = mentionKey.getState(view.state);
      if (!st) return setMention(null);
      loadPeople().then((all) => {
        const q = st.query.toLowerCase();
        const list = all.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().startsWith(q)).slice(0, 6);
        const c = view.coordsAtPos(st.from);
        setMention(list.length ? { state: st, list, pick: 0, at: { x: c.left, y: c.bottom + 4 } } : null);
      });
    };
    const keys: Record<string, Command> = {
      'Mod-z': () => { props.current.undo?.undo(); return true; },
      'Mod-Shift-z': () => { props.current.undo?.redo(); return true; },
      'Mod-y': () => { props.current.undo?.redo(); return true; },
      'Mod-b': toggleMark(m.bold), 'Mod-i': toggleMark(m.italic), 'Mod-u': toggleMark(m.underline), 'Mod-Shift-x': toggleMark(m.strike),
      'Mod-k': () => { requestLink(); return true; }, 'Mod-Shift-u': () => { requestLink(); return true; },
      'Shift-Enter': chainCommands(exitCode, (s, d) => { d?.(s.tr.replaceSelectionWith(n.hard_break.create()).scrollIntoView()); return true; }),
      Enter: splitListItem(n.list_item), Tab: sinkListItem(n.list_item), 'Shift-Tab': liftListItem(n.list_item),
      Escape: () => { view.dom.blur(); return true; }, 'Mod-Enter': () => { view.dom.blur(); return true; },
    };
    const { doc, mapping } = initProseMirrorDoc(fragment, schema);
    view = new EditorView(el, {
      state: EditorState.create({
        doc, schema,
        plugins: [
          ySyncPlugin(fragment, { mapping }), mentionPlugin(),
          inputRules({ rules: [wrappingInputRule(/^\s*([-+*])\s$/, n.bullet_list), wrappingInputRule(/^(\d+)\.\s$/, n.ordered_list)] }),
          keymap(keys), keymap(baseKeymap),
        ],
      }),
      attributes: { class: `rich-edit ${className ?? ''}`, spellcheck: 'true', ...(placeholder ? { 'data-placeholder': placeholder } : {}) },
      dispatchTransaction(tr) {
        view.updateState(view.state.apply(tr));
        if (tr.docChanged) report();
        syncMention();
        changed();
      },
      handleKeyDown(v, e) {
        const mn = mentionRef.current;
        if (mn) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { setMention({ ...mn, pick: (mn.pick + (e.key === 'ArrowDown' ? 1 : mn.list.length - 1)) % mn.list.length }); return true; }
          if (e.key === 'Enter' || e.key === 'Tab') { pickMention(mn.list[mn.pick]); return true; }
          if (e.key === 'Escape') { setMention(null); return true; }
        }
        if (props.current.onKey?.(e, v)) { done = true; e.preventDefault(); return true; }
        return false;
      },
      handleDOMEvents: {
        // Focus moving into the context bar (link field, buttons) keeps the editor open.
        blur: (_v, e) => { if ((e.relatedTarget as HTMLElement | null)?.closest?.('.contextbar, .rich-mentions')) return false; finish(); return false; },
        mousedown: (_v, e) => { e.stopPropagation(); return false; },
      },
    });
    (el as HTMLDivElement & { pickMention?: typeof pickMention }).pickMention = pickMention;
    view.focus();
    const end = view.state.doc.content.size;
    view.dispatch(view.state.tr.setSelection(selectAll ? TextSelection.create(view.state.doc, 1, Math.max(1, end - 1)) : TextSelection.atEnd(view.state.doc)));
    active = { view, key: field };
    changed();
    report();
    if (pending) { const fn = pending; pending = null; fn(view); }
    return () => {
      if (active?.view === view) { active = null; changed(); }
      view.destroy();
    };
  }, [fragment]);

  return (
    <>
      <div ref={ref} className="rich-host" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} />
      {/* In a portal: the board layer is transformed, which would place a fixed box relative to it. */}
      {mention && createPortal(
        <div className="rich-mentions c-mentions" role="listbox" style={{ left: mention.at.x, top: mention.at.y }} onMouseDown={(e) => e.preventDefault()}>
          {mention.list.map((p, i) => (
            <button key={p.id} role="option" aria-selected={i === mention.pick} className={i === mention.pick ? 'active' : ''}
              onClick={() => (ref.current as HTMLDivElement & { pickMention?: (p: Person) => void })?.pickMention?.(p)}>
              <span className="name">{p.name}</span> <span className="muted">{p.email}</span>
            </button>
          ))}
        </div>, document.body,
      )}
    </>
  );
}

