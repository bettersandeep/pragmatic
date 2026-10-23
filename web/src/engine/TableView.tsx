import { memo, useEffect, useMemo } from 'react';
import { FONT_SIZES, cellKey, type TableObj } from '../../../shared/model.ts';
import { COL_W } from '../../../shared/tableOps.ts';
import { EditText } from './ObjectView.tsx';
import { measureText, useFontsReady } from './measure.ts';
import { CANVAS, mix, type Theme, activePalette } from './theme.ts';

const PAD_X = 10, PAD_Y = 8;
export type CellKey = 'Tab' | 'ShiftTab' | 'Enter';

type Props = {
  o: TableObj; layer: number; theme: Theme; focus: [string, string] | null; editing: [string, string] | null; pv?: number;
  onCommitCell: (id: string, row: string, col: string, text: string, then?: CellKey) => void;
  onLayout: (id: string, patch: Record<string, number>) => void;
};

export const TableView = memo(function TableView({ o, layer, theme, focus, editing, onCommitCell, onLayout }: Props) {
  const fonts = useFontsReady();
  const px = FONT_SIZES[o.fontSize ?? 's'];
  const head = o.style !== 'none' && o.style !== 'filled';
  // Columns share the box width in proportion to their stored widths.
  const widths = useMemo(() => {
    const raw = o.cols.map((c) => o.colW[c] ?? COL_W), sum = raw.reduce((a, b) => a + b, 0) || 1;
    return raw.map((w) => (w / sum) * o.w);
  }, [o.cols, o.colW, o.w]);
  const heights = useMemo(() => o.rows.map((r, i) => Math.max(
    px * 1.3 + PAD_Y * 2,
    ...o.cols.map((c, j) => measureText(o[cellKey(r, c)] ?? '', px, head && i === 0 ? 600 : 500, Math.max(20, widths[j] - PAD_X * 2)).h + PAD_Y * 2),
  )), [o, widths, fonts]);
  const total = Math.ceil(heights.reduce((a, b) => a + b, 0));
  useEffect(() => { if (Math.abs(total - o.h) > 0.5) onLayout(o.id, { h: total }); }, [total]);

  const t = CANVAS[theme], c = activePalette()[o.headColor];
  const line = theme === 'light' ? '#C4CFDA' : '#3A434D';
  const tint = theme === 'light' ? c.fill : mix(t.bg, c.base, 0.22);
  const cellStyle = (i: number): React.CSSProperties => {
    if (o.style === 'filled') return { background: tint };
    if (i === 0 && (o.style === 'contrast' || o.style === 'striped')) return { background: c.base, color: '#fff', fontWeight: 600 };
    if (i === 0 && o.style === 'plain') return { background: tint, fontWeight: 600 };
    if (o.style === 'striped' && i % 2 === 0) return { background: theme === 'light' ? '#F2F5F7' : '#1A1F26' };
    return { background: t.bg };
  };
  let y = 0;
  return (
    <div className="obj table-obj" data-id={o.id} style={{ left: o.x, top: o.y, width: o.w, height: o.h, zIndex: layer, fontSize: px, color: t.text, borderColor: line }}>
      {o.rows.map((r, i) => {
        let x = 0;
        const top = y;
        y += heights[i];
        return o.cols.map((col, j) => {
          const left = x;
          x += widths[j];
          const isEdit = editing?.[0] === r && editing[1] === col, isFocus = focus?.[0] === r && focus[1] === col;
          return (
            <div key={`${r}.${col}`} className={`cell ${isFocus ? 'focus' : ''}`} data-cell={`${r}.${col}`} data-table={o.id}
              style={{ left, top, width: widths[j], height: heights[i], borderColor: line, ...cellStyle(i) }}>
              {isEdit
                ? <EditText value={o[cellKey(r, col)] ?? ''} bind={{ id: o.id, key: cellKey(r, col) }} onCommit={(text) => onCommitCell(o.id, r, col, text)}
                    onKey={(e, text) => {
                      const k: CellKey | null = e.key === 'Tab' ? (e.shiftKey ? 'ShiftTab' : 'Tab') : e.key === 'Enter' && !e.shiftKey ? 'Enter' : null;
                      if (!k) return false;
                      onCommitCell(o.id, r, col, text, k);
                      return true;
                    }} />
                : <span className="cell-text">{o[cellKey(r, col)] ?? ''}</span>}
            </div>
          );
        });
      })}
    </div>
  );
});
