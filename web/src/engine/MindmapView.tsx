import { memo, useEffect, useMemo } from 'react';
import { FONT_SIZES, type MindmapObj } from '../../../shared/model.ts';
import { layoutMindmap, nodeIcon } from '../../../shared/mindmapLayout.ts';
import { measureText, useFontsReady } from './measure.ts';
import { RichField } from './ObjectView.tsx';
import { RichView, inList } from './rich.tsx';
import { InlineIcon } from './IconView.tsx';
import { CANVAS, inkColor, lineColor, shapePaint, type Theme } from './theme.ts';

// The root text of a new mind map; the first edit selects it, so typing replaces it.
export const NEW_ROOT = 'Central idea';

export type NodeKey = 'Enter' | 'Tab' | 'ShiftTab' | 'ModEnter' | 'AltEnter' | 'Indent' | 'Outdent';

// The mind map keys while a node is being typed in, as Whimsical: Enter a sibling (inside a list: a new item),
// Tab a child, ⌘Enter a sibling above, ⌥Enter a parent, ⌘⌃] / ⌘⌃[ indent / outdent. Shift+Enter is a line break.
export function nodeKey(e: KeyboardEvent, listItem: boolean): NodeKey | null {
  if (e.ctrlKey && (e.metaKey || e.altKey) && (e.key === ']' || e.key === '[')) return e.key === ']' ? 'Indent' : 'Outdent';
  if (e.key === 'Tab') return e.shiftKey ? 'ShiftTab' : 'Tab';
  if (e.key !== 'Enter' || e.shiftKey) return null;
  if (e.metaKey || e.ctrlKey) return 'ModEnter';
  if (e.altKey) return 'AltEnter';
  return listItem ? null : 'Enter';
}

type Props = {
  o: MindmapObj; layer: number; theme: Theme; focus: string | null; editing: string | null; pv?: number;
  onCommitNode: (mapId: string, nodeId: string, text: string, then?: NodeKey) => void;
  onLayout: (mapId: string, patch: Record<string, number>) => void;
};

export const MindmapView = memo(function MindmapView({ o, layer, theme, focus, editing, onCommitNode, onLayout }: Props) {
  const fonts = useFontsReady();
  const layout = useMemo(() => layoutMindmap(o, measureText), [o, fonts]);

  // Keep the root where it is while branches grow in any direction.
  useEffect(() => {
    if (!layout) return;
    const same = (a: number, b: number) => Math.abs(a - b) < 0.5;
    if (same(layout.w, o.w) && same(layout.h, o.h) && same(layout.rx, o.rx ?? 0) && same(layout.ry, o.ry ?? 0)) return;
    onLayout(o.id, { x: o.x + (o.rx ?? 0) - layout.rx, y: o.y + (o.ry ?? 0) - layout.ry, w: layout.w, h: layout.h, rx: layout.rx, ry: layout.ry });
  }, [layout]);

  if (!layout) return null;
  const base = FONT_SIZES[o.fontSize ?? 'm'];
  const vertical = o.layout === 'vertical';
  return (
    <div className={`obj mindmap ${vertical ? 'vertical' : ''}`} data-id={o.id} style={{ left: o.x, top: o.y, width: o.w, height: o.h, zIndex: layer }}>
      <svg className="mm-edges" width={layout.w} height={layout.h} aria-hidden="true">
        {layout.edges.map((e) => <path key={e.to} d={e.d} stroke={lineColor(e.color, theme)} strokeWidth={2} fill="none" strokeLinecap="round" strokeDasharray={e.dash ? '6 5' : undefined} />)}
      </svg>
      {[...layout.nodes.values()].map((n) => {
        const root = n.depth === 0;
        const ink = inkColor(n.color, theme);
        const paint = root ? shapePaint(n.color === 'default' ? 'default' : n.color, 'fill', theme) : null;
        const px = root ? Math.round(base * 1.2) : base;
        const style: React.CSSProperties = {
          left: n.x, top: n.y, width: n.w, height: n.h, fontSize: px,
          ...(root ? { background: paint!.fill, color: paint!.text }
            : vertical ? { borderColor: ink, color: CANVAS[theme].text }
            : { color: CANVAS[theme].text }), // the underline is the end of the branch line (mindmapLayout)
        };
        return (
          <div key={n.id} className={`mm-node ${root ? 'root' : ''} ${focus === n.id ? 'focus' : ''} ${n.icon ? 'has-icon' : ''}`} data-node={n.id} data-map={o.id} style={style}>
            {n.icon && <InlineIcon name={n.icon} deco={n.iconDeco} color={n.color} size={nodeIcon(px).size} theme={theme} />}
            {editing === n.id
              ? <RichField bind={{ id: o.id, key: `t.${n.id}` }} value={n.text} selectAll={root && n.text === NEW_ROOT} onCommit={(t) => onCommitNode(o.id, n.id, t)}
                  onKey={(e, view, text) => {
                    const k = nodeKey(e, inList(view.state));
                    if (!k) return false;
                    onCommitNode(o.id, n.id, text, k);
                    return true;
                  }} />
              : <span className="mm-text text-static rich">{n.rich ? <RichView json={n.rich} /> : n.text || <span className="placeholder">Idea</span>}</span>}
            {n.collapsed && n.hidden > 0 && <span className="mm-count" style={{ borderColor: ink, color: ink }}>{n.hidden}</span>}
          </div>
        );
      })}
    </div>
  );
});
