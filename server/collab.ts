import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import * as awareness from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { now, one, run } from './db.ts';
import { searchText } from '../shared/doc.ts';
import { NotFound, atLeast, getBoard, hooks as storeHooks } from './store.ts';
import * as history from './history.ts';
import { objectsOf } from '../shared/doc.ts';

export type Actor = { id?: string; name: string };
// Listeners for board changes (the inbox watches card assignments). Set once at startup.
export const hooks: {
  objects?: (board: string, events: Y.YEvent<Y.Map<unknown>>[], actor: Actor) => void;
  saved?: (board: string, final: boolean) => void; // after changes reach the log; final = the last person left
} = {};

// y-websocket wire protocol (the browser uses y-websocket's WebsocketProvider).
const MSG_SYNC = 0, MSG_AWARENESS = 1, MSG_QUERY_AWARENESS = 3;
const LOG_DELAY = 250, SAVE_DELAY = 1000, UNLOAD_DELAY = 60_000, RETRY_DELAY = 5000;

type Room = {
  id: string; doc: Y.Doc; awareness: awareness.Awareness;
  conns: Map<WebSocket, Set<number>>; saveTimer?: NodeJS.Timeout; unloadTimer?: NodeJS.Timeout; logTimer?: NodeJS.Timeout;
  pending: Uint8Array[]; authors: Set<string>; // updates not yet in the log, and who made them
  seq: number; // the last log position written
  writing: Promise<void>; // log writes run one after another, so the log keeps the order of the updates
  users: Map<WebSocket, Actor>;
  editors: Set<WebSocket>; // sockets whose document changes are applied (the rest view or comment)
  editor?: Actor; // the author of a server-side edit in progress (MCP, restore)
  changed?: boolean; // changed since the last final save
};

// ponytail: rooms live in this process, one server only; move to a shared Yjs backend (Redis or Hocuspocus) to scale out
const rooms = new Map<string, Room>();
const loading = new Map<string, Promise<Room>>();

const actorOf = (room: Room, origin: unknown) =>
  origin && typeof origin === 'object' && 'readyState' in origin ? room.users.get(origin as WebSocket) : room.editor;

// Updates go to the log in small batches; the search text follows a little later.
// `checkpoint`: also store the full state at the new log position (the last person left).
function flushLog(room: Room, checkpoint = false): Promise<void> {
  clearTimeout(room.logTimer);
  room.logTimer = undefined;
  room.writing = room.writing.then(async () => {
    if (!room.pending.length && !(checkpoint && room.changed)) return;
    // Taken together, before any wait: the state is exactly the logged updates.
    const data = room.pending.length ? Y.mergeUpdates(room.pending) : null, authors = [...room.authors], state = Y.encodeStateAsUpdate(room.doc);
    room.pending = [];
    room.authors.clear();
    try {
      if (data) { room.seq = await history.append(room.id, data, authors); room.changed = true; }
      await history.maybeCheckpoint(room.id, state, room.seq, checkpoint);
    } catch (e) {
      // The database is not reachable: keep the updates and try again. They are still in the live document.
      if (data) { room.pending.unshift(data); authors.forEach((a) => room.authors.add(a)); }
      room.logTimer ??= setTimeout(() => void flushLog(room), RETRY_DELAY);
      console.error('board log write failed, will retry', room.id, (e as Error).message);
      return;
    }
    if (data) hooks.saved?.(room.id, false);
  });
  return room.writing;
}

async function save(room: Room, final = false) {
  clearTimeout(room.saveTimer);
  room.saveTimer = undefined;
  await flushLog(room, final);
  if (!room.changed) return; // only looked at: nothing to save, and "Recent" keeps its order
  try {
    await run('UPDATE items SET search_text = $1, updated_at = $2 WHERE id = $3', searchText(room.doc), now(), room.id);
  } catch (e) { console.error('search text update failed', room.id, (e as Error).message); return; }
  if (!final || room.pending.length) return;
  room.changed = false;
  hooks.saved?.(room.id, true);
}

// Unload only after a quiet period, so MCP calls and reconnects reuse the loaded doc.
function scheduleUnload(room: Room) {
  clearTimeout(room.unloadTimer);
  room.unloadTimer = setTimeout(async () => {
    if (room.conns.size) return;
    await save(room, true);
    // Someone came back, or the log is not written yet: keep the room.
    if (room.conns.size || room.pending.length) return scheduleUnload(room);
    room.doc.destroy();
    rooms.delete(room.id);
  }, UNLOAD_DELAY);
  room.unloadTimer.unref(); // housekeeping only; never keeps the process alive
}

const frame = (write: (e: encoding.Encoder) => void) => {
  const e = encoding.createEncoder();
  write(e);
  return encoding.toUint8Array(e);
};

function broadcast(room: Room, msg: Uint8Array, except?: unknown) {
  for (const conn of room.conns.keys()) if (conn !== except && conn.readyState === conn.OPEN) conn.send(msg);
}

async function load(id: string): Promise<Room> {
  const { doc, seq } = await history.stateAt(id);
  const room: Room = {
    id, doc, awareness: new awareness.Awareness(doc), conns: new Map(), pending: [], authors: new Set(), seq, writing: Promise.resolve(), users: new Map(), editors: new Set(),
  };
  room.awareness.setLocalState(null); // the server has no presence of its own
  // Awareness checks for stale presence every few seconds; that must not keep the process alive either.
  (room.awareness as unknown as { _checkInterval?: NodeJS.Timeout })._checkInterval?.unref();

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    const who = actorOf(room, origin);
    if (who) room.authors.add(who.name);
    broadcast(room, frame((e) => { encoding.writeVarUint(e, MSG_SYNC); sync.writeUpdate(e, update); }), origin);
    room.pending.push(update);
    room.logTimer ??= setTimeout(() => void flushLog(room), LOG_DELAY);
    clearTimeout(room.saveTimer);
    room.saveTimer = setTimeout(() => void save(room), SAVE_DELAY);
  });
  room.awareness.on('update', ({ added, updated, removed }: Record<string, number[]>, conn: WebSocket | null) => {
    const changed = [...added, ...updated, ...removed];
    if (conn) {
      const owned = room.conns.get(conn);
      added.forEach((c) => owned?.add(c));
      removed.forEach((c) => owned?.delete(c));
    }
    broadcast(room, frame((e) => {
      encoding.writeVarUint(e, MSG_AWARENESS);
      encoding.writeVarUint8Array(e, awareness.encodeAwarenessUpdate(room.awareness, changed));
    }));
  });
  objectsOf(doc).observeDeep((events, tr) => { const a = actorOf(room, tr.origin); if (a) hooks.objects?.(id, events as Y.YEvent<Y.Map<unknown>>[], a); });
  rooms.set(id, room);
  scheduleUnload(room);
  return room;
}

// The live room of a board, loaded from the log on first use. Concurrent callers share one load.
export function getRoom(id: string): Promise<Room> {
  const room = rooms.get(id);
  if (room) return Promise.resolve(room);
  let p = loading.get(id);
  if (!p) { p = load(id).finally(() => loading.delete(id)); loading.set(id, p); }
  return p;
}

// Server-side edit (MCP tools), or a read of the live board. Open tabs receive edits like any other update.
// `fn` runs synchronously on the live document, with `author` credited for its changes.
export async function editBoard<T>(id: string, fn: (doc: Y.Doc) => T, author?: string | Actor): Promise<T> {
  const room = await getRoom(id);
  room.editor = typeof author === 'string' ? { name: author } : author;
  try { return fn(room.doc); } finally {
    room.editor = undefined;
    if (!room.conns.size) scheduleUnload(room);
  }
}

export const isOpen = (id: string) => (rooms.get(id)?.conns.size ?? 0) > 0;

// Viewers and commenters get the board and presence, but their document changes are dropped.
function connect(conn: WebSocket, room: Room, user: Actor, canEdit: boolean) {
  clearTimeout(room.unloadTimer);
  room.conns.set(conn, new Set());
  room.users.set(conn, user);
  if (canEdit) room.editors.add(conn);
  conn.binaryType = 'arraybuffer';

  conn.on('message', (data: ArrayBuffer) => {
    try {
      const dec = decoding.createDecoder(new Uint8Array(data));
      const type = decoding.readVarUint(dec);
      if (type === MSG_SYNC) {
        if (!room.editors.has(conn) && decoding.peekVarUint(dec) !== sync.messageYjsSyncStep1) return;
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, MSG_SYNC);
        sync.readSyncMessage(dec, reply, room.doc, conn);
        if (encoding.length(reply) > 1) conn.send(encoding.toUint8Array(reply));
      } else if (type === MSG_AWARENESS) {
        awareness.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(dec), conn);
      } else if (type === MSG_QUERY_AWARENESS) {
        conn.send(frame((e) => {
          encoding.writeVarUint(e, MSG_AWARENESS);
          encoding.writeVarUint8Array(e, awareness.encodeAwarenessUpdate(room.awareness, [...room.awareness.getStates().keys()]));
        }));
      }
    } catch (err) {
      console.error('collab message failed', room.id, err);
      conn.close(1011);
    }
  });

  // Keep idle sockets alive through proxies, drop dead ones.
  let alive = true;
  conn.on('pong', () => { alive = true; });
  const ping = setInterval(() => {
    if (!alive) return conn.terminate();
    alive = false;
    conn.ping();
  }, 30_000);

  conn.on('close', () => {
    clearInterval(ping);
    const owned = room.conns.get(conn);
    room.conns.delete(conn);
    room.users.delete(conn);
    room.editors.delete(conn);
    if (owned?.size) awareness.removeAwarenessStates(room.awareness, [...owned], null);
    if (!room.conns.size) { void save(room, true); scheduleUnload(room); }
  });

  conn.send(frame((e) => { encoding.writeVarUint(e, MSG_SYNC); sync.writeSyncStep1(e, room.doc); }));
  const states = [...room.awareness.getStates().keys()];
  if (states.length) conn.send(frame((e) => {
    encoding.writeVarUint(e, MSG_AWARENESS);
    encoding.writeVarUint8Array(e, awareness.encodeAwarenessUpdate(room.awareness, states));
  }));
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });

type Who = { id: string; name: string; canEdit: boolean };
// Upgrade path: /collab/<boardId>. `authorize` returns null to refuse. The room is loaded before the socket opens.
export async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, authorize: (req: IncomingMessage, boardId: string) => Promise<Who | null>) {
  const boardId = req.url?.match(/^\/collab\/([\w-]+)/)?.[1];
  let who: Who | null = null, room: Room | null = null;
  try {
    who = boardId ? await authorize(req, boardId) : null;
    if (who) room = await getRoom(boardId!);
  } catch (e) { console.error('collab upgrade failed', boardId, (e as Error).message); }
  if (!who || !room) {
    socket.write(`HTTP/1.1 ${who ? '503 Service Unavailable' : '403 Forbidden'}\r\nConnection: close\r\n\r\n`);
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (conn) => connect(conn, room, { id: who.id, name: who.name }, who.canEdit));
}

// May this person open the board live, and edit it? null = no access (also a removed person).
export async function boardAccess(userId: string, boardId: string): Promise<boolean | null> {
  if (!(await one('SELECT 1 FROM users WHERE id = $1 AND disabled_at IS NULL', userId))) return null;
  try { return atLeast((await getBoard(userId, boardId)).role!, 'edit'); }
  catch (e) { if (e instanceof NotFound) return null; throw e; }
}

// Access changed somewhere (store.ts accessChanged): ask again for every open socket. Who lost access is disconnected;
// who can no longer edit stays, read-only.
// ponytail: checks every open socket on each change; scope it to the changed boards if many boards are open at once.
export async function recheckAccess() {
  for (const room of rooms.values()) for (const [conn, user] of [...room.users]) {
    const canEdit = user.id ? await boardAccess(user.id, room.id).catch(() => undefined) : null;
    if (canEdit === undefined) continue; // the check failed (database): keep the socket as it is
    if (canEdit === null) conn.close(4403, 'Access removed');
    else if (canEdit) room.editors.add(conn);
    else room.editors.delete(conn);
  }
}
storeHooks.accessChanged = recheckAccess;

// --- time machine --------------------------------------------------------------
export async function listVersions(boardId: string) {
  const room = rooms.get(boardId);
  if (room) await flushLog(room); // the newest edits count too
  return history.listVersions(boardId);
}

// A version id is a log position.
export async function versionDoc(boardId: string, versionId: string): Promise<Y.Doc> {
  const seq = Number(versionId);
  if (!Number.isInteger(seq) || !(await history.listVersions(boardId)).some((v) => v.id === versionId)) throw new NotFound('No such version');
  return (await history.stateAt(boardId, seq)).doc;
}

export const flushAll = () => Promise.all([...rooms.values()].map((room) => save(room, true)));
