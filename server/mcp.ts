import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { userByEmail, type User } from './auth.ts';
import { notify } from './inbox.ts';
import { boardJson, copyToDrive, shareDriveCopy } from './drive.ts';
import { renderBoardPng } from './render.ts';
import { blocksOf, docTools } from './docs.ts';
import { toMermaid } from '../shared/mermaidOut.ts';
import * as store from './store.ts';
import { editBoard, isOpen } from './collab.ts';
import { addChild, deleteNode, indentNode, mindmapFromOutline, outdentNode, setNode, toOutline } from '../shared/mindmapOps.ts';
import { newTable, parseMarkdownTable, toMarkdown } from '../shared/tableOps.ts';
import { saveImage } from './files.ts';
import { createThread, reply } from './comments.ts';
import { applyTemplate, listTemplates } from './templates.ts';
import { unfurl } from './unfurl.ts';
import { readThreads } from '../shared/comments.ts';
import { addObjects, deleteObjects, maxZ, objectsOf, pendingOf, readObjects, updateObjects, type Patch } from '../shared/doc.ts';
import { fromExcalidraw } from '../shared/excalidraw.ts';
import { placeBatch } from '../shared/layout.ts';
import { buildWireframe } from '../shared/wireframe.ts';
import { describeChange, layoutStacks, logActivity, stackCards } from '../shared/tasks.ts';
import { listUsers } from './comments.ts';
import { boardUrl, docUrl, internalLink } from './tasks.ts';
import { COLOR_NAMES, DEFAULTS, DEVICES, FONT_SIZE_STEPS, SECTION_Z, STACK_Z, TASK_H, TASK_SIZES, type StackObj, type TaskObj, SHAPES, SHAPE_SIZE, WF_KINDS, WF_SIZES, cellKey, kebab, newId, type BoardObject, type End, type MindmapObj } from '../shared/model.ts';


const INSTRUCTIONS = `pragmatic is a diagram workspace, modelled on Whimsical. Boards hold shapes, text, sticky notes, sections, images and connectors.
Workflows:
- Flowcharts and sequence diagrams from a description -> add_mermaid. Mind maps -> add_mindmap. Task boards, backlogs and kanban -> add_tasks, update_task. Free layouts, architecture diagrams, sticky-note boards -> add_objects. UI wireframes and screen mockups -> add_wireframe.
- Screenshot of a diagram: read the image yourself, then rebuild it as editable content (add_mermaid, add_mindmap or add_objects). Use add_image only when the user wants the picture itself on the board.
- Import from Whimsical: read with the Whimsical MCP tools (flowchart_read, mindmap_read, board_read), then rebuild here.
- Import an .excalidraw file: import_excalidraw.
Pick or create a board first (list_items, search, create_board) and give the user the board URL.
Edits appear live in open tabs. Mermaid needs an open pragmatic tab to lay out; read_board shows how many Mermaid requests still wait.`;

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));
const pos = { x: z.number().optional().describe('Left edge. Default: right of the current content.'), y: z.number().optional() };

const objectFields = {
  shape: z.enum(SHAPES).optional().describe('For type shape. Default rect.'),
  x: z.number().optional(), y: z.number().optional(), w: z.number().optional(), h: z.number().optional(),
  text: z.string().optional().describe('Text of a shape, sticky or text; label of a connector; title of a section'),
  color: z.enum(COLOR_NAMES).optional(),
  deco: z.enum(['fill', 'outline', 'dash', 'transparent', 'multicolor']).optional().describe('Shapes: fill = solid color, outline = tinted with border, dash, transparent. Icons: multicolor, fill, outline'),
  font_size: z.enum(FONT_SIZE_STEPS).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  from_id: z.string().optional().describe('Connector start: id of an object in this batch or on the board'),
  to_id: z.string().optional().describe('Connector end'),
  from_side: z.enum(['top', 'right', 'bottom', 'left']).optional(), to_side: z.enum(['top', 'right', 'bottom', 'left']).optional(),
  route: z.enum(['elbow', 'straight', 'curved']).optional(),
  start_cap: z.enum(['none', 'arrow']).optional(), end_cap: z.enum(['none', 'arrow']).optional(),
  dash: z.boolean().optional(),
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional().describe('Shapes and icons: turn the outline (text stays upright)'),
};
// Fields of wireframe components and frames, for add_wireframe and update_objects.
const wfFields = {
  size: z.enum(WF_SIZES).optional().describe('Component size, default m'),
  state: z.enum(['normal', 'focused', 'error', 'disabled', 'selected']).optional().describe('selected turns a toggle on'),
  label: z.string().optional().describe('Label above an input, textarea, dropdown, checkbox/radio list, slider, progress or rating'),
  pos: z.number().min(0).max(1).optional().describe('Value of a slider, progress bar or rating (0 to 1)'),
  arrow: z.enum(['top', 'right', 'bottom', 'left']).optional().describe('Tooltip arrow side'),
  shape_type: z.enum(['rect', 'ellipse', 'pill']).optional().describe('For kind shape'),
};
const frameFields = {
  device: z.enum(Object.keys(DEVICES) as [keyof typeof DEVICES]).optional().describe('Frames only'),
  status_bar: z.boolean().optional(), keyboard: z.boolean().optional(),
};
const WF_TEXT_HELP = 'Button, link, tag, tooltip, annotation: the caption. Input, textarea, dropdown: the placeholder or value. Checkbox, radio, tabs: one item per line; "* " before the checked or selected item.';
// Lucide icon names in kebab-case, loaded once on first use.
let iconNames: Set<string> | null = null;
async function icons() {
  if (!iconNames) {
    const { icons: all } = await import('lucide-react');
    iconNames = new Set(Object.keys(all).map(kebab));
  }
  return iconNames;
}
// Every icon name in a call must exist (a shape's icon too), or Claude draws a "?" without knowing.
async function checkIcons(names: (string | undefined)[]) {
  const want = names.filter((n): n is string => !!n);
  if (!want.length) return;
  const all = await icons();
  for (const n of want) if (!all.has(n)) throw new Error(`Unknown icon "${n}". Use search_icons.`);
}

const objectInput = z.object({
  type: z.enum(['shape', 'text', 'sticky', 'section', 'icon', 'connector']),
  icon: z.string().optional().describe('For type icon: a name from search_icons, for example "circle-check". For a shape: an icon left of its text'),
  id: z.string().optional().describe('Your own id, so connectors in the same batch can refer to it'),
  ...objectFields,
});
type ObjectInput = z.infer<typeof objectInput>;
type WfInput = z.infer<z.ZodObject<typeof wfFields & typeof frameFields>>;

// Agent-facing names -> stored fields.
function fieldsOf(i: Partial<Omit<ObjectInput, 'type' | 'deco'> & WfInput> & { type?: string; deco?: string }) {
  const f: Record<string, unknown> = {};
  for (const k of ['shape', 'icon', 'x', 'y', 'w', 'h', 'color', 'deco', 'align', 'route', 'dash', 'rotate', 'size', 'state', 'label', 'pos', 'arrow', 'device', 'keyboard'] as const) if (i[k] !== undefined) f[k] = i[k];
  if (i.shape_type) f.shapeType = i.shape_type;
  if (i.status_bar !== undefined) f.statusBar = i.status_bar;
  if (i.font_size) f.fontSize = i.font_size;
  if (i.start_cap) f.startCap = i.start_cap;
  if (i.end_cap) f.endCap = i.end_cap;
  if (i.text !== undefined) f[i.type === 'section' || i.type === 'frame' ? 'title' : 'text'] = i.text;
  return f;
}

export function build(inputs: ObjectInput[], existing: Set<string>, z0: number): { objs: BoardObject[]; ids: Record<string, string> } {
  const ids: Record<string, string> = {};
  for (const i of inputs) if (i.id && i.type !== 'connector') ids[i.id] = newId();
  const ref = (r: string) => {
    if (ids[r]) return ids[r];
    if (existing.has(r)) return r;
    throw new Error(`Unknown object id "${r}": not in this batch and not on the board`);
  };
  let z = z0;
  const objs = inputs.map((i): BoardObject => {
    const f = fieldsOf(i);
    if (i.type === 'connector') {
      if ((!i.from_id && (i.x === undefined || i.y === undefined)) || (!i.to_id && (i.w === undefined || i.h === undefined)))
        throw new Error('A connector needs from_id and to_id, or free ends: x,y for the start and x+w,y+h for the end');
      const from: End = i.from_id ? { id: ref(i.from_id), side: i.from_side } : { x: i.x, y: i.y };
      const to: End = i.to_id ? { id: ref(i.to_id), side: i.to_side } : { x: (i.x ?? 0) + (i.w ?? 0), y: (i.y ?? 0) + (i.h ?? 0) };
      const { x: _x, y: _y, w: _w, h: _h, ...rest } = f;
      return { ...DEFAULTS.connector, ...rest, id: newId(), z: z++, type: 'connector', from, to } as BoardObject;
    }
    if (i.type === 'icon' && !i.icon) throw new Error('An icon needs an icon name (see search_icons)');
    const size = i.type === 'shape' ? SHAPE_SIZE[i.shape ?? 'rect'] ?? DEFAULTS.shape : DEFAULTS[i.type];
    return {
      ...DEFAULTS[i.type], ...(i.type === 'shape' ? { shape: 'rect' } : {}), ...(i.type === 'sticky' ? { author: '' } : {}),
      x: 0, y: 0, w: size.w, h: size.h, ...f,
      id: (i.id && ids[i.id]) || newId(), z: i.type === 'section' ? SECTION_Z + z++ : z++, type: i.type,
    } as BoardObject;
  });
  return { objs, ids };
}

type Person = { id: string; name: string; email: string };
// An assignee by email or name, among people who have signed in to pragmatic (`people`, from listUsers).
function personOf(who: string, people: Person[]): Person {
  const q = who.trim().toLowerCase();
  const hits = people.filter((p) => p.email.toLowerCase() === q || p.name.toLowerCase() === q);
  if (hits.length !== 1) throw new Error(hits.length ? `"${who}" matches several people; use the email` : `Nobody called "${who}" has signed in to pragmatic yet`);
  return hits[0];
}
const namer = (people: Person[]) => (id: string) => people.find((p) => p.id === id)?.name ?? 'someone';

function describe(o: BoardObject, nameOf: (id: string) => string) {
  if (o.type === 'connector') {
    const end = (e: End) => e.id ?? `(${Math.round(e.x!)},${Math.round(e.y!)})`;
    return { id: o.id, type: o.type, from: end(o.from), to: end(o.to), ...(o.text ? { text: o.text } : {}), route: o.route };
  }
  const d: Record<string, unknown> = { id: o.id, type: o.type, x: Math.round(o.x), y: Math.round(o.y), w: Math.round(o.w), h: Math.round(o.h) };
  if (o.type === 'shape') Object.assign(d, { shape: o.shape, deco: o.deco });
  if ('color' in o) d.color = o.color;
  if ('text' in o && o.text) d.text = o.text;
  if (o.type === 'section' || o.type === 'stack') d.title = o.title;
  if (o.type === 'task') Object.assign(d, { title: o.title, size: o.size }, o.desc ? { description: o.desc } : {}, o.assignee ? { assignee: nameOf(o.assignee) } : {},
    o.tags?.length ? { tags: o.tags } : {}, o.stack ? { stack_id: o.stack } : {});
  if (o.type === 'frame') Object.assign(d, { device: o.device, title: o.title });
  if (o.type === 'wf') Object.assign(d, { kind: o.kind, size: o.size, state: o.state, deco: o.deco }, o.label ? { label: o.label } : {}, o.pos !== undefined ? { pos: o.pos } : {}, o.icon ? { icon: o.icon } : {});
  if (o.type === 'image') d.src = o.src;
  if (o.type === 'icon') d.icon = o.icon;
  if (o.type === 'mindmap') d.outline = toOutline(o, true);
  if (o.type === 'table') Object.assign(d, { markdown: toMarkdown(o), style: o.style });
  if (o.type === 'draw') d.stroke = o.highlight ? 'highlighter' : 'marker';
  if (o.type === 'link') Object.assign(d, { url: o.url, title: o.title });
  return d;
}

const live = (id: string) => (isOpen(id) ? 'shown live in the open board' : 'saved; shown when the board is opened');

export function createMcpServer(user: User) {
  const server = new McpServer({ name: 'pragmatic', version: '0.2.0' }, { instructions: INSTRUCTIONS });
  const tool = <S extends z.ZodRawShape>(name: string, description: string, schema: S, fn: (a: z.infer<z.ZodObject<S>>) => unknown) =>
    // The SDK's callback type is tied to its own zod build; the args are validated at runtime either way.
    server.registerTool(name, { description, inputSchema: schema }, (async (args: z.infer<z.ZodObject<S>>) => {
      try {
        const r = await fn(args);
        if (r && typeof r === 'object' && 'content' in r) return r; // already MCP content (images)
        return typeof r === 'string' ? text(r) : json(r);
      } catch (err) {
        return { ...text(`Error: ${(err as Error).message}`), isError: true };
      }
    }) as never);
  const board = async (id: string, need: store.Role = 'view') => (await store.getBoard(user.id, id, need)).id;
  // Board edits by this user's Claude session, credited in the time machine. They need edit access.
  const edit = async <T,>(id: string, fn: (doc: Parameters<Parameters<typeof editBoard>[1]>[0]) => T) => {
    await board(id, 'edit');
    return editBoard(id, fn, { id: user.id, name: `${user.name} (Claude)` });
  };

  tool('list_items', 'List folders and boards the user can see (private and team), as a flat list with parent ids.', {}, async () =>
    (await store.listItems(user.id)).map(({ id, kind, title, parent_id, scope }) => ({ id, kind, title, parent_id, scope, url: kind === 'board' ? boardUrl(id) : kind === 'doc' ? docUrl(id) : undefined })));

  tool('search', 'Find boards and folders by title or by text on the board.', { query: z.string() }, async ({ query }) =>
    (await store.search(user.id, query)).map(({ id, kind, title }) => ({ id, kind, title, url: kind === 'doc' ? docUrl(id) : boardUrl(id) })));

  tool('create_board', 'Create a board, empty or from a template (see list_templates). Returns its id and URL.', {
    title: z.string(), folder_id: z.string().optional(), scope: z.enum(['private', 'team']).optional().describe('Default private. Ignored inside a folder.'),
    template: z.string().optional().describe('Template id, for example builtin:retro'),
  }, async ({ title, folder_id, scope, template }) => {
    const b = await store.createItem(user.id, { kind: 'board', title, parent_id: folder_id, scope });
    if (template) await applyTemplate(b.id, template);
    return { id: b.id, url: boardUrl(b.id), scope: b.scope };
  });

  tool('create_doc', 'Create a doc (rich text: headings, lists, checklists, code, quotes, tables), optionally with Markdown content. Returns its id and URL.', {
    title: z.string(), markdown: z.string().optional(), folder_id: z.string().optional(), scope: z.enum(['private', 'team']).optional(),
  }, async ({ title, markdown, folder_id, scope }) => {
    const d = await store.createItem(user.id, { kind: 'doc', title, parent_id: folder_id, scope });
    if (markdown) {
      const t = await docTools(), add = await t.parse(markdown);
      await editBoard(d.id, (doc) => t.write(doc, blocksOf(doc), add, 'replace', 'mcp'), { id: user.id, name: `${user.name} (Claude)` });
    }
    return { id: d.id, url: docUrl(d.id), scope: d.scope };
  });

  tool('read_doc', 'Read a doc as Markdown.', { doc_id: z.string() }, async ({ doc_id }) => {
    const d = await store.getBoard(user.id, doc_id);
    const t = await docTools();
    return `# ${d.title}\n\n${await editBoard(d.id, (doc) => t.toMarkdown(blocksOf(doc)))}`;
  });

  tool('write_doc', 'Add Markdown to the end of a doc (mode append, default) or replace all of its content (mode replace).', {
    doc_id: z.string(), markdown: z.string(), mode: z.enum(['append', 'replace']).optional(),
  }, async ({ doc_id, markdown, mode }) => {
    const id = await board(doc_id, 'edit');
    const t = await docTools(), add = await t.parse(markdown);
    const blocks = await editBoard(id, (doc) => t.write(doc, blocksOf(doc), add, mode ?? 'append', 'mcp'), { id: user.id, name: `${user.name} (Claude)` });
    return { blocks, url: docUrl(id), status: live(id) };
  });

  tool('list_templates', 'List board templates: built-in ones and the workspace\'s saved templates.', {}, async () =>
    (await listTemplates(user.id)).map(({ id, title, description, source }) => ({ id, title, description, source })));

  tool('create_folder', 'Create a folder.', {
    title: z.string(), parent_id: z.string().optional(), scope: z.enum(['private', 'team']).optional(),
  }, ({ title, parent_id, scope }) => store.createItem(user.id, { kind: 'folder', title, parent_id, scope }));

  tool('read_board', 'Read every object on a board: id, type, position, size, text, color; connectors with their from/to ids.', {
    board_id: z.string(),
  }, async ({ board_id }) => {
    const item = await store.getBoard(user.id, board_id), nameOf = namer(await listUsers());
    return editBoard(item.id, (doc) => ({
      title: item.title, url: boardUrl(item.id), waiting_mermaid: pendingOf(doc).size, objects: readObjects(doc).map((o) => describe(o, nameOf)),
    }));
  });

  tool('add_objects', `Add shapes, text, sticky notes, sections and connectors in one batch. Coordinates are relative within the batch; the batch goes right of the existing content unless x/y are given.
Shapes: ${SHAPES.join(', ')}. Colors: ${COLOR_NAMES.join(', ')}. Font sizes: ${FONT_SIZE_STEPS.join(', ')}.
Connectors bind to objects (from_id/to_id) and route themselves; default route elbow with an arrow at the end.`, {
    board_id: z.string(), objects: z.array(objectInput).min(1), ...pos,
  }, async ({ board_id, objects, x, y }) => {
    await checkIcons(objects.map((o) => o.icon));
    return edit(board_id, (doc) => {
    const existing = readObjects(doc);
    const { objs, ids } = build(objects, new Set(existing.map((o) => o.id)), maxZ(doc) + 1);
    const placed = placeBatch(objs, existing, { x, y });
    addObjects(doc, placed, 'mcp');
    return { added: placed.length, ids, url: boardUrl(board_id), status: live(board_id) };
    });
  });

  tool('search_icons', 'Find icon names for add_objects (type icon). Returns up to 40 matches.', { query: z.string() }, async ({ query }) => {
    const q = query.toLowerCase().trim();
    return [...await icons()].filter((n) => n.includes(q)).slice(0, 40);
  });

  tool('update_objects', 'Change objects by id: text, color, style, position, size, connector ends and style. Only the given fields change.', {
    board_id: z.string(),
    updates: z.array(z.object({ id: z.string(), ...objectFields, deco: z.enum(['fill', 'outline', 'dash', 'dashes', 'transparent', 'multicolor']).optional(), ...wfFields, ...frameFields,
      icon: z.string().optional().describe('A name from search_icons (icons, shapes, wireframe components)') })).min(1),
  }, async ({ board_id, updates }) => {
    await checkIcons(updates.map((u) => u.icon));
    return edit(board_id, (doc) => {
    const map = objectsOf(doc);
    const patches: Patch[] = updates.map((u) => {
      const current = map.get(u.id);
      if (!current) throw new Error(`No object ${u.id} on this board`);
      const type = current.get('type') as BoardObject['type'];
      const f = fieldsOf({ ...u, type });
      if (type === 'connector') {
        delete f.x; delete f.y; delete f.w; delete f.h;
        for (const [key, id, side] of [['from', u.from_id, u.from_side], ['to', u.to_id, u.to_side]] as const) {
          if (!id && !side) continue;
          if (id && !map.has(id)) throw new Error(`No object ${id} on this board`);
          f[key] = id ? { id, side } : { ...(current.get(key) as End), side };
        }
      }
      return { id: u.id, ...f };
    });
    updateObjects(doc, patches, 'mcp');
    return { updated: patches.length, status: live(board_id) };
    });
  });

  const taskInput = {
    title: z.string(), description: z.string().optional(),
    assignee: z.string().optional().describe('Email or name of someone who has signed in to pragmatic'),
    tags: z.array(z.string()).optional(), color: z.enum(COLOR_NAMES).optional().describe('Default blue'), size: z.enum(TASK_SIZES).optional().describe('xs, s, m (default), l'),
  };
  tool('add_tasks', `Add task cards. Put them in a new stack (stack_title), an existing stack (stack_id), or loose on the board in a grid.
Stacks are columns of cards, like a kanban column. Cards record who made them in their activity log.`, {
    board_id: z.string(), tasks: z.array(z.object(taskInput)).min(1),
    stack_title: z.string().optional(), stack_color: z.enum(COLOR_NAMES).optional(), stack_id: z.string().optional(), ...pos,
  }, async ({ board_id, tasks, stack_title, stack_color, stack_id, x, y }) => {
    const everyone = await listUsers();
    const people = tasks.map((t) => (t.assignee ? personOf(t.assignee, everyone).id : undefined));
    const by = `${user.name} (Claude)`;
    return edit(board_id, (doc) => {
      const existing = readObjects(doc);
      let z0 = maxZ(doc) + 1;
      const old = stack_id ? existing.find((o): o is StackObj => o.id === stack_id && o.type === 'stack') : undefined;
      if (stack_id && !old) throw new Error(`No stack ${stack_id} on this board`);
      const fresh: StackObj | undefined = !old && stack_title !== undefined
        ? { ...DEFAULTS.stack, id: newId(), z: STACK_Z + z0, type: 'stack', title: stack_title, color: stack_color ?? DEFAULTS.stack.color, x: 0, y: 0 } : undefined;
      const stack = old ?? fresh;
      const after = stack ? Math.max(0, ...stackCards(stack.id, existing).map((c) => c.order ?? 0)) : 0;
      const cards = tasks.map((t, i): TaskObj => {
        const size = t.size ?? 'm';
        return {
          ...DEFAULTS.task, id: newId(), z: z0++, type: 'task', title: t.title, color: t.color ?? DEFAULTS.task.color, size, h: TASK_H[size],
          x: stack ? 0 : (i % 4) * (DEFAULTS.task.w + 24), y: stack ? 0 : Math.floor(i / 4) * (TASK_H.l + 24),
          watch: [user.id], ...(t.description && { desc: t.description }), ...(people[i] && { assignee: people[i] }), ...(t.tags?.length && { tags: t.tags }),
          ...(stack && { stack: stack.id, order: after + i + 1 }),
        };
      });
      // A new stack and loose cards are placed as a batch; cards for an existing stack go where the stack is.
      // A new stack lines up right of the last stack, like the next kanban column.
      const last = fresh && x === undefined && y === undefined
        ? existing.filter((o): o is StackObj => o.type === 'stack').sort((a, b) => b.x + b.w - (a.x + a.w))[0] : undefined;
      const at = last ? { x: last.x + last.w + 24, y: last.y } : { x, y };
      const batch: BoardObject[] = old ? cards : placeBatch([...(fresh ? [fresh] : []), ...cards], existing, at);
      addObjects(doc, batch, 'mcp');
      for (const c of cards) logActivity(doc, c.id, by, 'created the card');
      const layout = layoutStacks(readObjects(doc));
      if (layout.length) updateObjects(doc, layout, 'mcp');
      return { stack_id: stack?.id, ids: batch.filter((o) => o.type === 'task').map((c) => c.id), url: boardUrl(board_id), status: live(board_id) };
    });
  });

  tool('update_task', 'Change a task card: title, description, assignee ("" to unassign), tags (the full list), color, size, or stack_id ("" to take it out of its stack).', {
    board_id: z.string(), task_id: z.string(),
    title: z.string().optional(), description: z.string().optional(), assignee: z.string().optional(), tags: z.array(z.string()).optional(),
    color: z.enum(COLOR_NAMES).optional(), size: z.enum(TASK_SIZES).optional(), stack_id: z.string().optional(),
  }, async ({ board_id, task_id, title, description, assignee, tags, color, size, stack_id }) => {
    const everyone = await listUsers(), nameOf = namer(everyone);
    const who = assignee ? personOf(assignee, everyone).id : undefined;
    return edit(board_id, (doc) => {
      const objs = readObjects(doc), card = objs.find((o) => o.id === task_id);
      if (card?.type !== 'task') throw new Error(`No task card ${task_id} on this board`);
      const stack = stack_id ? objs.find((o): o is StackObj => o.id === stack_id && o.type === 'stack') : undefined;
      if (stack_id && !stack) throw new Error(`No stack ${stack_id} on this board`);
      const patch: Partial<TaskObj> = {
        ...(title !== undefined && { title }), ...(description !== undefined && { desc: description || undefined }),
        ...(assignee !== undefined && { assignee: who }), ...(tags && { tags }), ...(color && { color }), ...(size && { size, h: TASK_H[size] }),
        ...(stack_id !== undefined && { stack: stack?.id, order: stack ? Math.max(0, ...stackCards(stack.id, objs).map((c) => c.order ?? 0)) + 1 : undefined }),
      };
      for (const w of describeChange(card, patch, nameOf, (id) => (objs.find((o) => o.id === id) as StackObj | undefined)?.title || 'a stack')) logActivity(doc, task_id, `${user.name} (Claude)`, w);
      updateObjects(doc, [{ id: task_id, ...patch }], 'mcp');
      const layout = layoutStacks(readObjects(doc));
      if (layout.length) updateObjects(doc, layout, 'mcp');
      return { updated: true, status: live(board_id) };
    });
  });

  tool('add_wireframe', `Add a UI wireframe: an optional device frame with components on its screen.
Kinds: ${WF_KINDS.join(', ')}. Devices: ${Object.keys(DEVICES).join(', ')}.
Component x/y are relative to the frame's screen (below the status bar). Leave them out and components stack top to bottom with full-width fields.
Several screens: call once per screen; frames line up to the right unless x/y are given. Connect screens with add_objects connectors (from_id/to_id).`, {
    board_id: z.string(),
    device: frameFields.device.describe('Leave out for components without a frame'),
    title: z.string().optional().describe('Frame title, shown above it'),
    landscape: z.boolean().optional(),
    components: z.array(z.object({
      kind: z.enum(WF_KINDS),
      text: z.string().optional().describe(WF_TEXT_HELP),
      x: z.number().optional(), y: z.number().optional(), w: z.number().optional(), h: z.number().optional(),
      color: z.enum(COLOR_NAMES).optional(), deco: z.enum(['fill', 'outline', 'dashes']).optional(),
      icon: z.string().optional().describe('Icon name from search_icons, for buttons, inputs, tags, links and placeholders'),
      ...wfFields,
    })).default([]),
    ...pos,
  }, async ({ board_id, device, title, landscape, components, x, y }) => {
    await checkIcons(components.map((c) => c.icon));
    if (!device && !components.length) throw new Error('Give a device, components, or both');
    return edit(board_id, (doc) => {
      const objs = buildWireframe({ device, title, landscape, components: components.map((c) => ({ kind: c.kind, ...fieldsOf(c) })) }, maxZ(doc) + 1);
      const placed = placeBatch(objs, readObjects(doc), { x, y });
      addObjects(doc, placed, 'mcp');
      return { frame_id: device ? placed[0].id : undefined, ids: placed.slice(device ? 1 : 0).map((o) => o.id), url: boardUrl(board_id), status: live(board_id) };
    });
  });

  tool('share_board', `Share a board on demand. Give a colleague (email in the workspace domain) a role: edit, comment or view; "none" removes them.
link_access sets the role for anyone in the workspace who has the link (none by default). Only the owner and editors can share.`, {
    board_id: z.string(), email: z.string().optional(), role: z.enum(['edit', 'comment', 'view', 'none']).optional(),
    link_access: z.enum(['none', 'view', 'comment', 'edit']).optional(),
    drive_copy: z.boolean().optional().describe('Also put a copy (PNG + JSON) in your Google Drive and share it view-only with the person'),
  }, async ({ board_id, email, role, link_access, drive_copy }) => {
    const id = await board(board_id, 'edit');
    if (email) {
      if (!role) throw new Error('Give a role for the person');
      const target = await userByEmail(email);
      if (await store.share(user.id, id, target.id, role)) await notify({ user: target.id, kind: 'share', board: id, actor: { id: user.id, name: user.name }, text: role });
    }
    if (link_access) await store.setLinkAccess(user.id, id, link_access);
    const drive_link = drive_copy && email && role !== 'none' ? await shareDriveCopy(user.id, id, email) : undefined;
    const s = await store.shares(user.id, id);
    return { url: boardUrl(id), link_access: s.link_access, people: s.members.map((m) => ({ email: m.email, role: m.role })), drive_link };
  });

  tool('export_board', 'Export a whole board: png (an image you can look at or pass on), json (all objects and comments), or mermaid (flowchart text).', {
    board_id: z.string(), format: z.enum(['png', 'json', 'mermaid']), scale: z.number().min(1).max(4).optional().describe('png only, default 2'),
  }, async ({ board_id, format, scale }) => {
    const item = await store.getBoard(user.id, board_id);
    if (format === 'json') return boardJson(item.id, item.title);
    if (format === 'mermaid') return editBoard(item.id, (doc) => toMermaid(readObjects(doc)));
    const png = await renderBoardPng(item.id, user.id, scale ?? 2);
    if (!png) throw new Error('The board is empty');
    return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }, { type: 'text', text: `${item.title} (${boardUrl(item.id)})` }] };
  });

  tool('copy_to_drive', 'Save a copy of a board (PNG + JSON) in your Google Drive, in the "pragmatic" folder. Needs Google Drive connected in pragmatic.', {
    board_id: z.string(),
  }, async ({ board_id }) => {
    const item = await store.getBoard(user.id, board_id);
    const f = await copyToDrive(user.id, item.id, item.title);
    return { drive_link: f?.webViewLink ?? null, board_url: boardUrl(item.id) };
  });

  tool('delete_objects', 'Delete objects by id. Connectors attached to deleted objects are deleted too.', {
    board_id: z.string(), ids: z.array(z.string()).min(1),
  }, ({ board_id, ids }) => edit(board_id, (doc) => ({ deleted: deleteObjects(doc, ids, 'mcp') })));

  tool('add_mindmap', 'Add a live mind map from an indented outline, one node per line, one root. Two spaces per level, "- " bullets allowed.', {
    board_id: z.string(), outline: z.string(), layout: z.enum(['horizontal', 'vertical']).optional(), ...pos,
  }, ({ board_id, outline, layout, x, y }) => edit(board_id, (doc) => {
    const [placed] = placeBatch([mindmapFromOutline(outline, { x: 0, y: 0 }, maxZ(doc) + 1, layout)], readObjects(doc), { x, y });
    addObjects(doc, [placed], 'mcp');
    return { id: placed.id, outline: toOutline(placed as MindmapObj, true), url: boardUrl(board_id), status: live(board_id) };
  }));

  tool('edit_mindmap', 'Change nodes of a mind map: add, rename, delete, color, icon, indent (become a child of the node above), outdent (move up a level). Node ids are shown in [brackets] by read_board and add_mindmap.', {
    board_id: z.string(), mindmap_id: z.string(),
    ops: z.array(z.object({
      op: z.enum(['add', 'rename', 'delete', 'color', 'icon', 'indent', 'outdent']),
      node: z.string().describe('add: the parent node; others: the node to change'),
      text: z.string().optional(), color: z.enum(COLOR_NAMES).optional(),
      icon: z.string().optional().describe('For op icon: a name from search_icons; "" removes the icon'),
    })).min(1),
  }, async ({ board_id, mindmap_id, ops }) => {
    await checkIcons(ops.map((o) => (o.op === 'icon' ? o.icon : undefined)));
    return edit(board_id, (doc) => {
    const added: string[] = [];
    // All ops run on a copy first and the board changes once at the end, so a failing op changes nothing
    // (Claude can fix the call and send it again without making duplicates). Each op sees the ones before it.
    let map = readObjects(doc).find((m) => m.id === mindmap_id);
    if (map?.type !== 'mindmap') throw new Error(`No mind map ${mindmap_id} on this board`);
    const total: Patch = { id: mindmap_id };
    for (const o of ops) {
      if (!map[`n.${o.node}`]) throw new Error(`No node ${o.node} in this mind map`);
      const patch = o.op === 'add' ? (() => { const r = addChild(map, o.node, o.text ?? ''); added.push(r.nodeId); return r.patch; })()
        : o.op === 'rename' ? setNode(map, o.node, { text: o.text ?? '' })
        : o.op === 'color' ? setNode(map, o.node, { color: o.color })
        : o.op === 'icon' ? setNode(map, o.node, { icon: o.icon || undefined })
        : o.op === 'indent' ? indentNode(map, o.node)
        : o.op === 'outdent' ? outdentNode(map, o.node)
        : deleteNode(map, o.node);
      if (!patch) throw new Error(o.op === 'delete' ? 'The root node cannot be deleted; delete the mind map with delete_objects' : o.op === 'indent' ? `${o.node} has no node above it to go under` : o.op === 'outdent' ? `${o.node} cannot move up a level` : `Cannot ${o.op} ${o.node}`);
      const { id: _, ...fields } = patch;
      Object.assign(total, fields);
      map = Object.fromEntries(Object.entries({ ...map, ...fields }).filter(([, v]) => v !== undefined)) as unknown as MindmapObj;
    }
    updateObjects(doc, [total], 'mcp');
    return { added, outline: toOutline(readObjects(doc).find((m) => m.id === mindmap_id) as MindmapObj, true), status: live(board_id) };
    });
  });

  tool('add_table', 'Add a table from a Markdown table. The first row is the header.', {
    board_id: z.string(), markdown: z.string(),
    style: z.enum(['plain', 'contrast', 'striped', 'none', 'filled']).optional(), head_color: z.enum(COLOR_NAMES).optional(), ...pos,
  }, ({ board_id, markdown, style, head_color, x, y }) => edit(board_id, (doc) => {
    const t = newTable(parseMarkdownTable(markdown), { x: 0, y: 0 }, maxZ(doc) + 1);
    if (style) t.style = style;
    if (head_color) t.headColor = head_color;
    const [placed] = placeBatch([t], readObjects(doc), { x, y });
    addObjects(doc, [placed], 'mcp');
    return { id: placed.id, url: boardUrl(board_id), status: live(board_id) };
  }));

  tool('update_table', 'Replace the content of a table with a Markdown table (rows and columns are rebuilt).', {
    board_id: z.string(), table_id: z.string(), markdown: z.string(),
  }, ({ board_id, table_id, markdown }) => edit(board_id, (doc) => {
    const old = readObjects(doc).find((o) => o.id === table_id);
    if (old?.type !== 'table') throw new Error(`No table ${table_id} on this board`);
    const fresh = newTable(parseMarkdownTable(markdown), old, old.z);
    const patch: Patch = { id: table_id, rows: fresh.rows, cols: fresh.cols, colW: {}, w: Math.max(old.w, fresh.w) };
    for (const r of old.rows) for (const c of old.cols) patch[cellKey(r, c)] = undefined;
    for (const [k, v] of Object.entries(fresh)) if (k.startsWith('c.')) patch[k] = v;
    updateObjects(doc, [patch], 'mcp');
    return { updated: true, status: live(board_id) };
  }));

  tool('add_mermaid', 'Add a Mermaid diagram as editable shapes and connectors. flowchart/graph and sequenceDiagram are converted; other types become a picture.', {
    board_id: z.string(), mermaid: z.string(), ...pos,
  }, ({ board_id, mermaid, x, y }) => edit(board_id, (doc) => {
    pendingOf(doc).set(newId(), JSON.stringify({ definition: mermaid, x, y, at: Date.now() }));
    return { queued: true, url: boardUrl(board_id), status: isOpen(board_id) ? 'drawn now by the open board' : 'drawn the next time someone opens the board' };
  }));

  tool('add_comment', 'Leave a comment on a board, on an object (object_id) or at a point (x, y). With thread_id, reply to that thread instead.', {
    board_id: z.string(), text: z.string(), object_id: z.string().optional(), thread_id: z.string().optional(), ...pos,
  }, async ({ board_id, text, object_id, thread_id, x, y }) => {
    const id = await board(board_id, 'comment');
    if (thread_id) return reply(id, thread_id, user, { text });
    if (object_id && !(await editBoard(id, (doc) => readObjects(doc).some((o) => o.id === object_id)))) throw new Error(`No object ${object_id} on this board`);
    return createThread(id, user, { text, anchor: object_id ? { objectId: object_id, x: x ?? 0, y: y ?? 0 } : { x: x ?? 0, y: y ?? 0 } });
  });

  tool('read_comments', 'Read the comment threads of a board.', {
    board_id: z.string(), include_resolved: z.boolean().optional(),
  }, async ({ board_id, include_resolved }) => editBoard(await board(board_id), (doc) => readThreads(doc)
    .filter((t) => include_resolved || !t.resolved)
    .map((t) => ({ id: t.id, on: t.anchor.objectId ?? `(${Math.round(t.anchor.x)},${Math.round(t.anchor.y)})`, resolved: t.resolved,
      messages: t.messages.map((m) => ({ by: m.author.name, text: m.text, at: new Date(m.at).toISOString() })) }))));

  tool('add_link', 'Add a link card (title read from the page) to a board.', {
    board_id: z.string(), url: z.string(), ...pos,
  }, async ({ board_id, url, x, y }) => {
    const id = await board(board_id), card = (await internalLink(user.id, url)) ?? await unfurl(url);
    return edit(id, (doc) => {
      const w = Math.min(420, Math.max(220, card.title.length * 9 + 80));
      const [o] = placeBatch([{ ...DEFAULTS.link, id: newId(), z: maxZ(doc) + 1, type: 'link', x: 0, y: 0, w, h: 44, ...card } as BoardObject], readObjects(doc), { x, y });
      addObjects(doc, [o], 'mcp');
      return { id: o.id, title: card.title, status: live(board_id) };
    });
  });

  tool('add_image', 'Place an image (for example a screenshot) on the board.', {
    board_id: z.string(), data_base64: z.string().describe('Image bytes, base64, no data: prefix'),
    mime_type: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
    width: z.number().optional().describe('Display width. Height keeps the aspect ratio.'), ...pos,
  }, async ({ board_id, data_base64, mime_type, width, x, y }) => {
    const id = await board(board_id);
    const img = saveImage(Buffer.from(data_base64, 'base64'), mime_type);
    const w = width ?? Math.min(img.width ?? 800, 960);
    const h = img.width && img.height ? (w * img.height) / img.width : w * 0.75;
    return edit(id, (doc) => {
      const [obj] = placeBatch([{ id: newId(), z: maxZ(doc) + 1, type: 'image', x: 0, y: 0, w, h, src: img.src }], readObjects(doc), { x, y });
      addObjects(doc, [obj], 'mcp');
      return { id: obj.id, src: img.src, url: boardUrl(board_id), status: live(board_id) };
    });
  });

  tool('import_excalidraw', 'Import an .excalidraw file (JSON with an "elements" array) into a board as editable objects.', {
    board_id: z.string(), excalidraw_json: z.string(), ...pos,
  }, ({ board_id, excalidraw_json, x, y }) => edit(board_id, (doc) => {
    const data = JSON.parse(excalidraw_json) as { elements?: Record<string, unknown>[] };
    if (!Array.isArray(data.elements)) throw new Error('JSON has no "elements" array');
    const placed = placeBatch(fromExcalidraw(data.elements, { z0: maxZ(doc) + 1 }), readObjects(doc), { x, y });
    addObjects(doc, placed, 'mcp');
    return { imported: placed.length, url: boardUrl(board_id) };
  }));

  return server;
}
