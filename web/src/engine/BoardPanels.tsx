import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Clock, GitFork, History, Pause, Play, Plus, RotateCcw, Square, Star, ThumbsUp, Timer, Trash2, X } from 'lucide-react';
import { COLOR_NAMES, NEUTRAL } from '../../../shared/model.ts';
import { PRESETS, paletteOf, settingsOf, votesOf, type BoardTheme, type TimerState, type VotingSession } from '../../../shared/themes.ts';
import { api, ago, itemPath, navigate } from '../api.ts';
import type { Me } from './Comments.tsx';

const set = (doc: Y.Doc, key: string, v: unknown) => (v === null ? settingsOf(doc).delete(key) : settingsOf(doc).set(key, JSON.stringify(v)));

// --- color theme ---------------------------------------------------------------------
export type WorkspaceThemes = Awaited<ReturnType<typeof api.themes>>;
// The workspace default changed: open boards reload it.
export const themesChanged = () => dispatchEvent(new Event('pragmatic:themes'));

export function ThemeDialog({ doc, current, meId, onClose }: { doc: Y.Doc; current: BoardTheme | undefined; meId: string; onClose: () => void }) {
  const active = current?.name ?? 'Whimsical';
  const [ws, setWs] = useState<WorkspaceThemes | null>(null);
  const [error, setError] = useState('');
  const load = () => api.themes().then(setWs, (e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const act = (p: Promise<unknown>) => p.then(() => { load(); themesChanged(); }, (e) => setError(e.message));
  const pal = paletteOf(current);
  const apply = (t: BoardTheme | null) => set(doc, 'theme', t && t.name !== 'Whimsical' ? t : null);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal theme-modal" role="dialog" aria-modal="true" aria-labelledby="theme-title" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
        <div className="gallery-head"><h2 id="theme-title">Color theme</h2><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button></div>
        <p className="muted">The theme recolors every object on this board. Each color keeps its name, so Claude and templates still work.</p>
        <div className="theme-grid">
          {PRESETS.map((t) => {
            const p = paletteOf(t);
            return (
              <button key={t.name} className={`theme-card ${active === t.name ? 'active' : ''}`} onClick={() => apply(t)}>
                <span className="theme-swatches">{COLOR_NAMES.filter((c) => !NEUTRAL.has(c)).slice(0, 8).map((c) => <span key={c} style={{ background: p[c].base }} />)}</span>
                {t.name}
              </button>
            );
          })}
        </div>
        <h3>Workspace themes</h3>
        <p className="muted">Shared with everyone. Boards without their own theme use the workspace default.</p>
        <div className="theme-grid">
          {ws?.themes.map((t) => {
            const p = paletteOf({ name: t.name, base: t.base });
            return (
              <div key={t.id} className={`theme-card ws ${active === t.name ? 'active' : ''}`}>
                <button className="theme-apply" onClick={() => apply({ name: t.name, base: t.base })}>
                  <span className="theme-swatches">{COLOR_NAMES.filter((c) => !NEUTRAL.has(c)).slice(0, 8).map((c) => <span key={c} style={{ background: p[c].base }} />)}</span>
                  {t.name}{ws.default_id === t.id && <span className="theme-default">Default</span>}
                </button>
                <span className="theme-tools">
                  <button className="icon-btn" aria-label={ws.default_id === t.id ? 'Stop using as workspace default' : 'Make workspace default'} title={ws.default_id === t.id ? 'Workspace default' : 'Make workspace default'}
                    onClick={() => act(api.setDefaultTheme(ws.default_id === t.id ? null : t.id))}><Star size={14} fill={ws.default_id === t.id ? 'currentColor' : 'none'} /></button>
                  {t.created_by === meId && <button className="icon-btn" aria-label={`Delete ${t.name}`} title="Delete" onClick={() => act(api.deleteTheme(t.id))}><Trash2 size={14} /></button>}
                </span>
              </div>
            );
          })}
          {current && (
            <button className="theme-card add" onClick={() => { const n = prompt('Name for the workspace theme', current.name === 'Custom' ? '' : current.name); if (n?.trim()) act(api.saveTheme(n.trim(), current.base as Record<string, string>)); }}>
              <Plus size={16} /> Save this board's theme for the workspace
            </button>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        <h3>Customize</h3>
        <div className="theme-custom">
          {COLOR_NAMES.filter((c) => !NEUTRAL.has(c)).map((c) => (
            <label key={c} className="theme-color">
              <input type="color" value={pal[c].base.toLowerCase()} onChange={(e) => apply({ name: 'Custom', base: { ...(current?.base ?? {}), [c]: e.target.value } })} />
              <span>{c}</span>
            </label>
          ))}
        </div>
        <div className="modal-actions"><button className="btn ghost" onClick={() => apply(null)}>Reset to default</button><button className="btn primary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

// --- timer ------------------------------------------------------------------------------
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function TimerStart({ doc, me, onClose }: { doc: Y.Doc; me: Me; onClose: () => void }) {
  const [custom, setCustom] = useState('3');
  const start = (min: number) => { set(doc, 'timer', { endsAt: Date.now() + min * 60_000, left: null, total: min * 60_000, byName: me.name } satisfies TimerState); onClose(); };
  return (
    <div className="board-pop" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="c-panel-head"><Timer size={16} /><strong>Timer</strong><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button></div>
      <p className="muted">Everyone on the board sees the same countdown.</p>
      <div className="pop-buttons">{[1, 2, 5, 10, 15].map((m) => <button key={m} className="btn ghost" onClick={() => start(m)}>{m} min</button>)}</div>
      <form className="pop-row" onSubmit={(e) => { e.preventDefault(); const n = Number(custom); if (n > 0 && n <= 180) start(n); }}>
        <input className="field" type="number" min={1} max={180} value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom minutes" />
        <button className="btn primary" type="submit">Start</button>
      </form>
    </div>
  );
}

function chime() {
  try {
    const ctx = new AudioContext();
    [0, 0.25, 0.5].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = [880, 988, 1175][i];
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.4);
    });
  } catch { /* no audio */ }
}

export function TimerPill({ doc, timer }: { doc: Y.Doc; timer: TimerState }) {
  const [now, setNow] = useState(Date.now());
  const rang = useRef(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  const left = timer.endsAt ? timer.endsAt - now : timer.left ?? 0;
  const done = timer.endsAt !== null && left <= 0;
  useEffect(() => { if (done && !rang.current && now - timer.endsAt! < 3000) { rang.current = true; chime(); } }, [done]);
  useEffect(() => { if (done && now - timer.endsAt! > 15_000) set(doc, 'timer', null); }, [done, now]);
  return (
    <div className={`timer-pill ${done ? 'done' : left < 10_000 ? 'ending' : ''}`} role="timer" aria-live="polite" onPointerDown={(e) => e.stopPropagation()}>
      <Clock size={15} />
      <span className="timer-time">{done ? "Time's up" : mmss(left)}</span>
      {!done && (timer.endsAt
        ? <button className="icon-btn" aria-label="Pause timer" onClick={() => set(doc, 'timer', { ...timer, endsAt: null, left })}><Pause size={14} /></button>
        : <button className="icon-btn" aria-label="Resume timer" onClick={() => set(doc, 'timer', { ...timer, endsAt: Date.now() + (timer.left ?? 0), left: null })}><Play size={14} /></button>)}
      {!done && <button className="icon-btn" aria-label="Add one minute" onClick={() => set(doc, 'timer', timer.endsAt ? { ...timer, endsAt: timer.endsAt + 60_000 } : { ...timer, left: (timer.left ?? 0) + 60_000 })}><Plus size={14} /></button>}
      <button className="icon-btn" aria-label="Stop timer" onClick={() => set(doc, 'timer', null)}><Square size={13} /></button>
    </div>
  );
}

// --- voting -------------------------------------------------------------------------------
export function VotingStart({ doc, me, onClose }: { doc: Y.Doc; me: Me; onClose: () => void }) {
  const [per, setPer] = useState(3);
  const start = () => {
    doc.transact(() => {
      for (const k of [...votesOf(doc).keys()]) votesOf(doc).delete(k);
      set(doc, 'voting', { active: true, perPerson: per, by: me.id, byName: me.name, at: Date.now() } satisfies VotingSession);
    });
    onClose();
  };
  return (
    <div className="board-pop" onPointerDown={(e) => e.stopPropagation()}>
      <div className="c-panel-head"><ThumbsUp size={16} /><strong>Voting</strong><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button></div>
      <p className="muted">Votes per person</p>
      <div className="pop-buttons">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((n) => <button key={n} className={`btn ghost ${per === n ? 'selected' : ''}`} onClick={() => setPer(n)}>{n || '∞'}</button>)}
      </div>
      <p className="muted small">Everyone clicks objects to vote. You see only your own votes until the session ends.</p>
      <div className="modal-actions"><button className="btn primary" onClick={start}>Start voting</button></div>
    </div>
  );
}

export const myVotes = (votes: Record<string, Record<string, number>>, me: string) => votes[me] ?? {};
export const usedVotes = (mine: Record<string, number>) => Object.values(mine).reduce((a, b) => a + b, 0);
export function castVote(doc: Y.Doc, me: string, objectId: string, delta: 1 | -1, session: VotingSession, mine: Record<string, number>) {
  if (delta > 0 && session.perPerson && usedVotes(mine) >= session.perPerson) return false;
  const n = Math.max(0, (mine[objectId] ?? 0) + delta);
  const next = { ...mine, [objectId]: n };
  if (!n) delete next[objectId];
  votesOf(doc).set(me, JSON.stringify(next));
  return true;
}
export const totals = (votes: Record<string, Record<string, number>>) => {
  const t: Record<string, number> = {};
  for (const v of Object.values(votes)) for (const [id, n] of Object.entries(v)) t[id] = (t[id] ?? 0) + n;
  return t;
};

export function VotingBanner({ doc, session, votes, me, voting, setVoting }: {
  doc: Y.Doc; session: VotingSession; votes: Record<string, Record<string, number>>; me: Me; voting: boolean; setVoting: (v: boolean) => void;
}) {
  const used = usedVotes(myVotes(votes, me.id));
  const voters = Object.values(votes).filter((v) => usedVotes(v) > 0).length;
  if (!session.active) {
    const top = Object.values(totals(votes)).reduce((a, b) => Math.max(a, b), 0);
    return (
      <div className="vote-banner" onPointerDown={(e) => e.stopPropagation()}>
        <ThumbsUp size={15} /> <strong>Voting results</strong> <span className="muted">{voters} {voters === 1 ? 'person' : 'people'} voted · top {top}</span>
        <button className="btn ghost" onClick={() => doc.transact(() => { set(doc, 'voting', null); for (const k of [...votesOf(doc).keys()]) votesOf(doc).delete(k); })}>Clear results</button>
      </div>
    );
  }
  return (
    <div className="vote-banner" onPointerDown={(e) => e.stopPropagation()}>
      <ThumbsUp size={15} />
      <strong>{session.perPerson ? `${Math.max(0, session.perPerson - used)} of ${session.perPerson} votes left` : `${used} votes`}</strong>
      <span className="muted">{voters} voting · started by {session.byName}</span>
      <button className="btn ghost" onClick={() => setVoting(!voting)}>{voting ? 'Back to editing' : 'Vote'}</button>
      <button className="btn primary" onClick={() => set(doc, 'voting', { ...session, active: false })}>End voting</button>
    </div>
  );
}

// --- time machine ---------------------------------------------------------------------------
export function HistoryPanel({ boardId, onPreview, previewing, onClose, onToast }: {
  boardId: string; onPreview: (v: { id: string; at: number } | null) => void; previewing: string | null; onClose: () => void; onToast: (m: string) => void;
}) {
  const [list, setList] = useState<{ id: string; at: number; authors: string[] }[] | null>(null);
  useEffect(() => { api.versions(boardId).then(setList, () => setList([])); }, [boardId]);
  return (
    <aside className="c-panel" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="c-panel-head"><History size={16} /><strong>Time machine</strong><button className="icon-btn" aria-label="Close" onClick={() => { onPreview(null); onClose(); }}><X size={16} /></button></div>
      {list && !list.length && <p className="muted pad">No changes yet. Every change is kept for 30 days, then one point per hour for 6 months, then one per day.</p>}
      {!list && <div className="spinner" />}
      {list?.map((v) => (
        <div key={v.id} className={`c-card version ${previewing === v.id ? 'active' : ''}`} role="button" tabIndex={0} onClick={() => onPreview(v)} onKeyDown={(e) => e.key === 'Enter' && onPreview(v)}>
          <strong>{new Date(v.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</strong>
          <span className="muted">{ago(v.at)} · {v.authors.join(', ') || 'unknown'}</span>
          {previewing === v.id && (
            <div className="pop-buttons">
              <button className="btn primary" onClick={async (e) => { e.stopPropagation(); await api.restoreVersion(boardId, v.id); onPreview(null); onToast('Board restored to this version'); }}><RotateCcw size={14} /> Restore</button>
              <button className="btn ghost" onClick={async (e) => { e.stopPropagation(); const b = await api.forkVersion(boardId, v.id); onPreview(null); navigate(itemPath(b)); }}><GitFork size={14} /> Fork</button>
            </div>
          )}
        </div>
      ))}
    </aside>
  );
}
