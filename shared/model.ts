// Board object model, shared by the browser, the sync server and the MCP tools.
// Colors and font sizes copy Whimsical's own scale.
import type { RichJSON } from './richtext.ts';

export const PALETTE = {
  white: { base: '#FFFFFF', fill: '#FFFFFF', stroke: '#C4CFDA' },
  'light-gray': { base: '#C4CFDA', fill: '#F2F5F7', stroke: '#C4CFDA' },
  silver: { base: '#798897', fill: '#E1E5EC', stroke: '#9FADBA' },
  default: { base: '#4D5D6C', fill: '#CED8E0', stroke: '#798897' },
  blue: { base: '#2987D7', fill: '#D4E7F7', stroke: '#2987D7' },
  'whimsy-blue': { base: '#665BF3', fill: '#E0DEFD', stroke: '#665BF3' },
  'dark-purple': { base: '#730FC3', fill: '#E3CFF3', stroke: '#730FC3' },
  purple: { base: '#BE36D3', fill: '#F2D7F6', stroke: '#BE36D3' },
  green: { base: '#26AEA0', fill: '#D4EFEC', stroke: '#26AEA0' },
  'dark-green': { base: '#007A6F', fill: '#CCE4E2', stroke: '#007A6F' },
  brown: { base: '#897A5F', fill: '#E7E4DF', stroke: '#897A5F' },
  'pale-red': { base: '#A46767', fill: '#EDE1E1', stroke: '#A46767' },
  red: { base: '#D5475B', fill: '#F7DADE', stroke: '#D5475B' },
  orange: { base: '#E8843C', fill: '#FAE6D8', stroke: '#E8843C' },
  yellow: { base: '#F0C54F', fill: '#FCF3DC', stroke: '#F0C54F' },
} as const;
export type ColorName = keyof typeof PALETTE;
export const COLOR_NAMES = Object.keys(PALETTE) as ColorName[];
// Grays and white: not a color choice when matching or tinting.
export const NEUTRAL = new Set<ColorName>(['white', 'light-gray', 'silver', 'default']);

export const FONT_SIZES = { xs: 13, s: 15, m: 18, l0: 21, l1: 27, l2: 36, l3: 60, l4: 90 } as const;
export type FontSize = keyof typeof FONT_SIZES;
export const FONT_SIZE_STEPS = Object.keys(FONT_SIZES) as FontSize[];

export const SHAPES = [
  'rect', 'pill', 'oval', 'diamond', 'parallelogram', 'parallelogram-flip', 'trapezoid', 'triangle', 'hexagon',
  'cylinder', 'actor', 'code', 'annotation', 'line', 'cross', 'bracket', 'cloud', 'star',
] as const;
export type ShapeKind = (typeof SHAPES)[number];

export type Deco = 'fill' | 'outline' | 'dash' | 'transparent';
export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Align = 'left' | 'center' | 'right';
export type Route = 'elbow' | 'straight' | 'curved';
export type Cap = 'none' | 'arrow';

// A connector end is bound to an object (id, optional fixed side) or free (x, y).
// A connector end: bound to an object (`id`, optionally one mind map `node` in it), or a free point.
export type End = { id?: string; node?: string; side?: Side; x?: number; y?: number };

// `group`: objects with the same group id are selected and moved together (⌘G); ⌘-click selects one of them.
// `rich`: formatting of rich text fields (see shared/richtext.ts), by field key; the field itself holds the plain text.
type Base = { id: string; z: number; locked?: boolean; group?: string; rich?: Record<string, RichJSON> };
type Box = { x: number; y: number; w: number; h: number };

// rotate: the outline turns in steps of 90 degrees (the text stays upright); icon: shown left of the text.
export type Rotation = 0 | 90 | 180 | 270;
export type ShapeObj = Base & Box & { type: 'shape'; shape: ShapeKind; color: ColorName; deco: Deco; text: string; fontSize: FontSize; align: Align; rotate?: Rotation; icon?: string; iconDeco?: IconDeco };
export type TextObj = Base & Box & { type: 'text'; text: string; color: ColorName; fontSize: FontSize; align: Align };
export type StickyObj = Base & Box & { type: 'sticky'; text: string; color: ColorName; fontSize: FontSize; author: string; hideAuthor?: boolean };
export type SectionObj = Base & Box & { type: 'section'; title: string; color: ColorName; deco: 'fill' | 'outline' };
// crop: the visible part of the image, as fractions of its natural size (default: all of it).
export type Crop = { x: number; y: number; w: number; h: number };
export type ImageObj = Base & Box & { type: 'image'; src: string; crop?: Crop };
export type ConnectorObj = Base & { type: 'connector'; from: End; to: End; route: Route; startCap: Cap; endCap: Cap; color: ColorName; dash: boolean; text: string; animate?: boolean };

// Mind map: each node is its own field `n.<nodeId>`, so concurrent edits to different nodes merge.
// w and h are written back by the browser after layout with real text metrics.
// icon: a Lucide icon name before the text; dash: the line from the parent is dashed.
export type MNode = { text: string; parent: string | null; order: number; collapsed?: boolean; color?: ColorName; icon?: string; iconDeco?: 'multicolor' | 'fill' | 'outline'; dash?: boolean };
export type MindmapObj = Base & Box & { type: 'mindmap'; layout: 'horizontal' | 'vertical'; edge: 'curvy' | 'angular'; fontSize: FontSize; rx: number; ry: number } & { [node: `n.${string}`]: MNode } & { [text: `t.${string}`]: string }; // t.<id>: the node's shared text, when edited

// Table: cells are fields `c.<rowId>.<colId>`; rows and cols hold the order of ids.
export type TableStyle = 'plain' | 'contrast' | 'striped' | 'none' | 'filled';
export type TableObj = Base & Box & {
  type: 'table'; rows: string[]; cols: string[]; colW: Record<string, number>; style: TableStyle; headColor: ColorName; fontSize: FontSize;
} & { [cell: `c.${string}`]: string };

export type IconDeco = 'multicolor' | 'fill' | 'outline';
export type IconObj = Base & Box & { type: 'icon'; icon: string; color: ColorName; deco: IconDeco; text: string; rotate?: Rotation };

// Freehand stroke: points are x,y pairs in a w0 x h0 space, scaled to the box when resized.
export type DrawObj = Base & Box & { type: 'draw'; points: number[]; w0: number; h0: number; color: ColorName; size: number; highlight: boolean };

export type LinkObj = Base & Box & { type: 'link'; url: string; title: string; site: string; color: ColorName };

// --- wireframes ------------------------------------------------------------------------
// Components follow Whimsical's wireframe kit.
export const WF_KINDS = [
  'button', 'link', 'input', 'textarea', 'dropdown', 'checkbox', 'radio', 'toggle', 'slider', 'progress', 'stars',
  'htabs', 'vtabs', 'tag', 'tooltip', 'shape', 'image', 'video', 'avatar', 'divider', 'overlay', 'map', 'lorem', 'blockfont', 'annotation',
] as const;
export type WfKind = (typeof WF_KINDS)[number];
export const WF_SIZES = ['xs', 's', 'm', 'l0', 'xl', 'xxl'] as const;
export type WfSize = (typeof WF_SIZES)[number];
export type WfState = 'normal' | 'focused' | 'error' | 'disabled' | 'selected';
// text: the content. For checkbox, radio, tabs and dropdown it holds one item per line;
// a line starting with "* " is the selected or checked item.
export type WfObj = Base & Box & {
  type: 'wf'; kind: WfKind; color: ColorName; deco: 'fill' | 'outline' | 'dashes'; size: WfSize; state: WfState;
  text: string; label?: string; pos?: number; icon?: string; arrow?: Side; shapeType?: 'rect' | 'ellipse' | 'pill';
};

export const DEVICES = {
  plain: { label: 'Plain', w: 480, h: 360, inset: [0, 0, 0, 0], status: 0 },
  window: { label: 'Window', w: 1024, h: 640, inset: [36, 1, 1, 1], status: 0 },
  iphone: { label: 'iPhone', w: 390, h: 844, inset: [12, 12, 12, 12], status: 44 },
  android: { label: 'Android', w: 412, h: 892, inset: [10, 10, 10, 10], status: 28 },
  tablet: { label: 'Tablet', w: 820, h: 1180, inset: [18, 18, 18, 18], status: 28 },
  watch: { label: 'Watch', w: 210, h: 250, inset: [16, 16, 16, 16], status: 22 },
} as const;
export type Device = keyof typeof DEVICES;
export type FrameObj = Base & Box & { type: 'frame'; device: Device; title: string; statusBar: boolean; keyboard: boolean };

// The usable screen of a frame (below chrome and status bar), for layout and hit testing.
export function frameScreen(f: Pick<FrameObj, 'x' | 'y' | 'w' | 'h' | 'device' | 'statusBar'>) {
  const d = DEVICES[f.device], [t, r, b, l] = d.inset, sb = f.statusBar ? d.status : 0;
  return { x: f.x + l, y: f.y + t + sb, w: f.w - l - r, h: f.h - t - b - sb };
}

// Task mode. A card's height follows its size; `stack` and `order` place it in a task stack.
// `desc` is the description, `assignee` a user id, `watch` the user ids notified about the card.
export const TASK_SIZES = ['xs', 's', 'm', 'l'] as const;
export type TaskSize = (typeof TASK_SIZES)[number];
export const TASK_H: Record<TaskSize, number> = { xs: 44, s: 72, m: 108, l: 180 };
export type TaskObj = Base & Box & {
  type: 'task'; title: string; color: ColorName; size: TaskSize; desc?: string; assignee?: string; tags?: string[];
  stack?: string; order?: number; watch?: string[];
};
export type StackObj = Base & Box & { type: 'stack'; title: string; color: ColorName };

export type BoardObject = ShapeObj | TextObj | StickyObj | SectionObj | ImageObj | MindmapObj | TableObj | IconObj | DrawObj | LinkObj | WfObj | FrameObj | TaskObj | StackObj | ConnectorObj;
export type BoxObject = Exclude<BoardObject, ConnectorObj>;

export const isBox = (o: BoardObject): o is BoxObject => o.type !== 'connector';
// Sections, device frames and task stacks hold other objects: they sit below content and carry it when moved.
export const isContainer = (o: BoardObject): o is SectionObj | FrameObj | StackObj => o.type === 'section' || o.type === 'frame' || o.type === 'stack';
export const SECTION_Z = -1_000_000, FRAME_Z = -500_000, STACK_Z = -250_000;

// Default sizes and styles, close to Whimsical's.
export const DEFAULTS = {
  shape: { w: 160, h: 72, color: 'white', deco: 'outline', fontSize: 'm', align: 'center', text: '' },
  text: { w: 180, h: 32, color: 'default', fontSize: 'm', align: 'left', text: '' },
  sticky: { w: 240, h: 240, color: 'yellow', fontSize: 'm', text: '' },
  section: { w: 1344, h: 756, color: 'light-gray', deco: 'outline', title: 'Section' },
  connector: { route: 'elbow', startCap: 'none', endCap: 'arrow', color: 'silver', dash: false, text: '' },
  icon: { w: 72, h: 72, color: 'silver', deco: 'multicolor', text: '' },
  link: { w: 280, h: 44, color: 'blue', title: '', site: '' },
  wf: { color: 'default', deco: 'outline', size: 'm', state: 'normal', text: '' },
  frame: { statusBar: true, keyboard: false },
  task: { w: 288, h: 108, title: '', color: 'blue', size: 'm' },
  stack: { w: 312, h: 108, title: 'Stack', color: 'light-gray' },
  table: { w: 480, h: 120, style: 'contrast', headColor: 'blue', fontSize: 's' },
} as const;

// Branch colors of a new mind map, in Whimsical's order.
export const BRANCH_COLORS: ColorName[] = ['purple', 'blue', 'green', 'orange', 'red', 'yellow', 'whimsy-blue', 'dark-green'];

// Nodes with their text: the shared text (t.<id>) when a node has been edited live, else the text in the node record.
export const mindmapNodes = (o: MindmapObj): [string, MNode][] =>
  Object.entries(o).filter(([k, v]) => k.startsWith('n.') && v).map(([k, v]) => {
    const id = k.slice(2), t = o[`t.${id}`];
    return [id, typeof t === 'string' ? { ...(v as MNode), text: t } : (v as MNode)];
  });

export const cellKey = (row: string, col: string) => `c.${row}.${col}` as const;

// Shape-specific default sizes where 160x72 looks wrong.
export const SHAPE_SIZE: Partial<Record<ShapeKind, { w: number; h: number }>> = {
  oval: { w: 120, h: 120 }, diamond: { w: 160, h: 120 }, triangle: { w: 140, h: 120 }, hexagon: { w: 160, h: 96 },
  cylinder: { w: 120, h: 140 }, star: { w: 140, h: 140 }, cloud: { w: 200, h: 130 }, actor: { w: 160, h: 72 },
  line: { w: 200, h: 8 }, cross: { w: 80, h: 80 }, bracket: { w: 40, h: 160 },
};

// getRandomValues works in every page; randomUUID only on https and localhost (a team server on plain http has none).
export const randomHex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
export const newId = () => randomHex(6);

// Lucide exports PascalCase names (CircleCheck); boards and MCP use kebab-case ("circle-check").
export const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Za-z])([0-9])/g, '$1-$2').toLowerCase();

// Board maps that hold JSON strings (comments, settings, votes, card activity). Any editor's socket can write any
// value there, so one that does not parse is skipped instead of breaking the board for every reader.
export const parseJson = <T,>(v: string): T | undefined => { try { return JSON.parse(v) as T; } catch { return undefined; } };
export const jsonEntries = <T,>(entries: Iterable<[string, string]>): [string, T][] =>
  [...entries].flatMap(([k, v]) => { const x = parseJson<T>(v); return x === undefined ? [] : [[k, x] as [string, T]]; });

// Default size and content of each wireframe component (Whimsical's defaults where known).
export const WF_DEFAULTS: Record<WfKind, Partial<WfObj> & { w: number; h: number }> = {
  button: { w: 120, h: 40, text: 'Button', color: 'whimsy-blue', deco: 'fill' },
  link: { w: 120, h: 24, text: 'Link', color: 'whimsy-blue' },
  input: { w: 240, h: 40, text: 'Placeholder' },
  textarea: { w: 240, h: 96, text: 'Placeholder' },
  dropdown: { w: 200, h: 40, text: 'Select' },
  checkbox: { w: 180, h: 64, text: '* Option one\nOption two', color: 'whimsy-blue' },
  radio: { w: 180, h: 64, text: '* Option one\nOption two', color: 'whimsy-blue' },
  toggle: { w: 44, h: 24, state: 'selected', color: 'whimsy-blue' },
  slider: { w: 240, h: 24, pos: 0.4, color: 'whimsy-blue' },
  progress: { w: 240, h: 8, pos: 0.6, color: 'whimsy-blue' },
  stars: { w: 120, h: 24, pos: 0.6, color: 'yellow' },
  htabs: { w: 320, h: 40, text: '* Tab one\nTab two\nTab three', color: 'whimsy-blue' },
  vtabs: { w: 180, h: 120, text: '* Tab one\nTab two\nTab three', color: 'whimsy-blue' },
  tag: { w: 64, h: 24, text: 'Tag', color: 'blue' },
  tooltip: { w: 160, h: 44, text: 'Tooltip', arrow: 'bottom', color: 'default', deco: 'fill' },
  shape: { w: 160, h: 100, shapeType: 'rect', color: 'light-gray' },
  image: { w: 200, h: 140, icon: 'image', color: 'silver' },
  video: { w: 240, h: 140, icon: 'circle-play', color: 'silver' },
  avatar: { w: 48, h: 48, icon: 'user', shapeType: 'ellipse', color: 'silver' },
  divider: { w: 240, h: 8, color: 'light-gray' },
  overlay: { w: 320, h: 240, color: 'default', deco: 'fill' },
  map: { w: 280, h: 180, color: 'silver' },
  lorem: { w: 260, h: 96, color: 'silver' },
  blockfont: { w: 200, h: 40, color: 'light-gray' },
  annotation: { w: 28, h: 28, text: '1', color: 'orange', deco: 'fill' },
};
