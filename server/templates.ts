import { all, newId as rowId, now, one, run } from './db.ts';
import { editBoard } from './collab.ts';
import { BadRequest, NotFound, getBoard } from './store.ts';
import { builtInTemplates, buildTemplate } from '../shared/templates.ts';
import { cloneObjects } from '../shared/clone.ts';
import { addObjects, maxZ, readObjects } from '../shared/doc.ts';
import { placeBatch } from '../shared/layout.ts';
import { isContainer, type BoardObject } from '../shared/model.ts';

export type TemplateRow = { id: string; title: string; description: string; icon: string; source: 'built-in' | 'workspace'; owner?: string; mine?: boolean };

export async function listTemplates(userId: string): Promise<TemplateRow[]> {
  const rows = await all<{ id: string; title: string; description: string; owner_id: string; name: string }>(
    'SELECT t.id, t.title, t.description, t.owner_id, u.name FROM templates t JOIN users u ON u.id = t.owner_id ORDER BY t.created_at DESC');
  return [
    ...rows.map((r) => ({ id: `ws:${r.id}`, title: r.title, description: r.description, icon: 'layout-template', source: 'workspace' as const, owner: r.name, mine: r.owner_id === userId })),
    ...builtInTemplates().map((t) => ({ ...t, id: `builtin:${t.id}`, source: 'built-in' as const })),
  ];
}

// Fresh objects (new ids) for a template.
export async function templateObjects(id: string): Promise<BoardObject[]> {
  if (id.startsWith('builtin:')) {
    const objs = buildTemplate(id.slice(8));
    if (!objs) throw new NotFound(`No template ${id}`);
    return objs;
  }
  const row = await one<{ data: string }>('SELECT data FROM templates WHERE id = $1', id.replace(/^ws:/, ''));
  if (!row) throw new NotFound(`No template ${id}`);
  const objs = JSON.parse(row.data) as BoardObject[];
  return cloneObjects(objs, new Map(objs.map((o) => [o.id, o])), 0, 0, 1);
}

export async function saveTemplate(userId: string, boardId: string, title: string, description = '') {
  if (!title?.trim()) throw new BadRequest('A template needs a title');
  await getBoard(userId, boardId);
  const objs = await editBoard(boardId, (doc) => readObjects(doc));
  if (!objs.length) throw new BadRequest('The board is empty');
  const id = rowId();
  await run('INSERT INTO templates (id, title, description, owner_id, data, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    id, title.trim(), description.trim(), userId, JSON.stringify(objs), now());
  return { id: `ws:${id}` };
}

export async function deleteTemplate(userId: string, id: string) {
  if (!(await run('DELETE FROM templates WHERE id = $1 AND owner_id = $2', id.replace(/^ws:/, ''), userId))) throw new NotFound('No template of yours with that id');
}

// Add a template's objects to a board, right of its content.
export async function applyTemplate(boardId: string, templateId: string) {
  const objs = await templateObjects(templateId);
  return editBoard(boardId, (doc) => {
    const z0 = maxZ(doc) + 1;
    const placed = placeBatch(objs.map((o, i) => ({ ...o, z: isContainer(o) ? o.z : z0 + i })), readObjects(doc));
    addObjects(doc, placed, 'template');
    return placed.length;
  });
}
