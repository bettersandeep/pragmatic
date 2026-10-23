import { useContext, useEffect, useRef, useState } from 'react';
import { copyText } from '../clipboard.ts';
import { TextSource, bindText } from './ytext.ts';
import { LOCAL, type PeerUser } from './useBoard.ts';
import type * as Y from 'yjs';
import { Star, Bell, BellOff, ChevronsDown, ChevronsUp, CornerLeftUp, Link2, MessageSquare, Plus, Tag, Trash2, UserRound, X } from 'lucide-react';
import { COLOR_NAMES, type StackObj, type TaskObj } from '../../../shared/model.ts';
import { activityOf, readActivity, type Activity } from '../../../shared/tasks.ts';
import type { Thread } from '../../../shared/comments.ts';
import type { Patch } from '../../../shared/doc.ts';
import { ago, api, starsChanged } from '../api.ts';
import { Avatar, Composer, ThreadView, type Me } from './Comments.tsx';
import { TagPill, usePeople } from './TaskView.tsx';
import { activePalette, type Theme } from './theme.ts';


type Props = {
  task: TaskObj; doc: Y.Doc; boardId: string; me: Me; theme: Theme; stacks: StackObj[]; threads: Thread[]; tags: string[];
  update: (p: Patch[]) => void; onDelete: () => void; onClose: () => void; onToast: (m: string) => void; readOnly: boolean; canComment: boolean; onLog: (what: string) => void; here: PeerUser[];
};

// The expanded card, like Whimsical's: content on the left, properties on the right.
export function TaskExpanded({ task, doc, boardId, me, theme, stacks, threads, tags, update, onDelete, onClose, onToast, readOnly, canComment, onLog, here }: Props) {
  const ppl = usePeople();
  const set = (fields: Partial<TaskObj>) => update([{ id: task.id, ...fields }]);
  const [pop, setPop] = useState<null | 'assign' | 'tag'>(null);
  const [tagText, setTagText] = useState('');
  const [links, setLinks] = useState<Awaited<ReturnType<typeof api.backlinks>>>([]);
  const [showLinks, setShowLinks] = useState(false);
  useEffect(() => { api.backlinks(boardId, task.id).then(setLinks, () => setLinks([])); }, [boardId, task.id]);
  const [log, setLog] = useState<Activity[]>([]);
  const [starred, setStarred] = useState(false);
  useEffect(() => { api.stars().then((l) => setStarred(l.some((s) => s.item_id === boardId && s.object_id === task.id)), () => {}); }, [boardId, task.id]);
  useEffect(() => {
    const m = activityOf(doc), read = () => setLog(readActivity(doc, task.id));
    read();
    m.observe(read);
    return () => m.unobserve(read);
  }, [doc, task.id]);
  // Both text boxes grow with their text.
  // Title and description are live shared text; both boxes grow with their text.
  const titleRef = useRef<HTMLTextAreaElement>(null), descRef = useRef<HTMLTextAreaElement>(null);
  const source = useContext(TextSource);
  const grow = (el: HTMLTextAreaElement) => { el.style.height = '0'; el.style.height = `${el.scrollHeight}px`; };
  useEffect(() => {
    const offs: (() => void)[] = [];
    for (const [el, key] of [[titleRef.current, 'title'], [descRef.current, 'desc']] as const) {
      if (!el) continue;
      const t = readOnly ? null : source?.(task.id, key);
      if (t) offs.push(bindText(el, t, LOCAL));
      const fit = () => grow(el);
      el.addEventListener('input', fit);
      el.addEventListener('remote-input', fit);
      offs.push(() => { el.removeEventListener('input', fit); el.removeEventListener('remote-input', fit); });
    }
    return () => offs.forEach((f) => f());
  }, [task.id, readOnly]);
  // Viewers see changes as they come; editors' boxes are bound above.
  useEffect(() => {
    const t = titleRef.current, d = descRef.current;
    if (readOnly && t && d) { t.value = task.title; d.value = task.desc ?? ''; }
    if (t) grow(t);
    if (d) grow(d);
  }, [readOnly, task.title, task.desc]);
  // The activity log gets one entry per edit, when the box loses focus.
  const before = useRef('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLElement && e.target.closest('textarea, input'))) onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  const who = task.assignee ? ppl.get(task.assignee) : undefined;
  const watching = !!task.watch?.includes(me.id);
  const mine = threads.filter((t) => t.anchor.objectId === task.id);
  const addTag = (t: string) => {
    const v = t.trim();
    if (v && !task.tags?.includes(v)) set({ tags: [...(task.tags ?? []), v] });
    setTagText('');
    setPop(null);
  };
  const url = () => { const u = new URL(location.href); u.searchParams.set('task', task.id); return u.toString(); };

  return (
    <div className="task-modal-back" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }} onWheel={(e) => e.stopPropagation()}>
      <div className="modal task-modal" role="dialog" aria-label={task.title || 'Card'}>
        <div className="task-main">
          <textarea ref={titleRef} className="task-title-input" readOnly={readOnly} defaultValue={task.title} placeholder="Untitled" rows={1} aria-label="Title"
            onFocus={(e) => { before.current = e.target.value; }} onBlur={(e) => e.target.value !== before.current && onLog(`renamed the card to "${e.target.value}"`)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }} />
          <div className="task-desc-row">
            <Plus size={18} className="muted task-desc-plus" />
            <textarea ref={descRef} className="task-desc-input" readOnly={readOnly} defaultValue={task.desc ?? ''} placeholder={readOnly ? '' : 'Add a description…'} aria-label="Description"
              onFocus={(e) => { before.current = e.target.value; }} onBlur={(e) => e.target.value !== before.current && onLog('changed the description')} />
          </div>
          <div className="task-grow" />
          <button className="task-section-btn" disabled={!links.length} onClick={() => setShowLinks(!showLinks)}>
            <CornerLeftUp size={15} /> {links.length} {links.length === 1 ? 'backlink' : 'backlinks'} {links.length > 0 && (showLinks ? <ChevronsUp size={14} /> : <ChevronsDown size={14} />)}
          </button>
          {showLinks && (
            <ul className="task-links">
              {links.map((l) => <li key={l.object_id}><a href={`/b/${l.board_id}`}>{l.board_title}</a><span className="muted"> · {l.title}</span></li>)}
            </ul>
          )}
          <div className="task-section-head"><MessageSquare size={15} /> Discussion</div>
          <div className="task-threads">
            {mine.map((t) => <ThreadView key={t.id} t={t} me={me} boardId={boardId} readOnly={!canComment} onClose={() => {}} />)}
          </div>
          {canComment && <div className="task-new-thread">
            <Avatar p={me} size={32} />
            <Composer placeholder="Start a new thread…" autoFocus={false}
              onSend={(text, mentions) => api.comment(boardId, { anchor: { objectId: task.id, x: 0, y: 0 }, text, mentions })} />
          </div>}
        </div>

        <aside className="task-side">
          <button className="icon-btn task-close" aria-label="Close" onClick={onClose}><X size={18} /></button>
          {here.length > 0 && (
            <div className="task-here" title={`${here.map((p) => p.name).join(', ')} also here`}>
              {here.map((p) => <span key={p.id} className="task-here-dot" style={{ background: p.color }}>{p.name[0]?.toUpperCase()}</span>)}
              <span className="muted">{here.length === 1 ? `${here[0].name} is here` : `${here.length} people are here`}</span>
            </div>
          )}
          <div className="task-actions">
            <button className="task-act" aria-label="Copy link" data-tip="Copy link" onClick={() => copyText(url()).then(() => onToast('Link copied'))}><Link2 size={18} /></button>
            <button disabled={readOnly} className={`task-act ${watching ? 'on' : ''}`} aria-label={watching ? 'Stop notifications' : 'Get notifications'} aria-pressed={watching}
              data-tip={watching ? 'You get notifications' : 'Get notifications'}
              onClick={() => set({ watch: watching ? task.watch!.filter((x) => x !== me.id) : [...(task.watch ?? []), me.id] })}>{watching ? <Bell size={18} /> : <BellOff size={18} />}</button>
            <button className={`task-act ${starred ? 'on' : ''}`} aria-label={starred ? 'Remove star' : 'Star card'} aria-pressed={starred} data-tip={starred ? 'Starred' : 'Star card'}
              onClick={async () => { await api.star(boardId, !starred, task.id); setStarred(!starred); starsChanged(); }}><Star size={18} fill={starred ? 'currentColor' : 'none'} /></button>
            <button disabled={readOnly} className="task-act" aria-label="Delete card" data-tip="Delete card" onClick={onDelete}><Trash2 size={18} /></button>
          </div>

          <fieldset className="task-fields" disabled={readOnly}>
          <h4>Assignee</h4>
          <div className="task-wrap">
            <button className="task-chip" onClick={() => setPop(pop === 'assign' ? null : 'assign')}>
              {who ? <><Avatar p={who} size={20} /> {who.name}</> : <><UserRound size={16} /> Assign</>}
            </button>
            {pop === 'assign' && (
              <div className="task-pop cb-menu" role="menu">
                {[...ppl.values()].map((p) => (
                  <button key={p.id} role="menuitem" className={p.id === task.assignee ? 'checked' : ''} onClick={() => { set({ assignee: p.id }); setPop(null); }}><Avatar p={p} size={20} /> {p.name}</button>
                ))}
                {task.assignee && <button role="menuitem" onClick={() => { set({ assignee: undefined }); setPop(null); }}><X size={15} /> Unassign</button>}
              </div>
            )}
          </div>

          <h4>Tags</h4>
          <div className="task-tags">
            {task.tags?.map((t) => (
              <span key={t} className="task-tag-edit"><TagPill tag={t} theme={theme} />
                <button aria-label={`Remove tag ${t}`} onClick={() => set({ tags: task.tags!.filter((x) => x !== t) })}><X size={12} /></button>
              </span>
            ))}
            {pop === 'tag'
              ? <input className="task-tag-input" autoFocus value={tagText} list="task-tag-list" placeholder="Tag name" aria-label="Tag name"
                  onChange={(e) => setTagText(e.target.value)} onBlur={() => addTag(tagText)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addTag(tagText); if (e.key === 'Escape') { setTagText(''); setPop(null); } }} />
              : <button className="task-chip" onClick={() => setPop('tag')}><Tag size={15} /> Tag</button>}
            <datalist id="task-tag-list">{tags.filter((t) => !task.tags?.includes(t)).map((t) => <option key={t} value={t} />)}</datalist>
          </div>

          <h4>Color</h4>
          <div className="task-colors">
            {COLOR_NAMES.filter((c) => c !== 'default').map((c) => (
              <button key={c} className={`swatch-btn ${task.color === c ? 'active' : ''}`} aria-label={c} data-tip={c} onClick={() => set({ color: c })}>
                <span className="swatch" style={{ background: activePalette()[c].base }} />
              </button>
            ))}
          </div>

          <h4>Stack</h4>
          <select className="task-select" value={task.stack ?? ''} aria-label="Stack" onChange={(e) => set({ stack: e.target.value || undefined, order: e.target.value ? Date.now() : undefined })}>
            <option value="">No stack</option>
            {stacks.map((s) => <option key={s.id} value={s.id}>{s.title || 'Stack'}</option>)}
          </select>

          </fieldset>
          <h4>Activity</h4>
          <ul className="task-activity">
            {log.slice().reverse().map((a, i) => <li key={i}><strong>{a.by}</strong> {a.what}<span className="muted"> · {ago(a.at)}</span></li>)}
            {!log.length && <li className="muted">No activity yet</li>}
          </ul>
        </aside>
      </div>
    </div>
  );
}
