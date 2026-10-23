import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, ArrowLeftRight, Copy, MoveRight, Spline, Type, Unlock,
  CornerDownRight, Minus as Straight, Ellipsis, ArrowRightFromLine, ArrowDownFromLine, ListTree, ChevronsDownUp, Rows3, Columns3,
  BetweenHorizontalStart, BetweenVerticalStart, Smile, MessageSquarePlus, Crop, ExternalLink, Link2, ImageOff, Tag, RotateCw, Keyboard, Signal, Square, Circle, RectangleHorizontal, Maximize2, Bell, BellOff, UserRound, X,
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, AtSign, EllipsisVertical, Unlink,
} from 'lucide-react';
import type * as Y from 'yjs';
import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { activeList, commands, markActive, requestBarPop, schema, useActiveEditor, useBarRequests } from './rich.tsx';
import { formatAll, hasMarkEverywhere, jsonHasMark, jsonListKind, listKindOf, setListAll, type ListKind, type Mark } from '../../../shared/richtext.ts';
import { LOCAL } from './useBoard.ts';
import { Avatar } from './Comments.tsx';
import { usePeople } from './TaskView.tsx';
import { WF_ICON, WF_LABELLED, WF_POS, WF_TEXT } from './Wireframe.tsx';
import { IconPicker } from './IconView.tsx';
import type { Sub } from './Canvas.tsx';
import { DEVICES, TASK_H, TASK_SIZES, WF_SIZES, type TaskObj, type Device, type FrameObj, type MindmapObj, type TableObj, type TableStyle, type WfObj, type WfSize } from '../../../shared/model.ts';
import { COLOR_NAMES, FONT_SIZE_STEPS, FONT_SIZES, SHAPES, type BoardObject, type ColorName, type FontSize } from '../../../shared/model.ts';
import { ShapeIcon } from './shapes.tsx';
import { SHAPE_LABELS } from './Toolbar.tsx';
import type { Patch } from '../../../shared/doc.ts';
import { activePalette } from './theme.ts';

type Props = {
  selected: BoardObject[];
  at: { x: number; y: number; below: boolean };
  update: (patches: Patch[]) => void;
  sub: Sub;
  me: string;
  actions: {
    expand: () => void;
    rotateFrame: () => void;
    duplicate: () => void; remove: () => void; front: () => void; back: () => void; edit: () => void; toggleLock: () => void; comment: () => void;
    crop: () => void; cropping: boolean; editLink: () => void;
    openMenu: (clientX: number, clientY: number) => void; // the object menu (right-click menu) at a screen point
    mindmap: (act: 'Tab' | 'Collapse') => void; table: (act: 'addRow' | 'addCol' | 'delRow' | 'delCol') => void;
    // Rich text of the selection (see Canvas): being typed in now, its fragments (made on first use), and start
    // typing in it, then run `then` in the open editor.
    rich: { editing: boolean; fragments: () => Y.XmlFragment[]; edit: (then?: (v: EditorView) => void) => void };
  };
};

const TABLE_STYLES: [TableStyle, string][] = [
  ['plain', 'Plain header'], ['contrast', 'Contrasting header'], ['striped', 'Alternating rows'], ['none', 'No header'], ['filled', 'Filled, no header'],
];

// `menu`: the button opens a menu (a corner mark shows it).
function Icon({ label, keys, active, menu, onClick, children }: { label: string; keys?: string; active?: boolean; menu?: boolean; onClick: (e: React.MouseEvent) => void; children: ReactNode }) {
  return <button className={`cb-btn ${active ? 'active' : ''} ${menu ? 'has-menu' : ''}`} aria-label={label} aria-pressed={active} data-tip={keys ? `${label}  ${keys}` : label} onClick={onClick}>{children}</button>;
}

const WF_SIZE_LABEL: Record<WfSize, string> = { xs: 'XS', s: 'S', m: 'M', l0: 'L', xl: 'XL', xxl: 'XXL' };
const STATE_LABEL: Record<WfObj['state'], string> = { normal: 'Normal', focused: 'Focused', error: 'Error', disabled: 'Disabled', selected: 'Selected' };

const same = <T,>(xs: T[]) => (xs.length && xs.every((x) => x === xs[0]) ? xs[0] : undefined);

export function ContextBar({ selected, at, update, actions, sub, me }: Props) {
  const ppl = usePeople();
  const [pop, setPop] = useState<null | 'color' | 'shape' | 'icon' | 'tstyle' | 'wstate' | 'device' | 'assign' | 'tmore' | 'lmore' | 'link' | 'nicon' | 'sicon'>(null);
  useEffect(() => setPop(null), [selected.map((o) => o.id).join()]);
  useBarRequests((p) => setPop((p === 'icon' ? (single?.type === 'shape' ? 'sicon' : 'nicon') : p) as typeof pop));
  // Keep the bar inside the canvas: shift it when it would cross an edge.
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current, parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    // Stay inside the canvas, and right of the tool bar that floats on its left edge.
    const tools = parent.querySelector<HTMLElement>('.toolbar');
    const min = tools ? tools.offsetLeft + tools.offsetWidth + 8 : 8;
    const half = el.offsetWidth / 2, max = parent.clientWidth - 8;
    setShift(at.x - half < min ? min - (at.x - half) : at.x + half > max ? max - (at.x + half) : 0);
  });
  if (!selected.length) return null;
  const all = (pred: (o: BoardObject) => boolean) => selected.every(pred);
  const set = (fields: Record<string, unknown>) => update(selected.map((o) => ({ id: o.id, ...fields })));
  const types = new Set(selected.map((o) => o.type));
  const shapes = selected.filter((o) => o.type === 'shape');
  const hasText = all((o) => o.type === 'shape' || o.type === 'text' || o.type === 'sticky' || o.type === 'mindmap' || o.type === 'table');
  // Which field a color pick changes: tables color their header, mind maps the focused (or root) branch.
  const mapNode = (o: MindmapObj) => sub?.id === o.id && sub.node ? sub.node : Object.entries(o).find(([k, v]) => k.startsWith('n.') && (v as { parent: unknown }).parent === null)?.[0].slice(2);
  const colorOf = (o: BoardObject): ColorName | undefined =>
    o.type === 'frame' ? undefined : o.type === 'table' ? o.headColor : o.type === 'mindmap' ? (o[`n.${mapNode(o)}`]?.color ?? 'default') : 'color' in o ? o.color : undefined;
  const colored = selected.filter((o) => colorOf(o) !== undefined);
  const color = same(colored.map((o) => colorOf(o)!));
  const setColor = (c: ColorName) => update(colored.map((o) => {
    if (o.type === 'table') return { id: o.id, headColor: c };
    if (o.type === 'mindmap') { const n = mapNode(o)!; return { id: o.id, [`n.${n}`]: { ...o[`n.${n}`], color: c } }; }
    return { id: o.id, color: c };
  }));
  const locked = all((o) => !!o.locked);
  const single = selected.length === 1 ? selected[0] : undefined;
  // Text options (size, formatting, alignment), as Whimsical: always for stickies, text and mind maps; for shapes while typing.
  const textTools = actions.rich.editing || !selected.some((o) => o.type === 'shape');

  const fontSize = hasText ? same(selected.map((o) => (o as { fontSize: FontSize }).fontSize)) : undefined;
  const stepFont = (dir: 1 | -1) => update(selected.map((o) => {
    const i = FONT_SIZE_STEPS.indexOf((o as { fontSize: FontSize }).fontSize);
    return { id: o.id, fontSize: FONT_SIZE_STEPS[Math.max(0, Math.min(FONT_SIZE_STEPS.length - 1, i + dir))] };
  }));

  return (
    <div ref={ref} className={`contextbar ${at.below ? 'below' : ''}`} style={{ left: at.x + shift, top: at.y }} onPointerDown={(e) => e.stopPropagation()} role="toolbar" aria-label="Object options"
      // Buttons keep the focus (and the selection) in the text being edited; fields still take it.
      onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('input, textarea')) e.preventDefault(); }}>
      {single && !['image', 'draw', 'mindmap', 'table'].includes(single.type) && !(single.type === 'wf' && !WF_TEXT.has(single.kind)) && !locked && <Icon label={single.type === 'section' || single.type === 'frame' || single.type === 'stack' ? 'Rename' : single.type === 'task' ? 'Edit title' : single.type === 'icon' ? 'Edit label' : single.type === 'link' ? 'Edit title' : 'Edit text'} keys="Enter" onClick={actions.edit}><Type size={16} /></Icon>}
      {single?.type === 'image' && !locked && (
        <span className="cb-group first">
          <Icon label={actions.cropping ? 'Done cropping' : 'Crop'} keys={actions.cropping ? 'Esc' : 'Double-click'} active={actions.cropping} onClick={actions.crop}><Crop size={16} /></Icon>
          {single.crop && <Icon label="Reset crop" onClick={() => {
            const c = single.crop!, fw = single.w / c.w, fh = single.h / c.h;
            update([{ id: single.id, crop: undefined, x: single.x - c.x * fw, y: single.y - c.y * fh, w: fw, h: fh }]);
          }}><ImageOff size={16} /></Icon>}
        </span>
      )}
      {single?.type === 'link' && (
        <span className="cb-group first">
          <Icon label="Open link" keys="⌘-click" onClick={() => window.open(single.url, '_blank', 'noopener')}><ExternalLink size={16} /></Icon>
          {!locked && <Icon label="Edit URL" onClick={actions.editLink}><Link2 size={16} /></Icon>}
        </span>
      )}
      {(single?.type === 'icon' || (single?.type === 'wf' && WF_ICON.has(single.kind))) && !locked && (
        <span className="cb-wrap">
          <Icon label="Change icon" keys="X" menu active={pop === 'icon'} onClick={() => setPop(pop === 'icon' ? null : 'icon')}><Smile size={16} /></Icon>
          {pop === 'icon' && <div className="cb-pop"><IconPicker onPick={(icon) => { set({ icon }); setPop(null); }} /></div>}
        </span>
      )}
      {types.size === 1 && types.has('shape') && !locked && (
        <span className="cb-wrap">
          <Icon label="Change shape" menu active={pop === 'shape'} onClick={() => setPop(pop === 'shape' ? null : 'shape')}>
            <ShapeIcon kind={same(shapes.map((o) => (o as { shape: typeof SHAPES[number] }).shape)) ?? 'rect'} />
          </Icon>
          {pop === 'shape' && (
            <div className="cb-pop shape-grid">
              {SHAPES.map((s) => <button key={s} className="cb-btn" aria-label={SHAPE_LABELS[s][0]} data-tip={SHAPE_LABELS[s][0]} onClick={() => set({ shape: s })}><ShapeIcon kind={s} /></button>)}
            </div>
          )}
        </span>
      )}
      {colored.length > 0 && !locked && (
        <span className="cb-wrap">
          <button className={`cb-btn has-menu ${pop === 'color' ? 'active' : ''}`} aria-label="Color" data-tip="Color" onClick={() => setPop(pop === 'color' ? null : 'color')}>
            <span className="swatch" style={{ background: color ? activePalette()[color].base : 'conic-gradient(#2987D7, #26AEA0, #F0C54F, #D5475B, #BE36D3, #2987D7)' }} />
          </button>
          {pop === 'color' && (
            <div className="cb-pop color-grid">
              {COLOR_NAMES.map((c) => (
                <button key={c} className={`swatch-btn ${c === color ? 'active' : ''}`} aria-label={c} data-tip={c} onClick={() => setColor(c)}>
                  <span className="swatch" style={{ background: activePalette()[c].base }} />
                </button>
              ))}
            </div>
          )}
        </span>
      )}
      {types.size === 1 && types.has('shape') && !locked && (
        <span className="cb-group">
          {(['fill', 'outline', 'dash', 'transparent'] as const).map((d) => (
            <Icon key={d} label={d[0].toUpperCase() + d.slice(1)} active={same(shapes.map((o) => (o as { deco: string }).deco)) === d} onClick={() => set({ deco: d })}>
              <span className={`deco-icon deco-${d}`} />
            </Icon>
          ))}
        </span>
      )}
      {single?.type === 'shape' && !locked && (
        <>
          <span className="cb-wrap">
            <Icon label={single.icon ? 'Change icon' : 'Add icon'} keys="⇧X" menu active={pop === 'sicon'} onClick={() => setPop(pop === 'sicon' ? null : 'sicon')}><Smile size={16} /></Icon>
            {pop === 'sicon' && (
              <div className="cb-pop">
                <IconPicker deco={single.iconDeco ?? 'multicolor'} onDeco={(d) => set({ iconDeco: d })} onPick={(icon) => { set({ icon }); setPop(null); }}
                  onRemove={single.icon ? () => { set({ icon: undefined, iconDeco: undefined }); setPop(null); } : undefined} />
              </div>
            )}
          </span>
          <Icon label="Rotate" onClick={() => set({ rotate: ((((single.rotate ?? 0) + 90) % 360) || undefined) })}><RotateCw size={16} /></Icon>
        </>
      )}
      {types.size === 1 && types.has('section') && !locked && (
        <span className="cb-group">
          {(['fill', 'outline'] as const).map((d) => (
            <Icon key={d} label={d === 'fill' ? 'Fill' : 'Outline'} active={same(selected.map((o) => (o as { deco: string }).deco)) === d} onClick={() => set({ deco: d })}>
              <span className={`deco-icon deco-${d}`} />
            </Icon>
          ))}
        </span>
      )}
      {types.size === 1 && types.has('wf') && !locked && (() => {
        const w = selected as WfObj[], one = w.length === 1 ? w[0] : undefined;
        const size = same(w.map((o) => o.size)), state = same(w.map((o) => o.state));
        const stepSize = (dir: 1 | -1) => update(w.map((o) => ({ id: o.id, size: WF_SIZES[Math.max(0, Math.min(WF_SIZES.length - 1, WF_SIZES.indexOf(o.size) + dir))] })));
        return (
          <>
            <span className="cb-group">
              {(['fill', 'outline', 'dashes'] as const).map((d) => (
                <Icon key={d} label={d === 'dashes' ? 'Dashed' : d[0].toUpperCase() + d.slice(1)} active={same(w.map((o) => o.deco)) === d} onClick={() => set({ deco: d })}>
                  <span className={`deco-icon deco-${d === 'dashes' ? 'dash' : d}`} />
                </Icon>
              ))}
            </span>
            <span className="cb-group">
              <Icon label="Smaller" onClick={() => stepSize(-1)}><span className="cb-text">−</span></Icon>
              <span className="cb-size">{size ? WF_SIZE_LABEL[size] : '–'}</span>
              <Icon label="Larger" onClick={() => stepSize(1)}><span className="cb-text">+</span></Icon>
            </span>
            <span className="cb-wrap">
              <button className={`cb-btn cb-wide ${pop === 'wstate' ? 'active' : ''}`} aria-label="State" data-tip="State" onClick={() => setPop(pop === 'wstate' ? null : 'wstate')}>{state ? STATE_LABEL[state] : 'State'}</button>
              {pop === 'wstate' && (
                <div className="cb-pop cb-menu" role="menu">
                  {(Object.keys(STATE_LABEL) as WfObj['state'][]).map((st) => (
                    <button key={st} role="menuitem" className={state === st ? 'checked' : ''} onClick={() => { set({ state: st }); setPop(null); }}>{STATE_LABEL[st]}</button>
                  ))}
                </div>
              )}
            </span>
            {one && WF_LABELLED.has(one.kind) && (
              <span className="cb-group"><Icon label={one.label ? 'Hide label' : 'Show label'} active={!!one.label} onClick={() => set({ label: one.label ? undefined : 'Label' })}><Tag size={16} /></Icon></span>
            )}
            {one && WF_POS.has(one.kind) && (
              <span className="cb-group">
                <input className="cb-range" type="range" min={0} max={1} step={one.kind === 'stars' ? 0.2 : 0.05} value={one.pos ?? 0.5} aria-label="Value"
                  onChange={(e) => update([{ id: one.id, pos: Number(e.target.value) }])} />
              </span>
            )}
            {one?.kind === 'shape' && (
              <span className="cb-group">
                {([['rect', 'Rectangle', Square], ['ellipse', 'Circle', Circle], ['pill', 'Pill', RectangleHorizontal]] as const).map(([st, label, I]) => (
                  <Icon key={st} label={label} active={(one.shapeType ?? 'rect') === st} onClick={() => set({ shapeType: st })}><I size={16} /></Icon>
                ))}
              </span>
            )}
            {one?.kind === 'tooltip' && (
              <span className="cb-group">
                <Icon label="Arrow position" onClick={() => set({ arrow: ({ bottom: 'left', left: 'top', top: 'right', right: 'bottom' } as const)[one.arrow ?? 'bottom'] })}><RotateCw size={16} /></Icon>
              </span>
            )}
          </>
        );
      })()}
      {types.size === 1 && types.has('task') && (() => {
        const t = selected as TaskObj[], one = t.length === 1 ? t[0] : undefined, size = same(t.map((o) => o.size));
        const who = one?.assignee ? ppl.get(one.assignee) : undefined, watching = !!one?.watch?.includes(me);
        return (
          <>
            {one && <span className="cb-group first"><Icon label="Expand" keys="⌘Enter" onClick={actions.expand}><Maximize2 size={16} /></Icon></span>}
            {!locked && (
              <span className="cb-group">
                {TASK_SIZES.map((sz) => (
                  <button key={sz} className={`cb-btn cb-wide ${size === sz ? 'active' : ''}`} aria-label={`Size ${sz.toUpperCase()}`} aria-pressed={size === sz} data-tip={`Size ${sz.toUpperCase()}`}
                    onClick={() => set({ size: sz, h: TASK_H[sz] })}>{sz.toUpperCase()}</button>
                ))}
              </span>
            )}
            {one && !locked && (
              <span className="cb-group">
                <span className="cb-wrap">
                  <Icon label={who ? `Assigned to ${who.name}` : 'Assign'} active={pop === 'assign'} onClick={() => setPop(pop === 'assign' ? null : 'assign')}>
                    {who ? <Avatar p={who} size={20} /> : <UserRound size={16} />}
                  </Icon>
                  {pop === 'assign' && (
                    <div className="cb-pop cb-menu" role="menu">
                      {[...ppl.values()].map((p) => (
                        <button key={p.id} role="menuitem" className={p.id === one.assignee ? 'checked' : ''} onClick={() => { set({ assignee: p.id }); setPop(null); }}><Avatar p={p} size={20} /> {p.name}</button>
                      ))}
                      {one.assignee && <button role="menuitem" onClick={() => { set({ assignee: undefined }); setPop(null); }}><X size={15} /> Unassign</button>}
                    </div>
                  )}
                </span>
                <Icon label={watching ? 'Stop notifications' : 'Get notifications'} active={watching}
                  onClick={() => set({ watch: watching ? one.watch!.filter((x) => x !== me) : [...(one.watch ?? []), me] })}>{watching ? <Bell size={16} /> : <BellOff size={16} />}</Icon>
              </span>
            )}
          </>
        );
      })()}
      {single?.type === 'frame' && !locked && (() => {
        const f = single as FrameObj;
        return (
          <>
            <span className="cb-wrap">
              <button className={`cb-btn cb-wide ${pop === 'device' ? 'active' : ''}`} aria-label="Device" data-tip="Device" onClick={() => setPop(pop === 'device' ? null : 'device')}>{DEVICES[f.device].label}</button>
              {pop === 'device' && (
                <div className="cb-pop cb-menu" role="menu">
                  {(Object.keys(DEVICES) as Device[]).map((d) => (
                    <button key={d} role="menuitem" className={f.device === d ? 'checked' : ''} onClick={() => {
                      // Keep the orientation when the device changes.
                      const land = f.w > f.h, { w, h } = DEVICES[d];
                      update([{ id: f.id, device: d, ...(land && d !== 'window' && d !== 'plain' ? { w: h, h: w } : { w, h }) }]);
                      setPop(null);
                    }}>{DEVICES[d].label}</button>
                  ))}
                </div>
              )}
            </span>
            <span className="cb-group">
              <Icon label="Rotate" onClick={actions.rotateFrame}><RotateCw size={16} /></Icon>
              {DEVICES[f.device].status > 0 && <Icon label="Status bar" active={f.statusBar} onClick={() => set({ statusBar: !f.statusBar })}><Signal size={16} /></Icon>}
              <Icon label="Keyboard" active={f.keyboard} onClick={() => set({ keyboard: !f.keyboard })}><Keyboard size={16} /></Icon>
            </span>
          </>
        );
      })()}
      {hasText && !locked && textTools && (
        <span className="cb-group">
          <Icon label="Decrease text size" keys="⌥⌘-" onClick={() => stepFont(-1)}><span className="cb-text">−</span></Icon>
          <span className="cb-size">{fontSize ? `${FONT_SIZES[fontSize]}` : '–'}</span>
          <Icon label="Increase text size" keys="⌥⌘=" onClick={() => stepFont(1)}><span className="cb-text">+</span></Icon>
        </span>
      )}
      {!locked && textTools && (all((o) => o.type === 'shape' || o.type === 'text' || o.type === 'sticky') || (single?.type === 'mindmap' && !!sub?.node)) && (
        <TextFormat rich={actions.rich} pop={pop} setPop={setPop}
          json={single?.type === 'mindmap' ? [single.rich?.[`t.${sub!.node}`]] : selected.map((o) => o.rich?.text)} />
      )}
      {single?.type === 'mindmap' && sub?.node && !locked && (() => {
        const map = single as MindmapObj, key = `n.${sub.node}` as const, n = map[key];
        if (!n) return null;
        const setN = (f: Partial<typeof n>) => update([{ id: map.id, [key]: { ...n, ...f } }]);
        return (
          <>
            {n.parent !== null && (
              <span className="cb-group">
                <Icon label="Solid line" active={!n.dash} onClick={() => setN({ dash: undefined })}><svg width="16" height="16" aria-hidden="true"><line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></Icon>
                <Icon label="Dashed line" active={!!n.dash} onClick={() => setN({ dash: true })}><svg width="16" height="16" aria-hidden="true"><line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" strokeLinecap="round" /></svg></Icon>
              </span>
            )}
            <span className="cb-wrap">
              <Icon label={n.icon ? 'Change icon' : 'Add icon'} keys="⇧X" active={pop === 'nicon'} onClick={() => setPop(pop === 'nicon' ? null : 'nicon')}><Smile size={16} /></Icon>
              {pop === 'nicon' && (
                <div className="cb-pop">
                  <IconPicker deco={n.iconDeco ?? 'multicolor'} onDeco={(d) => setN({ iconDeco: d })} onPick={(icon) => { setN({ icon }); setPop(null); }}
                    onRemove={n.icon ? () => { setN({ icon: undefined, iconDeco: undefined }); setPop(null); } : undefined} />
                </div>
              )}
            </span>
          </>
        );
      })()}
      {all((o) => o.type === 'shape' || o.type === 'text') && !locked && textTools && (
        <span className="cb-group">
          {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([a, I]) => (
            <Icon key={a} label={`Align ${a}`} active={same(selected.map((o) => (o as { align: string }).align)) === a} onClick={() => set({ align: a })}><I size={16} /></Icon>
          ))}
        </span>
      )}
      {types.size === 1 && types.has('icon') && !locked && (
        <span className="cb-group">
          {(['multicolor', 'fill', 'outline'] as const).map((d) => (
            <Icon key={d} label={d[0].toUpperCase() + d.slice(1)} active={same(selected.map((o) => (o as { deco: string }).deco)) === d} onClick={() => set({ deco: d })}>
              <span className={`deco-icon deco-${d === 'multicolor' ? 'outline' : d === 'fill' ? 'fill' : 'transparent'}`} />
            </Icon>
          ))}
          {single?.type === 'icon' && <Icon label="Rotate" onClick={() => set({ rotate: ((((single.rotate ?? 0) + 90) % 360) || undefined) })}><RotateCw size={16} /></Icon>}
        </span>
      )}
      {single?.type === 'sticky' && !locked && (
        <Icon label={single.hideAuthor ? 'Show author' : 'Hide author'} active={!!single.hideAuthor} onClick={() => set({ hideAuthor: single.hideAuthor ? undefined : true })}><UserRound size={16} /></Icon>
      )}
      {single?.type === 'mindmap' && !locked && (
        <>
          <span className="cb-group">
            <Icon label="Horizontal" active={single.layout !== 'vertical'} onClick={() => set({ layout: 'horizontal' })}><ArrowRightFromLine size={16} /></Icon>
            <Icon label="Vertical" active={single.layout === 'vertical'} onClick={() => set({ layout: 'vertical' })}><ArrowDownFromLine size={16} /></Icon>
            <Icon label="Curvy" active={single.edge !== 'angular'} onClick={() => set({ edge: 'curvy' })}><Spline size={16} /></Icon>
            <Icon label="Angular" active={single.edge === 'angular'} onClick={() => set({ edge: 'angular' })}><CornerDownRight size={16} /></Icon>
          </span>
          {sub?.node && (
            <span className="cb-group">
              <Icon label="Add child" keys="Tab" onClick={() => actions.mindmap('Tab')}><ListTree size={16} /></Icon>
              <Icon label="Collapse / expand" keys="⌘/" active={!!(single as MindmapObj)[`n.${sub.node}`]?.collapsed} onClick={() => actions.mindmap('Collapse')}><ChevronsDownUp size={16} /></Icon>
            </span>
          )}
        </>
      )}
      {single?.type === 'table' && !locked && (
        <>
          <span className="cb-wrap">
            <Icon label="Table style" active={pop === 'tstyle'} onClick={() => setPop(pop === 'tstyle' ? null : 'tstyle')}><Rows3 size={16} /></Icon>
            {pop === 'tstyle' && (
              <div className="cb-pop cb-menu" role="menu">
                {TABLE_STYLES.map(([st, label]) => (
                  <button key={st} role="menuitem" className={(single as TableObj).style === st ? 'checked' : ''} onClick={() => { set({ style: st }); setPop(null); }}>{label}</button>
                ))}
              </div>
            )}
          </span>
          <span className="cb-group">
            <Icon label="Add row" onClick={() => actions.table('addRow')}><BetweenHorizontalStart size={16} /></Icon>
            <Icon label="Add column" onClick={() => actions.table('addCol')}><BetweenVerticalStart size={16} /></Icon>
            {sub?.cell && <Icon label="Delete row" onClick={() => actions.table('delRow')}><Rows3 size={16} style={{ opacity: 0.6 }} /><span className="cb-x">×</span></Icon>}
            {sub?.cell && <Icon label="Delete column" onClick={() => actions.table('delCol')}><Columns3 size={16} style={{ opacity: 0.6 }} /><span className="cb-x">×</span></Icon>}
          </span>
        </>
      )}
      {types.size === 1 && types.has('draw') && !locked && (
        <span className="cb-group">
          {([['Thin', 3], ['Medium', 6], ['Thick', 12]] as const).map(([label, size]) => (
            <Icon key={size} label={label} active={same(selected.map((o) => (o as { size: number }).size)) === size} onClick={() => set({ size })}>
              <span className="stroke-icon" style={{ height: Math.max(2, size / 2) }} />
            </Icon>
          ))}
        </span>
      )}
      {types.size === 1 && types.has('connector') && !locked && (() => {
        const c = selected as Extract<BoardObject, { type: 'connector' }>[];
        const route = same(c.map((o) => o.route));
        return (
          <>
            <span className="cb-group">
              <Icon label="Straight" active={route === 'straight'} onClick={() => set({ route: 'straight' })}><Straight size={16} style={{ transform: 'rotate(-45deg)' }} /></Icon>
              <Icon label="Elbow" active={route === 'elbow'} onClick={() => set({ route: 'elbow' })}><CornerDownRight size={16} /></Icon>
              <Icon label="Curved" active={route === 'curved'} onClick={() => set({ route: 'curved' })}><Spline size={16} /></Icon>
            </span>
            <span className="cb-group">
              <Icon label="Start arrow" active={same(c.map((o) => o.startCap)) === 'arrow'} onClick={() => set({ startCap: c[0].startCap === 'arrow' ? 'none' : 'arrow' })}><MoveRight size={16} style={{ transform: 'scaleX(-1)' }} /></Icon>
              <Icon label="Swap ends" onClick={() => update(c.map((o) => ({ id: o.id, from: o.to, to: o.from, startCap: o.endCap, endCap: o.startCap })))}><ArrowLeftRight size={16} /></Icon>
              <Icon label="End arrow" active={same(c.map((o) => o.endCap)) === 'arrow'} onClick={() => set({ endCap: c[0].endCap === 'arrow' ? 'none' : 'arrow' })}><MoveRight size={16} /></Icon>
              <Icon label="Dashed" active={same(c.map((o) => o.dash)) === true} onClick={() => set({ dash: !c[0].dash })}><span className="deco-icon deco-dash" /></Icon>
            </span>
          </>
        );
      })()}
      <span className="cb-group">
        {!locked && <Icon label="Duplicate" keys="⌘D" onClick={actions.duplicate}><Copy size={16} /></Icon>}
        {single && <Icon label="Add comment" keys="M" onClick={actions.comment}><MessageSquarePlus size={16} /></Icon>}
        {locked && <Icon label="Unlock" keys="⇧⌘L" active onClick={actions.toggleLock}><Unlock size={16} /></Icon>}
        {/* The same menu as a right-click: copy as, arrange, align, lock, wrap in section and the rest. */}
        <Icon label="More" onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); actions.openMenu(r.left, r.bottom + 6); }}><Ellipsis size={16} /></Icon>
      </span>
    </div>
  );
}

// Bold, italic (more: underline, strikethrough), lists, link and @mention. While typing, they act on the
// selection in the editor; with the object only selected, on all of its text (link and @ open the editor first).
function TextFormat({ rich, json, pop, setPop }: {
  rich: Props['actions']['rich']; json: (import('../../../shared/richtext.ts').RichJSON | undefined)[];
  pop: string | null; setPop: (p: never) => void;
}) {
  const ed = useActiveEditor();
  const view = rich.editing ? ed?.view : undefined;
  const open = (p: string) => (setPop as (p: string | null) => void)(pop === p ? null : p);
  const isOn = (mark: Mark) => (view ? markActive(view.state, schema.marks[mark]) : json.length > 0 && json.every((j) => jsonHasMark(j, mark)));
  const listOn = (kind: ListKind) => (view ? activeList(view.state) === kind : json.length > 0 && json.every((j) => jsonListKind(j) === kind));
  const mark = (m: Mark) => {
    if (view) return commands.mark(view, m);
    const fs = rich.fragments(), on = !fs.every((f) => hasMarkEverywhere(f, m));
    fs.forEach((f) => formatAll(f, m, on ? {} : null, LOCAL));
  };
  const list = (kind: ListKind) => {
    (setPop as (p: string | null) => void)(null);
    if (view) return commands.list(view, kind);
    const fs = rich.fragments(), off = fs.every((f) => listKindOf(f) === kind);
    fs.forEach((f) => setListAll(f, off ? null : kind, LOCAL));
  };
  const link = () => {
    if (view) return open('link');
    rich.edit((v) => { v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1, Math.max(1, v.state.doc.content.size - 1)))); requestBarPop('link'); });
  };
  const mention = () => (view ? commands.mention(view) : rich.edit((v) => commands.mention(v)));
  const href = view ? commands.linkAt(view.state) : undefined;
  return (
    <>
      <span className="cb-group">
        <Icon label="Bold" keys="⌘B" active={isOn('bold')} onClick={() => mark('bold')}><Bold size={16} /></Icon>
        <Icon label="Italic" keys="⌘I" active={isOn('italic')} onClick={() => mark('italic')}><Italic size={16} /></Icon>
        <span className="cb-wrap">
          <Icon label="More text options" active={pop === 'tmore'} onClick={() => open('tmore')}><EllipsisVertical size={16} /></Icon>
          {pop === 'tmore' && (
            <div className="cb-pop cb-menu" role="menu">
              <button role="menuitem" className={isOn('underline') ? 'checked' : ''} onClick={() => mark('underline')}><Underline size={15} /> Underline<kbd>⌘U</kbd></button>
              <button role="menuitem" className={isOn('strike') ? 'checked' : ''} onClick={() => mark('strike')}><Strikethrough size={15} /> Strikethrough<kbd>⇧⌘X</kbd></button>
            </div>
          )}
        </span>
      </span>
      <span className="cb-group">
        <Icon label="Bulleted list" keys="- space" active={listOn('bullet_list')} onClick={() => list('bullet_list')}><List size={16} /></Icon>
        <span className="cb-wrap">
          <Icon label="More list options" active={pop === 'lmore'} onClick={() => open('lmore')}><EllipsisVertical size={16} /></Icon>
          {pop === 'lmore' && (
            <div className="cb-pop cb-menu" role="menu">
              <button role="menuitem" className={listOn('bullet_list') ? 'checked' : ''} onClick={() => list('bullet_list')}><List size={15} /> Bulleted list</button>
              <button role="menuitem" className={listOn('ordered_list') ? 'checked' : ''} onClick={() => list('ordered_list')}><ListOrdered size={15} /> Numbered list<kbd>1. space</kbd></button>
            </div>
          )}
        </span>
      </span>
      <span className="cb-wrap">
        <Icon label="Link" keys="⌘K" active={pop === 'link' || !!href} onClick={link}><Link2 size={16} /></Icon>
        {pop === 'link' && view && <LinkField key={href ?? ''} href={href} view={view} close={() => (setPop as (p: string | null) => void)(null)} />}
      </span>
      <Icon label="Mention someone" keys="@" onClick={mention}><AtSign size={16} /></Icon>
    </>
  );
}

function LinkField({ href, view, close }: { href?: string; view: EditorView; close: () => void }) {
  const [v, setV] = useState(href ?? '');
  const apply = (to: string | null) => { commands.link(view, to); close(); };
  return (
    <form className="cb-pop cb-link" onSubmit={(e) => { e.preventDefault(); apply(v.trim() || null); }}>
      <input autoFocus className="search" value={v} placeholder="Paste or type a link" aria-label="Link address" onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { close(); view.focus(); } }} />
      {href && <button type="button" className="cb-btn" aria-label="Remove link" data-tip="Remove link" onClick={() => apply(null)}><Unlink size={15} /></button>}
    </form>
  );
}
