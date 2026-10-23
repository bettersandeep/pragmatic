// Built-in templates. Each builds fresh objects (new ids) at the origin.
import { DEFAULTS, newId, type BoardObject, type ColorName, type ShapeKind, type StickyObj } from './model.ts';
import { mindmapFromOutline } from './mindmapOps.ts';
import { newTable } from './tableOps.ts';

export type TemplateInfo = { id: string; title: string; description: string; icon: string };

let z = 1;
const shape = (text: string, x: number, y: number, o: { shape?: ShapeKind; color?: ColorName; deco?: 'fill' | 'outline'; w?: number; h?: number } = {}): BoardObject =>
  ({ ...DEFAULTS.shape, id: newId(), z: z++, type: 'shape', shape: o.shape ?? 'rect', text, x, y, w: o.w ?? 160, h: o.h ?? 72, color: o.color ?? 'white', deco: o.deco ?? 'outline' } as BoardObject);
const link = (a: BoardObject, b: BoardObject, text = ''): BoardObject =>
  ({ ...DEFAULTS.connector, id: newId(), z: z++, type: 'connector', from: { id: a.id }, to: { id: b.id }, text } as BoardObject);
const sticky = (text: string, x: number, y: number, color: ColorName = 'yellow'): StickyObj =>
  ({ ...DEFAULTS.sticky, id: newId(), z: z++, type: 'sticky', text, x, y, w: 200, h: 160, color, author: '' } as StickyObj);
const section = (title: string, x: number, y: number, w: number, h: number, color: ColorName = 'light-gray'): BoardObject =>
  ({ ...DEFAULTS.section, id: newId(), z: -1_000_000 + z++, type: 'section', title, x, y, w, h, color, deco: 'fill' } as BoardObject);
const heading = (text: string, x: number, y: number): BoardObject =>
  ({ ...DEFAULTS.text, id: newId(), z: z++, type: 'text', text, x, y, w: 600, h: 48, fontSize: 'l2' } as BoardObject);

const BUILT_IN: (TemplateInfo & { build: () => BoardObject[] })[] = [
  {
    id: 'flowchart', title: 'Flowchart', description: 'Start, steps, a decision and two outcomes.', icon: 'workflow',
    build: () => {
      const s = shape('Start', 0, 0, { shape: 'pill', color: 'green', deco: 'fill' }), a = shape('Step one', 240, 0), d = shape('Decision?', 480, -24, { shape: 'diamond', color: 'yellow', h: 120 });
      const y = shape('Yes path', 760, 0, { color: 'blue' }), n = shape('No path', 480, 200, { color: 'red' }), e = shape('End', 1000, 0, { shape: 'pill', color: 'default', deco: 'fill' });
      return [heading('Flowchart', 0, -120), s, a, d, y, n, e, link(s, a), link(a, d), link(d, y, 'Yes'), link(d, n, 'No'), link(y, e)];
    },
  },
  {
    id: 'retro', title: 'Retrospective', description: 'What went well, what to improve, actions.', icon: 'rotate-ccw',
    build: () => {
      const cols: [string, ColorName][] = [['What went well', 'green'], ['What to improve', 'orange'], ['Actions', 'blue']];
      return [heading('Sprint retrospective', 0, -110), ...cols.flatMap(([t, c], i) => [
        section(t, i * 520, 0, 480, 640, c),
        sticky('Add a note', i * 520 + 32, 48, c === 'green' ? 'green' : c === 'orange' ? 'yellow' : 'blue'),
      ])];
    },
  },
  {
    id: 'kanban', title: 'Kanban board', description: 'To do, doing, done columns with cards.', icon: 'square-kanban',
    build: () => [heading('Kanban', 0, -110), ...['To do', 'Doing', 'Done'].flatMap((t, i) => [
      section(t, i * 380, 0, 340, 720, ['light-gray', 'blue', 'green'][i] as ColorName),
      ...[0, 1].map((j) => sticky(i === 0 ? `Task ${j + 1}` : '', i * 380 + 30, 48 + j * 184, ['yellow', 'blue', 'green'][i] as ColorName)),
    ])],
  },
  {
    id: 'journey', title: 'User journey', description: 'Stages with actions, thoughts and pain points.', icon: 'route',
    build: () => {
      const t = newTable([['', 'Discover', 'Sign up', 'First use', 'Habit'], ['Actions', '', '', '', ''], ['Thinking', '', '', '', ''], ['Pain points', '', '', '', ''], ['Ideas', '', '', '', '']], { x: 0, y: 0 }, z++);
      return [heading('User journey', 0, -110), { ...t, w: 1000, style: 'striped', headColor: 'whimsy-blue' }];
    },
  },
  {
    id: 'brainstorm', title: 'Brainstorm', description: 'A mind map to collect ideas around a topic.', icon: 'brain',
    build: () => [mindmapFromOutline('Topic\n  Idea A\n    Detail\n  Idea B\n  Idea C\n    Detail\n    Detail', { x: 0, y: 0 }, z++)],
  },
  {
    id: 'org', title: 'Org chart', description: 'A team structure, top down.', icon: 'network',
    build: () => [mindmapFromOutline('Head of team\n  Lead A\n    Member\n    Member\n  Lead B\n    Member\n  Lead C', { x: 0, y: 0 }, z++, 'vertical')],
  },
];

export const builtInTemplates = (): TemplateInfo[] => BUILT_IN.map(({ build: _b, ...info }) => info);
export const buildTemplate = (id: string): BoardObject[] | null => BUILT_IN.find((t) => t.id === id)?.build() ?? null;
