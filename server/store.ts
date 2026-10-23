import { all, newId, now, one, outsideTx, run, tx } from './db.ts';

export type Role = 'view' | 'comment' | 'edit' | 'owner';
export type Item = {
  id: string; kind: 'folder' | 'board' | 'doc'; title: string; parent_id: string | null;
  scope: 'private' | 'team'; owner_id: string; link_access: 'none' | Exclude<Role, 'owner'>; thumbnail: string | null;
  created_at: number; updated_at: number; deleted_at: number | null; role?: Role;
};

const cols = 'i.id, i.kind, i.title, i.parent_id, i.scope, i.owner_id, i.link_access, i.thumbnail, i.created_at, i.updated_at, i.deleted_at';
// Items with the user's share, if any. `u` is the placeholder of the user id, for example '$1'.
export const fromItems = (u: string) => `FROM items i LEFT JOIN shares s ON s.item_id = i.id AND s.user_id = ${u}`;
// A user lists all team items, their own private items, and items shared with them.
export const visible = (u: string) => `(i.scope = 'team' OR i.owner_id = ${u} OR s.user_id IS NOT NULL)`;
// The strongest of: owner, team member (edit), a personal share, and link access.
const roleOf = (u: string) => `(CASE WHEN i.owner_id = ${u} THEN 'owner'
  WHEN i.scope = 'team' OR s.role = 'edit' OR i.link_access = 'edit' THEN 'edit'
  WHEN s.role = 'comment' OR i.link_access = 'comment' THEN 'comment'
  WHEN s.role = 'view' OR i.link_access = 'view' THEN 'view' ELSE 'none' END)`;

const RANK: Record<Role | 'none', number> = { none: 0, view: 1, comment: 2, edit: 3, owner: 4 };
export const atLeast = (role: Role | 'none', need: Role) => RANK[role] >= RANK[need];
// Who may open a board changed (a share, link access, a move, the trash, a person removed). collab.ts re-checks the
// open live connections (recheckAccess).
export const hooks: { accessChanged?: () => Promise<void> } = {};
export const accessChanged = () => outsideTx(() => void hooks.accessChanged?.().catch((e) => console.error('access re-check failed', e)));
export class Forbidden extends Error {}
export class NotFound extends Error {}
export class BadRequest extends Error {}

export const listItems = (userId: string, trash = false) =>
  all<Item>(`SELECT ${cols}, ${roleOf('$1')} AS role ${fromItems('$1')}
    WHERE ${visible('$1')} AND i.deleted_at IS ${trash ? 'NOT ' : ''}NULL ORDER BY i.kind DESC, lower(i.title)`, userId);

export const recentBoards = (userId: string, limit = 30) =>
  all<Item>(`SELECT ${cols}, ${roleOf('$1')} AS role ${fromItems('$1')}
    WHERE ${visible('$1')} AND i.deleted_at IS NULL AND i.kind IN ('board', 'doc') ORDER BY i.updated_at DESC LIMIT $2`, userId, limit);

// An item the user may at least `need`. Without any access it does not exist for them.
export async function getItem(userId: string, id: string, need: Role = 'view'): Promise<Item> {
  const item = await one<Omit<Item, 'role'> & { role: Role | 'none' }>(`SELECT ${cols}, ${roleOf('$1')} AS role ${fromItems('$1')} WHERE i.id = $2`, userId, id);
  if (!item || item.role === 'none') throw new NotFound(`No item ${id}`);
  if (!atLeast(item.role, need)) throw new Forbidden(need === 'edit' ? 'You can only view or comment on this board' : need === 'comment' ? 'You can only view this board' : 'Only the owner can do this');
  return item as Item;
}

// The user's role on an item, or 'none'.
export const roleOn = async (userId: string, id: string): Promise<Role | 'none'> =>
  (await one<{ role: Role | 'none' }>(`SELECT ${roleOf('$1')} AS role ${fromItems('$1')} WHERE i.id = $2 AND i.deleted_at IS NULL`, userId, id))?.role ?? 'none';

export async function getBoard(userId: string, id: string, need: Role = 'view') {
  const item = await getItem(userId, id, need);
  // Boards and docs are both live documents (same sync, history, sharing and comments).
  if (item.kind === 'folder') throw new NotFound(`${id} is a folder, not a board or doc`);
  return item;
}

// --- stars ---------------------------------------------------------------------------
export async function setStar(userId: string, id: string, objectId: string, on: boolean) {
  await getItem(userId, id);
  if (on) await run('INSERT INTO stars (user_id, item_id, object_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', userId, id, objectId, now());
  else await run('DELETE FROM stars WHERE user_id = $1 AND item_id = $2 AND object_id = $3', userId, id, objectId);
}
// Starred items the person can still open, newest first. Card titles come from the caller (they live in the board).
export const stars = (userId: string) =>
  all<{ item_id: string; object_id: string; title: string; kind: Item['kind'] }>(`SELECT st.item_id, st.object_id, i.title, i.kind
    FROM stars st JOIN items i ON i.id = st.item_id LEFT JOIN shares s ON s.item_id = i.id AND s.user_id = $1
    WHERE st.user_id = $1 AND i.deleted_at IS NULL AND ${roleOf('$1')} <> 'none' ORDER BY st.created_at DESC`, userId);

// --- sharing ----------------------------------------------------------------------
export type Member = { user_id: string; name: string; email: string; picture: string | null; role: Exclude<Role, 'owner'> };
export async function shares(userId: string, id: string) {
  const item = await getItem(userId, id);
  const owner = await one('SELECT id, name, email, picture FROM users WHERE id = $1', item.owner_id);
  const members = await all<Member>(`SELECT s.user_id, u.name, u.email, u.picture, s.role FROM shares s JOIN users u ON u.id = s.user_id
    WHERE s.item_id = $1 ORDER BY lower(u.name)`, id);
  return { owner, members, link_access: item.link_access, scope: item.scope, role: item.role };
}

// Owner and editors share a board. Returns true when the person is new to the board.
export async function share(userId: string, id: string, targetId: string, role: Member['role'] | 'none') {
  const item = await getBoard(userId, id, 'edit');
  if (targetId === item.owner_id) throw new BadRequest('The owner always has full access');
  if (role === 'none') { await run('DELETE FROM shares WHERE item_id = $1 AND user_id = $2', id, targetId); accessChanged(); return false; }
  if (!['view', 'comment', 'edit'].includes(role)) throw new BadRequest('role must be view, comment, edit or none');
  // xmax = 0 only for a row this statement inserted (not updated).
  const r = await one<{ added: boolean }>(`INSERT INTO shares (item_id, user_id, role, by_id, created_at) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (item_id, user_id) DO UPDATE SET role = excluded.role RETURNING (xmax = 0) AS added`, id, targetId, role, userId, now());
  accessChanged(); // a lower role
  return r!.added;
}

export async function setLinkAccess(userId: string, id: string, access: Item['link_access']) {
  await getBoard(userId, id, 'edit');
  if (!['none', 'view', 'comment', 'edit'].includes(access)) throw new BadRequest('link access must be none, view, comment or edit');
  await run('UPDATE items SET link_access = $1 WHERE id = $2', access, id);
  accessChanged();
}

export async function createItem(userId: string, input: { kind: Item['kind']; title: string; parent_id?: string | null; scope?: Item['scope'] }) {
  if (!['folder', 'board', 'doc'].includes(input.kind)) throw new BadRequest('kind must be folder, board or doc');
  if (typeof input.title !== 'string') throw new BadRequest('title is required');
  let scope = input.scope ?? 'private';
  if (!['private', 'team'].includes(scope)) throw new BadRequest('scope must be private or team');
  if (input.parent_id) {
    const parent = await getItem(userId, input.parent_id, 'edit');
    if (parent.kind !== 'folder') throw new BadRequest('Parent must be a folder');
    scope = parent.scope; // children live in the parent's space
  }
  const id = newId();
  const t = now();
  await run('INSERT INTO items (id, kind, title, parent_id, scope, owner_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    id, input.kind, input.title.trim() || 'Untitled', input.parent_id ?? null, scope, userId, t, t);
  return getItem(userId, id);
}

const subtree = `WITH RECURSIVE t(id) AS (SELECT $1::text UNION ALL SELECT i.id FROM items i JOIN t ON i.parent_id = t.id)`;

export async function updateItem(userId: string, id: string, patch: { title?: string; parent_id?: string | null; thumbnail?: string | null }) {
  const item = await tx(async () => {
    const item = await getItem(userId, id, 'edit');
    if (patch.thumbnail !== undefined) {
      if (patch.thumbnail !== null && !/^\/files\/[a-f0-9]{32}\.(png|jpg|gif|webp)$/.test(patch.thumbnail)) throw new BadRequest('thumbnail must be an uploaded image');
      await run('UPDATE items SET thumbnail = $1 WHERE id = $2', patch.thumbnail, id);
      if (patch.title === undefined && patch.parent_id === undefined) return getItem(userId, id);
    }
    if (patch.parent_id !== undefined && item.owner_id !== userId && item.scope !== 'team') throw new Forbidden('Only the owner can move a shared board');
    let scope = item.scope;
    if (patch.parent_id) {
      for (let p: string | null = patch.parent_id; p; p = (await getItem(userId, p)).parent_id)
        if (p === id) throw new BadRequest('Cannot move a folder into itself');
      const parent = await getItem(userId, patch.parent_id, 'edit');
      if (parent.kind !== 'folder') throw new BadRequest('Parent must be a folder');
      // A moved subtree takes the scope of its new folder. Others' items may not go private.
      scope = parent.scope;
      if (scope === 'private' && await one(`${subtree} SELECT 1 FROM items WHERE id IN (SELECT id FROM t) AND owner_id <> $2`, id, userId))
        throw new BadRequest('Only items you own can move into a private folder');
    }
    await run('UPDATE items SET title = $1, parent_id = $2, updated_at = $3 WHERE id = $4',
      patch.title?.trim() || item.title, patch.parent_id === undefined ? item.parent_id : patch.parent_id, now(), id);
    if (scope !== item.scope) await run(`${subtree} UPDATE items SET scope = $2 WHERE id IN (SELECT id FROM t)`, id, scope);
    return getItem(userId, id);
  });
  if (patch.parent_id !== undefined) accessChanged(); // after the commit: a move can change the space
  return item;
}

// Trash and restore cover the whole subtree.
export async function setDeleted(userId: string, id: string, deleted: boolean) {
  const item = await getItem(userId, id, 'edit');
  if (item.owner_id !== userId && item.scope !== 'team') throw new Forbidden('Only the owner can delete a shared board');
  await run(`${subtree} UPDATE items SET deleted_at = $2 WHERE id IN (SELECT id FROM t)`, id, deleted ? now() : null);
  accessChanged();
}

export function search(userId: string, q: string) {
  const like = `%${q.replace(/[%_\\]/g, '')}%`;
  return all<Item>(`SELECT ${cols} ${fromItems('$1')} WHERE ${visible('$1')} AND i.deleted_at IS NULL AND (i.title ILIKE $2 OR i.search_text ILIKE $2)
    ORDER BY i.updated_at DESC LIMIT 20`, userId, like);
}
