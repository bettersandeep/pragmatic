import { useEffect, useState, type ReactNode } from 'react';
import { History, MessageSquare } from 'lucide-react';
import { api, canEdit as editsAllowed, type Item, type User } from './api.ts';
import { ItemBar, useItem, useToast } from './ItemBar.tsx';
import { useBoard } from './engine/useBoard.ts';
import { HistoryPanel } from './engine/BoardPanels.tsx';
import { Composer, ThreadView } from './engine/Comments.tsx';
import { DocEditor } from './docs/DocEditor.tsx';
import type { Theme } from './engine/theme.ts';

// A Whimsical-style doc: title, block editor (shared live), and a discussion at the end. Same sharing, stars,
// history and Drive copies as boards; the content lives in the item's live document as the "blocks" fragment.
export function Doc({ id, theme, user, item, onItem, header }: { id: string; theme: Theme; user: User; item: Item | null; onItem: (i: Item) => void; header: ReactNode }) {
  const board = useBoard(id, user);
  const [toast, setToast] = useToast();
  const { role, error } = useItem(id, onItem);
  const [history, setHistory] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  useEffect(() => setTitle(item?.title ?? ''), [item?.title]);
  const canEdit = editsAllowed(role), canComment = canEdit || role === 'comment';

  if (error) return <div className="empty"><h2>Doc not available</h2><p>{error}</p></div>;
  return (
    <>
      <ItemBar id={id} noun="doc" header={header} board={board} role={role} onToast={setToast}
        items={[{ label: <><History size={15} /> Version history</>, onClick: () => setHistory(true) }]} />
      <div className="doc-scroll">
        <article className="doc-page">
          <input className="doc-title" value={title} placeholder="Untitled" aria-label="Doc title" readOnly={!canEdit}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={async () => { const t = title.trim(); if (t && t !== item?.title) onItem(await api.update(id, { title: t })); }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          {board.synced && (
            <DocEditor fragment={board.doc.getXmlFragment('blocks')} awareness={board.awareness} user={{ id: user.id, name: user.name, picture: user.picture, color: board.myColor }}
              editable={canEdit} theme={theme} placeholder="Type / for blocks, or just start writing" />
          )}
          <section className="doc-discussion">
            <h3><MessageSquare size={16} /> Discussion</h3>
            {board.threads.map((t) => <ThreadView key={t.id} t={t} me={user} boardId={id} readOnly={!canComment} onClose={() => {}} />)}
            {canComment && <Composer placeholder="Start a discussion…" autoFocus={false} onSend={(text, mentions) => api.comment(id, { anchor: { x: 0, y: 0 }, text, mentions })} />}
          </section>
        </article>
      </div>
      {history && <HistoryPanel boardId={id} previewing={previewing} onPreview={(v) => setPreviewing(v?.id ?? null)} onClose={() => { setHistory(false); setPreviewing(null); }} onToast={setToast} />}
      {!board.synced && <div className="board-loading"><div className="spinner" /></div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
