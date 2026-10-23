import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export type MenuItem =
  | { label: string; icon?: ReactNode; keys?: string; onClick?: () => void; disabled?: boolean; danger?: boolean; sub?: MenuItem[] }
  | 'sep';

// Right-click menu with Whimsical's layout: icon, label, shortcut, and submenus that open on hover.
export function ContextMenu({ items, x, y, onClose }: { items: MenuItem[]; x: number; y: number; onClose: () => void }) {
  return (
    <div className="ctx-menu" style={{ left: x, top: y }} role="menu" onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      <List items={items} onClose={onClose} />
    </div>
  );
}

function List({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  // Keep the menu on screen: shift it up or to the other side when it would cross an edge.
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setShift({ x: r.right > innerWidth - 8 ? innerWidth - 8 - r.right : 0, y: r.bottom > innerHeight - 8 ? innerHeight - 8 - r.bottom : 0 });
  }, []);
  return (
    <div ref={ref} className="ctx-list" style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}>
      {items.map((it, i) => it === 'sep' ? <hr key={i} /> : (
        <div key={i} className="ctx-row" onPointerEnter={() => setOpen(it.sub ? i : null)}>
          <button role="menuitem" disabled={it.disabled} className={`${it.danger ? 'danger' : ''} ${open === i ? 'open' : ''}`} aria-haspopup={it.sub ? 'menu' : undefined}
            onClick={() => { if (it.sub) return setOpen(open === i ? null : i); it.onClick?.(); onClose(); }}>
            <span className="ctx-icon">{it.icon}</span>{it.label}
            {it.keys && <kbd>{it.keys}</kbd>}
            {it.sub && <ChevronRight size={15} className="ctx-more" />}
          </button>
          {it.sub && open === i && <div className="ctx-sub" role="menu"><List items={it.sub} onClose={onClose} /></div>}
        </div>
      ))}
    </div>
  );
}
