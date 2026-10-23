import { useState } from 'react';
import { copyBlob } from '../clipboard.ts';
import { Download, Copy, X } from 'lucide-react';
import type { Rect } from '../../../shared/layout.ts';
import { boardSvg, download, svgToPng } from './exporter.ts';

export function ExportMenu({ world, area, selectionArea, selectionIds, background, theme, title, onClose, onToast }: {
  world: () => HTMLElement | null; area: Rect | null; selectionArea: Rect | null; selectionIds: string[];
  background: string; theme: string; title: string; onClose: () => void; onToast: (m: string) => void;
}) {
  const [format, setFormat] = useState<'png' | 'svg'>('png');
  const [scale, setScale] = useState(2);
  const [onlySel, setOnlySel] = useState(selectionIds.length > 0);
  const [bg, setBg] = useState(true);
  const [busy, setBusy] = useState(false);

  const render = async () => {
    const el = world(), rect = onlySel && selectionArea ? selectionArea : area;
    if (!el || !rect) throw new Error('The board is empty');
    const svg = await boardSvg(el, rect, { background: bg ? background : null, theme, only: onlySel ? new Set(selectionIds) : undefined });
    return format === 'svg' ? new Blob([svg], { type: 'image/svg+xml' }) : svgToPng(svg, scale);
  };
  const run = async (copy: boolean) => {
    setBusy(true);
    try {
      const blob = await render();
      if (copy) {
        await copyBlob(blob.type, blob);
        onToast(`Copied as ${format.toUpperCase()}`);
      } else download(blob, `${title.replace(/[^\w.-]+/g, '-') || 'board'}.${format}`);
      onClose();
    } catch (e) { onToast(`Export failed: ${(e as Error).message}`); } finally { setBusy(false); }
  };

  return (
    <div className="export-menu" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Export">
      <div className="c-panel-head"><Download size={16} /><strong>Export</strong><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button></div>
      <label className="ex-row">Format
        <div className="seg">
          {(['png', 'svg'] as const).map((f) => <button key={f} className={format === f ? 'active' : ''} onClick={() => setFormat(f)}>{f.toUpperCase()}</button>)}
        </div>
      </label>
      {format === 'png' && (
        <label className="ex-row">Size
          <div className="seg">{[1, 2, 3].map((s) => <button key={s} className={scale === s ? 'active' : ''} onClick={() => setScale(s)}>{s}x</button>)}</div>
        </label>
      )}
      <label className="ex-row check"><input type="checkbox" checked={onlySel} disabled={!selectionIds.length} onChange={(e) => setOnlySel(e.target.checked)} /> Selection only</label>
      <label className="ex-row check"><input type="checkbox" checked={bg} onChange={(e) => setBg(e.target.checked)} /> Include background</label>
      <div className="modal-actions">
        <button className="btn ghost" disabled={busy} onClick={() => run(true)}><Copy size={15} /> Copy</button>
        <button className="btn primary" disabled={busy} onClick={() => run(false)}><Download size={15} /> {busy ? 'Exporting…' : 'Download'}</button>
      </div>
    </div>
  );
}
