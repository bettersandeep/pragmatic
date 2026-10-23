import { useEffect, useState } from 'react';
import { CheckCheck, ExternalLink, Inbox } from 'lucide-react';
import { ago, api, navigate, type Notification } from './api.ts';
import type { Thread } from '../../shared/comments.ts';
import { Avatar, ThreadView, type Me } from './engine/Comments.tsx';

const VERB: Record<Notification['kind'], string> = {
  mention: 'mentioned you in', reply: 'replied in', watch: 'commented on a card you follow in', assign: 'assigned you a card in', share: 'shared',
};
const targetOf = (n: Notification) =>
  // A mention outside a comment is in an object's text: show that object. Other object notifications are about task cards.
  `/b/${n.board_id}${n.thread_id ? `?thread=${n.thread_id}` : n.object_id ? `?${n.kind === 'mention' ? 'object' : 'task'}=${n.object_id}` : ''}`;

// Whimsical-style inbox: notifications on the left, the selected one on the right.
export function InboxPage({ me, onRead }: { me: Me; onRead: () => void }) {
  const [list, setList] = useState<Notification[] | null>(null);
  const [only, setOnly] = useState<'all' | 'unread'>('all');
  const [sel, setSel] = useState<Notification | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const load = () => api.inbox().then(setList);
  useEffect(() => { load(); }, []);
  useEffect(() => {
    setThread(null);
    if (sel?.thread_id) api.thread(sel.board_id, sel.thread_id).then(setThread, () => setThread(null));
  }, [sel?.id]);
  const open = async (n: Notification) => {
    setSel(n);
    if (!n.read_at) { await api.readInbox([n.id]); setList((l) => l?.map((x) => (x.id === n.id ? { ...x, read_at: Date.now() } : x)) ?? null); onRead(); }
  };
  const shown = list?.filter((n) => only === 'all' || !n.read_at) ?? [];
  return (
    <div className="inbox">
      <section className="inbox-list">
        <header className="inbox-head">
          <Inbox size={17} /><h1>Inbox</h1>
          <select value={only} aria-label="Show" onChange={(e) => setOnly(e.target.value as typeof only)}><option value="all">All</option><option value="unread">Unread</option></select>
          <button className="icon-btn" aria-label="Mark all as read" title="Mark all as read" onClick={async () => { await api.readInbox('all'); await load(); onRead(); }}><CheckCheck size={17} /></button>
        </header>
        {list && !shown.length && <p className="muted pad">{only === 'unread' ? 'No unread notifications' : 'Nothing yet'}</p>}
        {shown.map((n) => (
          <button key={n.id} className={`inbox-item ${sel?.id === n.id ? 'active' : ''} ${n.read_at ? '' : 'unread'}`} onClick={() => open(n)}>
            <Avatar p={{ name: n.actor_name, picture: n.actor_picture }} size={30} />
            <span className="inbox-body">
              <span className="inbox-line"><strong>{n.actor_name}</strong> {VERB[n.kind]} <strong>{n.board_title}</strong></span>
              {n.text && n.kind !== 'share' && <span className="inbox-text">{n.text}</span>}
              <span className="inbox-time">{ago(n.created_at)}</span>
            </span>
            {!n.read_at && <span className="inbox-dot" aria-label="Unread" />}
          </button>
        ))}
      </section>
      <section className="inbox-detail">
        {!sel ? (
          <div className="empty"><Inbox size={56} strokeWidth={1.2} className="inbox-empty-icon" /><p>Notifications will appear to the left</p></div>
        ) : (
          <div className="inbox-pane">
            <h2>{sel.board_title}</h2>
            <p className="muted">{sel.actor_name} {VERB[sel.kind]} this board · {ago(sel.created_at)}</p>
            {sel.kind === 'assign' && <p className="inbox-card">{sel.text || 'Untitled card'}</p>}
            {sel.kind === 'share' && <p>You can {sel.text === 'edit' ? 'edit' : sel.text === 'comment' ? 'comment on' : 'view'} this board.</p>}
            {thread && <ThreadView t={thread} me={me} boardId={sel.board_id} onClose={() => setSel(null)} />}
            <button className="btn primary" onClick={() => navigate(targetOf(sel))}><ExternalLink size={15} /> {sel.thread_id || (sel.object_id && sel.kind === 'mention') ? 'Open in board' : sel.object_id ? 'Open card' : 'Open board'}</button>
          </div>
        )}
      </section>
    </div>
  );
}
