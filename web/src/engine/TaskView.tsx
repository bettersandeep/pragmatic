import { memo, useEffect, useState } from 'react';
import { Bell, MessageSquare, UserRound } from 'lucide-react';
import type { StackObj, TaskObj } from '../../../shared/model.ts';
import { STACK_HEAD, tagColor } from '../../../shared/tasks.ts';
import type { Person } from '../api.ts';
import { Avatar, people } from './Comments.tsx';
import { EditText } from './ObjectView.tsx';
import { CANVAS, activePalette, mix, sectionPaint, shapePaint, type Theme } from './theme.ts';

// Workspace people by id, loaded once.
export function usePeople() {
  const [map, setMap] = useState(new Map<string, Person>());
  useEffect(() => { people().then((ps) => setMap(new Map(ps.map((p) => [p.id, p])))); }, []);
  return map;
}

export function TagPill({ tag, theme }: { tag: string; theme: Theme }) {
  const c = activePalette()[tagColor(tag)];
  return <span className="task-tag" style={{ background: theme === 'light' ? c.fill : mix(CANVAS.dark.bg, c.base, 0.35), color: theme === 'light' ? mix(c.base, '#1F2A35', 0.45) : '#fff' }}>{tag}</span>;
}

type Props = { o: TaskObj; layer: number; theme: Theme; editing: boolean; me: string; comments: number; pv?: number; onCommit: (id: string, text: string, before?: string) => void };

export const TaskView = memo(function TaskView({ o, layer, theme, editing, me, comments, onCommit }: Props) {
  const ppl = usePeople();
  const paint = shapePaint(o.color, 'fill', theme);
  const who = o.assignee ? ppl.get(o.assignee) : undefined;
  const xs = o.size === 'xs';
  const foot = !xs && (o.watch?.includes(me) || comments > 0 || o.tags?.length);
  return (
    <div className={`obj task-card size-${o.size}`} data-id={o.id} style={{ left: o.x, top: o.y, width: o.w, height: o.h, zIndex: layer, background: paint.fill, color: paint.text }}>
      <div className="task-head">
        <div className="task-title">{editing ? <EditText value={o.title} bind={{ id: o.id, key: 'title' }} onCommit={(t, before) => onCommit(o.id, t, before)} single selectAll /> : o.title || <span className="placeholder">Untitled</span>}</div>
        <span className="task-who" title={who ? `Assigned to ${who.name}` : 'Not assigned'}>{who ? <Avatar p={who} size={xs ? 20 : 24} /> : <UserRound size={xs ? 16 : 18} strokeWidth={1.8} />}</span>
      </div>
      {o.size === 'l' && o.desc && <div className="task-desc">{o.desc}</div>}
      {foot && (
        <div className="task-foot">
          {o.watch?.includes(me) && <Bell size={14} strokeWidth={2} aria-label="You get notifications" />}
          {comments > 0 && <span className="task-count"><MessageSquare size={13} strokeWidth={2} />{comments}</span>}
          {o.tags?.map((t) => <TagPill key={t} tag={t} theme={theme} />)}
        </div>
      )}
    </div>
  );
});

export const StackView = memo(function StackView({ o, layer, theme, editing, onCommit }: { o: StackObj; layer: number; theme: Theme; editing: boolean; onCommit: (t: string) => void; pv?: number }) {
  const p = sectionPaint(o.color, 'fill', theme);
  return (
    <div className="obj task-stack" data-id={o.id} style={{ left: o.x, top: o.y, width: o.w, height: o.h, zIndex: layer, background: p.fill, borderColor: p.stroke }}>
      <div className="stack-title" style={{ height: STACK_HEAD, color: p.title }}>{editing ? <EditText value={o.title} onCommit={onCommit} single selectAll /> : o.title || 'Stack'}</div>
    </div>
  );
});
