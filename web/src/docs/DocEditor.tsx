import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core';
import { CollaborationExtension } from '@blocknote/core/yjs';
import { createReactBlockSpec, getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { AlertCircle, FileText, Flag, Lightbulb, LayoutDashboard, TriangleAlert } from 'lucide-react';
import { api, itemPath, navigate, type Item } from '../api.ts';
import { CALLOUT_COLORS, calloutConfig, embedConfig } from '../../../shared/docSchema.ts';

// A board (or doc) shown inside a doc: a live picture of the board that opens it. An empty block offers a picker.
function Embed({ id, onPick, editable }: { id: string; onPick: (id: string) => void; editable: boolean }) {
  const [item, setItem] = useState<Item | null>(null), [img, setImg] = useState<string | null>(null), [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    // The doc being edited is not offered: it cannot show itself.
    if (!id) { api.items().then((l) => setItems(l.filter((i) => i.kind !== 'folder' && !location.pathname.endsWith(i.id)))); return; }
    api.board(id).then(setItem, () => setItem(null));
  }, [id]);
  useEffect(() => {
    if (item?.kind !== 'board') return;
    let url = '';
    api.renderPng(item.id, { theme: 'light' }).then((b) => { url = URL.createObjectURL(b); setImg(url); }, () => setImg(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [item?.id, item?.updated_at]);
  const open = () => item && navigate(itemPath(item));
  if (!id) return (
    <div className="embed-pick" contentEditable={false}>
      <div className="muted">{editable ? 'Choose a board or doc to embed' : 'Nothing embedded'}</div>
      {editable && <div className="embed-list">{items.map((i) => <button key={i.id} onClick={() => onPick(i.id)}>{i.kind === 'doc' ? <FileText size={14} /> : <LayoutDashboard size={14} />} {i.title}</button>)}</div>}
    </div>
  );
  return (
    // While editing, one click selects the block and a double click opens the item.
    <button className="embed" contentEditable={false} title="Double-click to open"
      onClick={() => !editable && open()} onDoubleClick={open}>
      {img ? <img src={img} alt="" /> : <span className="embed-empty"><LayoutDashboard size={28} /></span>}
      <span className="embed-title">{item?.title ?? 'Not available'}<span className="muted">{item?.kind === 'doc' ? ' · Doc' : ' · Board'}</span></span>
    </button>
  );
}

const CALLOUTS = { blue: AlertCircle, yellow: TriangleAlert, green: Lightbulb, red: Flag } as const;
type CalloutColor = (typeof CALLOUT_COLORS)[number];

const embed = createReactBlockSpec(
  embedConfig,
  { render: ({ block, editor }) => <Embed id={block.props.itemId} editable={editor.isEditable} onPick={(itemId) => editor.updateBlock(block, { props: { itemId } })} /> },
);
const callout = createReactBlockSpec(
  calloutConfig,
  {
    render: ({ block, editor, contentRef }) => {
      const color = block.props.color as CalloutColor, Icon = CALLOUTS[color];
      const next = CALLOUT_COLORS[(CALLOUT_COLORS.indexOf(color) + 1) % CALLOUT_COLORS.length];
      return (
        <div className={`callout callout-${color}`}>
          <button className="callout-icon" contentEditable={false} aria-label="Change callout color" onClick={() => editor.isEditable && editor.updateBlock(block, { props: { color: next } })}><Icon size={18} /></button>
          <div className="callout-text" ref={contentRef} />
        </div>
      );
    },
  },
);

export const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, embed: embed(), callout: callout() } });

type Props = {
  // `user` becomes this tab's presence (BlockNote replaces the awareness "user" field), so pass the full presence user.
  fragment: Y.XmlFragment; awareness?: Awareness; user: { name: string; color: string; id?: string; picture?: string | null }; editable: boolean; theme: 'light' | 'dark';
  placeholder?: string; onText?: (text: string) => void;
};

// Whimsical-style doc editor (BlockNote) on a shared Yjs fragment: slash menu, drag handles, text toolbar, live cursors.
export function DocEditor({ fragment, awareness, user, editable, theme, placeholder, onText }: Props) {
  const editor = useCreateBlockNote({
    schema,
    extensions: [CollaborationExtension({ fragment, user, ...(awareness && { provider: { awareness } }), showCursorLabels: 'activity' })],
    uploadFile: async (file) => (await api.uploadImage(file)).src,
    placeholders: placeholder ? { default: placeholder } : undefined,
  }, [fragment]);
  return (
    <BlockNoteView editor={editor} theme={theme} editable={editable} slashMenu={false}
      onChange={() => onText && onText(editor.document.map((b) => (Array.isArray(b.content) ? b.content.map((c) => ('text' in c ? c.text : '')).join('') : '')).filter(Boolean).join('\n'))}>
      <SuggestionMenuController triggerCharacter="/" getItems={async (query) => filterSuggestionItems([
        ...getDefaultReactSlashMenuItems(editor),
        { title: 'Board or doc', subtext: 'Show a board or doc from pragmatic', aliases: ['board', 'embed', 'diagram', 'doc'], group: 'pragmatic', icon: <LayoutDashboard size={18} />,
          onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'embed' }) },
        { title: 'Callout', subtext: 'Highlighted note with an icon', aliases: ['callout', 'info', 'note', 'warning'], group: 'pragmatic', icon: <AlertCircle size={18} />,
          onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'callout' }) },
      ], query)} />
    </BlockNoteView>
  );
}
