import { useState, type ReactNode } from 'react';
import { api, type Item, type User } from './api.ts';
import { ItemBar, useItem, useToast } from './ItemBar.tsx';
import { Canvas } from './engine/Canvas.tsx';
import { useBoard } from './engine/useBoard.ts';
import { ThemeDialog } from './engine/BoardPanels.tsx';
import type { BoardTheme } from '../../shared/themes.ts';
import type { Theme } from './engine/theme.ts';

export function Board({ id, theme, user, onItem, header }: { id: string; theme: Theme; user: User; onItem: (i: Item) => void; header: ReactNode }) {
  const [toast, setToast] = useToast();
  const rendering = new URLSearchParams(location.search).get('render') === '1';
  const board = useBoard(id, user, rendering);
  const { role, error } = useItem(id, onItem);
  const [saving, setSaving] = useState(false);
  const [theming, setTheming] = useState(false);

  if (error) return <div className="empty"><h2>Board not available</h2><p>{error}</p></div>;
  return (
    <>
      <ItemBar id={id} noun="board" header={header} board={board} role={role} onToast={setToast}
        items={[{ label: 'Color theme…', onClick: () => setTheming(true) }, { label: 'Save as template…', onClick: () => setSaving(true) }]} />
      {theming && <ThemeDialog doc={board.doc} current={board.settings.theme as BoardTheme | undefined} meId={user.id} onClose={() => setTheming(false)} />}
      {saving && <SaveTemplate onClose={() => setSaving(false)} onSave={async (title, description) => {
        await api.saveTemplate(id, title, description);
        setSaving(false);
        setToast('Saved as a workspace template');
      }} />}
      <div className="board">
        <Canvas board={board} boardId={id} theme={theme} role={rendering ? 'view' : role} onToast={setToast} />
        {!board.synced && <div className="board-loading"><div className="spinner" /></div>}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </>
  );
}

function SaveTemplate({ onClose, onSave }: { onClose: () => void; onSave: (title: string, description: string) => Promise<void> }) {
  const [title, setTitle] = useState(document.title.split(' · ')[0]);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="save-tpl" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
        <h2 id="save-tpl">Save as template</h2>
        <p className="muted">Everyone in the workspace can start a board from it. The board itself does not change.</p>
        <input className="field" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Template name" aria-label="Template name" />
        <input className="field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description (optional)" aria-label="Description" />
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!title.trim()} onClick={() => onSave(title, description).catch((e) => setError(e.message))}>Save template</button>
        </div>
      </div>
    </div>
  );
}
