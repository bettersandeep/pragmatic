import { now, one, run } from './db.ts';
import { accessToken, folderOf, hasDrive, setFolder } from './google.ts';
import { getRoom } from './collab.ts';
import { boardUrl } from './tasks.ts';
import { renderBoardPng } from './render.ts';
import { docTools } from './docs.ts';
import { readObjects } from '../shared/doc.ts';
import { readThreads } from '../shared/comments.ts';

// Copies of boards in Google Drive, written with each person's own token (drive.file: the app sees only files it made).
// Automatic copies go to the board owner's "pragmatic" folder; sharing on demand gives the other person view access.

const API = 'https://www.googleapis.com/drive/v3', UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
type Http = typeof fetch;

async function call(userId: string, url: string, init: RequestInit = {}, http: Http = fetch) {
  const r = await http(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${await accessToken(userId, http)}` } });
  if (!r.ok && r.status !== 404) throw new Error(`Google Drive ${init.method ?? 'GET'} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return r;
}

// The "pragmatic" folder in the person's My Drive, made on first use.
export async function folder(userId: string, http: Http = fetch) {
  const known = await folderOf(userId);
  if (known && (await call(userId, `${API}/files/${known}?fields=id,trashed`, {}, http)).ok) return known;
  const r = await call(userId, `${API}/files?fields=id`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'pragmatic', mimeType: 'application/vnd.google-apps.folder' }),
  }, http);
  const { id } = (await r.json()) as { id: string };
  await setFolder(userId, id);
  return id;
}

const multipart = (meta: object, mime: string, data: Buffer | string) => {
  const b = `pgm${Math.random().toString(36).slice(2)}`;
  return {
    headers: { 'content-type': `multipart/related; boundary=${b}` },
    body: Buffer.concat([Buffer.from(`--${b}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\ncontent-type: ${mime}\r\n\r\n`),
      Buffer.isBuffer(data) ? data : Buffer.from(data), Buffer.from(`\r\n--${b}--`)]),
  };
};

const fileOf = (boardId: string, userId: string, kind: 'json' | 'png') =>
  one<{ file_id: string }>('SELECT file_id FROM drive_files WHERE board_id = $1 AND user_id = $2 AND kind = $3', boardId, userId, kind);

// Create or replace one file; Drive keeps earlier versions as revisions of the same file.
export async function upsert(userId: string, boardId: string, kind: 'json' | 'png', name: string, data: Buffer | string, http: Http = fetch, type?: string) {
  const mime = type ?? (kind === 'json' ? 'application/json' : 'image/png');
  const row = await fileOf(boardId, userId, kind);
  const meta = { name, description: `pragmatic board: ${boardUrl(boardId)}` };
  let r = row ? await call(userId, `${UPLOAD}/files/${row.file_id}?uploadType=multipart&fields=id,webViewLink`, { method: 'PATCH', ...multipart(meta, mime, data) }, http) : null;
  if (!r || r.status === 404) // new, or deleted in Drive since: make it (again)
    r = await call(userId, `${UPLOAD}/files?uploadType=multipart&fields=id,webViewLink`, { method: 'POST', ...multipart({ ...meta, mimeType: mime, parents: [await folder(userId, http)] }, mime, data) }, http);
  const f = (await r.json()) as { id: string; webViewLink?: string };
  await run(`INSERT INTO drive_files (board_id, user_id, kind, file_id, updated_at) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (board_id, user_id, kind) DO UPDATE SET file_id = excluded.file_id, updated_at = excluded.updated_at`, boardId, userId, kind, f.id, now());
  return f;
}

export async function shareViewOnly(userId: string, fileId: string, email: string, http: Http = fetch) {
  await call(userId, `${API}/files/${fileId}/permissions?sendNotificationEmail=false`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'user', role: 'reader', emailAddress: email }),
  }, http);
}

// The board as data: objects and comment threads, with a link back to the live board.
export async function boardJson(boardId: string, title: string) {
  const { doc } = await getRoom(boardId);
  return JSON.stringify({ pragmatic: 1, title, url: boardUrl(boardId), exported_at: new Date().toISOString(), objects: readObjects(doc), comments: readThreads(doc) }, null, 2);
}

const fileName = (title: string, ext: string) => `${title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Untitled'}.${ext}`;

// Write the board's JSON and PNG into `userId`'s Drive. Returns the PNG file (with its link).
export async function copyToDrive(userId: string, boardId: string, title: string, http: Http = fetch) {
  // A doc is copied as Markdown (in the "data" slot, json); a board as JSON plus a PNG.
  if ((await one<{ kind: string }>('SELECT kind FROM items WHERE id = $1', boardId))?.kind === 'doc') {
    const md = await (await docTools()).toMarkdown((await getRoom(boardId)).doc.getXmlFragment('blocks'));
    return upsert(userId, boardId, 'json', fileName(title, 'md'), `# ${title}\n\n${md}`, http, 'text/markdown');
  }
  await upsert(userId, boardId, 'json', fileName(title, 'pragmatic.json'), await boardJson(boardId, title), http);
  const png = await renderBoardPng(boardId, userId);
  return png ? upsert(userId, boardId, 'png', fileName(title, 'png'), png, http) : null;
}

// Sharing on demand: the sharer's copy of the board, view-only for the other person. Returns the PNG's Drive link.
export async function shareDriveCopy(userId: string, boardId: string, email: string, title?: string) {
  const t = title ?? (await one<{ title: string }>('SELECT title FROM items WHERE id = $1', boardId))!.title;
  const png = await copyToDrive(userId, boardId, t);
  for (const kind of ['json', 'png'] as const) {
    const row = await fileOf(boardId, userId, kind);
    if (row) await shareViewOnly(userId, row.file_id, email);
  }
  return png?.webViewLink;
}

// Automatic copies: at most every 10 minutes while a board is being edited, and soon after the last person leaves.
const COPY_EVERY = 10 * 60e3, AFTER_LEAVE = 30e3;
const pending = new Map<string, { timer: NodeJS.Timeout; at: number }>();
const lastCopy = new Map<string, number>();
export function scheduleCopy(boardId: string, final: boolean, owner: () => Promise<{ id: string; title: string } | null>) {
  const due = final ? now() + AFTER_LEAVE : Math.max(now() + AFTER_LEAVE, (lastCopy.get(boardId) ?? 0) + COPY_EVERY);
  const cur = pending.get(boardId);
  if (cur && cur.at <= due) return;
  if (cur) clearTimeout(cur.timer);
  const timer = setTimeout(async () => {
    pending.delete(boardId);
    try {
      const o = await owner();
      if (!o || !(await hasDrive(o.id))) return;
      lastCopy.set(boardId, now());
      await copyToDrive(o.id, boardId, o.title);
    } catch (e) { console.error('drive copy failed', boardId, (e as Error).message); }
  }, due - now());
  timer.unref();
  pending.set(boardId, { timer, at: due });
}
