import { all } from './db.ts';
import { editBoard } from './collab.ts';
import * as store from './store.ts';
import { readObjects } from '../shared/doc.ts';

import { BASE_URL } from './config.ts';
export { BASE_URL };
export const boardUrl = (id: string) => `${BASE_URL}/b/${id}`;
export const docUrl = (id: string) => `${BASE_URL}/d/${id}`;

// Links to a task card carry ?task=<id> on the board URL.
const needle = (boardId: string, taskId: string) => `/b/${boardId}?task=${taskId}`;

// Link cards on any board the user can see that point at this task.
// ponytail: LIKE over search_text (which holds link URLs); a links table if boards grow into the thousands
export async function backlinks(userId: string, boardId: string, taskId: string) {
  const n = needle(boardId, taskId);
  const rows = await all<{ id: string; title: string }>(`SELECT i.id, i.title ${store.fromItems('$1')}
    WHERE i.kind IN ('board', 'doc') AND i.deleted_at IS NULL AND ${store.visible('$1')} AND i.search_text LIKE $2`, userId, `%${n.replace(/[%_\\]/g, '')}%`);
  const found = await Promise.all(rows.map((b) => editBoard(b.id, (doc) => readObjects(doc)
    .filter((o) => o.type === 'link' && o.url.includes(n))
    .map((o) => ({ board_id: b.id, board_title: b.title, object_id: o.id, title: o.type === 'link' ? o.title : '' })))));
  return found.flat();
}

// Link previews for pragmatic's own boards and cards come from the data, not from fetching our own URL.
export async function internalLink(userId: string, raw: string): Promise<{ url: string; title: string; site: string } | null> {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const m = url.pathname.match(/^\/[bd]\/([\w-]+)\/?$/);
  if (url.origin !== new URL(BASE_URL).origin || !m) return null;
  try {
    const board = await store.getBoard(userId, m[1]), task = url.searchParams.get('task');
    const card = task ? await editBoard(board.id, (doc) => readObjects(doc).find((o) => o.id === task)) : undefined;
    const title = card?.type === 'task' ? `${card.title || 'Untitled card'} · ${board.title}` : board.title;
    return { url: url.toString(), title, site: 'pragmatic' };
  } catch { return null; }
}
