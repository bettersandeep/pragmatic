import { memo, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { TextSource, bindText } from './ytext.ts';
import { RichEditor, RichSource, RichView } from './rich.tsx';
import { plainOf, type RichJSON } from '../../../shared/richtext.ts';
import type { EditorView } from 'prosemirror-view';
import { LOCAL } from './useBoard.ts';
import { FONT_SIZES, type BoardObject, type BoxObject, type ConnectorObj, type DrawObj } from '../../../shared/model.ts';
import { IconView, InlineIcon } from './IconView.tsx';
import { FrameView, WfView } from './Wireframe.tsx';
import { StackView, TaskView } from './TaskView.tsx';
import { Link as LinkIcon } from 'lucide-react';
import { arrowHead, connectorGeometry } from '../../../shared/route.ts';
import { ShapeSvg, textInset } from './shapes.tsx';
import { CANVAS, inkColor, lineColor, sectionPaint, shapePaint, stickyPaint, type Theme } from './theme.ts';
import { SECTION_TITLE_H } from './ops.ts';

type BoxProps = { o: BoxObject; layer: number; theme: Theme; editing: boolean; cropping?: boolean; pv?: number; onCommit: (id: string, text: string, before?: string) => void; onResize: (id: string, w: number, h: number) => void };

export const BoxView = memo(function BoxView({ o, layer, theme, editing, cropping, pv, onCommit: commitId, onResize: resizeId }: BoxProps) {
  const onCommit = (t: string, before?: string) => commitId(o.id, t, before), onResize = (w: number, h: number) => resizeId(o.id, w, h);
  const style = { left: o.x, top: o.y, width: o.w, height: o.h, zIndex: layer };
  if (o.type === 'section') {
    const p = sectionPaint(o.color, o.deco, theme);
    return (
      <div className="obj board-section" data-id={o.id} style={{ ...style, background: p.fill, borderColor: p.stroke }}>
        <div className="section-title" style={{ color: p.title, height: SECTION_TITLE_H }}>
          {editing ? <EditText value={o.title} onCommit={onCommit} single /> : o.title || 'Section'}
        </div>
      </div>
    );
  }
  if (o.type === 'icon') return <IconView o={o} layer={layer} theme={theme} editing={editing} onCommit={onCommit} pv={pv} />;
  if (o.type === 'wf') return <WfView o={o} layer={layer} theme={theme} editing={editing} onCommit={onCommit} pv={pv} />;
  if (o.type === 'frame') return <FrameView o={o} layer={layer} theme={theme} editing={editing} onCommit={onCommit} pv={pv} />;
  if (o.type === 'stack') return <StackView o={o} layer={layer} theme={theme} editing={editing} onCommit={onCommit} pv={pv} />;
  if (o.type === 'task') return <TaskView o={o} layer={layer} theme={theme} editing={editing} me="" comments={0} onCommit={commitId} pv={pv} />;
  if (o.type === 'draw') return <DrawView o={o} layer={layer} theme={theme} />;
  if (o.type === 'mindmap' || o.type === 'table') return null; // rendered by their own views in Canvas
  if (o.type === 'image') {
    const c = o.crop ?? { x: 0, y: 0, w: 1, h: 1 }, fw = o.w / c.w, fh = o.h / c.h;
    return (
      <div className={`obj image ${cropping ? 'cropping' : ''}`} data-id={o.id} style={style}>
        {cropping && <img className="crop-ghost" src={o.src} alt="" draggable={false} style={{ left: -c.x * fw, top: -c.y * fh, width: fw, height: fh }} />}
        <div className="crop-window"><img src={o.src} alt="" draggable={false} style={{ left: -c.x * fw, top: -c.y * fh, width: fw, height: fh }} /></div>
      </div>
    );
  }
  if (o.type === 'link') {
    return (
      <div className="obj link-obj" data-id={o.id} style={style} title={o.url}>
        <span className="link-icon" style={{ background: inkColor(o.color, theme) }}><LinkIcon size={16} color="#fff" /></span>
        <span className="link-text">
          <span className="link-title" style={{ color: CANVAS[theme].text }}>{editing ? <EditText value={o.title} onCommit={onCommit} single autoWidth /> : o.title || o.url}</span>
          <span className="link-site">{o.site}</span>
        </span>
      </div>
    );
  }
  if (o.type === 'sticky') {
    const p = stickyPaint(o.color, theme);
    return (
      <div className="obj sticky" data-id={o.id} style={{ ...style, background: p.fill, color: p.text, fontSize: FONT_SIZES[o.fontSize] }}>
        <Text value={o.text} rich={o.rich?.text} bind={{ id: o.id, key: 'text' }} editing={editing} onCommit={onCommit} onResize={(_, h) => h > o.h && onResize(o.w, h)} placeholder="Type something" />
        {o.author && !o.hideAuthor && <div className="sticky-author">{o.author}</div>}
      </div>
    );
  }
  if (o.type === 'text') {
    return (
      <div className="obj text-obj" data-id={o.id} style={{ ...style, color: inkColor(o.color, theme), fontSize: FONT_SIZES[o.fontSize], textAlign: o.align }}>
        <Text value={o.text} rich={o.rich?.text} bind={{ id: o.id, key: 'text' }} editing={editing} onCommit={onCommit} onResize={(w, h) => (Math.abs(w - o.w) > 1 || Math.abs(h - o.h) > 1) && onResize(w, h)} autoWidth placeholder="Text" />
      </div>
    );
  }
  const p = shapePaint(o.color, o.deco, theme), inset = textInset(o.shape, o.rotate);
  return (
    <div className={`obj shape shape-${o.shape}`} data-id={o.id} style={style}>
      {o.rotate ? (() => {
        // The outline turns; a quarter turn draws it in the swapped box so it fills the object again.
        const side = o.rotate % 180 !== 0, dw = side ? o.h : o.w, dh = side ? o.w : o.h;
        return <div className="shape-rot" style={{ left: (o.w - dw) / 2, top: (o.h - dh) / 2, width: dw, height: dh, transform: `rotate(${o.rotate}deg)` }}><ShapeSvg kind={o.shape} w={dw} h={dh} paint={p} /></div>;
      })() : <ShapeSvg kind={o.shape} w={o.w} h={o.h} paint={p} />}
      {o.shape !== 'line' && o.shape !== 'cross' && o.shape !== 'bracket' && (
        <div className={`shape-text ${o.icon ? 'has-icon' : ''}`} style={{
          left: o.w * inset.l, right: o.w * inset.r, top: o.h * inset.t, bottom: o.h * inset.b,
          color: p.text, fontSize: FONT_SIZES[o.fontSize], textAlign: o.align, fontFamily: o.shape === 'code' ? 'ui-monospace, Menlo, monospace' : undefined,
          justifyContent: o.icon ? (o.align === 'left' ? 'flex-start' : o.align === 'right' ? 'flex-end' : 'center') : undefined,
        }}>
          {o.icon && <InlineIcon name={o.icon} deco={o.iconDeco} color={o.color} size={Math.round(FONT_SIZES[o.fontSize] * 1.4)} theme={theme} />}
          <Text value={o.text} rich={o.rich?.text} bind={{ id: o.id, key: 'text' }} editing={editing} onCommit={onCommit}
            onResize={(_, h) => { const need = h / (1 - inset.t - inset.b); if (need > o.h + 1) onResize(o.w, Math.ceil(need)); }} />
        </div>
      )}
    </div>
  );
});

// Static rich text, or the rich editor in place. Reports its content size so boxes can grow.
function Text({ value, rich, bind, editing, onCommit, onResize, autoWidth, placeholder }: {
  value: string; rich?: RichJSON; bind: Bind; editing: boolean; onCommit: (t: string, before?: string) => void; onResize?: (w: number, h: number) => void; autoWidth?: boolean; placeholder?: string;
}) {
  if (editing) return <RichField bind={bind} value={value} onCommit={onCommit} onResize={onResize} autoWidth={autoWidth} />;
  const empty = !value && !rich?.some((b) => !('p' in b) || b.p.length);
  return (
    <div className={`text-static rich ${autoWidth ? 'auto-width' : ''}`}>
      {empty ? (placeholder ? <span className="placeholder">{placeholder}</span> : null) : rich ? <RichView json={rich} /> : value}
    </div>
  );
}

// The rich editor on a field; without edit access (no source) the plain editor, which changes nothing shared.
export function RichField({ bind, value, onCommit, onResize, autoWidth, selectAll, onKey }: {
  bind: Bind; value: string; onCommit: (t: string, before?: string) => void; onResize?: (w: number, h: number) => void; autoWidth?: boolean; selectAll?: boolean;
  // A key the caller takes, with the field's plain text at that moment (true = taken, the editor closes).
  onKey?: (e: KeyboardEvent, view: EditorView, text: string) => boolean;
}) {
  const source = useContext(RichSource);
  const [{ fragment, n }, setBound] = useState(() => ({ fragment: source?.(bind.id, bind.key) ?? null, n: 0 }));
  // Two people opening the same old field at once both convert it (shared/doc.ts richOf) and one copy wins. When
  // the other copy wins, edit that one; letters typed into the lost copy in that moment are gone.
  useEffect(() => {
    const map = fragment?.parent as Y.Map<unknown> | null;
    if (!map?.observe) return;
    const on = (e: Y.YMapEvent<unknown>) => { if (e.keysChanged.has(bind.key)) setBound((b) => ({ fragment: source?.(bind.id, bind.key) ?? null, n: b.n + 1 })); };
    map.observe(on);
    return () => map.unobserve(on);
  }, [fragment]);
  if (!fragment) return <EditText value={value} onCommit={onCommit} onResize={onResize} autoWidth={autoWidth} selectAll={selectAll} />;
  return <RichEditor key={n} fragment={fragment} field={`${bind.id}:${bind.key}`} className={autoWidth ? 'auto-width' : ''} selectAll={selectAll}
    onDone={() => onCommit(plainOf(fragment), value)} onResize={onResize} onKey={onKey && ((e, view) => onKey(e, view, plainOf(fragment)))} />;
}

type Bind = { id: string; key: string };
// In-place plain-text editor. `onKey` may take a key (return true) after which the editor closes without its own commit.
// With `bind`, the text is live shared text: every keystroke syncs, and others' typing appears while editing.
export function EditText({ value, bind, onCommit, onResize, autoWidth, single, onKey, selectAll }: {
  value: string; bind?: Bind; onCommit: (t: string, before?: string) => void; onResize?: (w: number, h: number) => void; autoWidth?: boolean; single?: boolean; selectAll?: boolean;
  onKey?: (e: React.KeyboardEvent, text: string) => boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const source = useContext(TextSource);
  useLayoutEffect(() => {
    const el = ref.current!;
    const t = bind && source ? source(bind.id, bind.key) : null;
    el.textContent = t ? t.toString() : value;
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    if (value && !selectAll) r.collapse(false);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(r);
    if (!t) return;
    const unbind = bindText(el, t, LOCAL);
    el.addEventListener('remote-input', report);
    return () => { unbind(); el.removeEventListener('remote-input', report); };
  }, []);
  const report = () => { const el = ref.current; if (el && onResize) onResize(Math.ceil(el.scrollWidth) + 2, Math.ceil(el.scrollHeight)); };
  useEffect(report, []);
  const commit = () => { if (done.current) return; done.current = true; onCommit(ref.current?.innerText.replace(/\n$/, '') ?? value, value); };
  return (
    <div
      ref={ref}
      className={`text-edit ${autoWidth ? 'auto-width' : ''}`}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck
      onInput={report}
      onBlur={commit}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (onKey?.(e, ref.current?.innerText.replace(/\n$/, '') ?? value)) { e.preventDefault(); done.current = true; return; }
        if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter') || (single && e.key === 'Enter')) { e.preventDefault(); ref.current?.blur(); }
      }}
    />
  );
}

type ConnProps = { c: ConnectorObj; byId: Map<string, BoardObject>; theme: Theme; editing: boolean; pv?: number; onCommit: (id: string, text: string) => void };

export const ConnectorView = memo(function ConnectorView({ c, byId, theme, editing, onCommit }: ConnProps) {
  const g = connectorGeometry(c, byId);
  if (!g) return null;
  const color = lineColor(c.color, theme);
  return (
    <g className="connector" data-id={c.id}>
      <path d={g.d} className="conn-hit" />
      <path d={g.d} className={c.animate ? 'animated' : undefined} fill="none" stroke={color} strokeWidth={2} strokeDasharray={c.dash || c.animate ? '7 6' : undefined} strokeLinecap="round" strokeLinejoin="round" />
      {c.endCap === 'arrow' && <path d={arrowHead(g.end, g.endDir)} fill={color} />}
      {c.startCap === 'arrow' && <path d={arrowHead(g.start, g.startDir)} fill={color} />}
      {(c.text || editing) && (
        <foreignObject x={g.mid.x - 150} y={g.mid.y - 16} width={300} height={32} className="conn-label-box">
          <div className="conn-label-wrap">
            <div className="conn-label" style={{ background: CANVAS[theme].plate, color: CANVAS[theme].text }}>
              {editing ? <EditText value={c.text} bind={{ id: c.id, key: 'text' }} onCommit={(t) => onCommit(c.id, t)} single autoWidth /> : c.text}
            </div>
          </div>
        </foreignObject>
      )}
    </g>
  );
}, (a, b) => a.c === b.c && a.theme === b.theme && a.editing === b.editing && a.pv === b.pv && endsUnchanged(a, b));

// A connector re-renders when the objects it is bound to move.
function endsUnchanged(a: ConnProps, b: ConnProps) {
  for (const end of [a.c.from, a.c.to]) if (end.id && a.byId.get(end.id) !== b.byId.get(end.id)) return false;
  return true;
}

export type { BoardObject };

// Smooth path through the points: quadratic curves via midpoints.
export function strokePath(pts: number[]): string {
  if (pts.length < 4) return pts.length === 2 ? `M${pts[0]},${pts[1]} l0.1,0` : '';
  let d = `M${pts[0]},${pts[1]}`;
  for (let i = 2; i < pts.length - 2; i += 2) d += ` Q${pts[i]},${pts[i + 1]} ${(pts[i] + pts[i + 2]) / 2},${(pts[i + 1] + pts[i + 3]) / 2}`;
  return `${d} L${pts.at(-2)},${pts.at(-1)}`;
}

export const DrawView = memo(function DrawView({ o, layer, theme }: { o: DrawObj; layer: number; theme: Theme }) {
  return (
    <div className="obj draw-obj" data-id={o.id} style={{ left: o.x, top: o.y, width: o.w, height: o.h, zIndex: layer }}>
      <svg width={o.w} height={o.h} viewBox={`0 0 ${o.w0} ${o.h0}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={strokePath(o.points)} fill="none" stroke={lineColor(o.color, theme)} strokeWidth={o.size} strokeLinecap="round" strokeLinejoin="round"
          strokeOpacity={o.highlight ? 0.35 : 1} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
});
