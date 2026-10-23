import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { copyText, copyBlob, readClipboard } from '../clipboard.ts';
import { addObjects, deleteObjects, isRichField, maxZ, pendingOf, readObjects, richOf, textOf, updateObjects, type Patch } from '../../../shared/doc.ts';
import { RichSource, RichUndo, requestBarPop, whenEditorOpens } from './rich.tsx';
import { TextSource } from './ytext.ts';
import { fromExcalidraw } from '../../../shared/excalidraw.ts';
import { placeBatch, translate, type Rect } from '../../../shared/layout.ts';
import { addChild, addParent, addSibling, deleteNode, indentNode, mindmapFromOutline, neighbour, outdentNode, setNode } from '../../../shared/mindmapOps.ts';
import { addCol, addRow, deleteCol, deleteRow, newTable } from '../../../shared/tableOps.ts';
import {
  DEFAULTS, DEVICES, FRAME_Z, frameScreen, SECTION_Z, STACK_Z, TASK_H, type TaskObj, type StackObj, SHAPE_SIZE, WF_DEFAULTS, cellKey, isBox, isContainer, newId, type BoardObject, type BoxObject, type ConnectorObj, type DrawObj, type End,
  type MindmapObj, type ShapeKind, type Side, type TableObj,
} from '../../../shared/model.ts';
import { anchor, connectorGeometry, type Pt } from '../../../shared/route.ts';
import { BoxView, ConnectorView, strokePath } from './ObjectView.tsx';
import { layoutMindmap } from '../../../shared/mindmapLayout.ts';
import { measureText, useFontsReady } from './measure.ts';
import { WF_TEXT } from './Wireframe.tsx';
import { TaskView, usePeople } from './TaskView.tsx';
import { TaskExpanded } from './TaskExpanded.tsx';
import { describeChange, layoutStacks, logActivity, orderAt } from '../../../shared/tasks.ts';
import { MindmapView, NEW_ROOT, type NodeKey } from './MindmapView.tsx';
import { TableView, type CellKey } from './TableView.tsx';
import { ContextBar } from './ContextBar.tsx';
import { BottomBar, Toolbar, type Flyout, type InsertKind, type Mode, type Tool } from './Toolbar.tsx';
import { InsertDialog } from './InsertDialog.tsx';
import { imageObject, mermaidObjects } from './insert.ts';
import {
  SECTION_TITLE_H, byIdOf, cloneObjects, contains, objectBounds, deserialize, hitBox, intersects, sectionContents, selectionBounds, serialize, snapRect, withInnerConnectors, type Guides,
} from './ops.ts';
import { LOCAL, type Board } from './useBoard.ts';
import { anchorPoint, CommentsPanel, Composer, Pin, ThreadView } from './Comments.tsx';
import { api, type Role } from '../api.ts';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceAround, AlignStartHorizontal, AlignStartVertical,
  AlignVerticalSpaceAround, Bookmark, ChevronLeft, ChevronRight, ClipboardPaste, Copy as CopyIcon, CopyPlus, Download, Files, Frame as FrameIcon, Grid3x3,
  History, Image as ImageIcon, Layers, Link2, Lock as LockIcon, MessageSquare, MessageSquarePlus, MousePointerClick, Paintbrush, Play, Scissors,
  Trash2, Unlock, X as XIcon, ZoomIn, ZoomOut, Maximize, Search, Group, Ungroup,
} from 'lucide-react';
import { HistoryPanel, TimerPill, TimerStart, VotingBanner, VotingStart, castVote, myVotes, totals } from './BoardPanels.tsx';
import type { TimerState, VotingSession } from '../../../shared/themes.ts';
import { ExportMenu } from './ExportMenu.tsx';
import { ContextMenu, type MenuItem } from './ContextMenu.tsx';
import { newTable as tableFrom, parseMarkdownTable } from '../../../shared/tableOps.ts';
import { TemplateGallery } from '../TemplateGallery.tsx';
import { boardSvg, svgToPng } from './exporter.ts';
import { toMermaid } from '../../../shared/mermaidOut.ts';
import { CANVAS, lineColor, setPalette, type Theme } from './theme.ts';
import { paletteOf, type BoardTheme } from '../../../shared/themes.ts';

type Vp = { x: number; y: number; zoom: number };
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type Drag =
  | { kind: 'pan'; sx: number; sy: number; vp: Vp }
  | { kind: 'move'; start: Pt; orig: Map<string, Pt>; ends: Map<string, { from: End; to: End }>; others: Rect[]; rect: Rect; moved: boolean; clicked?: string }
  | { kind: 'resize'; id: string; handle: Handle; start: Pt; orig: Rect; crop?: { x: number; y: number; w: number; h: number } }
  | { kind: 'marquee'; start: Pt; cur: Pt; base: string[] }
  | { kind: 'create'; tool: Tool; start: Pt; cur: Pt }
  | { kind: 'connect'; fromBox?: BoxObject; from: End; start: Pt; cur: Pt }
  | { kind: 'endpoint'; id: string; which: 'from' | 'to'; cur: Pt }
  | { kind: 'draw'; pts: number[]; mode: 'marker' | 'highlighter' | 'eraser' }
  | { kind: 'node'; map: string; node: string; start: Pt; cur: Pt; sx: number; sy: number; moved: boolean; target: string | null };

// Focus inside an object: a mind map node or a table cell.
export type Sub = { id: string; node?: string; cell?: [string, string] } | null;
// Derived writes (mind map and table sizes) are not undo steps.
const LAYOUT = { layout: true };

const ZOOM_MIN = 0.1, ZOOM_MAX = 4, GRID = 20;
const SHAPE_KEYS: Record<string, ShapeKind> = { r: 'rect', u: 'pill', o: 'oval', d: 'diamond', p: 'parallelogram', g: 'triangle', f: 'hexagon', y: 'cylinder', j: 'cloud', v: 'star', l: 'line', b: 'bracket', a: 'annotation' };
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const editable = (o: BoardObject) => ['shape', 'text', 'sticky', 'section', 'frame', 'task', 'stack', 'connector', 'icon', 'link'].includes(o.type) || (o.type === 'wf' && WF_TEXT.has(o.kind));
const WF_KEYS: Record<string, Tool> = {
  a: { kind: 'wf', wf: 'annotation' }, b: { kind: 'wf', wf: 'button' }, l: { kind: 'wf', wf: 'divider' }, d: { kind: 'wf', wf: 'divider' },
  g: { kind: 'wf', wf: 'image' }, o: { kind: 'wf', wf: 'shape', shapeType: 'ellipse' }, p: { kind: 'wf', wf: 'input' }, r: { kind: 'wf', wf: 'shape' }, v: { kind: 'wf', wf: 'avatar' },
};
const isUrl = (t: string) => /^https?:\/\/\S+$/i.test(t.trim());
type Arrange = 'front' | 'back' | 'forward' | 'backward';
// Hover keys for connector ends: "<id>" or "<map id>#<node id>".
const keyOf = (e: End) => (e.id ? (e.node ? `${e.id}#${e.node}` : e.id) : '');
const endOfKey = (k: string): End => { const [id, node] = k.split('#'); return node ? { id, node } : { id }; };
// Style = how an object looks, not what it says: used by Copy/Paste style and Save as default style.
const STYLE_KEYS = ['color', 'deco', 'fontSize', 'align', 'route', 'dash', 'startCap', 'endCap', 'size', 'state', 'shapeType', 'headColor', 'style'];
const styleOf = (o: BoardObject) => Object.fromEntries(STYLE_KEYS.filter((k) => k in o).map((k) => [k, (o as unknown as Record<string, unknown>)[k]]));
const defaultStyle = (type: string): Record<string, unknown> => { try { return JSON.parse(localStorage.getItem(`pragmatic:style:${type}`) ?? '{}'); } catch { return {}; } };
const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

const loadVp = (id: string): Vp | null => { try { return JSON.parse(localStorage.getItem(`pragmatic:vp:${id}`) ?? 'null'); } catch { return null; } };
const saveVp = (id: string, vp: Vp) => { try { localStorage.setItem(`pragmatic:vp:${id}`, JSON.stringify(vp)); } catch { /* private mode */ } };

export function Canvas({ board, boardId, theme, role, onToast }: { board: Board; boardId: string; theme: Theme; role: Role; onToast: (m: string) => void }) {
  // Viewers and commenters can look, select, pan and (commenters) comment. The server drops their board changes anyway.
  const canEdit = role === 'edit' || role === 'owner', canComment = canEdit || role === 'comment';
  const { doc, awareness, undo, peers, history, synced, threads, settings, votes } = board;
  // Time machine preview shows an old version read-only instead of the live board.
  const [preview, setPreview] = useState<{ id: string; at: number; objects: BoardObject[] } | null>(null);
  const objects = preview?.objects ?? board.objects;
  // The board's color theme, applied before any object renders.
  // The board's own theme, else the workspace default.
  const [wsTheme, setWsTheme] = useState<BoardTheme | null>(null);
  useEffect(() => {
    const load = () => api.themes().then((w) => { const t = w.themes.find((x) => x.id === w.default_id); setWsTheme(t ? { name: t.name, base: t.base } : null); }, () => {});
    load();
    addEventListener('pragmatic:themes', load);
    return () => removeEventListener('pragmatic:themes', load);
  }, []);
  const palette = useMemo(() => paletteOf((settings.theme as BoardTheme | undefined) ?? wsTheme), [settings.theme, wsTheme]);
  setPalette(palette);
  const pv = useMemo(() => Math.random(), [palette]);
  const el = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Vp>(() => loadVp(boardId) ?? { x: 400, y: 300, zoom: 1 });
  const [tool, setTool] = useState<Tool>({ kind: 'select' });
  const [flyout, setToolbarFlyout] = useState<Flyout>(null);
  const [mode, setModeState] = useState<Mode>(() => { try { const m = localStorage.getItem('pragmatic:mode'); return m === 'wireframe' || m === 'task' ? m : 'diagram'; } catch { return 'diagram'; } });
  const setMode = (m: Mode) => { setModeState(m); setTool({ kind: 'select' }); try { localStorage.setItem('pragmatic:mode', m); } catch { /* private window */ } };
  const [selection, setSelection] = useState<string[]>([]);
  const [editing, setEditingState] = useState<string | null>(null);
  const editOk = useRef(canEdit);
  editOk.current = canEdit;
  const setEditing = useCallback((v: React.SetStateAction<string | null>) => { if (editOk.current || v === null || typeof v === 'function') setEditingState(v); }, []);
  const [hover, setHover] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [guides, setGuides] = useState<Guides>({ x: [], y: [] });
  const [space, setSpace] = useState(false);
  // Hold ⌥ while hovering another object to measure the gap to the selection.
  const [alt, setAlt] = useState(false);
  // Q in Diagram mode hides the quick-add dots (remembered per browser).
  const [quickDots, setQuickDots] = useState(() => { try { return localStorage.getItem('pragmatic:quickadd') !== 'off'; } catch { return true; } });
  const toggleQuickDots = () => setQuickDots((on) => { try { localStorage.setItem('pragmatic:quickadd', on ? 'off' : 'on'); } catch { /* private window */ } onToast(on ? 'Quick add hidden (Q to show)' : 'Quick add shown'); return !on; });
  const [dialog, setDialog] = useState<null | 'mermaid' | 'mindmap' | 'template'>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; world: Pt } | null>(null);
  const [sub, setSub] = useState<Sub>(null);
  const [subEdit, setSubEdit] = useState(false);
  const [openThread, setOpenThread] = useState<string | null>(null);
  // A link from the inbox (?thread=<id>) opens that thread and centers the view on it, once the board has loaded.
  const linkThread = useRef(new URLSearchParams(location.search).get('thread'));
  useEffect(() => {
    const id = linkThread.current, t = id ? threads.find((x) => x.id === id) : undefined;
    if (!t || !el.current) return;
    linkThread.current = null;
    setOpenThread(t.id);
    const p = anchorPoint(t, byIdOf(objects)), r = el.current.getBoundingClientRect();
    setVp((v) => ({ ...v, x: r.width / 2 - p.x * v.zoom - 160, y: r.height / 2 - p.y * v.zoom }));
    fitted.current = true;
    const u = new URL(location.href);
    u.searchParams.delete('thread');
    window.history.replaceState(window.history.state, '', u);
  }, [threads, objects]);
  const [commentDraft, setCommentDraft] = useState<{ objectId?: string; x: number; y: number; at: Pt } | null>(null);
  const [panel, setPanel] = useState<null | 'comments' | 'export' | 'history'>(null);
  const [pop, setPop] = useState<null | 'timer' | 'voting'>(null);
  const [votingOn, setVotingOn] = useState(true);
  const [presenting, setPresenting] = useState<number | null>(null);
  const session = settings.voting as VotingSession | undefined;
  const [cropId, setCropId] = useState<string | null>(null);
  const [linkAsk, setLinkAsk] = useState<{ at: Pt; id?: string; url?: string } | null>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  // Objects by id, plus the measured box of every mind map node as "<map>#<node>", so connectors can bind to nodes.
  const fontsReady = useFontsReady();
  const byId = useMemo(() => {
    const m = byIdOf(objects);
    for (const o of objects) {
      if (o.type !== 'mindmap') continue;
      const l = layoutMindmap(o, measureText);
      for (const n of l?.nodes.values() ?? []) m.set(`${o.id}#${n.id}`, { id: `${o.id}#${n.id}`, type: 'shape', shape: 'rect', x: o.x + n.x, y: o.y + n.y, w: n.w, h: n.h, z: o.z } as unknown as BoardObject);
    }
    return m;
  }, [objects, fontsReady]);
  const selected = useMemo(() => selection.map((id) => byId.get(id)).filter(Boolean) as BoardObject[], [selection, byId]);
  const boxes = useMemo(() => objects.filter(isBox), [objects]);
  // Stacking order of every object (objects are sorted by z).
  const layer = useMemo(() => new Map(objects.map((o, i) => [o.id, i])), [objects]);
  // Links to an object (?object=<id>) or to a board position (?x=&y=&zoom=), applied once the board has loaded.
  const linkPlace = useRef(new URLSearchParams(location.search));
  useEffect(() => {
    const q = linkPlace.current, id = q.get('object'), x = Number(q.get('x')), y = Number(q.get('y'));
    if (!el.current || !synced || (!id && !q.has('x'))) return;
    if (id) {
      if (!byId.has(id)) return; // not synced yet
      setSelection([id]);
      fitTo(selectionBounds([id], byId));
    } else if (Number.isFinite(x) && Number.isFinite(y)) {
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(q.get('zoom')) || 1)), r = el.current.getBoundingClientRect();
      setVp({ zoom, x: r.width / 2 - x * zoom, y: r.height / 2 - y * zoom });
    }
    fitted.current = true;
    linkPlace.current = new URLSearchParams();
    const u = new URL(location.href);
    for (const k of ['object', 'x', 'y', 'zoom']) u.searchParams.delete(k);
    window.history.replaceState(window.history.state, '', u);
  }, [synced, byId]);
  const connectors = useMemo(() => objects.filter((o): o is ConnectorObj => o.type === 'connector'), [objects]);

  // Drop selection entries that other people deleted.
  useEffect(() => { if (selection.some((id) => !byId.has(id))) setSelection((s) => s.filter((id) => byId.has(id))); }, [byId]);
  useEffect(() => { awareness.setLocalStateField('selection', selection); }, [selection, awareness]);
  // A sub-focus only lives while its object is the single selection.
  useEffect(() => { if (sub && (selection.length !== 1 || selection[0] !== sub.id)) { setSub(null); setSubEdit(false); } }, [selection]);

  const screenOf = (p: Pt) => ({ x: p.x * vp.zoom + vp.x, y: p.y * vp.zoom + vp.y });
  const worldOf = useCallback((clientX: number, clientY: number): Pt => {
    const r = el.current!.getBoundingClientRect();
    return { x: (clientX - r.left - vp.x) / vp.zoom, y: (clientY - r.top - vp.y) / vp.zoom };
  }, [vp]);
  const viewCenter = (): Pt => { const r = el.current!.getBoundingClientRect(); return { x: (r.width / 2 - vp.x) / vp.zoom, y: (r.height / 2 - vp.y) / vp.zoom }; };

  const zoomAt = useCallback((sx: number, sy: number, z: number) => setVp((v) => {
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    return { zoom, x: sx - ((sx - v.x) / v.zoom) * zoom, y: sy - ((sy - v.y) / v.zoom) * zoom };
  }), []);
  const zoomCenter = (z: number) => { fitted.current = true; const r = el.current!.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, z); };
  const fitTo = useCallback((rect: Rect | null, maxZoom = 1) => {
    if (!el.current) return;
    const r = el.current.getBoundingClientRect();
    if (!rect) return setVp({ x: r.width / 2, y: r.height / 2, zoom: 1 });
    const pad = 96, zoom = Math.min(maxZoom, Math.max(ZOOM_MIN, Math.min((r.width - pad * 2) / Math.max(rect.w, 1), (r.height - pad * 2) / Math.max(rect.h, 1))));
    setVp({ zoom, x: r.width / 2 - (rect.x + rect.w / 2) * zoom, y: r.height / 2 - (rect.y + rect.h / 2) * zoom });
  }, []);
  const fitContent = () => fitTo(selectionBounds(objects.map((o) => o.id), byId));

  // First open of a board on this device: show all content once it has arrived.
  const fitted = useRef(!!loadVp(boardId));
  // An empty board waits for its first content (for example from Claude), unless the user acts first.
  useEffect(() => {
    if (!synced || fitted.current || !objects.length) return;
    fitted.current = true;
    fitContent();
  }, [synced, objects.length]);

  useEffect(() => {
    if (!fitted.current) return; // do not store the placeholder view before the first fit
    const t = setTimeout(() => saveVp(boardId, vp), 300);
    return () => clearTimeout(t);
  }, [vp, boardId]);

  // --- edits -----------------------------------------------------------------
  const update = useCallback((patches: Patch[]) => { if (editOk.current) updateObjects(doc, patches, LOCAL); }, [doc]);
  const add = useCallback((objs: BoardObject[]) => { if (editOk.current) addObjects(doc, objs, LOCAL); }, [doc]);
  // Changes to task cards also go to the card's activity log.
  const people = usePeople();
  const taskUpdate = (patches: Patch[]) => {
    for (const p of patches) {
      const o = byId.get(p.id);
      if (o?.type !== 'task') continue;
      const words = describeChange(o, p as Partial<TaskObj>, (id) => people.get(id)?.name ?? 'someone', (id) => (byId.get(id) as StackObj | undefined)?.title || 'a stack');
      for (const w of words) logActivity(doc, o.id, board.me.name, w);
    }
    update(patches);
  };
  const [expanded, setExpandedState] = useState<string | null>(() => new URLSearchParams(location.search).get('task'));
  // The open card is in the URL, so a link to it opens it.
  const setExpanded = (id: string | null) => {
    setExpandedState(id);
    const u = new URL(location.href);
    if (id) u.searchParams.set('task', id); else u.searchParams.delete('task');
    window.history.replaceState(window.history.state, '', u);
  };
  // Server-side render (Drive copies, export_board): the server opens ?render=1 and calls this for a PNG of the whole board.
  useEffect(() => {
    if (new URLSearchParams(location.search).get('render') !== '1' || !synced) return;
    type Opts = { ids?: string[]; background?: boolean };
    const w = window as unknown as { __pragmaticRender?: (scale?: number, opts?: Opts) => Promise<string | null>; __pragmaticReady?: boolean };
    w.__pragmaticRender = async (scale = 2, { ids, background = true }: Opts = {}) => {
      await document.fonts.ready;
      const only = ids?.length ? withInnerConnectors(ids, objects).map((o) => o.id) : undefined;
      const rect = selectionBounds(only ?? objects.map((o) => o.id), byId);
      if (!rect || !worldRef.current) return null;
      const blob = await svgToPng(await boardSvg(worldRef.current, rect, { background: background ? CANVAS[theme].bg : null, theme, only: only && new Set(only) }), scale);
      return new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.readAsDataURL(blob); });
    };
    requestAnimationFrame(() => requestAnimationFrame(() => { w.__pragmaticReady = true; }));
  }, [synced, objects, byId, theme]);
  // Others see what I am typing in, including an open card.
  useEffect(() => { awareness.setLocalStateField('editing', editing ?? expanded); }, [editing, expanded, awareness]);
  // Stacks place their cards; cards being dragged keep their own position until dropped.
  const dragging = drag?.kind === 'move' ? drag.orig : null;
  useEffect(() => {
    const patches = canEdit ? layoutStacks(objects, new Set(dragging?.keys() ?? [])) : [];
    if (patches.length) updateObjects(doc, patches, LAYOUT);
  }, [objects, dragging]);
  const commentCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of threads) if (!t.resolved && t.anchor.objectId) m.set(t.anchor.objectId, (m.get(t.anchor.objectId) ?? 0) + 1);
    return m;
  }, [threads]);
  const removeSelected = () => {
    const ids = selected.filter((o) => !o.locked).map((o) => o.id);
    if (ids.length) deleteObjects(doc, ids, LOCAL);
    setSelection([]);
  };
  const insertBatch = (batch: BoardObject[], at?: Pt, focus = true) => {
    const b = selectionBounds(batch.map((o) => o.id), byIdOf(batch));
    const c = at ?? viewCenter();
    const placed = b ? translate(batch, c.x - (b.x + b.w / 2), c.y - (b.y + b.h / 2)) : batch;
    add(placed);
    setSelection(placed.filter((o) => isBox(o) || !o.from.id).map((o) => o.id));
    setTool({ kind: 'select' });
    if (focus) {
      const all = byIdOf([...objects, ...placed]);
      const r = selectionBounds(placed.map((o) => o.id), all);
      const view = el.current!.getBoundingClientRect();
      if (r && (r.w * vp.zoom > view.width - 120 || r.h * vp.zoom > view.height - 120)) fitTo(r, vp.zoom);
    }
    return placed;
  };
  const duplicate = (ids = selection, dx = 24, dy = 24) => {
    const src = withInnerConnectors(ids, objects);
    if (!src.length) return [];
    const copies = cloneObjects(src, byId, dx, dy, maxZ(doc) + 1);
    add(copies);
    const picked = copies.filter((_, i) => ids.includes(src[i].id));
    setSelection(picked.map((c) => c.id));
    return picked;
  };
  // Arrange: to the front or back of everything, or one step past the next object that overlaps the selection.
  // Sections and frames keep their own layer below content.
  const arrange = (how: Arrange) => {
    const moving = selected.filter((o) => !isContainer(o)).sort((a, b) => a.z - b.z);
    if (!moving.length) return;
    const ids = new Set(moving.map((o) => o.id)), rest = objects.filter((o) => !isContainer(o) && !ids.has(o.id));
    const place = (lo: number, hi: number) => update(moving.map((o, k) => ({ id: o.id, z: lo + ((hi - lo) * (k + 1)) / (moving.length + 1) })));
    if (how === 'front') return place(Math.max(0, ...rest.map((o) => o.z)), Math.max(0, ...rest.map((o) => o.z)) + moving.length + 1);
    if (how === 'back') return place(Math.min(0, ...rest.map((o) => o.z)) - moving.length - 1, Math.min(0, ...rest.map((o) => o.z)));
    const area = selectionBounds([...ids], byId);
    const near = rest.filter((o) => { const b = objectBounds(o, byId); return !!b && !!area && intersects(b, area); });
    const top = moving.at(-1)!.z, bottom = moving[0].z;
    if (how === 'forward') {
      const past = near.find((o) => o.z > top);
      if (!past) return;
      const next = rest.find((o) => o.z > past.z);
      return place(past.z, next ? next.z : past.z + 1);
    }
    const past = near.filter((o) => o.z < bottom).at(-1);
    if (!past) return;
    const prev = rest.filter((o) => o.z < past.z).at(-1);
    place(prev ? prev.z : past.z - 1, past.z);
  };
  const copied = useRef<Record<string, unknown> | null>(null);
  const copyAs = async (kind: 'png' | 'png-clear' | 'png-light' | 'png-dark' | 'svg' | 'mermaid' | 'link') => {
    try {
      // Light or dark regardless of the screen's theme: the server draws it (the promise keeps the click's clipboard permission).
      if (kind === 'png-light' || kind === 'png-dark') {
        const png = api.renderPng(boardId, { theme: kind === 'png-light' ? 'light' : 'dark', ids: selection });
        await copyBlob('image/png', png);
        return onToast(`Copied as PNG (${kind === 'png-light' ? 'light' : 'dark'})`);
      }
      if (kind === 'link') return void copyText(`${location.origin}/b/${boardId}?object=${selection[0]}`).then(() => onToast('Link copied'));
      if (kind === 'mermaid') {
        const text = toMermaid(withInnerConnectors(selection, objects));
        if (!text) return onToast('Select shapes to copy as Mermaid');
        return void copyText(text).then(() => onToast('Copied as Mermaid'));
      }
      const svg = await boardSvg(worldRef.current!, selBounds!, { background: kind === 'png' ? c.bg : null, theme, only: new Set(selection) });
      const blob = kind === 'svg' ? new Blob([svg], { type: 'text/plain' }) : await svgToPng(svg, 2);
      await copyBlob(blob.type, blob);
      onToast(kind === 'svg' ? 'Copied as SVG' : 'Copied as PNG');
    } catch (e) { onToast(`Copy failed: ${(e as Error).message}`); }
  };
  const copyPositionLink = () => {
    const p = viewCenter();
    copyText(`${location.origin}/b/${boardId}?x=${Math.round(p.x)}&y=${Math.round(p.y)}&zoom=${vp.zoom.toFixed(2)}`).then(() => onToast('Link to this board position copied'));
  };
  const pasteStyle = () => {
    const st = copied.current;
    if (st) update(selected.map((o) => ({ id: o.id, ...Object.fromEntries(Object.entries(st).filter(([k]) => k in o)) })));
  };
  const saveDefaultStyle = () => {
    const o = selected[0];
    if (!o) return;
    try { localStorage.setItem(`pragmatic:style:${o.type}`, JSON.stringify(Object.fromEntries(Object.entries(styleOf(o)).filter(([k]) => k !== 'size' && k !== 'state')))); } catch { /* private window */ }
    onToast(`New ${o.type === 'shape' ? 'shapes' : o.type === 'connector' ? 'connectors' : `${o.type}s`} use this style`);
  };
  const alignBoxes = () => selected.filter((o): o is BoxObject => isBox(o) && !o.locked);
  const align = (how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    const bs = alignBoxes(), r = selectionBounds(bs.map((o) => o.id), byId);
    if (bs.length < 2 || !r) return;
    update(bs.map((o) => ({ id: o.id, ...{ left: { x: r.x }, center: { x: r.x + r.w / 2 - o.w / 2 }, right: { x: r.x + r.w - o.w }, top: { y: r.y }, middle: { y: r.y + r.h / 2 - o.h / 2 }, bottom: { y: r.y + r.h - o.h } }[how] })));
  };
  // Equal gaps between neighbours, keeping the outer two in place.
  const distribute = (axis: 'x' | 'y') => {
    const size = axis === 'x' ? 'w' : 'h', bs = alignBoxes().sort((a, b) => a[axis] - b[axis]);
    if (bs.length < 3) return;
    const gap = (bs.at(-1)![axis] + bs.at(-1)![size] - bs[0][axis] - bs.reduce((t, o) => t + o[size], 0)) / (bs.length - 1);
    let at = bs[0][axis];
    update(bs.map((o) => { const p = { id: o.id, [axis]: at }; at += o[size] + gap; return p; }));
  };
  const wrapInSection = () => {
    const r = selectionBounds(selection, byId);
    if (!r) return;
    const pad = 40, sec = makeBox({ kind: 'section' }, { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad })!;
    add([sec]);
    setSelection([sec.id]);
    setEditing(sec.id);
  };
  const snapToGrid = () => update(selected.filter((o): o is BoxObject => isBox(o) && !o.locked).map((o) => ({ id: o.id, x: Math.round(o.x / GRID) * GRID, y: Math.round(o.y / GRID) * GRID })));
  const setThumbnail = async () => {
    try {
      const png = await svgToPng(await boardSvg(worldRef.current!, selBounds!, { background: c.bg, theme, only: new Set(selection) }), 1);
      const { src } = await api.uploadImage(png);
      await api.update(boardId, { thumbnail: src });
      onToast('Board thumbnail set');
    } catch (e) { onToast(`Could not set the thumbnail: ${(e as Error).message}`); }
  };
  // Portrait <-> landscape. Components keep their offset from the screen's top-left (so the layout does not squash);
  // wide ones (fields, tabs, lines) keep filling the width; anything past the new edges is pulled back in.
  const rotateFrame = () => {
    const f = selected[0];
    if (f?.type !== 'frame') return;
    const a = frameScreen(f), b = frameScreen({ ...f, w: f.h, h: f.w });
    const moved = sectionContents(f, objects).filter((o) => !o.locked).map((o) => {
      const w = o.w > a.w * 0.5 ? Math.max(o.w + b.w - a.w, 24) : Math.min(o.w, b.w);
      const x = Math.max(b.x, Math.min(b.x + (o.x - a.x), b.x + b.w - w)), y = Math.max(b.y, Math.min(b.y + (o.y - a.y), b.y + b.h - o.h));
      return { id: o.id, w, x, y };
    });
    update([{ id: f.id, w: f.h, h: f.w }, ...moved]);
  };
  const membersOf = (o: BoardObject) => (o.group ? objects.filter((x) => x.group === o.group).map((x) => x.id) : [o.id]);
  const groupSelected = () => { if (selected.length > 1) { const g = newId(); update(selected.map((o) => ({ id: o.id, group: g }))); } };
  const ungroupSelected = () => update(selected.filter((o) => o.group).map((o) => ({ id: o.id, group: undefined })));
  const toggleLock = () => { const lock = !selected.every((o) => o.locked); update(selected.map((o) => ({ id: o.id, locked: lock || undefined }))); };
  // Stable callbacks, so memoized object views do not re-render on every change.
  const linkDown = useRef(false);
  const latest = useRef(byId);
  latest.current = byId;
  const commitText = useCallback((id: string, text: string, before?: string) => {
    const o = latest.current.get(id);
    setEditing((e) => (e === id ? null : e));
    if (!o) return;
    if (o.type === 'section') update([{ id, title: text.trim() || 'Section' }]);
    else if (o.type === 'frame') update([{ id, title: text.trim() }]);
    else if (o.type === 'stack') update([{ id, title: text.trim() || 'Stack' }]);
    else if (o.type === 'task') { if (text !== (before ?? o.title)) logActivity(doc, id, board.me.name, `renamed the card to "${text}"`); update([{ id, title: text }]); }
    else if (o.type === 'link') update([{ id, title: text.trim() || o.site }]);
    else if (o.type === 'text' && !text.trim()) deleteObjects(doc, [id], LOCAL);
    else update([{ id, text }]);
  }, [doc, update, board.me.name]);
  const resizeTo = useCallback((id: string, w: number, h: number) => update([{ id, w, h }]), [update]);
  // Editors type into shared text; viewers get none, so they cannot change it.
  const textSource = useCallback((id: string, key: string) => (editOk.current ? textOf(doc, id, key, LOCAL) : null), [doc]);
  const richSource = useCallback((id: string, key: string) => (editOk.current ? richOf(doc, id, key, LOCAL) : null), [doc]);
  const richUndo = useMemo(() => ({ undo: () => { undo.undo(); }, redo: () => { undo.redo(); } }), [undo]);
  const layoutUpdate = useCallback((id: string, patch: Record<string, number>) => { if (editOk.current) updateObjects(doc, [{ id, ...patch }], LAYOUT); }, [doc]);

  // --- mind map nodes -------------------------------------------------------------
  const mapOf = (id: string) => latest.current.get(id) as MindmapObj | undefined;
  const focusNode = (id: string, node: string | null, edit = false) => {
    setSelection([id]);
    setSub(node ? { id, node } : null);
    setSubEdit(!!node && edit);
  };
  const mindmapAct = (id: string, node: string, act: NodeKey | 'Delete' | 'Collapse') => {
    const o = mapOf(id);
    if (!o) return;
    if (act === 'Delete') {
      const p = deleteNode(o, node);
      if (!p) { deleteObjects(doc, [id], LOCAL); setSelection([]); return; }
      update([p]);
      return focusNode(id, o[`n.${node}`]?.parent ?? null);
    }
    if (act === 'Collapse') { const p = setNode(o, node, { collapsed: !o[`n.${node}`]?.collapsed }); if (p) update([p]); return; }
    if (act === 'ShiftTab') return focusNode(id, o[`n.${node}`]?.parent ?? node);
    if (act === 'Indent' || act === 'Outdent') { const p = act === 'Indent' ? indentNode(o, node) : outdentNode(o, node); if (p) update([p]); return focusNode(id, node); }
    const isRoot = o[`n.${node}`]?.parent === null;
    const r = act === 'Tab' || (act === 'Enter' && isRoot) ? addChild(o, node)
      : act === 'Enter' ? addSibling(o, node)
      : act === 'ModEnter' ? addSibling(o, node, true)
      : addParent(o, node);
    if (!r) return;
    update([r.patch]);
    focusNode(id, r.nodeId, true);
  };
  const commitNode = useCallback((id: string, node: string, text: string, then?: NodeKey) => {
    const o = mapOf(id);
    const p = o && setNode(o, node, { text });
    if (p) update([p]);
    setSubEdit(false);
    if (then) setTimeout(() => mindmapAct(id, node, then));
  }, [update]);

  // --- table cells -------------------------------------------------------------------
  const tableOf = (id: string) => latest.current.get(id) as TableObj | undefined;
  const moveCell = (id: string, row: string, col: string, k: CellKey | 'Up' | 'Down' | 'Left' | 'Right', edit: boolean) => {
    const t = tableOf(id);
    if (!t) return;
    let r = t.rows.indexOf(row), c = t.cols.indexOf(col);
    const patches = [];
    if (k === 'Tab' || k === 'Right') { c++; if (c >= t.cols.length) { if (k === 'Right') c--; else { c = 0; r++; } } }
    if (k === 'ShiftTab' || k === 'Left') { c--; if (c < 0) { if (k === 'Left') c = 0; else { c = t.cols.length - 1; r = Math.max(0, r - 1); } } }
    if (k === 'Enter' || k === 'Down') r++;
    if (k === 'Up') r = Math.max(0, r - 1);
    let rows = t.rows;
    if (r >= t.rows.length) {
      if (k === 'Down') r = t.rows.length - 1;
      else { const a = addRow(t); patches.push(a.patch); rows = a.patch.rows as string[]; }
    }
    if (patches.length) update(patches);
    setSub({ id, cell: [rows[r], t.cols[c]] });
    setSubEdit(edit);
  };
  const commitCell = useCallback((id: string, row: string, col: string, text: string, then?: CellKey) => {
    update([{ id, [cellKey(row, col)]: text || undefined }]);
    setSubEdit(false);
    if (then) setTimeout(() => moveCell(id, row, col, then, true));
  }, [update]);

  // --- links ---------------------------------------------------------------------------
  const addLink = async (url: string, at: Pt, id?: string) => {
    const u = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    try {
      const card = await api.unfurl(u);
      if (id) return update([{ id, url: card.url, title: card.title, site: card.site }]);
      const w = Math.min(420, Math.max(220, card.title.length * 9 + 80));
      const o = { ...DEFAULTS.link, id: newId(), z: maxZ(doc) + 1, type: 'link', x: at.x - w / 2, y: at.y - 22, w, h: 44, ...card } as BoxObject;
      add([o]);
      setSelection([o.id]);
    } catch (e) { onToast(`Link failed: ${(e as Error).message}`); }
  };

  // --- quick add (Option + arrow, or a click on a connection dot) -----------------------
  const quickAdd = (src: BoxObject, side: Side) => {
    const dir = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[side];
    const gap = src.type === 'sticky' ? 24 : 80;
    const c = { x: src.x + src.w / 2, y: src.y + src.h / 2 };
    // Whimsical connects to an existing object in that direction instead of adding one.
    const target = src.type === 'sticky' ? undefined : boxes
      .filter((o) => o.id !== src.id && !isContainer(o) && o.type !== 'mindmap' && o.type !== 'draw')
      .map((o) => ({ o, d: (o.x + o.w / 2 - c.x) * dir[0] + (o.y + o.h / 2 - c.y) * dir[1], off: Math.abs((o.x + o.w / 2 - c.x) * dir[1] + (o.y + o.h / 2 - c.y) * dir[0]) }))
      .filter(({ d, off }) => d > 0 && d < 700 && off < Math.max(src.w, src.h))
      .sort((a, b) => a.d - b.d)[0]?.o;
    const z = maxZ(doc) + 1;
    let next = target;
    const objs: BoardObject[] = [];
    if (!next) {
      next = { ...src, id: newId(), z, locked: undefined, x: src.x + dir[0] * (src.w + gap), y: src.y + dir[1] * (src.h + gap) } as BoxObject;
      if ('text' in next) (next as { text: string }).text = '';
      objs.push(next);
    }
    if (src.type !== 'sticky') objs.push({ ...DEFAULTS.connector, ...defaultStyle('connector'), id: newId(), z: z + 1, type: 'connector', from: { id: src.id, side }, to: { id: next.id, side: OPPOSITE[side] } } as ConnectorObj);
    add(objs);
    setSelection([next.id]);
    if (!target) setEditing(next.id);
  };

  // --- creation ----------------------------------------------------------------
  const makeBox = (t: Tool, r: Rect): BoxObject | null => {
    const z = maxZ(doc) + 1;
    if (t.kind === 'shape') return { ...DEFAULTS.shape, ...defaultStyle('shape'), id: newId(), z, type: 'shape', shape: t.shape, ...r } as BoxObject;
    if (t.kind === 'sticky') return { ...DEFAULTS.sticky, ...defaultStyle('sticky'), id: newId(), z, type: 'sticky', author: board.awareness.getLocalState()?.user?.name ?? '', ...r } as BoxObject;
    if (t.kind === 'text') return { ...DEFAULTS.text, ...defaultStyle('text'), id: newId(), z, type: 'text', ...r } as BoxObject;
    if (t.kind === 'section') return { ...DEFAULTS.section, id: newId(), z: SECTION_Z + z, type: 'section', ...r } as BoxObject;
    if (t.kind === 'task') {
      // A card made inside a stack joins it.
      const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      const into = boxes.find((b): b is StackObj => b.type === 'stack' && !b.locked && c.x > b.x && c.x < b.x + b.w && c.y > b.y && c.y < b.y + b.h);
      return { ...DEFAULTS.task, id: newId(), z, type: 'task', watch: [board.me.id], ...r, h: TASK_H.m, ...(into && { stack: into.id, order: orderAt(into, c.y, objects, '') }) } as BoxObject;
    }
    if (t.kind === 'stack') return { ...DEFAULTS.stack, id: newId(), z: STACK_Z + z, type: 'stack', ...r } as BoxObject;
    if (t.kind === 'frame') return { ...DEFAULTS.frame, id: newId(), z: FRAME_Z + z, type: 'frame', device: t.device, title: '', ...r } as BoxObject;
    if (t.kind === 'wf') return { ...DEFAULTS.wf, ...WF_DEFAULTS[t.wf], ...(t.shapeType && { shapeType: t.shapeType }), id: newId(), z, type: 'wf', kind: t.wf, ...r } as BoxObject;
    if (t.kind === 'icon') return { ...DEFAULTS.icon, id: newId(), z, type: 'icon', icon: t.icon, ...r } as BoxObject;
    if (t.kind === 'table') return { ...newTable([['', '', ''], ['', '', ''], ['', '', '']], r, z), w: Math.max(r.w, 240) };
    if (t.kind === 'mindmap') return mindmapFromOutline(NEW_ROOT, r, z);
    return null;
  };
  const defaultSize = (t: Tool): { w: number; h: number } => t.kind === 'task' ? DEFAULTS.task : t.kind === 'stack' ? DEFAULTS.stack : t.kind === 'wf' ? (t.shapeType === 'ellipse' ? { w: 100, h: 100 } : WF_DEFAULTS[t.wf]) : t.kind === 'frame' ? DEVICES[t.device] : t.kind === 'shape' ? SHAPE_SIZE[t.shape] ?? DEFAULTS.shape : t.kind === 'sticky' ? DEFAULTS.sticky
    : t.kind === 'section' ? { w: 800, h: 480 } : t.kind === 'icon' ? DEFAULTS.icon : t.kind === 'table' ? { w: 480, h: 120 } : t.kind === 'mindmap' ? { w: 160, h: 50 } : DEFAULTS.text;

  // --- pending Mermaid (from Claude) -------------------------------------------
  // The present user with the lowest client id converts, so each request is drawn once.
  const converting = useRef(false);
  useEffect(() => {
    const pending = pendingOf(doc);
    const run = async () => {
      if (converting.current || !pending.size || !editOk.current) return;
      const present = [...awareness.getStates()].filter(([, s]) => s.user).map(([id]) => id);
      if (Math.min(...present) !== awareness.clientID) return;
      converting.current = true;
      try {
        // Drain until empty: requests can arrive while a conversion runs.
        for (let next = pending.keys().next(); !next.done; next = pending.keys().next()) {
          const key = next.value, raw = pending.get(key)!;
          const req = JSON.parse(raw) as { definition: string; x?: number; y?: number };
          try {
            const objs = await mermaidObjects(req.definition, maxZ(doc) + 1);
            const placed = placeBatch(objs, readObjects(doc), { x: req.x, y: req.y });
            doc.transact(() => { addObjects(doc, placed); pending.delete(key); }, LOCAL);
            onToast('A Mermaid diagram was added to the board');
          } catch (e) {
            pending.delete(key);
            onToast(`Could not draw a Mermaid diagram: ${(e as Error).message}`);
          }
        }
      } finally { converting.current = false; }
    };
    pending.observe(run);
    awareness.on('change', run);
    if (synced) run();
    return () => { pending.unobserve(run); awareness.off('change', run); };
  }, [doc, awareness, synced]);

  // New comment on an object (anchored to its top-right corner) or at a point.
  const startComment = (at: Pt, on?: BoardObject) => {
    setTool({ kind: 'select' });
    setOpenThread(null);
    if (on && isBox(on)) setCommentDraft({ objectId: on.id, x: on.w, y: 0, at: { x: on.x + on.w, y: on.y } });
    else setCommentDraft({ x: at.x, y: at.y, at });
  };

  // Eraser: delete strokes that pass near the point.
  const eraseAt = (p: Pt) => {
    const r = 10 / vp.zoom;
    const hit = objects.filter((o): o is DrawObj => o.type === 'draw' && !o.locked && p.x > o.x - r && p.x < o.x + o.w + r && p.y > o.y - r && p.y < o.y + o.h + r)
      .filter((o) => {
        const sx = o.w / o.w0, sy = o.h / o.h0;
        for (let i = 0; i < o.points.length; i += 2) if (Math.hypot(o.x + o.points[i] * sx - p.x, o.y + o.points[i + 1] * sy - p.y) < r + o.size / 2) return true;
        return false;
      }).map((o) => o.id);
    if (hit.length) deleteObjects(doc, hit, LOCAL);
  };

  // --- pointer -----------------------------------------------------------------
  // What a connector end would bind to under the pointer: a mind map node, an object, or a device frame
  // (anywhere on its screen). Sections are never targets.
  const endTarget = (e: { clientX: number; clientY: number }, p: Pt): { end: End; box: BoxObject } | null => {
    const node = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-node]');
    if (node?.dataset.map && node.dataset.node) {
      const box = byId.get(`${node.dataset.map}#${node.dataset.node}`);
      if (box && isBox(box)) return { end: { id: node.dataset.map, node: node.dataset.node }, box };
    }
    const h = hitBox(p, objects, vp.zoom) ?? [...boxes].reverse().find((b) => b.type === 'frame' && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    return h && (h.type === 'frame' || !isContainer(h)) ? { end: { id: h.id }, box: h } : null;
  };
  const startDrag = (d: Drag, e: React.PointerEvent) => {
    if (!canEdit && d.kind !== 'pan' && d.kind !== 'marquee') return;
    el.current?.setPointerCapture(e.pointerId);
    setDrag(d);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    fitted.current = true;
    if (e.button === 2) return;
    setMenu(null);
    const p = worldOf(e.clientX, e.clientY);
    const target = e.target as Element;
    if (presenting !== null) return;
    if (e.button === 1 || space || tool.kind === 'hand' || preview) return startDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vp }, e);
    // While voting, a click on an object votes for it (Option-click takes a vote back).
    if (session?.active && votingOn && tool.kind === 'select' && canEdit) {
      const hit = hitBox(p, objects, vp.zoom);
      if (hit && !isContainer(hit)) {
        if (!castVote(doc, board.me.id, hit.id, e.altKey ? -1 : 1, session, myVotes(votes, board.me.id))) onToast('No votes left');
        return;
      }
      return startDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vp }, e);
    }
    if (editing) setEditing(null);

    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset;
    if (handle?.handle === 'resize') {
      const o = byId.get(handle.id!) as BoxObject;
      return startDrag({ kind: 'resize', id: o.id, handle: handle.dir as Handle, start: p, orig: { x: o.x, y: o.y, w: o.w, h: o.h }, crop: o.type === 'image' ? o.crop : undefined }, e);
    }
    if (handle?.handle === 'end') return startDrag({ kind: 'endpoint', id: handle.id!, which: handle.which as 'from' | 'to', cur: p }, e);
    if (handle?.handle === 'dot') {
      const o = byId.get(handle.id!) as BoxObject;
      return startDrag({ kind: 'connect', fromBox: o, from: { id: o.id, side: handle.side as End['side'] }, start: p, cur: p }, e);
    }

    if (tool.kind === 'comment') {
      const on = hitBox(p, objects, vp.zoom);
      setTool({ kind: 'select' });
      setOpenThread(null);
      return setCommentDraft(on ? { objectId: on.id, x: p.x - on.x, y: p.y - on.y, at: p } : { x: p.x, y: p.y, at: p });
    }
    if (commentDraft) setCommentDraft(null);
    if (tool.kind === 'link') { setTool({ kind: 'select' }); return setLinkAsk({ at: p }); }
    if (cropId && hitBox(p, objects, vp.zoom)?.id !== cropId && !target.closest('[data-handle]')) setCropId(null);
    if (tool.kind === 'draw') {
      if (tool.mode === 'eraser') eraseAt(p);
      return startDrag({ kind: 'draw', pts: [p.x, p.y], mode: tool.mode }, e);
    }
    if (['shape', 'sticky', 'text', 'section', 'icon', 'table', 'mindmap', 'wf', 'frame', 'task', 'stack'].includes(tool.kind)) return startDrag({ kind: 'create', tool, start: p, cur: p }, e);
    if (tool.kind === 'connector') {
      const t = endTarget(e, p);
      return startDrag({ kind: 'connect', fromBox: t?.box, from: t ? t.end : { x: p.x, y: p.y }, start: p, cur: p }, e);
    }

    // A mind map node or table cell: select the object, focus the part, and allow dragging the whole object.
    const partEl = target.closest<HTMLElement>('[data-node], [data-cell]');
    if (partEl) {
      const id = partEl.dataset.map ?? partEl.dataset.table!;
      const o = byId.get(id);
      if (!o || !isBox(o)) return;
      setSelection([id]);
      setSub(partEl.dataset.node ? { id, node: partEl.dataset.node } : { id, cell: partEl.dataset.cell!.split('.') as [string, string] });
      setSubEdit(false);
      // Dragging a branch node re-parents it; dragging the root moves the whole map.
      const nodeId = partEl.dataset.node;
      if (nodeId && o.type === 'mindmap' && o[`n.${nodeId}`]?.parent && !o.locked)
        return startDrag({ kind: 'node', map: id, node: nodeId, start: p, cur: p, sx: e.clientX, sy: e.clientY, moved: false, target: null }, e);
      if (!o.locked) startDrag({ kind: 'move', start: p, orig: new Map([[id, { x: o.x, y: o.y }]]), ends: new Map(), others: boxes.filter((b) => b.id !== id && !isContainer(b)), rect: o, moved: false, clicked: id }, e);
      return;
    }
    const connId = target.closest<SVGElement>('.connector')?.dataset.id;
    if (connId) {
      const cn = byId.get(connId) as ConnectorObj | undefined;
      // ⌘-click animates the line (Whimsical's "animate connector").
      if ((e.metaKey || e.ctrlKey) && cn && canEdit) { update([{ id: connId, animate: !cn.animate || undefined }]); setSelection([connId]); return; }
      const picked = cn ? membersOf(cn) : [connId];
      setSelection((s) => (e.shiftKey ? (s.includes(connId) ? s.filter((x) => !picked.includes(x)) : [...new Set([...s, ...picked])]) : picked));
      return;
    }
    const hit = hitBox(p, objects, vp.zoom);
    if (hit?.type === 'link' && (e.metaKey || e.ctrlKey)) { window.open(hit.url, '_blank', 'noopener'); return; }
    if (hit) {
      // A click takes the whole group; ⌘-click (deep select) takes just the object under the pointer.
      const picked = e.metaKey || e.ctrlKey ? [hit.id] : membersOf(hit);
      let sel = selection;
      if (e.shiftKey) sel = sel.includes(hit.id) ? sel.filter((x) => !picked.includes(x)) : [...new Set([...sel, ...picked])];
      else if (!sel.includes(hit.id) || e.metaKey || e.ctrlKey) sel = picked;
      setSelection(sel);
      if (e.shiftKey && !sel.includes(hit.id)) return;
      let moving = sel.map((id) => byId.get(id)!).filter((o) => o && !o.locked);
      if (e.altKey) moving = duplicate(sel, 0, 0); // Option-drag drags a copy
      // A section carries the objects inside it.
      for (const s of moving.filter(isContainer)) moving.push(...sectionContents(s, objects).filter((o) => !o.locked && !moving.includes(o)));
      const ids = new Set(moving.map((o) => o.id));
      const orig = new Map(moving.filter(isBox).map((o) => [o.id, { x: o.x, y: o.y }]));
      const ends = new Map(moving.filter((o): o is ConnectorObj => o.type === 'connector').map((c) => [c.id, { from: c.from, to: c.to }]));
      const others = boxes.filter((o) => !ids.has(o.id) && !isContainer(o));
      const rect = selectionBounds([...orig.keys()], byId) ?? { x: p.x, y: p.y, w: 0, h: 0 };
      if (orig.size || ends.size) startDrag({ kind: 'move', start: p, orig, ends, others, rect, moved: false, clicked: hit.id }, e);
      return;
    }
    if (!e.shiftKey) setSelection([]);
    startDrag({ kind: 'marquee', start: p, cur: p, base: e.shiftKey ? selection : [] }, e);
  };

  const cursorFrame = useRef(0);
  const onPointerMove = (e: React.PointerEvent) => {
    const p = worldOf(e.clientX, e.clientY);
    cancelAnimationFrame(cursorFrame.current);
    cursorFrame.current = requestAnimationFrame(() => awareness.setLocalStateField('cursor', p));
    const d = dragRef.current;
    if (!d) {
      if (tool.kind === 'select' && !space && canEdit && !(e.target as Element).closest('[data-handle="dot"]')) {
        const h = hitBox(p, objects, vp.zoom);
        const ok = h && !isContainer(h) && h.type !== 'image' && h.type !== 'draw' && !h.locked ? h : undefined;
        // Keep the dots while the pointer travels from the shape out to them.
        const cur = hover ? byId.get(hover) : undefined, pad = 24 / vp.zoom;
        const near = cur && isBox(cur) && p.x > cur.x - pad && p.x < cur.x + cur.w + pad && p.y > cur.y - pad && p.y < cur.y + cur.h + pad;
        setHover(ok ? ok.id : near ? hover : null);
      }
      return;
    }
    if (d.kind === 'pan') return setVp({ ...d.vp, x: d.vp.x + e.clientX - d.sx, y: d.vp.y + e.clientY - d.sy });
    if (d.kind === 'node') {
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
      const map = byId.get(d.map) as MindmapObj | undefined;
      const under = (document.elementsFromPoint(e.clientX, e.clientY).find((el) => (el as HTMLElement).dataset?.node && (el as HTMLElement).dataset.map === d.map) as HTMLElement | undefined)?.dataset.node ?? null;
      // Not onto itself or its own branch.
      const inBranch = (n: string | null): boolean => !!n && (n === d.node || inBranch(map?.[`n.${n}`]?.parent ?? null));
      return setDrag({ ...d, cur: p, moved: true, target: under && !inBranch(under) ? under : null });
    }
    if (d.kind === 'draw') {
      if (d.mode === 'eraser') return eraseAt(p);
      const [lx, ly] = d.pts.slice(-2);
      if (Math.hypot(p.x - lx, p.y - ly) * vp.zoom < 2) return;
      return setDrag({ ...d, pts: [...d.pts, p.x, p.y] });
    }
    if (d.kind === 'move') {
      let dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) * vp.zoom < 3) return;
      const snap = e.metaKey ? { dx: 0, dy: 0, guides: { x: [], y: [] } } : snapRect({ ...d.rect, x: d.rect.x + dx, y: d.rect.y + dy }, d.others, vp.zoom);
      dx += snap.dx; dy += snap.dy;
      setGuides(snap.guides);
      const shift = (end: End): End => (end.id ? end : { ...end, x: end.x! + dx, y: end.y! + dy });
      update([
        ...[...d.orig].map(([id, o]) => ({ id, x: o.x + dx, y: o.y + dy })),
        ...[...d.ends].map(([id, c]) => ({ id, from: shift(c.from), to: shift(c.to) })),
      ]);
      if (!d.moved) setDrag({ ...d, moved: true });
      return;
    }
    if (d.kind === 'resize') {
      const { orig: o, handle } = d;
      let dx = p.x - d.start.x, dy = p.y - d.start.y;
      let x = o.x, y = o.y, w = o.w, h = o.h;
      if (handle.includes('e')) w = o.w + dx;
      if (handle.includes('s')) h = o.h + dy;
      if (handle.includes('w')) { w = o.w - dx; x = o.x + dx; }
      if (handle.includes('n')) { h = o.h - dy; y = o.y + dy; }
      if (e.shiftKey && handle.length === 2) { const k = Math.max(w / o.w, h / o.h); w = o.w * k; h = o.h * k; if (handle.includes('w')) x = o.x + o.w - w; if (handle.includes('n')) y = o.y + o.h - h; }
      if (e.altKey) { x = o.x - (w - o.w) / 2; y = o.y - (h - o.h) / 2; }
      const min = 16;
      if (w < min) { if (handle.includes('w')) x -= min - w; w = min; }
      if (h < min) { if (handle.includes('n')) y -= min - h; h = min; }
      const img = cropId === d.id ? byId.get(d.id) : undefined;
      if (img?.type === 'image') {
        // Crop: the full image stays put; the box is a window onto it.
        const c0 = d.crop ?? { x: 0, y: 0, w: 1, h: 1 }, fw = o.w / c0.w, fh = o.h / c0.h, fx = o.x - c0.x * fw, fy = o.y - c0.y * fh;
        const x1 = Math.max(fx, x), y1 = Math.max(fy, y), x2 = Math.min(fx + fw, x + w), y2 = Math.min(fy + fh, y + h);
        return update([{ id: d.id, x: x1, y: y1, w: x2 - x1, h: y2 - y1, crop: { x: (x1 - fx) / fw, y: (y1 - fy) / fh, w: (x2 - x1) / fw, h: (y2 - y1) / fh } }]);
      }
      return update([{ id: d.id, x, y, w, h }]);
    }
    if (d.kind === 'marquee') {
      const r = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) };
      const hits = objects.filter((o) => {
        if (o.locked) return false;
        if (isBox(o)) return isContainer(o) ? contains(r, o) : intersects(r, o);
        const g = connectorGeometry(o, byId);
        return !!g && contains(r, { x: Math.min(g.start.x, g.end.x), y: Math.min(g.start.y, g.end.y), w: Math.abs(g.end.x - g.start.x), h: Math.abs(g.end.y - g.start.y) });
      }).map((o) => o.id);
      setSelection([...new Set([...d.base, ...hits.flatMap((id) => membersOf(byId.get(id)!))])]);
      return setDrag({ ...d, cur: p });
    }
    if (d.kind === 'create' || d.kind === 'connect' || d.kind === 'endpoint') {
      if (d.kind !== 'create') { const t = endTarget(e, p); setHover(t ? keyOf(t.end) : null); }
      setDrag({ ...d, cur: p });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    setDrag(null);
    setGuides({ x: [], y: [] });
    if (!d) return;
    const p = worldOf(e.clientX, e.clientY);
    // A click (no drag) inside a multi-selection keeps just that object, unless the selection is its group.
    if (d.kind === 'move' && !d.moved && !e.shiftKey && d.clicked && selection.length > 1) {
      const group = byId.get(d.clicked) ? membersOf(byId.get(d.clicked)!) : [];
      if (!(group.length > 1 && selection.every((id) => group.includes(id)))) setSelection([d.clicked]);
    }
    if (d.kind === 'move' && d.moved) {
      // A dragged card joins the stack under its center, or leaves its stack when dropped outside.
      const moving = new Set(d.orig.keys()), patches: Patch[] = [];
      for (const id of moving) {
        const c = byId.get(id);
        if (c?.type !== 'task') continue;
        if (c.stack && moving.has(c.stack)) continue; // moved together with its stack
        const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
        const into = boxes.find((b): b is StackObj => b.type === 'stack' && !b.locked && !moving.has(b.id) && cx > b.x && cx < b.x + b.w && cy > b.y && cy < b.y + b.h);
        if (into) patches.push({ id, stack: into.id, order: orderAt(into, cy, objects, id) });
        else if (c.stack) patches.push({ id, stack: undefined, order: undefined });
      }
      if (patches.length) taskUpdate(patches);
    }
    if (d.kind === 'node' && d.moved && d.target) {
      const map = byId.get(d.map) as MindmapObj | undefined;
      if (map) {
        const last = Object.entries(map).filter(([k, v]) => k.startsWith('n.') && v && (v as { parent: string }).parent === d.target).length;
        const pch = setNode(map, d.node, { parent: d.target, order: last + 1 });
        if (pch) update([pch]);
      }
    }
    if (d.kind === 'create') {
      const dragged = Math.hypot(p.x - d.start.x, p.y - d.start.y) * vp.zoom > 6;
      const size = defaultSize(d.tool);
      const r = dragged
        ? { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.max(16, Math.abs(p.x - d.start.x)), h: Math.max(16, Math.abs(p.y - d.start.y)) }
        : { x: d.start.x - (d.tool.kind === 'text' ? 4 : size.w / 2), y: d.start.y - (d.tool.kind === 'text' ? size.h / 2 : size.h / 2), w: size.w, h: size.h };
      const o = makeBox(d.tool, r);
      if (!o) return;
      add([o]);
      if (o.type === 'task') logActivity(doc, o.id, board.me.name, 'created the card');
      setSelection([o.id]);
      setTool({ kind: 'select' });
      if (o.type === 'mindmap') { const root = Object.keys(o).find((k) => k.startsWith('n.'))!.slice(2); setSub({ id: o.id, node: root }); setSubEdit(true); }
      else if (o.type === 'table') setSub({ id: o.id, cell: [o.rows[0], o.cols[0]] });
      else if ((o.type !== 'wf' || WF_TEXT.has(o.kind)) && !isContainer(o) && o.type !== 'icon' && !(o.type === 'shape' && ['line', 'cross', 'bracket'].includes(o.shape))) setEditing(o.id);
    }
    if (d.kind === 'draw' && d.mode !== 'eraser' && d.pts.length >= 2) {
      const size = d.mode === 'highlighter' ? 18 : 3, pad = size;
      const xs = d.pts.filter((_, i) => i % 2 === 0), ys = d.pts.filter((_, i) => i % 2 === 1);
      const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad, w = Math.max(...xs) - x + pad, h = Math.max(...ys) - y + pad;
      add([{
        id: newId(), z: maxZ(doc) + 1, type: 'draw', x, y, w, h, w0: w, h0: h, size, highlight: d.mode === 'highlighter',
        color: d.mode === 'highlighter' ? 'yellow' : 'default', points: d.pts.map((v, i) => Math.round((v - (i % 2 ? y : x)) * 10) / 10),
      }]);
    }
    if (d.kind === 'connect') {
      if (Math.hypot(p.x - d.start.x, p.y - d.start.y) * vp.zoom < 10) {
        if (d.fromBox && d.from.side && tool.kind === 'select') quickAdd(d.fromBox, d.from.side); // a click on a dot
        return;
      }
      const t = endTarget(e, p), target = t?.box;
      const z = maxZ(doc) + 1;
      let to: End, extra: BoxObject[] = [];
      if (t && keyOf(t.end) !== keyOf(d.from)) to = t.end;
      else if (d.fromBox && d.fromBox.type === 'shape' && !d.from.node && !target) {
        // Like Whimsical: dragging a connector into empty space adds a matching shape there.
        const n = { ...d.fromBox, id: newId(), z: z + 1, text: '', x: p.x - d.fromBox.w / 2, y: p.y - d.fromBox.h / 2, locked: undefined } as BoxObject;
        extra = [n];
        to = { id: n.id };
      } else to = { x: p.x, y: p.y };
      const conn = { ...DEFAULTS.connector, ...defaultStyle('connector'), id: newId(), z, type: 'connector', from: d.from, to } as ConnectorObj;
      add([...extra, conn]);
      setSelection([extra[0]?.id ?? conn.id]);
      setTool({ kind: 'select' });
      if (extra[0]) setEditing(extra[0].id);
    }
    if (d.kind === 'endpoint') {
      const c = byId.get(d.id) as ConnectorObj | undefined;
      if (!c) return;
      const t = endTarget(e, p), other = d.which === 'from' ? c.to : c.from;
      const end: End = t && keyOf(t.end) !== keyOf(other) ? t.end : { x: p.x, y: p.y };
      update([{ id: c.id, [d.which]: end }]);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!canEdit) return;
    if (preview || presenting !== null || (session?.active && votingOn)) return;
    const p = worldOf(e.clientX, e.clientY);
    // The first click may have captured the pointer (a drag can start), which makes the canvas the event target;
    // look at what is really under the pointer.
    const under = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
    const partEl = under.closest<HTMLElement>('[data-node], [data-cell]');
    if (partEl) {
      const id = partEl.dataset.map ?? partEl.dataset.table!;
      if (byId.get(id)?.locked) return;
      setSub(partEl.dataset.node ? { id, node: partEl.dataset.node } : { id, cell: partEl.dataset.cell!.split('.') as [string, string] });
      return setSubEdit(true);
    }
    const connId = under.closest<SVGElement>('.connector')?.dataset.id;
    if (connId) { setSelection([connId]); return setEditing(connId); }
    const hit = hitBox(p, objects, vp.zoom);
    if (hit?.type === 'image' && !hit.locked) { setSelection([hit.id]); return setCropId(hit.id); }
    if (hit && editable(hit) && !hit.locked) { setSelection([hit.id]); return setEditing(hit.id); }
    if (!hit && mode === 'task') {
      const o = makeBox({ kind: 'task' }, { x: p.x - DEFAULTS.task.w / 2, y: p.y - DEFAULTS.task.h / 2, w: DEFAULTS.task.w, h: DEFAULTS.task.h })!;
      add([o]);
      logActivity(doc, o.id, board.me.name, 'created the card');
      setSelection([o.id]);
      return setEditing(o.id);
    }
    if (hit) return; // locked, or not editable: a double-click does nothing
    const o = makeBox({ kind: 'text' }, { x: p.x - 4, y: p.y - DEFAULTS.text.h / 2, w: DEFAULTS.text.w, h: DEFAULTS.text.h })!;
    add([o]);
    setSelection([o.id]);
    setEditing(o.id);
  };

  // --- wheel: pinch / ctrl zoom, otherwise pan ------------------------------------
  useEffect(() => {
    const node = el.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest('.toolbar, .contextbar, .bottombar, .modal, .task-modal-back, .ctx-menu')) return;
      e.preventDefault();
      fitted.current = true;
      const r = node.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) setVp((v) => {
        const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom * Math.exp(-e.deltaY * 0.01)));
        const sx = e.clientX - r.left, sy = e.clientY - r.top;
        return { zoom, x: sx - ((sx - v.x) / v.zoom) * zoom, y: sy - ((sy - v.y) / v.zoom) * zoom };
      });
      else setVp((v) => ({ ...v, x: v.x - (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX), y: v.y - (e.shiftKey && !e.deltaX ? 0 : e.deltaY) }));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  // --- keyboard ------------------------------------------------------------------
  const startCommentRef = useRef((_o: BoardObject) => {});
  startCommentRef.current = (o) => startComment({ x: 0, y: 0 }, o);
  const previewRef = useRef(preview);
  previewRef.current = preview;
  // Presentation: sections are the slides, top to bottom, then left to right.
  const slides = useMemo(() => {
    const secs = objects.filter((o): o is BoxObject => o.type === 'section');
    return secs.sort((a, b) => (Math.abs(a.y - b.y) > 80 ? a.y - b.y : a.x - b.x));
  }, [objects]);
  const showSlide = (i: number) => {
    const s = slides[i];
    setPresenting(i);
    fitTo(s ? { x: s.x, y: s.y - 40, w: s.w, h: s.h + 40 } : selectionBounds(objects.map((o) => o.id), byId), 4);
  };
  const presentRef = useRef({ on: false, step: (_d: number) => {}, exit: () => {} });
  presentRef.current = {
    on: presenting !== null,
    step: (d) => showSlide(Math.max(0, Math.min(Math.max(slides.length, 1) - 1, (presenting ?? 0) + d))),
    exit: () => { setPresenting(null); if (document.fullscreenElement) document.exitFullscreen(); },
  };
  const startPresenting = () => {
    setSelection([]);
    setPanel(null);
    el.current?.requestFullscreen?.().catch(() => {});
    setTimeout(() => showSlide(0), 150);
  };
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement && presenting !== null) setPresenting(null); };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, [presenting]);
  const cropIdRef = useRef(cropId);
  cropIdRef.current = cropId;
  const lastIcon = useRef('star');
  if (tool.kind === 'icon') lastIcon.current = tool.icon;
  const keyNow = { selected, selection, editing, objects, tool, mode, setMode, setExpanded, canEdit, canComment, pasteStyle, saveDefaultStyle, groupSelected, ungroupSelected, toggleQuickDots, duplicate, removeSelected, arrange, toggleLock, fitContent, zoomCenter, vp, update, sub, subEdit, mindmapAct, moveCell, quickAdd, focusNode };
  const keyState = useRef(keyNow);
  keyState.current = keyNow;
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
    const down = (e: KeyboardEvent) => {
      const s = keyState.current;
      if (typing(e.target) || s.editing || s.subEdit || document.querySelector('.modal')) return;
      if (presentRef.current.on) {
        if (['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(e.key)) { e.preventDefault(); return presentRef.current.step(1); }
        if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); return presentRef.current.step(-1); }
        if (e.key === 'Escape') return presentRef.current.exit();
        return;
      }
      if (previewRef.current) { if (e.key === 'Escape') setPreview(null); return; }
      const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
      // Read-only: only navigation, copy, opening a card and (for commenters) comments.
      if (!s.canEdit && !(['Escape', ' ', '=', '+', '-', '0', '1', '2'].includes(e.key) || (mod && ['c', 'a', 'enter'].includes(k)) || (k === 'm' && !mod && s.canComment))) return;
      // ⇧X on one selected shape: its icon picker (in a mind map, the node's; handled below).
      if (e.key === 'X' && e.shiftKey && !mod && s.selected.length === 1 && s.selected[0].type === 'shape') { e.preventDefault(); return requestBarPop('icon'); }
      const arrow = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom' } as const)[e.key as 'ArrowLeft'];

      // Inside a mind map: Whimsical's outline keys.
      const sb = s.sub, map = sb?.node ? s.objects.find((o) => o.id === sb.id) as MindmapObj | undefined : undefined;
      if (sb?.node && map) {
        const node = sb.node;
        const go = (dir: 'parent' | 'child' | 'prev' | 'next') => { const n = neighbour(map, node, dir); if (n) s.focusNode(map.id, n); };
        const vertical = map.layout === 'vertical';
        if (e.key === 'Tab') { e.preventDefault(); return s.mindmapAct(map.id, node, e.shiftKey ? 'ShiftTab' : 'Tab'); }
        if (e.key === 'Enter') { e.preventDefault(); return s.mindmapAct(map.id, node, mod ? 'ModEnter' : e.altKey ? 'AltEnter' : 'Enter'); }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return s.mindmapAct(map.id, node, 'Delete'); }
        if (mod && e.key === '/') { e.preventDefault(); return s.mindmapAct(map.id, node, 'Collapse'); }
        if (e.ctrlKey && (e.metaKey || e.altKey) && (e.key === ']' || e.key === '[')) { e.preventDefault(); return s.mindmapAct(map.id, node, e.key === ']' ? 'Indent' : 'Outdent'); }
        if (e.key === 'X' && e.shiftKey && !mod) { e.preventDefault(); return requestBarPop('icon'); }
        if (e.key === 'Escape') return s.focusNode(map.id, null);
        if (arrow && !mod) {
          e.preventDefault();
          const dirs = vertical
            ? ({ top: 'parent', bottom: 'child', left: 'prev', right: 'next' } as const)
            : ({ left: 'parent', right: 'child', top: 'prev', bottom: 'next' } as const);
          return go(dirs[arrow]);
        }
        if (e.key === 'F2' || (e.key.length === 1 && !mod && !e.altKey)) {
          e.preventDefault();
          // Typing on a focused node edits it, starting with that letter at the end.
          if (e.key.length === 1) { const ch = e.key; whenEditorOpens((v) => v.dispatch(v.state.tr.insertText(ch))); }
          return setSubEdit(true);
        }
        if (!mod) return;
      }
      // Inside a table: spreadsheet keys.
      const table = sb?.cell ? s.objects.find((o) => o.id === sb.id) as TableObj | undefined : undefined;
      if (sb?.cell && table) {
        const [row, col] = sb.cell;
        if (e.key === 'Tab') { e.preventDefault(); return s.moveCell(table.id, row, col, e.shiftKey ? 'ShiftTab' : 'Tab', false); }
        if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); return setSubEdit(true); }
        if (e.key === 'Escape') return setSub(null);
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return s.update([{ id: table.id, [cellKey(row, col)]: undefined }]); }
        if (arrow && !mod) { e.preventDefault(); return s.moveCell(table.id, row, col, ({ left: 'Left', right: 'Right', top: 'Up', bottom: 'Down' } as const)[arrow], false); }
        if (e.key.length === 1 && !mod && !e.altKey) {
          e.preventDefault();
          s.update([{ id: table.id, [cellKey(row, col)]: e.key }]); // typing replaces the cell, like a spreadsheet
          return setSubEdit(true);
        }
        if (!mod) return;
      }
      // Option + arrow: quick add next to the selected shape or sticky note.
      if (e.altKey && arrow && s.selected.length === 1) {
        const o = s.selected[0];
        if (isBox(o) && (o.type === 'shape' || o.type === 'sticky' || o.type === 'icon') && !o.locked) { e.preventDefault(); return s.quickAdd(o, arrow); }
      }
      if (e.key === ' ') { setSpace(true); e.preventDefault(); return; }
      if (mod && k === 'z') { e.preventDefault(); return e.shiftKey ? undo.redo() : undo.undo(); }
      if (mod && k === 'y') { e.preventDefault(); return undo.redo(); }
      if (mod && k === 'a') { e.preventDefault(); return setSelection(s.objects.filter((o) => !o.locked).map((o) => o.id)); }
      if (mod && k === 'd') { e.preventDefault(); return s.duplicate(); }
      if (mod && e.shiftKey && k === 'l') { e.preventDefault(); return s.toggleLock(); }
      if (mod && e.shiftKey && k === 'e') { e.preventDefault(); return setPanel('export'); }
      if (mod && e.altKey && (k === 'm' || e.code === 'KeyM')) { e.preventDefault(); return setTool({ kind: 'comment' }); }
      if (mod && e.altKey && (e.key === '=' || e.key === '≠' || e.key === '-' || e.key === '–')) {
        e.preventDefault();
        return; // font size steps live in the context bar
      }
      if (mod && e.altKey && e.code === 'KeyC' && s.selected.length === 1) { e.preventDefault(); copied.current = styleOf(s.selected[0]); return onToast('Style copied'); }
      if (mod && e.altKey && e.code === 'KeyV' && copied.current) { e.preventDefault(); return s.pasteStyle(); }
      if (mod && e.shiftKey && e.code === 'KeyD' && s.selected.length === 1) { e.preventDefault(); return s.saveDefaultStyle(); }
      if (mod && e.code === 'KeyG') { e.preventDefault(); return e.shiftKey ? s.ungroupSelected() : s.groupSelected(); }
      if (mod && (e.key === ']' || e.key === '[')) { e.preventDefault(); return s.arrange(e.key === ']' ? 'forward' : 'backward'); }
      if (mod && e.key === 'Enter' && s.selected.length === 1 && s.selected[0].type === 'task') { e.preventDefault(); return s.setExpanded(s.selected[0].id); }
      if (mod) return;
      if (e.key === 'Escape' && cropIdRef.current) return setCropId(null);
      if (e.key === 'Escape') { setTool({ kind: 'select' }); setSelection([]); setMenu(null); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return s.removeSelected(); }
      if (e.key === 'Enter' && s.selected.length === 1 && editable(s.selected[0]) && !s.selected[0].locked) { e.preventDefault(); return setEditing(s.selected[0].id); }
      if (e.key.startsWith('Arrow') && !e.altKey && s.selected.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        return s.update(s.selected.filter((o) => isBox(o) && !o.locked).map((o) => ({ id: o.id, x: (o as BoxObject).x + dx, y: (o as BoxObject).y + dy })));
      }
      if (e.key === ']') return s.arrange('front');
      if (e.key === '[') return s.arrange('back');
      if (e.key === '=' || e.key === '+') return s.zoomCenter(s.vp.zoom * 1.25);
      if (e.key === '-') return s.zoomCenter(s.vp.zoom / 1.25);
      if (e.key === '0') return s.zoomCenter(1);
      if (e.key === '1') return s.fitContent();
      if (e.key === '2') return fitTo(selectionBounds(s.selection, byIdOf(s.objects)));
      if (k === 'q') return s.mode === 'diagram' ? s.toggleQuickDots() : s.setMode('diagram');
      if (e.key === '/') { e.preventDefault(); return setToolbarFlyout('all'); }
      if (k === 'w') return s.setMode('wireframe');
      if (s.mode === 'task') {
        if (k === 'a') return setTool({ kind: 'task' });
        if (k === 's') return setTool({ kind: 'stack' });
      }
      if (s.mode === 'wireframe') {
        if (WF_KEYS[k]) return setTool(WF_KEYS[k]);
        if (k === 'f') return setTool({ kind: 'frame', device: s.tool.kind === 'frame' ? s.tool.device : 'iphone' });
        if (k === 'e') return setToolbarFlyout('components');
      } else if (s.mode === 'diagram' && SHAPE_KEYS[k]) return setTool({ kind: 'shape', shape: SHAPE_KEYS[k] });
      if (k === 's' && s.mode === 'diagram') return setTool({ kind: 'shape', shape: s.tool.kind === 'shape' ? s.tool.shape : 'rect' });
      if (k === 'n') return setTool({ kind: 'sticky' });
      if (k === 'c') return setTool({ kind: 'connector' });
      if (k === 't') return setTool({ kind: 'text' });
      if (k === '.') return setTool({ kind: 'section' });
      if (e.key === 'H') return setTool({ kind: 'draw', mode: 'highlighter' });
      if (k === 'h') return setTool({ kind: 'draw', mode: 'marker' });
      if (k === 'e') return setTool({ kind: 'table' });
      if (k === 'k') return setTool({ kind: 'link' });
      if (k === 'x') return setTool({ kind: 'icon', icon: lastIcon.current });
      if (k === 'i' && s.mode === 'diagram') return fileInput.current?.click();
      if (k === 'm' && s.selected.length === 1) return startCommentRef.current(s.selected[0]);
      if (k === 'm' && s.mode === 'diagram') return setTool({ kind: 'mindmap' });
      // Typing on a selected shape, sticky or text starts editing it.
      const one = s.selected.length === 1 ? s.selected[0] : null;
      if (one && e.key.length === 1 && (one.type === 'shape' || one.type === 'sticky' || one.type === 'text' || (one.type === 'wf' && WF_TEXT.has(one.kind))) && !one.locked) {
        e.preventDefault();
        s.update([{ id: one.id, text: one.text + e.key }]);
        setEditing(one.id);
      }
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ') setSpace(false); if (e.key === 'Alt') setAlt(false); };
    const altDown = (e: KeyboardEvent) => { if (e.key === 'Alt') setAlt(true); };
    const blur = () => setAlt(false);
    addEventListener('keydown', altDown);
    addEventListener('blur', blur);
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('keydown', altDown); removeEventListener('blur', blur); };
  }, [undo, fitTo]);

  // --- clipboard ------------------------------------------------------------------
  const pasteRef = useRef<(e: ClipboardEvent) => void>(() => {});
  pasteRef.current = async (e: ClipboardEvent) => {
    if (!canEdit) return;
    if (editing || (e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(e.target.tagName)))) return;
    e.preventDefault();
    await pasteData([...(e.clipboardData?.files ?? [])], e.clipboardData?.getData('text/plain') ?? '');
  };
  // Images, copied pragmatic objects, a link, or text. `as` forces plain text or a table ("Paste as").
  const pasteData = async (all: File[], text: string, as?: 'text' | 'table', at?: Pt) => {
    const files = all.filter((f) => f.type.startsWith('image/'));
    try {
      if (as === 'table') {
        const rows = text.includes('|') ? parseMarkdownTable(text) : text.trim().split(/\r?\n/).map((l) => l.split('\t'));
        if (!rows.length || !rows[0].length) return onToast('Nothing to paste as a table');
        return void insertBatch([tableFrom(rows, { x: 0, y: 0 }, maxZ(doc) + 1)], at);
      }
      if (as === 'text') {
        if (text.trim()) insertBatch([{ ...DEFAULTS.text, id: newId(), z: maxZ(doc) + 1, type: 'text', x: 0, y: 0, w: Math.min(600, text.length * 10 + 16), h: 32 * text.split('\n').length, text }], at);
        return;
      }
      if (files.length) {
        const imgs = [];
        for (const f of files) imgs.push(await imageObject(f, maxZ(doc) + 1 + imgs.length));
        return void insertBatch(imgs);
      }
      const objs = deserialize(text);
      if (objs?.length) {
        const copies = cloneObjects(objs, byIdOf(objs), 0, 0, maxZ(doc) + 1);
        return void insertBatch(copies, undefined, false);
      }
      if (isUrl(text)) return void addLink(text, at ?? viewCenter());
      if (text.trim()) insertBatch([{ ...DEFAULTS.text, id: newId(), z: maxZ(doc) + 1, type: 'text', x: 0, y: 0, w: Math.min(600, text.length * 10 + 16), h: 32 * text.split('\n').length, text }], at);
    } catch (err) { onToast(`Paste failed: ${(err as Error).message}`); }
  };
  // The menu's Paste reads the clipboard itself (the browser may ask for permission).
  const pasteFromClipboard = async (as?: 'text' | 'table', at?: Pt) => {
    try {
      const files: File[] = [];
      let text = '';
      for (const item of await readClipboard()) {
        const img = item.types.find((t) => t.startsWith('image/'));
        if (img) files.push(new File([await item.getType(img)], 'pasted', { type: img }));
        if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
      }
      await pasteData(as ? [] : files, text, as, at);
    } catch { onToast('Use ⌘V to paste: the browser did not allow reading the clipboard'); }
  };
  useEffect(() => {
    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      const s = keyState.current;
      if (s.editing || !s.selected.length || (e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(e.target.tagName)))) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', serialize(withInnerConnectors(s.selection, s.objects)));
      if (cut) s.removeSelected();
    };
    const copy = (e: ClipboardEvent) => onCopy(e, false), cut = (e: ClipboardEvent) => onCopy(e, true), paste = (e: ClipboardEvent) => pasteRef.current(e);
    addEventListener('copy', copy); addEventListener('cut', cut); addEventListener('paste', paste);
    return () => { removeEventListener('copy', copy); removeEventListener('cut', cut); removeEventListener('paste', paste); };
  }, []);

  // --- inserts ---------------------------------------------------------------------
  const onInsert = (k: InsertKind) => {
    if (k === 'timer' || k === 'voting') { setVotingOn(true); return setPop(k); }
    if (k === 'image') return fileInput.current?.click();
    if (k === 'file') return importInput.current?.click();
    setDialog(k);
  };
  const addImages = async (files: File[], at?: Pt) => {
    try {
      const imgs: BoardObject[] = [];
      for (const f of files) imgs.push(await imageObject(f, maxZ(doc) + 1 + imgs.length));
      if (imgs.length) insertBatch(imgs, at);
    } catch (err) { onToast(`Image upload failed: ${(err as Error).message}`); }
  };
  const importFile = async (f: File, at?: Pt) => {
    try {
      if (f.type.startsWith('image/')) return addImages([f], at);
      if (/\.(mmd|mermaid)$/i.test(f.name)) return void insertBatch(await mermaidObjects(await f.text(), maxZ(doc) + 1), at);
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.elements)) throw new Error('This file has no Excalidraw elements');
      insertBatch(fromExcalidraw(data.elements, { z0: maxZ(doc) + 1 }), at);
    } catch (err) { onToast(`Import failed: ${(err as Error).message}`); }
  };
  const submitDialog = async (kind: 'mermaid' | 'mindmap', source: string) => {
    const objs = kind === 'mermaid' ? await mermaidObjects(source, maxZ(doc) + 1) : [mindmapFromOutline(source, { x: 0, y: 0 }, maxZ(doc) + 1)];
    insertBatch(objs);
  };

  // --- render --------------------------------------------------------------------------
  const c = CANVAS[theme];
  const single = selected.length === 1 ? selected[0] : null;
  const selBounds = selectionBounds(selection, byId);
  // While typing in rich text the bar stays, for its text options (bold, lists, link, mention).
  const editingRich = (!!editing && single?.id === editing && isRichField(single.type, 'text')) || (subEdit && !!sub?.node);
  const showBar = !drag && (!editing || editingRich) && selBounds && selected.length > 0;
  const barAt = selBounds && (() => {
    const tl = screenOf({ x: selBounds.x, y: selBounds.y }), br = screenOf({ x: selBounds.x + selBounds.w, y: selBounds.y + selBounds.h });
    const lift = selected.some(isContainer) ? SECTION_TITLE_H * vp.zoom : 0; // keep section and frame titles visible
    const below = tl.y - lift < 70;
    return { x: (tl.x + br.x) / 2, y: below ? br.y + 14 : tl.y - 14 - lift, below };
  })();
  const cursor = session?.active && votingOn && !preview ? 'pointer' : tool.kind === 'comment' ? 'copy' : tool.kind === 'draw' && !space ? (tool.mode === 'eraser' ? 'cell' : 'crosshair') : drag?.kind === 'pan' || (space && drag) ? 'grabbing' : space || tool.kind === 'hand' ? 'grab' : tool.kind !== 'select' ? 'crosshair' : drag?.kind === 'move' ? 'move' : 'default';
  const hoverObj = hover ? byId.get(hover) as BoxObject | undefined : undefined;
  const draft = drag?.kind === 'create' ? { x: Math.min(drag.start.x, drag.cur.x), y: Math.min(drag.start.y, drag.cur.y), w: Math.abs(drag.cur.x - drag.start.x), h: Math.abs(drag.cur.y - drag.start.y) } : null;
  const connectDraft = drag?.kind === 'connect' && Math.hypot(drag.cur.x - drag.start.x, drag.cur.y - drag.start.y) * vp.zoom > 6
    ? connectorGeometry({ from: drag.from, to: hover && hover !== keyOf(drag.from) ? endOfKey(hover) : { x: drag.cur.x, y: drag.cur.y }, route: 'elbow' }, byId) : null;
  const endDraft = drag?.kind === 'endpoint' && byId.get(drag.id)?.type === 'connector' ? (() => {
    const cn = byId.get(drag.id) as ConnectorObj;
    const end: End = hover ? endOfKey(hover) : { x: drag.cur.x, y: drag.cur.y };
    return connectorGeometry({ ...cn, [drag.which]: end }, byId);
  })() : null;

  return (
    <TextSource.Provider value={textSource}>
    <RichSource.Provider value={richSource}>
    <RichUndo.Provider value={richUndo}>
    <div
      ref={el}
      className={`canvas theme-${theme} ${presenting !== null ? 'presenting' : ''} ${preview ? 'previewing' : ''}`}
      style={{ cursor, background: c.bg }}
      // Links in text: a click on an object that was already selected (or ⌘-click) opens them in a new tab.
      onPointerDownCapture={(e) => { const id = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id; linkDown.current = !!id && selection.includes(id); }}
      onClickCapture={(e) => {
        const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('.text-static a[href]');
        if (!a) return;
        e.preventDefault();
        if (e.metaKey || e.ctrlKey || linkDown.current) window.open(a.href, '_blank', 'noopener,noreferrer');
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { setHover(null); awareness.setLocalStateField('cursor', null); }}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        const p = worldOf(e.clientX, e.clientY);
        const hit = hitBox(p, objects, vp.zoom);
        if (hit && !selection.includes(hit.id)) setSelection([hit.id]);
        const r = el.current!.getBoundingClientRect();
        setMenu({ x: e.clientX - r.left, y: e.clientY - r.top, world: p });
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!canEdit) return;
        const at = worldOf(e.clientX, e.clientY);
        const files = [...e.dataTransfer.files];
        const imgs = files.filter((f) => f.type.startsWith('image/'));
        if (imgs.length) addImages(imgs, at);
        files.filter((f) => !f.type.startsWith('image/')).forEach((f) => importFile(f, at));
      }}
    >
      <div className="grid" style={{
        backgroundImage: `radial-gradient(${c.dot} ${Math.max(0.8, 1.1 * vp.zoom)}px, transparent 0)`,
        backgroundSize: `${GRID * vp.zoom}px ${GRID * vp.zoom}px`,
        backgroundPosition: `${vp.x}px ${vp.y}px`,
        opacity: vp.zoom < 0.35 ? 0 : 1,
      }} />
      <div ref={worldRef} className="world" style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` }}>
        {boxes.map((o) => o.type === 'mindmap' ? (
          <MindmapView key={o.id} o={o} layer={layer.get(o.id)!} theme={theme} pv={pv} focus={sub?.id === o.id ? sub.node ?? null : null}
            editing={sub?.id === o.id && subEdit ? sub.node ?? null : null} onCommitNode={commitNode} onLayout={layoutUpdate} />
        ) : o.type === 'table' ? (
          <TableView key={o.id} o={o} layer={layer.get(o.id)!} theme={theme} pv={pv} focus={sub?.id === o.id ? sub.cell ?? null : null}
            editing={sub?.id === o.id && subEdit ? sub.cell ?? null : null} onCommitCell={commitCell} onLayout={layoutUpdate} />
        ) : o.type === 'task' ? (
          <TaskView key={o.id} o={o} layer={layer.get(o.id)!} theme={theme} pv={pv} editing={editing === o.id} me={board.me.id} comments={commentCount.get(o.id) ?? 0} onCommit={commitText} />
        ) : (
          <BoxView key={o.id} o={o} layer={layer.get(o.id)!} theme={theme} pv={pv} editing={editing === o.id} cropping={cropId === o.id} onCommit={commitText} onResize={resizeTo} />
        ))}
        {/* Each connector is drawn at its own place in the stacking order, so Arrange works on lines too. */}
        {connectors.map((cn) => (
          <svg key={cn.id} className="connectors" style={{ zIndex: editing === cn.id ? objects.length + 1 : layer.get(cn.id) }}>
            <ConnectorView c={cn} byId={byId} theme={theme} pv={pv} editing={editing === cn.id} onCommit={commitText} />
          </svg>
        ))}
        <svg className="connectors" style={{ zIndex: objects.length + 1 }}>
          {connectDraft && <path d={connectDraft.d} className="draft-line" />}
          {drag?.kind === 'draw' && drag.mode !== 'eraser' && (
            <path d={strokePath(drag.pts)} fill="none" stroke={lineColor(drag.mode === 'highlighter' ? 'yellow' : 'default', theme)}
              strokeWidth={drag.mode === 'highlighter' ? 18 : 3} strokeOpacity={drag.mode === 'highlighter' ? 0.35 : 1} strokeLinecap="round" strokeLinejoin="round" />
          )}
          {endDraft && <path d={endDraft.d} className="draft-line" />}
        </svg>
        {draft && <div className="draft-box" style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h, zIndex: objects.length + 2 }} />}
      </div>

      {/* screen-space overlays */}
      <svg className="overlay">
        {guides.x.map((x) => <line key={`gx${x}`} x1={x * vp.zoom + vp.x} x2={x * vp.zoom + vp.x} y1={0} y2="100%" className="guide" />)}
        {guides.y.map((y) => <line key={`gy${y}`} y1={y * vp.zoom + vp.y} y2={y * vp.zoom + vp.y} x1={0} x2="100%" className="guide" />)}
        {peers.map((pr) => (pr.selection ?? []).map((id) => {
          const r = selectionBounds([id], byId);
          if (!r) return null;
          const tl = screenOf(r);
          return <rect key={`${pr.clientId}-${id}`} x={tl.x - 3} y={tl.y - 3} width={r.w * vp.zoom + 6} height={r.h * vp.zoom + 6} rx={4} className="peer-sel" style={{ stroke: pr.user.color }} />;
        }))}
        {alt && !drag && single && isBox(single) && hoverObj && hoverObj.id !== single.id && !hover?.includes('#') && (() => {
          // Gaps between the selection and the hovered object, in board units.
          const a = single, b = hoverObj, out: { x1: number; y1: number; x2: number; y2: number; d: number }[] = [];
          const midY = Math.max(a.y, b.y) < Math.min(a.y + a.h, b.y + b.h) ? (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2 : a.y + a.h / 2;
          const midX = Math.max(a.x, b.x) < Math.min(a.x + a.w, b.x + b.w) ? (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2 : a.x + a.w / 2;
          if (b.x >= a.x + a.w) out.push({ x1: a.x + a.w, x2: b.x, y1: midY, y2: midY, d: b.x - a.x - a.w });
          else if (a.x >= b.x + b.w) out.push({ x1: b.x + b.w, x2: a.x, y1: midY, y2: midY, d: a.x - b.x - b.w });
          if (b.y >= a.y + a.h) out.push({ x1: midX, x2: midX, y1: a.y + a.h, y2: b.y, d: b.y - a.y - a.h });
          else if (a.y >= b.y + b.h) out.push({ x1: midX, x2: midX, y1: b.y + b.h, y2: a.y, d: a.y - b.y - b.h });
          return out.map((l, i) => {
            const p1 = screenOf({ x: l.x1, y: l.y1 }), p2 = screenOf({ x: l.x2, y: l.y2 });
            return (
              <g key={i} className="measure">
                <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} />
                <text x={(p1.x + p2.x) / 2 + (l.y1 === l.y2 ? 0 : 6)} y={(p1.y + p2.y) / 2 - (l.y1 === l.y2 ? 6 : 0)} textAnchor={l.y1 === l.y2 ? 'middle' : 'start'}>{Math.round(l.d)}</text>
              </g>
            );
          });
        })()}
        {selected.map((o) => {
          if (o.type === 'connector') return null;
          const tl = screenOf(o);
          return <rect key={o.id} x={tl.x - 1} y={tl.y - 1} width={o.w * vp.zoom + 2} height={o.h * vp.zoom + 2} rx={2} className={`sel-box ${o.locked ? 'locked' : ''}`} />;
        })}
        {drag?.kind === 'marquee' && (() => {
          const a = screenOf(drag.start), b = screenOf(drag.cur);
          return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} className="marquee" />;
        })()}
        {drag?.kind === 'node' && drag.moved && drag.target && (() => {
          const el2 = document.querySelector<HTMLElement>(`[data-map="${drag.map}"][data-node="${drag.target}"]`), host = el.current?.getBoundingClientRect();
          if (!el2 || !host) return null;
          const r = el2.getBoundingClientRect();
          return <rect x={r.left - host.left - 3} y={r.top - host.top - 3} width={r.width + 6} height={r.height + 6} rx={6} className="drop-target" />;
        })()}
        {(drag?.kind === 'connect' || drag?.kind === 'endpoint') && hoverObj && (() => {
          const tl = screenOf(hoverObj);
          return <rect x={tl.x - 3} y={tl.y - 3} width={hoverObj.w * vp.zoom + 6} height={hoverObj.h * vp.zoom + 6} rx={4} className="drop-target" />;
        })()}
      </svg>

      {/* resize handles, connector ends, connection dots */}
      {!drag && canEdit && single && isBox(single) && !single.locked && !editing && !subEdit && single.type !== 'mindmap' && HANDLES.filter((h) => (single.type !== 'text' && single.type !== 'table') || h === 'e' || h === 'w').map((h) => {
        const x = single.x + (h.includes('w') ? 0 : h.includes('e') ? single.w : single.w / 2), y = single.y + (h.includes('n') ? 0 : h.includes('s') ? single.h : single.h / 2);
        const s = screenOf({ x, y });
        return <div key={h} className={`handle h-${h}`} data-handle="resize" data-id={single.id} data-dir={h} style={{ left: s.x, top: s.y }} />;
      })}
      {!drag && canEdit && single?.type === 'connector' && !single.locked && (() => {
        const g = connectorGeometry(single, byId);
        if (!g) return null;
        return (['from', 'to'] as const).map((w) => {
          const s = screenOf(w === 'from' ? g.start : g.end);
          return <div key={w} className="end-handle" data-handle="end" data-id={single.id} data-which={w} style={{ left: s.x, top: s.y }} />;
        });
      })()}
      {!drag && quickDots && tool.kind === 'select' && hoverObj && !hover?.includes('#') && !isContainer(hoverObj) && !editing && !preview && !(session?.active && votingOn) && (['top', 'right', 'bottom', 'left'] as const).map((side) => {
        const a = anchor(hoverObj, side), n = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[side];
        const s = screenOf(a);
        return <div key={side} className="conn-dot" data-handle="dot" data-id={hoverObj.id} data-side={side}
          style={{ left: s.x + n[0] * 14, top: s.y + n[1] * 14 }} onPointerEnter={() => setHover(hoverObj.id)} />;
      })}

      {drag?.kind === 'node' && drag.moved && (() => {
        const map = byId.get(drag.map) as MindmapObj | undefined, s2 = screenOf(drag.cur);
        return <div className="node-ghost" style={{ left: s2.x + 12, top: s2.y + 8 }}>{map?.[`n.${drag.node}`]?.text || 'Idea'}</div>;
      })()}
      {/* Who is typing where: an outline in their color and their name. */}
      {peers.map((pr) => {
        const r = pr.editing ? selectionBounds([pr.editing], byId) : null;
        if (!r) return null;
        const tl = screenOf(r);
        return (
          <div key={`ed-${pr.clientId}`} className="peer-editing" style={{ left: tl.x - 4, top: tl.y - 4, width: r.w * vp.zoom + 8, height: r.h * vp.zoom + 8, borderColor: pr.user.color }}>
            <span style={{ background: pr.user.color }}>{pr.user.name} is editing</span>
          </div>
        );
      })}
      {peers.filter((pr) => pr.cursor).map((pr) => {
        const s = screenOf(pr.cursor!);
        return (
          <div key={pr.clientId} className="peer-cursor" style={{ left: s.x, top: s.y, color: pr.user.color }}>
            <svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 2 L16 8 L9 10 L7 16 Z" fill="currentColor" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" /></svg>
            <span style={{ background: pr.user.color }}>{pr.user.name}</span>
          </div>
        );
      })}

      {expanded && byId.get(expanded)?.type === 'task' && (
        <TaskExpanded task={byId.get(expanded) as TaskObj} doc={doc} boardId={boardId} me={board.me} theme={theme} threads={threads}
          stacks={objects.filter((o): o is StackObj => o.type === 'stack')}
          tags={[...new Set(objects.flatMap((o) => (o.type === 'task' ? o.tags ?? [] : [])))].sort()}
          update={taskUpdate} onToast={onToast} onClose={() => setExpanded(null)} readOnly={!canEdit} canComment={canComment} onLog={(what) => expanded && logActivity(doc, expanded, board.me.name, what)}
          here={[...new Map(peers.filter((pr) => pr.editing === expanded).map((pr) => [pr.user.id, pr.user])).values()]}
          onDelete={() => { deleteObjects(doc, [expanded], LOCAL); setExpanded(null); }} />
      )}
      {showBar && barAt && canEdit && (
        <ContextBar selected={selected} at={barAt} update={taskUpdate} sub={sub} me={board.me.id} actions={{
          expand: () => single?.type === 'task' && setExpanded(single.id), rotateFrame,
          duplicate: () => duplicate(), remove: removeSelected, front: () => arrange('front'), back: () => arrange('back'),
          edit: () => single && setEditing(single.id), toggleLock,
          comment: () => single && startComment({ x: 0, y: 0 }, single),
          crop: () => single && setCropId(cropId === single.id ? null : single.id), cropping: !!single && cropId === single.id,
          editLink: () => single?.type === 'link' && setLinkAsk({ at: { x: single.x, y: single.y }, id: single.id, url: single.url }),
          openMenu: (cx, cy) => { const r = el.current!.getBoundingClientRect(); setMenu({ x: cx - r.left, y: cy - r.top, world: worldOf(cx, cy) }); },
          mindmap: (act) => sub?.node && mindmapAct(sub.id, sub.node, act),
          // Rich text of the selection: the focused node of a mind map, else the text of shapes, stickies and text.
          rich: {
            editing: editingRich,
            fragments: () => (single?.type === 'mindmap' ? (sub?.node ? [richOf(doc, single.id, `t.${sub.node}`, LOCAL)] : [])
              : selected.filter((o) => isRichField(o.type, 'text')).map((o) => richOf(doc, o.id, 'text', LOCAL))).filter((f): f is NonNullable<typeof f> => !!f),
            edit: (then) => {
              if (then) whenEditorOpens(then);
              if (single?.type === 'mindmap') { if (sub?.node) focusNode(single.id, sub.node, true); }
              else if (single) setEditing(single.id);
            },
          },
          table: (act) => {
            const t = single?.type === 'table' ? single : undefined;
            if (!t) return;
            const [row, col] = sub?.cell ?? [t.rows.at(-1)!, t.cols.at(-1)!];
            const p = act === 'addRow' ? addRow(t, row).patch : act === 'addCol' ? addCol(t, col).patch : act === 'delRow' ? deleteRow(t, row) : deleteCol(t, col);
            if (p) update([p]);
            if (act === 'delRow' || act === 'delCol') setSub({ id: t.id });
          },
        }} />
      )}

      {menu && (() => {
        const one = selected.length === 1 ? selected[0] : null, locked = selected.length > 0 && selected.every((o) => o.locked), n = alignBoxes().length;
        const edit = (items: MenuItem[]) => (canEdit ? items : []);
        const copyAsItems: MenuItem[] = [
          { label: 'PNG', onClick: () => copyAs('png'), keys: '⇧⌘C' }, { label: 'PNG without background', onClick: () => copyAs('png-clear') },
          { label: 'PNG light', onClick: () => copyAs('png-light') }, { label: 'PNG dark', onClick: () => copyAs('png-dark') },
          { label: 'SVG', onClick: () => copyAs('svg') }, { label: 'Mermaid', onClick: () => copyAs('mermaid') },
          ...(one ? [{ label: 'Link to object', onClick: () => copyAs('link'), keys: '⌥⇧⌘C' }] : []),
        ];
        const zoomItems: MenuItem[] = [
          { label: 'Zoom in', icon: <ZoomIn size={15} />, keys: '=', onClick: () => zoomCenter(vp.zoom * 1.25) },
          { label: 'Zoom out', icon: <ZoomOut size={15} />, keys: '-', onClick: () => zoomCenter(vp.zoom / 1.25) },
          { label: 'Zoom to 100%', icon: <Search size={15} />, keys: '0', onClick: () => zoomCenter(1) },
          { label: 'Zoom to content', icon: <Maximize size={15} />, keys: '1', onClick: fitContent },
        ];
        const items: MenuItem[] = selected.length ? [
          { label: 'Copy', icon: <CopyIcon size={15} />, keys: '⌘C', onClick: () => copyText(serialize(withInnerConnectors(selection, objects))) },
          { label: 'Copy as…', icon: <Files size={15} />, sub: copyAsItems },
          { label: 'Copy link to board position', icon: <Link2 size={15} />, onClick: copyPositionLink },
          ...edit([
            { label: 'Cut', icon: <Scissors size={15} />, keys: '⌘X', onClick: () => copyText(serialize(withInnerConnectors(selection, objects))).then(removeSelected) },
            { label: 'Duplicate', icon: <CopyPlus size={15} />, keys: '⌘D', onClick: () => duplicate() },
            { label: 'Delete', icon: <Trash2 size={15} />, keys: '⌫', danger: true, onClick: removeSelected },
          ]),
          'sep',
          ...(canComment && one ? [{ label: 'Add comment', icon: <MessageSquarePlus size={15} />, keys: '⌥⌘M', onClick: () => startComment({ x: 0, y: 0 }, one) } as MenuItem, 'sep' as const] : []),
          ...edit([
            ...(one ? [{ label: 'Copy style', icon: <Paintbrush size={15} />, keys: '⌥⌘C', onClick: () => { copied.current = styleOf(one); onToast('Style copied'); } } as MenuItem] : []),
            { label: 'Paste style', icon: <Paintbrush size={15} />, keys: '⌥⌘V', disabled: !copied.current, onClick: pasteStyle },
            ...(one ? [{ label: 'Save as default style', icon: <Bookmark size={15} />, keys: '⇧⌘D', onClick: saveDefaultStyle } as MenuItem] : []),
            'sep',
            ...(selected.length > 1 && !selected.every((o) => o.group && o.group === selected[0].group) ? [{ label: 'Group', icon: <Group size={15} />, keys: '⌘G', onClick: groupSelected } as MenuItem] : []),
            ...(selected.some((o) => o.group) ? [{ label: 'Ungroup', icon: <Ungroup size={15} />, keys: '⇧⌘G', onClick: ungroupSelected } as MenuItem] : []),
            { label: 'Arrange', icon: <Layers size={15} />, sub: [
              { label: 'Bring forward', keys: '⌘]', onClick: () => arrange('forward') }, { label: 'Bring to front', keys: ']', onClick: () => arrange('front') },
              { label: 'Send backward', keys: '⌘[', onClick: () => arrange('backward') }, { label: 'Send to back', keys: '[', onClick: () => arrange('back') },
            ] },
            { label: 'Align', icon: <AlignStartVertical size={15} />, disabled: n < 2, sub: [
              { label: 'Left', icon: <AlignStartVertical size={15} />, onClick: () => align('left') }, { label: 'Center', icon: <AlignCenterVertical size={15} />, onClick: () => align('center') },
              { label: 'Right', icon: <AlignEndVertical size={15} />, onClick: () => align('right') }, 'sep',
              { label: 'Top', icon: <AlignStartHorizontal size={15} />, onClick: () => align('top') }, { label: 'Middle', icon: <AlignCenterHorizontal size={15} />, onClick: () => align('middle') },
              { label: 'Bottom', icon: <AlignEndHorizontal size={15} />, onClick: () => align('bottom') }, 'sep',
              { label: 'Distribute horizontally', icon: <AlignHorizontalSpaceAround size={15} />, disabled: n < 3, onClick: () => distribute('x') },
              { label: 'Distribute vertically', icon: <AlignVerticalSpaceAround size={15} />, disabled: n < 3, onClick: () => distribute('y') },
            ] },
            'sep',
          ]),
          { label: locked ? 'Unlock' : 'Lock', icon: locked ? <Unlock size={15} /> : <LockIcon size={15} />, keys: '⇧⌘L', disabled: !canEdit, onClick: toggleLock },
          ...edit([
            { label: 'Wrap in section', icon: <FrameIcon size={15} />, onClick: wrapInSection },
            { label: 'Snap to grid', icon: <Grid3x3 size={15} />, onClick: snapToGrid },
            'sep',
            { label: 'Set as board thumbnail', icon: <ImageIcon size={15} />, onClick: setThumbnail },
          ]),
        ] : [
          ...edit([
            { label: 'Paste', icon: <ClipboardPaste size={15} />, keys: '⌘V', onClick: () => pasteFromClipboard(undefined, menu.world) },
            { label: 'Paste as…', icon: <ClipboardPaste size={15} />, sub: [
              { label: 'Plain text', onClick: () => pasteFromClipboard('text', menu.world) }, { label: 'Table', onClick: () => pasteFromClipboard('table', menu.world) },
            ] },
            'sep',
          ]),
          { label: 'Copy link to board position', icon: <Link2 size={15} />, onClick: copyPositionLink },
          ...(canComment ? [{ label: 'Add comment', icon: <MessageSquarePlus size={15} />, keys: '⌥⌘M', onClick: () => startComment(menu.world) } as MenuItem] : []),
          { label: 'Select all', icon: <MousePointerClick size={15} />, keys: '⌘A', onClick: () => setSelection(objects.filter((o) => !o.locked).map((o) => o.id)) },
          'sep', ...zoomItems, 'sep',
          { label: 'Export…', icon: <Download size={15} />, keys: '⇧⌘E', onClick: () => setPanel('export') },
        ];
        return <ContextMenu x={menu.x} y={menu.y} items={items.filter((it, k, all) => it !== 'sep' || (k > 0 && all[k - 1] !== 'sep' && k < all.length - 1))} onClose={() => setMenu(null)} />;
      })()}

      {threads.filter((t) => !t.resolved || t.id === openThread).map((t) => {
        const s = screenOf(anchorPoint(t, byId));
        return <Pin key={t.id} t={t} at={s} active={openThread === t.id} onOpen={() => { setCommentDraft(null); setOpenThread(openThread === t.id ? null : t.id); }} />;
      })}
      {(() => {
        const t = threads.find((x) => x.id === openThread);
        if (!t) return null;
        const s = screenOf(anchorPoint(t, byId));
        return <div className="c-pop" style={{ left: s.x + 22, top: s.y - 10 }}><ThreadView t={t} me={board.me} boardId={boardId} readOnly={!canComment} onClose={() => setOpenThread(null)} /></div>;
      })()}
      {commentDraft && (() => {
        const s = screenOf(commentDraft.at);
        return (
          <div className="c-pop" style={{ left: s.x + 22, top: s.y - 10 }}>
            <div className="c-thread">
              <Composer placeholder="Add a comment… use @ to mention" onCancel={() => setCommentDraft(null)}
                onSend={async (text, mentions) => {
                  const t = await api.comment(boardId, { anchor: { objectId: commentDraft.objectId, x: commentDraft.x, y: commentDraft.y }, text, mentions });
                  setCommentDraft(null);
                  setOpenThread(t.id);
                }} />
            </div>
          </div>
        );
      })()}
      <div className="top-actions" onPointerDown={(e) => e.stopPropagation()}>
        <button className="c-toggle" aria-label="Present" data-tip={slides.length ? `Present ${slides.length} sections` : 'Present the board'} onClick={startPresenting}><Play size={17} /></button>
        <button className={`c-toggle ${panel === 'history' ? 'active' : ''}`} aria-label="Time machine" data-tip="Time machine" onClick={() => { setPanel(panel === 'history' ? null : 'history'); if (panel === 'history') setPreview(null); }}><History size={17} /></button>
        <button className={`c-toggle ${panel === 'export' ? 'active' : ''}`} aria-label="Export" data-tip="Export  ⇧⌘E" onClick={() => setPanel(panel === 'export' ? null : 'export')}><Download size={17} /></button>
        <button className={`c-toggle ${panel === 'comments' ? 'active' : ''}`} aria-label="Comments" data-tip="Comments" onClick={() => setPanel(panel === 'comments' ? null : 'comments')}>
          <MessageSquare size={17} />{threads.filter((t) => !t.resolved).length > 0 && <span>{threads.filter((t) => !t.resolved).length}</span>}
        </button>
      </div>
      {panel === 'export' && (
        <ExportMenu world={() => worldRef.current} area={selectionBounds(objects.map((o) => o.id), byId)} selectionArea={selBounds} selectionIds={selection}
          background={c.bg} theme={theme} title={document.title.split(' · ')[0]} onClose={() => setPanel(null)} onToast={onToast} />
      )}
      {panel === 'history' && <HistoryPanel boardId={boardId} previewing={preview?.id ?? null} onClose={() => setPanel(null)} onToast={onToast}
        onPreview={async (v) => {
          if (!v) return setPreview(null);
          const objs = await api.version(boardId, v.id) as BoardObject[];
          setSelection([]);
          setPreview({ id: v.id, at: v.at, objects: objs.sort((a, b) => a.z - b.z) });
        }} />}
      <div className="center-banners" onPointerDown={(e) => e.stopPropagation()}>
        {preview && <div className="vote-banner preview-banner"><History size={15} /><strong>Previewing {new Date(preview.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</strong><span className="muted">read only</span><button className="btn ghost" onClick={() => setPreview(null)}>Exit preview</button></div>}
        {settings.timer && <TimerPill doc={doc} timer={settings.timer as TimerState} />}
        {session && !preview && <VotingBanner doc={doc} session={session} votes={votes} me={board.me} voting={votingOn} setVoting={setVotingOn} />}
      </div>
      {pop && <div className="pop-anchor">{pop === 'timer' ? <TimerStart doc={doc} me={board.me} onClose={() => setPop(null)} /> : <VotingStart doc={doc} me={board.me} onClose={() => setPop(null)} />}</div>}
      {session && !preview && (() => {
        const counts = session.active ? myVotes(votes, board.me.id) : totals(votes);
        return Object.entries(counts).map(([id, n]) => {
          const o = byId.get(id);
          if (!o || !isBox(o) || !n) return null;
          const s = screenOf({ x: o.x + o.w, y: o.y });
          return <span key={id} className={`vote-badge ${session.active ? 'mine' : ''}`} style={{ left: s.x, top: s.y }}>{n}</span>;
        });
      })()}
      {presenting !== null && slides[presenting] && (() => {
        // Only the current section shows; everything around it is covered.
        const sl = slides[presenting], a = screenOf({ x: sl.x - 2, y: sl.y - 34 }), b = screenOf({ x: sl.x + sl.w + 2, y: sl.y + sl.h + 2 });
        return <svg className="slide-mask"><path fillRule="evenodd" fill={c.bg} d={`M-10,-10 H100000 V100000 H-10 Z M${a.x},${a.y} V${b.y} H${b.x} V${a.y} Z`} /></svg>;
      })()}
      {presenting !== null && (
        <div className="slide-controls" onPointerDown={(e) => e.stopPropagation()}>
          <button className="icon-btn" aria-label="Previous slide" onClick={() => presentRef.current.step(-1)}><ChevronLeft size={20} /></button>
          <span>{slides.length ? `${presenting + 1} / ${slides.length}` : 'Board'}{slides[presenting] ? ` · ${(slides[presenting] as { title: string }).title}` : ''}</span>
          <button className="icon-btn" aria-label="Next slide" onClick={() => presentRef.current.step(1)}><ChevronRight size={20} /></button>
          <button className="icon-btn" aria-label="Stop presenting" onClick={() => presentRef.current.exit()}><XIcon size={18} /></button>
        </div>
      )}
      {panel === 'comments' && <CommentsPanel threads={threads} onClose={() => setPanel(null)} onOpen={(t) => {
        setOpenThread(t.id);
        const p = anchorPoint(t, byId);
        const r = el.current!.getBoundingClientRect();
        setVp((v) => ({ ...v, x: r.width / 2 - p.x * v.zoom - 160, y: r.height / 2 - p.y * v.zoom }));
      }} />}
      <Toolbar readOnly={!canEdit} canComment={canComment} mode={mode} setMode={setMode} flyout={flyout} setFlyout={setToolbarFlyout} tool={tool} setTool={setTool} onInsert={onInsert} />
      <BottomBar zoom={vp.zoom} setZoom={zoomCenter} fit={fitContent} history={history} undo={() => undo.undo()} redo={() => undo.redo()} />
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden
        onChange={(e) => { addImages([...(e.target.files ?? [])]); e.target.value = ''; }} />
      <input ref={importInput} type="file" accept=".excalidraw,.json,.mmd,.mermaid,image/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }} />
      {linkAsk && <LinkDialog url={linkAsk.url} onClose={() => setLinkAsk(null)} onSubmit={(url) => { addLink(url, linkAsk.at, linkAsk.id); setLinkAsk(null); }} />}
      {(dialog === 'mermaid' || dialog === 'mindmap') && <InsertDialog kind={dialog} onClose={() => setDialog(null)} onSubmit={(src) => submitDialog(dialog, src)} />}
      {dialog === 'template' && <TemplateGallery title="Insert a template" onClose={() => setDialog(null)} onPick={async (t) => {
        setDialog(null);
        try {
          const objs = await api.templateObjects(t.id) as BoardObject[];
          const z0 = maxZ(doc) + 1;
          insertBatch(objs.map((o, i) => (o.type === 'section' ? o : { ...o, z: z0 + i })));
        } catch (e) { onToast(`Template failed: ${(e as Error).message}`); }
      }} />}
    </div>
    </RichUndo.Provider>
    </RichSource.Provider>
    </TextSource.Provider>
  );
}

// Peers' presence list for the title bar.
export function Presence({ board }: { board: Board }) {
  const seen = new Map<string, Board['peers'][number]>();
  for (const p of board.peers) seen.set(p.user.id, p);
  return (
    <div className="presence">
      {[...seen.values()].map((p) => (
        <span key={p.clientId} className="avatar peer" title={p.user.name} style={{ background: p.user.color }}>
          {p.user.picture ? <img src={p.user.picture} alt="" referrerPolicy="no-referrer" /> : p.user.name[0]?.toUpperCase()}
        </span>
      ))}
      <span className={`sync-dot ${board.online ? 'on' : 'off'}`} title={board.online ? 'Connected' : 'Offline, reconnecting'} />
    </div>
  );
}


function LinkDialog({ url = '', onClose, onSubmit }: { url?: string; onClose: () => void; onSubmit: (url: string) => void }) {
  const [value, setValue] = useState(url);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal narrow-modal" role="dialog" aria-modal="true" aria-labelledby="link-title" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}
        onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(value); }}>
        <h2 id="link-title">{url ? 'Edit link' : 'Add a link'}</h2>
        <input className="field" autoFocus placeholder="https://…" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Link URL" />
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!value.trim()}>{url ? 'Save' : 'Add link'}</button>
        </div>
      </form>
    </div>
  );
}
