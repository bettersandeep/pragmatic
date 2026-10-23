import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Component, CreditCard, GalleryVerticalEnd, SquareKanban, PanelsTopLeft, Smartphone, Link2, MessageSquarePlus, Eraser, Frame, Hand, Highlighter, MousePointer2, Pencil, Plus, Redo2, Shapes, Smile, Spline, StickyNote, Table2, Type, Undo2, Minus, Workflow, Waypoints } from 'lucide-react';
import { IconPicker } from './IconView.tsx';
import { DEVICES, SHAPES, WF_KINDS, type Device, type ShapeKind, type WfKind } from '../../../shared/model.ts';
import { Glyph } from './IconView.tsx';
import { ShapeIcon } from './shapes.tsx';

export type DrawMode = 'marker' | 'highlighter' | 'eraser';
export type Tool =
  | { kind: 'select' } | { kind: 'hand' } | { kind: 'shape'; shape: ShapeKind } | { kind: 'sticky' }
  | { kind: 'text' } | { kind: 'section' } | { kind: 'connector' } | { kind: 'mindmap' } | { kind: 'table' }
  | { kind: 'icon'; icon: string } | { kind: 'draw'; mode: DrawMode } | { kind: 'comment' } | { kind: 'link' }
  | { kind: 'wf'; wf: WfKind; shapeType?: 'ellipse' } | { kind: 'frame'; device: Device } | { kind: 'task' } | { kind: 'stack' };
export type Mode = 'diagram' | 'wireframe' | 'task';
export type Flyout = null | 'shapes' | 'all' | 'icon' | 'draw' | 'components' | 'frames';

// Name, shortcut and picker glyph of each wireframe component.
export const WF_LABELS: Record<WfKind, [string, string, string?]> = {
  button: ['Button', 'rectangle-horizontal', 'B'], link: ['Link', 'link'], input: ['Text input', 'text-cursor-input', 'P'], textarea: ['Textarea', 'text-align-start'],
  dropdown: ['Dropdown', 'square-chevron-down'], checkbox: ['Checkbox', 'square-check'], radio: ['Radio button', 'circle-dot'], toggle: ['Toggle', 'toggle-right'],
  slider: ['Slider', 'sliders-horizontal'], progress: ['Progress bar', 'loader'], stars: ['Rating', 'star'], htabs: ['Tabs', 'panel-top'], vtabs: ['Vertical tabs', 'panel-left'],
  tag: ['Tag', 'tag'], tooltip: ['Tooltip', 'message-square'], shape: ['Rectangle', 'square', 'R'], image: ['Image', 'image', 'G'], video: ['Video', 'circle-play'],
  avatar: ['Avatar', 'circle-user', 'V'], divider: ['Line', 'minus', 'L'], overlay: ['Overlay', 'layers'], map: ['Map', 'map'], lorem: ['Text lorem', 'pilcrow'],
  blockfont: ['Text block', 'heading'], annotation: ['Annotation', 'badge-info', 'A'],
};
const DEVICE_GLYPH: Record<Device, string> = { plain: 'square', window: 'app-window', iphone: 'smartphone', android: 'tablet-smartphone', tablet: 'tablet', watch: 'watch' };

export const SHAPE_LABELS: Record<ShapeKind, [string, string?]> = {
  rect: ['Rectangle', 'R'], pill: ['Pill', 'U'], oval: ['Oval', 'O'], diamond: ['Diamond', 'D'], parallelogram: ['Parallelogram', 'P'],
  'parallelogram-flip': ['Flipped parallelogram'], trapezoid: ['Trapezoid'], triangle: ['Triangle', 'G'], hexagon: ['Hexagon', 'F'],
  cylinder: ['Cylinder', 'Y'], actor: ['Sequence diagram actor'], code: ['Code'], annotation: ['Annotation', 'A'], line: ['Line', 'L'],
  cross: ['Cross'], bracket: ['Bracket', 'B'], cloud: ['Cloud', 'J'], star: ['Star', 'V'],
};

export type InsertKind = 'mermaid' | 'mindmap' | 'image' | 'file' | 'template' | 'timer' | 'voting';

function Btn({ label, keys, active, onClick, children, anchor }: { label: string; keys?: string; active?: boolean; onClick: () => void; children: ReactNode; anchor?: (el: HTMLButtonElement | null) => void }) {
  return (
    <button ref={anchor} className={`tool ${active ? 'active' : ''}`} onClick={onClick} aria-label={label} aria-pressed={active} data-tip={keys ? `${label}  ${keys}` : label}>
      {children}
    </button>
  );
}

export function Toolbar({ readOnly, canComment, mode, setMode, flyout, setFlyout, tool, setTool, onInsert }: {
  readOnly: boolean; canComment: boolean; mode: Mode; setMode: (m: Mode) => void; flyout: Flyout; setFlyout: (f: Flyout) => void; tool: Tool; setTool: (t: Tool) => void; onInsert: (k: InsertKind) => void;
}) {
  const [lastShape, setLastShape] = useState<ShapeKind>('rect');
  useEffect(() => {
    if (!flyout) return;
    const close = (e: KeyboardEvent | PointerEvent) => { if (!(e instanceof KeyboardEvent) || e.key === 'Escape') setFlyout(null); };
    addEventListener('pointerdown', close);
    addEventListener('keydown', close);
    return () => { removeEventListener('pointerdown', close); removeEventListener('keydown', close); };
  }, [flyout]);
  useEffect(() => { if (tool.kind === 'shape') setLastShape(tool.shape); }, [tool]);
  const is = (k: Tool['kind']) => tool.kind === k;
  // Each flyout opens beside the button that owns it.
  const anchors = useRef<Partial<Record<NonNullable<Flyout>, HTMLButtonElement | null>>>({});
  const at = (f: NonNullable<Flyout>) => ({ top: anchors.current[f]?.offsetTop ?? 0 });

  if (readOnly) return (
    <div className="toolbar" data-mode={mode} onPointerDown={(e) => e.stopPropagation()}>
      <Btn label="Select" keys="Esc" active={is('select')} onClick={() => setTool({ kind: 'select' })}><MousePointer2 size={18} /></Btn>
      <Btn label="Pan" keys="Space" active={is('hand')} onClick={() => setTool({ kind: 'hand' })}><Hand size={18} /></Btn>
      {canComment && <Btn label="Comment" keys="⌥⌘M" active={is('comment')} onClick={() => setTool({ kind: 'comment' })}><MessageSquarePlus size={18} /></Btn>}
    </div>
  );
  return (
    <div className="toolbar" data-mode={mode} onPointerDown={(e) => e.stopPropagation()}>
      {/* Board modes, like Whimsical: a small stack above the tools; each mode has its own accent color. */}
      <div className="mode-switch" role="radiogroup" aria-label="Board mode">
        {([['diagram', 'Diagram mode', 'Q', Workflow], ['wireframe', 'Wireframe mode', 'W', PanelsTopLeft], ['task', 'Task mode', undefined, SquareKanban]] as const).map(([m, label, key, I]) => (
          <button key={m} role="radio" aria-checked={mode === m} aria-label={label} data-tip={key ? `${label}  ${key}` : label}
            className={mode === m ? 'on' : ''} onClick={() => setMode(m)}><I size={14} /></button>
        ))}
      </div>
      <Btn label="Select" keys="Esc" active={is('select')} onClick={() => setTool({ kind: 'select' })}><MousePointer2 size={18} /></Btn>
      <Btn label="Pan" keys="Space" active={is('hand')} onClick={() => setTool({ kind: 'hand' })}><Hand size={18} /></Btn>
      <div className="tool-sep" />
      {mode === 'diagram' ? <>
        <Btn anchor={(el) => { anchors.current.shapes = el; }} label="Diagram shapes" keys="S" active={is('shape')} onClick={() => setFlyout(flyout === 'shapes' ? null : 'shapes')}>
          {is('shape') ? <ShapeIcon kind={lastShape} /> : <Shapes size={18} />}
        </Btn>
        <Btn label="Sticky note" keys="N" active={is('sticky')} onClick={() => setTool({ kind: 'sticky' })}><StickyNote size={18} /></Btn>
        <Btn label="Mind map" keys="M" active={is('mindmap')} onClick={() => setTool({ kind: 'mindmap' })}><Waypoints size={18} /></Btn>
      </> : mode === 'task' ? <>
        <Btn label="Card" keys="A" active={is('task')} onClick={() => setTool({ kind: 'task' })}><CreditCard size={18} /></Btn>
        <Btn label="Task stack" keys="S" active={is('stack')} onClick={() => setTool({ kind: 'stack' })}><GalleryVerticalEnd size={18} /></Btn>
      </> : <>
        <Btn anchor={(el) => { anchors.current.components = el; }} label="Components" keys="E" active={is('wf') || flyout === 'components'} onClick={() => setFlyout(flyout === 'components' ? null : 'components')}><Component size={18} /></Btn>
        <Btn anchor={(el) => { anchors.current.frames = el; }} label="Wireframe frames" keys="F" active={is('frame') || flyout === 'frames'} onClick={() => setFlyout(flyout === 'frames' ? null : 'frames')}><Smartphone size={18} /></Btn>
      </>}
      <div className="tool-sep" />
      <Btn label="Connector" keys="C" active={is('connector')} onClick={() => setTool({ kind: 'connector' })}><Spline size={18} /></Btn>
      <Btn label="Text" keys="T" active={is('text')} onClick={() => setTool({ kind: 'text' })}><Type size={18} /></Btn>
      <Btn anchor={(el) => { anchors.current.icon = el; }} label="Icon" keys="X" active={is('icon') || flyout === 'icon'} onClick={() => setFlyout(flyout === 'icon' ? null : 'icon')}><Smile size={18} /></Btn>
      <Btn label="Link" keys="K" active={is('link')} onClick={() => setTool({ kind: 'link' })}><Link2 size={18} /></Btn>
      <Btn anchor={(el) => { anchors.current.draw = el; }} label="Freehand drawing" keys="H" active={is('draw')} onClick={() => setFlyout(flyout === 'draw' ? null : 'draw')}>
        {tool.kind === 'draw' && tool.mode === 'highlighter' ? <Highlighter size={18} /> : tool.kind === 'draw' && tool.mode === 'eraser' ? <Eraser size={18} /> : <Pencil size={18} />}
      </Btn>
      <Btn label="Section" keys="." active={is('section')} onClick={() => setTool({ kind: 'section' })}><Frame size={18} /></Btn>
      <Btn label="Comment" keys="⌥⌘M" active={is('comment')} onClick={() => setTool({ kind: 'comment' })}><MessageSquarePlus size={18} /></Btn>
      <div className="tool-sep" />
      <Btn anchor={(el) => { anchors.current.all = el; }} label="All tools" keys="/" active={flyout === 'all'} onClick={() => setFlyout(flyout === 'all' ? null : 'all')}><Plus size={18} /></Btn>

      {flyout === 'shapes' && (
        <div className="flyout shapes-flyout" style={at('shapes')} onPointerDown={(e) => e.stopPropagation()}>
          {SHAPES.map((s) => (
            <button key={s} className={`tool ${tool.kind === 'shape' && tool.shape === s ? 'active' : ''}`} aria-label={SHAPE_LABELS[s][0]}
              data-tip={SHAPE_LABELS[s][1] ? `${SHAPE_LABELS[s][0]}  ${SHAPE_LABELS[s][1]}` : SHAPE_LABELS[s][0]}
              onClick={() => { setTool({ kind: 'shape', shape: s }); setFlyout(null); }}>
              <ShapeIcon kind={s} />
            </button>
          ))}
          <button className={`tool ${is('table') ? 'active' : ''}`} aria-label="Table" data-tip="Table  E" onClick={() => { setTool({ kind: 'table' }); setFlyout(null); }}><Table2 size={18} /></button>
        </div>
      )}
      {flyout === 'components' && (
        <div className="flyout components-flyout" style={at('components')} onPointerDown={(e) => e.stopPropagation()}>
          {WF_KINDS.map((k) => (
            <button key={k} className={`tool ${tool.kind === 'wf' && tool.wf === k ? 'active' : ''}`} aria-label={WF_LABELS[k][0]}
              data-tip={WF_LABELS[k][2] ? `${WF_LABELS[k][0]}  ${WF_LABELS[k][2]}` : WF_LABELS[k][0]}
              onClick={() => { setTool({ kind: 'wf', wf: k }); setFlyout(null); }}><Glyph name={WF_LABELS[k][1]} size={18} color="currentColor" /></button>
          ))}
        </div>
      )}
      {flyout === 'frames' && (
        <div className="flyout menu-flyout frames-flyout" style={at('frames')} role="menu" onPointerDown={(e) => e.stopPropagation()}>
          {(Object.keys(DEVICES) as Device[]).map((d) => (
            <button key={d} role="menuitem" onClick={() => { setTool({ kind: 'frame', device: d }); setFlyout(null); }}>
              <Glyph name={DEVICE_GLYPH[d]} size={16} color="currentColor" /> {DEVICES[d].label}
            </button>
          ))}
        </div>
      )}
      {flyout === 'icon' && (
        <div className="flyout icon-flyout" style={at('icon')} onPointerDown={(e) => e.stopPropagation()}>
          <IconPicker onPick={(icon) => { setTool({ kind: 'icon', icon }); setFlyout(null); }} />
        </div>
      )}
      {flyout === 'draw' && (
        <div className="flyout draw-flyout" style={at('draw')} onPointerDown={(e) => e.stopPropagation()}>
          {([['marker', Pencil, 'Marker  H'], ['highlighter', Highlighter, 'Highlighter  ⇧H'], ['eraser', Eraser, 'Eraser']] as const).map(([mode, I, tip]) => (
            <button key={mode} className={`tool ${tool.kind === 'draw' && tool.mode === mode ? 'active' : ''}`} aria-label={tip} data-tip={tip}
              onClick={() => { setTool({ kind: 'draw', mode }); setFlyout(null); }}><I size={18} /></button>
          ))}
        </div>
      )}
      {flyout === 'all' && <AllTools at={at('all')} close={() => setFlyout(null)} run={(it) => { if (it.mode && it.mode !== mode) setMode(it.mode); if (it.tool) setTool(it.tool); if (it.insert) onInsert(it.insert); setFlyout(null); }} />}
    </div>
  );
}

type ToolItem = { label: string; section: string; keys?: string; mode?: Mode; tool?: Tool; insert?: InsertKind };

// Every tool in every mode plus the insert actions, as one searchable list ("All tools", /).
const ALL_TOOLS: ToolItem[] = [
  { section: 'Insert', label: 'Template…', insert: 'template' },
  { section: 'Insert', label: 'Image', keys: 'I', insert: 'image' },
  { section: 'Insert', label: 'Mermaid diagram', insert: 'mermaid' },
  { section: 'Insert', label: 'Mind map from outline', insert: 'mindmap' },
  { section: 'Insert', label: 'Import .excalidraw / .mmd file', insert: 'file' },
  { section: 'Insert', label: 'Timer', insert: 'timer' },
  { section: 'Insert', label: 'Voting', insert: 'voting' },
  { section: 'Diagram', label: 'Sticky note', keys: 'N', tool: { kind: 'sticky' } },
  { section: 'Diagram', label: 'Mind map', keys: 'M', mode: 'diagram', tool: { kind: 'mindmap' } },
  { section: 'Diagram', label: 'Table', keys: 'E', mode: 'diagram', tool: { kind: 'table' } },
  ...SHAPES.map((sh): ToolItem => ({ section: 'Diagram shapes', label: SHAPE_LABELS[sh][0], keys: SHAPE_LABELS[sh][1], mode: 'diagram', tool: { kind: 'shape', shape: sh } })),
  ...WF_KINDS.map((k): ToolItem => ({ section: 'Components', label: WF_LABELS[k][0], keys: WF_LABELS[k][2], mode: 'wireframe', tool: { kind: 'wf', wf: k } })),
  ...(Object.keys(DEVICES) as Device[]).map((d): ToolItem => ({ section: 'Wireframe frames', label: `${DEVICES[d].label} frame`, mode: 'wireframe', tool: { kind: 'frame', device: d } })),
  { section: 'Task', label: 'Card', keys: 'A', mode: 'task', tool: { kind: 'task' } },
  { section: 'Task', label: 'Task stack', keys: 'S', mode: 'task', tool: { kind: 'stack' } },
  { section: 'Basics', label: 'Connector', keys: 'C', tool: { kind: 'connector' } },
  { section: 'Basics', label: 'Text', keys: 'T', tool: { kind: 'text' } },
  { section: 'Basics', label: 'Link', keys: 'K', tool: { kind: 'link' } },
  { section: 'Basics', label: 'Section', keys: '.', tool: { kind: 'section' } },
  { section: 'Basics', label: 'Comment', keys: '⌥⌘M', tool: { kind: 'comment' } },
  { section: 'Freehand', label: 'Marker', keys: 'H', tool: { kind: 'draw', mode: 'marker' } },
  { section: 'Freehand', label: 'Highlighter', keys: '⇧H', tool: { kind: 'draw', mode: 'highlighter' } },
  { section: 'Freehand', label: 'Eraser', tool: { kind: 'draw', mode: 'eraser' } },
];

function AllTools({ at, close, run }: { at: React.CSSProperties; close: () => void; run: (it: ToolItem) => void }) {
  const [q, setQ] = useState(''), [i, setI] = useState(0);
  const list = ALL_TOOLS.filter((t) => `${t.label} ${t.section}`.toLowerCase().includes(q.trim().toLowerCase()));
  useEffect(() => setI(0), [q]);
  return (
    <div className="flyout all-tools" style={{ ...at, top: Math.max(0, (at.top as number) - 360) }} onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="All tools">
      <input autoFocus placeholder="Search tools" value={q} aria-label="Search tools" onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(list.length - 1, i + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(0, i - 1)); }
          if (e.key === 'Enter' && list[i]) run(list[i]);
          if (e.key === 'Escape') close();
        }} />
      <div className="all-tools-list" role="listbox">
        {list.map((t, k) => (
          <div key={`${t.section}-${t.label}`}>
            {(k === 0 || list[k - 1].section !== t.section) && <div className="all-tools-section">{t.section}</div>}
            <button role="option" aria-selected={k === i} className={k === i ? 'active' : ''} onPointerEnter={() => setI(k)} onClick={() => run(t)}>
              {t.label}{t.keys && <kbd>{t.keys}</kbd>}
            </button>
          </div>
        ))}
        {!list.length && <p className="muted pad">No tool matches</p>}
      </div>
    </div>
  );
}

export function BottomBar({ zoom, setZoom, fit, history, undo, redo }: {
  zoom: number; setZoom: (z: number) => void; fit: () => void; history: { undo: boolean; redo: boolean }; undo: () => void; redo: () => void;
}) {
  return (
    <div className="bottombar" onPointerDown={(e) => e.stopPropagation()}>
      <div className="group">
        <button className="tool" aria-label="Undo" data-tip="Undo  ⌘Z" disabled={!history.undo} onClick={undo}><Undo2 size={17} /></button>
        <button className="tool" aria-label="Redo" data-tip="Redo  ⇧⌘Z" disabled={!history.redo} onClick={redo}><Redo2 size={17} /></button>
      </div>
      <div className="group">
        <button className="tool" aria-label="Zoom out" data-tip="Zoom out  -" onClick={() => setZoom(zoom / 1.25)}><Minus size={17} /></button>
        <button className="zoom-label" aria-label="Zoom to content" data-tip="Zoom to content  1" onClick={fit}>{Math.round(zoom * 100)}%</button>
        <button className="tool" aria-label="Zoom in" data-tip="Zoom in  =" onClick={() => setZoom(zoom * 1.25)}><Plus size={17} /></button>
      </div>
    </div>
  );
}
