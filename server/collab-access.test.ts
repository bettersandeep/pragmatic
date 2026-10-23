import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';

// Live board sockets: viewers cannot write, and a person whose access goes away is cut off at once.
process.env.PRAGMATIC_PGLITE = 'memory';
const { run } = await import('./db.ts');
const store = await import('./store.ts');
const collab = await import('./collab.ts');
const { hostAllowed, originAllowed } = await import('./request.ts');

for (const id of ['ana', 'bo', 'cy']) await run('INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, 0)', id, `${id}@x.test`, id);
const board = await store.createItem('ana', { kind: 'board', title: 'B' });
await store.share('ana', board.id, 'bo', 'edit');
await store.share('ana', board.id, 'cy', 'view');

// The upgrade check of main.ts, with the user from a header instead of a session cookie.
const server = createServer().listen(0);
server.on('upgrade', (req, socket, head) => void collab.handleUpgrade(req, socket, head, async (r, boardId) => {
  const id = String(r.headers['x-user']), canEdit = await collab.boardAccess(id, boardId);
  return canEdit === null ? null : { id, name: id, canEdit };
}));
const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}/collab/${board.id}`;
const sockets: WebSocket[] = [];
after(() => { sockets.forEach((ws) => ws.terminate()); server.close(); });
const open = (user: string) => new Promise<WebSocket>((ok, fail) => {
  const ws = new WebSocket(url, { headers: { 'x-user': user } });
  sockets.push(ws);
  ws.on('error', () => {}); // a refused socket: the test checks the status below
  ws.once('open', () => ok(ws)).once('unexpected-response', (_q, r) => fail(new Error(String(r.statusCode))));
});
const write = (ws: WebSocket, key: string) => {
  const d = new Y.Doc();
  d.getMap('t').set(key, 1);
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, 0); // sync message
  sync.writeUpdate(e, Y.encodeStateAsUpdate(d));
  ws.send(encoding.toUint8Array(e));
};
const has = (key: string) => collab.editBoard(board.id, (d) => d.getMap('t').has(key));
const settle = () => new Promise((r) => setTimeout(r, 100));
// The close code, or 0 when the socket stays open for two seconds.
const closed = (ws: WebSocket) => new Promise<number>((r) => { ws.once('close', (code) => r(code)); setTimeout(() => r(0), 2000).unref(); });

test('collab: viewers are read-only, removed access disconnects, lost edit rights stop writes', async () => {
  await assert.rejects(open('nobody'), /403/, 'no access, no socket');
  const bo = await open('bo'), cy = await open('cy');
  write(bo, 'by-bo'); write(cy, 'by-cy'); await settle();
  assert.equal(await has('by-bo'), true, 'an editor writes');
  assert.equal(await has('by-cy'), false, 'a viewer does not');

  await store.share('ana', board.id, 'bo', 'view');
  await settle();
  write(bo, 'after-downgrade'); await settle();
  assert.equal(await has('after-downgrade'), false, 'edit taken away: the open socket is read-only');

  const gone = closed(cy);
  await store.share('ana', board.id, 'cy', 'none');
  assert.equal(await gone, 4403, 'share removed: the open socket closes');

  const trashed = closed(bo);
  await store.setDeleted('ana', board.id, true);
  await store.share('ana', board.id, 'bo', 'none').catch(() => {});
  assert.equal(await trashed, 4403);
});

test('AUTH=local: pages from other sites cannot reach this server', () => {
  // DNS rebinding: the page's own name arrives as Host.
  assert.equal(hostAllowed('localhost:3100'), true);
  assert.equal(hostAllowed('127.0.0.1:3100'), true);
  assert.equal(hostAllowed('rebind.attacker.example:3100'), false);
  assert.equal(hostAllowed(undefined), false);
  // WebSockets have no CORS: the browser's Origin must be this server.
  assert.equal(originAllowed(undefined, 'localhost:3100'), true, 'not a browser');
  assert.equal(originAllowed('http://localhost:3100', 'localhost:3100'), true);
  assert.equal(originAllowed('https://pragmatic.example.com', 'pragmatic:3100'), false, 'not this server');
  assert.equal(originAllowed('https://evil.example', 'localhost:3100'), false);
});
