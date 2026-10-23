import { useEffect, useState, type ReactNode } from 'react';
import { Ellipsis, Lock, Star } from 'lucide-react';
import { copyText } from './clipboard.ts';
import { useLocalMode } from './useMe.ts';
import { ShareDialog } from './ShareDialog.tsx';
import { api, starsChanged, type Item, type Role } from './api.ts';
import { Presence } from './engine/Canvas.tsx';
import type { useBoard } from './engine/useBoard.ts';

// The item (board or doc) and the signed-in person's role on it.
export function useItem(id: string, onItem: (i: Item) => void) {
  const [role, setRole] = useState<Role>('view'), [error, setError] = useState('');
  useEffect(() => { api.board(id).then((i) => { setRole(i.role ?? 'view'); onItem(i); }, (e) => setError(e.message)); }, [id]);
  return { role, error };
}

// A message at the bottom of the page for 5 seconds.
export function useToast() {
  const [toast, setToast] = useState('');
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 5000); return () => clearTimeout(t); }, [toast]);
  return [toast, setToast] as const;
}

// The title bar of a board or doc: breadcrumb (header), star, who is here, the role, Share, and the menu with the
// page's own items first, then Copy link and Save copy to Google Drive.
export function ItemBar({ id, noun, header, board, role, items, onToast }: {
  id: string; noun: 'board' | 'doc'; header: ReactNode; board: ReturnType<typeof useBoard>; role: Role;
  items: { label: ReactNode; onClick: () => void }[]; onToast: (t: string) => void;
}) {
  const local = useLocalMode(); // one person: nothing to share
  const [menu, setMenu] = useState(false), [sharing, setSharing] = useState(false), [starred, setStarred] = useState(false);
  useEffect(() => { api.stars().then((l) => setStarred(l.some((s) => s.item_id === id && !s.object_id)), () => {}); }, [id]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    addEventListener('pointerdown', close);
    return () => removeEventListener('pointerdown', close);
  }, [menu]);
  const pick = (fn: () => void) => () => { setMenu(false); fn(); };
  const driveCopy = async () => {
    onToast('Saving a copy to Google Drive…');
    try { await api.driveCopy(id); onToast('Saved to the pragmatic folder in your Google Drive'); }
    catch (e) {
      const m = (e as Error).message;
      // Drive not connected yet: Google's consent page, then back here.
      if (/connect/i.test(m)) location.assign(`/auth/drive?next=${encodeURIComponent(location.pathname)}`);
      else onToast(m);
    }
  };
  return (
    <div className="title-bar">
      {header}
      <button className={`icon-btn star-btn ${starred ? 'on' : ''}`} aria-label={starred ? 'Remove star' : `Star this ${noun}`} aria-pressed={starred} title={starred ? 'Starred' : 'Star'}
        onClick={async () => { await api.star(id, !starred); setStarred(!starred); starsChanged(); }}><Star size={16} fill={starred ? 'currentColor' : 'none'} /></button>
      <Presence board={board} />
      {(role === 'view' || role === 'comment') && <span className="role-pill">{role === 'view' ? 'View only' : 'Can comment'}</span>}
      {!local && <button className="btn share-btn" onClick={() => setSharing(true)}><Lock size={14} /> Share</button>}
      <span className="menu-wrap" onPointerDown={(e) => e.stopPropagation()}>
        <button className="icon-btn board-menu-btn" aria-label={noun === 'doc' ? 'Doc menu' : 'Board menu'} aria-expanded={menu} onClick={() => setMenu(!menu)}><Ellipsis size={18} /></button>
        {menu && (
          <div className="menu" role="menu">
            {items.map((it, i) => <button key={i} role="menuitem" onClick={pick(it.onClick)}>{it.label}</button>)}
            <button role="menuitem" onClick={pick(() => copyText(location.href).then(() => onToast('Link copied')))}>Copy link</button>
            <button role="menuitem" onClick={pick(driveCopy)}>Save copy to Google Drive</button>
          </div>
        )}
      </span>
      {sharing && <ShareDialog id={id} onClose={() => setSharing(false)} onToast={onToast} />}
    </div>
  );
}
