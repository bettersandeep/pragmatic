import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { api, type TemplateInfo } from './api.ts';
import { Glyph } from './engine/IconView.tsx';

export function TemplateGallery({ title, onPick, onClose }: { title: string; onPick: (t: TemplateInfo) => void; onClose: () => void }) {
  const [list, setList] = useState<TemplateInfo[] | null>(null);
  const load = () => api.templates().then(setList);
  useEffect(() => { load(); }, []);
  const groups = [['workspace', 'Your workspace'], ['built-in', 'Built-in']] as const;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal gallery" role="dialog" aria-modal="true" aria-labelledby="tpl-title" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
        <div className="gallery-head"><h2 id="tpl-title">{title}</h2><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button></div>
        {!list && <div className="spinner" />}
        {list && groups.map(([source, label]) => {
          const items = list.filter((t) => t.source === source);
          if (!items.length) return null;
          return (
            <section key={source}>
              <h3>{label}</h3>
              <div className="tpl-grid">
                {items.map((t) => (
                  <div key={t.id} className="tpl-card" role="button" tabIndex={0} onClick={() => onPick(t)} onKeyDown={(e) => e.key === 'Enter' && onPick(t)}>
                    <div className="tpl-thumb"><Glyph name={t.icon} size={30} color="currentColor" strokeWidth={1.6} /></div>
                    <div className="tpl-title">{t.title}</div>
                    <div className="tpl-desc">{t.description || (t.owner ? `By ${t.owner}` : '')}</div>
                    {t.mine && (
                      <button className="icon-btn tpl-del" aria-label={`Delete template ${t.title}`}
                        onClick={async (e) => { e.stopPropagation(); await api.deleteTemplate(t.id); load(); }}><Trash2 size={15} /></button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
