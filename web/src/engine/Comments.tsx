import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, MessageSquare, MoreHorizontal, RotateCcw, SmilePlus, X } from 'lucide-react';
import { REACTIONS, type Message, type Thread } from '../../../shared/comments.ts';
import type { BoardObject } from '../../../shared/model.ts';
import type { Pt } from '../../../shared/route.ts';
import { ago, api, type Person } from '../api.ts';

export type Me = { id: string; name: string; picture: string | null };

// World position of a thread: relative to its object when it has one.
export function anchorPoint(t: Thread, byId: Map<string, BoardObject>): Pt {
  const o = t.anchor.objectId ? byId.get(t.anchor.objectId) : undefined;
  return o && 'x' in o ? { x: o.x + t.anchor.x, y: o.y + t.anchor.y } : { x: t.anchor.x, y: t.anchor.y };
}

let peopleCache: Promise<Person[]> | null = null;
export const people = () => (peopleCache ??= api.users().catch(() => []));

export function Avatar({ p, size = 24 }: { p: { name: string; picture: string | null }; size?: number }) {
  return p.picture
    ? <img className="c-avatar" src={p.picture} alt="" referrerPolicy="no-referrer" style={{ width: size, height: size }} />
    : <span className="c-avatar" style={{ width: size, height: size, fontSize: size * 0.45 }}>{p.name[0]?.toUpperCase()}</span>;
}

// Highlight @Name mentions of real people.
function Rich({ text, mentions, names }: { text: string; mentions: string[]; names: Map<string, string> }) {
  const tags = mentions.map((id) => names.get(id)).filter(Boolean) as string[];
  if (!tags.length) return <>{text}</>;
  const re = new RegExp(`(@(?:${tags.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'g');
  return <>{text.split(re).map((part, i) => (i % 2 ? <span key={i} className="c-mention">{part}</span> : part))}</>;
}

// Textarea with @mention autocomplete. Enter sends, Shift+Enter adds a line.
export function Composer({ placeholder, initial = '', autoFocus = true, onSend, onCancel }: {
  placeholder: string; initial?: string; autoFocus?: boolean; onSend: (text: string, mentions: string[]) => Promise<unknown>; onCancel?: () => void;
}) {
  const [text, setText] = useState(initial);
  const [list, setList] = useState<Person[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const mentioned = useRef(new Map<string, string>()); // id -> name
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { people().then(setList); }, []);
  const matches = query === null ? [] : list.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()) || p.email.toLowerCase().startsWith(query.toLowerCase())).slice(0, 6);

  const onChange = (v: string) => {
    setText(v);
    const caret = ref.current?.selectionStart ?? v.length;
    const m = v.slice(0, caret).match(/@([\w.-]*)$/);
    setQuery(m ? m[1] : null);
    setPick(0);
  };
  const insert = (p: Person) => {
    const caret = ref.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@[\w.-]*$/, `@${p.name} `);
    setText(before + text.slice(caret));
    mentioned.current.set(p.id, p.name);
    setQuery(null);
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(before.length, before.length); });
  };
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const ids = [...mentioned.current].filter(([, name]) => text.includes(`@${name}`)).map(([id]) => id);
    try { await onSend(text.trim(), ids); setText(''); mentioned.current.clear(); } finally { setBusy(false); }
  };
  return (
    <div className="c-composer" onPointerDown={(e) => e.stopPropagation()}>
      <textarea ref={ref} autoFocus={autoFocus} rows={2} placeholder={placeholder} value={text} disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setPick((i) => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length); return; }
          if (matches.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); insert(matches[pick]); return; }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          if (e.key === 'Escape') { if (query !== null) setQuery(null); else onCancel?.(); }
        }} />
      {matches.length > 0 && (
        <div className="c-mentions" role="listbox">
          {matches.map((p, i) => (
            <button key={p.id} role="option" aria-selected={i === pick} className={i === pick ? 'active' : ''} onPointerDown={(e) => { e.preventDefault(); insert(p); }}>
              <Avatar p={p} size={20} /> {p.name} <span className="muted">{p.email}</span>
            </button>
          ))}
        </div>
      )}
      <div className="c-composer-actions">
        {onCancel && <button className="btn ghost" onClick={onCancel}>Cancel</button>}
        <button className="btn primary" disabled={!text.trim() || busy} onClick={send}>Send</button>
      </div>
    </div>
  );
}

function MessageView({ m, me, names, boardId, threadId, first }: { m: Message; me: Me; names: Map<string, string>; boardId: string; threadId: string; first: boolean }) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(false);
  const mine = m.author.id === me.id;
  return (
    <div className="c-msg">
      <div className="c-msg-head">
        <Avatar p={m.author} />
        <strong>{m.author.name}</strong>
        <span className="muted">{ago(m.at)}{m.edited ? ' · edited' : ''}</span>
        {mine && !editing && (
          <span className="c-more">
            <button className="icon-btn" aria-label="Message options" onClick={() => setMenu(!menu)}><MoreHorizontal size={16} /></button>
            {menu && (
              <div className="cb-menu c-menu" role="menu">
                <button role="menuitem" onClick={() => { setEditing(true); setMenu(false); }}>Edit</button>
                <button role="menuitem" className="danger" onClick={() => { setMenu(false); api.deleteMessage(boardId, threadId, m.id); }}>{first ? 'Delete thread' : 'Delete'}</button>
              </div>
            )}
          </span>
        )}
      </div>
      {editing
        ? <Composer placeholder="Edit comment" initial={m.text} onCancel={() => setEditing(false)}
            onSend={async (text, mentions) => { await api.editMessage(boardId, threadId, m.id, { text, mentions: [...new Set([...m.mentions, ...mentions])] }); setEditing(false); }} />
        : <div className="c-text"><Rich text={m.text} mentions={m.mentions} names={names} /></div>}
      <div className="c-reactions">
        {Object.entries(m.reactions).map(([emoji, who]) => (
          <button key={emoji} className={`c-react ${who.includes(me.id) ? 'mine' : ''}`} title={who.map((id) => names.get(id) ?? 'Someone').join(', ')}
            onClick={() => api.react(boardId, threadId, m.id, emoji)}>{emoji} {who.length}</button>
        ))}
        <span className="c-more">
          <button className="icon-btn" aria-label="Add reaction" onClick={() => setPicker(!picker)}><SmilePlus size={15} /></button>
          {picker && (
            <div className="c-picker">
              {REACTIONS.map((e) => <button key={e} onClick={() => { setPicker(false); api.react(boardId, threadId, m.id, e); }}>{e}</button>)}
            </div>
          )}
        </span>
      </div>
    </div>
  );
}

export function ThreadView({ t, me, boardId, onClose, readOnly }: { t: Thread; me: Me; boardId: string; onClose: () => void; readOnly?: boolean }) {
  const [names, setNames] = useState(new Map<string, string>());
  useEffect(() => { people().then((ps) => setNames(new Map(ps.map((p) => [p.id, p.name])))); }, []);
  return (
    <div className="c-thread" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="c-thread-head">
        <span>{t.resolved ? 'Resolved' : 'Comment'}</span>
        {!readOnly && <button className="icon-btn" aria-label={t.resolved ? 'Reopen' : 'Resolve'} title={t.resolved ? 'Reopen' : 'Resolve'} onClick={() => api.resolve(boardId, t.id, !t.resolved)}>
          {t.resolved ? <RotateCcw size={16} /> : <Check size={16} />}
        </button>}
        <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="c-msgs">
        {t.messages.map((m, i) => <MessageView key={m.id} m={m} me={me} names={names} boardId={boardId} threadId={t.id} first={i === 0} />)}
      </div>
      {!readOnly && <Composer placeholder="Reply… use @ to mention" autoFocus={false} onSend={(text, mentions) => api.reply(boardId, t.id, { text, mentions })} />}
    </div>
  );
}

export function CommentsPanel({ threads, onOpen, onClose }: { threads: Thread[]; onOpen: (t: Thread) => void; onClose: () => void }) {
  const [resolved, setResolved] = useState(false);
  const shown = useMemo(() => threads.filter((t) => t.resolved === resolved).sort((a, b) => b.at - a.at), [threads, resolved]);
  return (
    <aside className="c-panel" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="c-panel-head">
        <MessageSquare size={16} /> <strong>Comments</strong>
        <div className="seg">
          <button className={!resolved ? 'active' : ''} onClick={() => setResolved(false)}>Open {threads.filter((t) => !t.resolved).length}</button>
          <button className={resolved ? 'active' : ''} onClick={() => setResolved(true)}>Resolved</button>
        </div>
        <button className="icon-btn" aria-label="Close comments" onClick={onClose}><X size={16} /></button>
      </div>
      {!shown.length && <p className="muted pad">{resolved ? 'No resolved comments.' : 'No open comments. Press M with an object selected, or use the comment tool.'}</p>}
      {shown.map((t) => (
        <button key={t.id} className="c-card" onClick={() => onOpen(t)}>
          <div className="c-msg-head"><Avatar p={t.messages[0].author} size={20} /><strong>{t.messages[0].author.name}</strong><span className="muted">{ago(t.messages.at(-1)!.at)}</span></div>
          <div className="c-text clamp">{t.messages[0].text}</div>
          {t.messages.length > 1 && <div className="muted">{t.messages.length - 1} {t.messages.length === 2 ? 'reply' : 'replies'}</div>}
        </button>
      ))}
    </aside>
  );
}

export function Pin({ t, at, active, onOpen }: { t: Thread; at: Pt; active: boolean; onOpen: () => void }) {
  const first = t.messages[0];
  return (
    <button className={`c-pin ${active ? 'active' : ''} ${t.resolved ? 'resolved' : ''}`} style={{ left: at.x, top: at.y }}
      aria-label={`Comment by ${first.author.name}`} onPointerDown={(e) => e.stopPropagation()} onClick={onOpen}>
      <Avatar p={first.author} size={22} />
      {t.messages.length > 1 && <span className="c-count">{t.messages.length}</span>}
    </button>
  );
}
