import { memo, useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { kebab, type IconObj } from '../../../shared/model.ts';
import { CANVAS, mix, type Theme, activePalette } from './theme.ts';
import { EditText } from './ObjectView.tsx';

// The full icon set is ~1,600 icons; load it in its own chunk on first use.
// Keyed by kebab-case name ("circle-check"), which is what the model and MCP use.
let iconsPromise: Promise<Record<string, LucideIcon>> | null = null;
export const loadIcons = () => (iconsPromise ??= import('lucide-react').then((m) =>
  Object.fromEntries(Object.entries(m.icons as Record<string, LucideIcon>).map(([k, v]) => [kebab(k), v]))));

export function useIcons() {
  const [icons, setIcons] = useState<Record<string, LucideIcon> | null>(null);
  useEffect(() => { let live = true; loadIcons().then((i) => live && setIcons(i)); return () => { live = false; }; }, []);
  return icons;
}

export function Glyph({ name, size, color, strokeWidth = 2 }: { name: string; size: number; color: string; strokeWidth?: number }) {
  const icons = useIcons();
  const I = icons?.[name] ?? icons?.['circle-question-mark'];
  return I ? <I size={size} color={color} strokeWidth={strokeWidth} absoluteStrokeWidth={false} /> : <span style={{ width: size, height: size, display: 'inline-block' }} />;
}

// An icon inside text (mind map nodes): the same disc and ink as icon objects, sized to the text.
export function InlineIcon({ name, deco = 'multicolor', color, size, theme }: { name: string; deco?: 'multicolor' | 'fill' | 'outline'; color: keyof ReturnType<typeof activePalette>; size: number; theme: Theme }) {
  const c = activePalette()[color], t = CANVAS[theme];
  const base = color === 'white' || color === 'default' ? t.text : c.base;
  const disc = deco === 'fill' ? base : deco === 'multicolor' ? (theme === 'light' ? c.fill : mix(t.bg, c.base, 0.25)) : 'transparent';
  return (
    <span className="inline-icon" style={{ width: size, height: size, background: disc }}>
      <Glyph name={name} size={Math.round(size * (deco === 'outline' ? 0.92 : 0.62))} color={deco === 'fill' ? '#FFFFFF' : base} strokeWidth={deco === 'outline' ? 1.6 : 2} />
    </span>
  );
}

export const IconView = memo(function IconView({ o, layer, theme, editing, onCommit }: { o: IconObj; layer: number; theme: Theme; editing: boolean; onCommit: (t: string) => void; pv?: number }) {
  const c = activePalette()[o.color], t = CANVAS[theme];
  const d = Math.max(16, Math.min(o.w, o.h)); // the label hangs below the box, like Whimsical
  const base = o.color === 'white' ? t.text : c.base;
  const disc = o.deco === 'fill' ? base : o.deco === 'multicolor' ? (theme === 'light' ? c.fill : mix(t.bg, c.base, 0.25)) : 'transparent';
  const ink = o.deco === 'fill' ? '#FFFFFF' : base;
  return (
    <div className="obj icon-obj" data-id={o.id} style={{ left: o.x, top: o.y, width: o.w, height: o.h, zIndex: layer }}>
      <div className="icon-disc" style={{ width: d, height: d, background: disc }}>
        <span className="icon-glyph" style={o.rotate ? { transform: `rotate(${o.rotate}deg)` } : undefined}>
          <Glyph name={o.icon} size={Math.round(d * (o.deco === 'outline' ? 0.92 : 0.56))} color={ink} strokeWidth={o.deco === 'outline' ? 1.6 : 2} />
        </span>
      </div>
      {(o.text || editing) && <div className="icon-label" style={{ color: t.text }}>{editing ? <EditText value={o.text} bind={{ id: o.id, key: 'text' }} onCommit={onCommit} single autoWidth /> : o.text}</div>}
    </div>
  );
});

type IconDeco = 'multicolor' | 'fill' | 'outline';
// `deco` + `onDeco`: the style buttons beside the search (mind map node icons); `onRemove`: a "No icon" choice.
export function IconPicker({ onPick, deco, onDeco, onRemove }: { onPick: (name: string) => void; deco?: IconDeco; onDeco?: (d: IconDeco) => void; onRemove?: () => void }) {
  const icons = useIcons();
  const [q, setQ] = useState('');
  const names = useMemo(() => Object.keys(icons ?? {}), [icons]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (term ? names.filter((n) => n.includes(term)) : names).slice(0, 120);
  }, [names, q]);
  return (
    <div className="icon-picker" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="icon-picker-head">
        <input autoFocus className="search" placeholder="Search icons" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search icons" />
        {onDeco && (
          <span className="cb-group icon-decos">
            {(['multicolor', 'fill', 'outline'] as const).map((d) => (
              <button key={d} className={`cb-btn ${deco === d ? 'active' : ''}`} aria-label={d} aria-pressed={deco === d} data-tip={d[0].toUpperCase() + d.slice(1)} onClick={() => onDeco(d)}>
                <span className={`deco-swatch deco-swatch-${d}`} />
              </button>
            ))}
          </span>
        )}
      </div>
      {onRemove && <button className="icon-remove" onClick={onRemove}>No icon</button>}
      <div className="icon-grid">
        {!icons && <div className="spinner" />}
        {shown.map((n) => (
          <button key={n} className="cb-btn" aria-label={n} data-tip={n} onClick={() => onPick(n)}><Glyph name={n} size={18} color="currentColor" /></button>
        ))}
        {icons && !shown.length && <p className="muted pad">No icon matches</p>}
      </div>
    </div>
  );
}
