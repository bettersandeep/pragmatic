import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// The MCP tools as Claude calls them, over an in-memory transport.
process.env.PRAGMATIC_PGLITE = 'memory';
const { run } = await import('./db.ts');
const { createMcpServer } = await import('./mcp.ts');

await run('INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, 0)', 'ana', 'ana@x.test', 'Ana');
const [a, b] = InMemoryTransport.createLinkedPair();
await createMcpServer({ id: 'ana', email: 'ana@x.test', name: 'Ana', picture: null }).connect(a);
const client = new Client({ name: 'test', version: '1' });
await client.connect(b);
after(() => client.close());
type Out = { isError?: boolean; content: { type: string; text: string }[] };
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as Out;
const data = (r: Out) => JSON.parse(r.content[0].text);

test('edit_mindmap: an op that fails changes nothing, so a retry makes no duplicates', async () => {
  const { id: board } = data(await call('create_board', { title: 'Plan' }));
  const map = data(await call('add_mindmap', { board_id: board, outline: 'Goal\n  Step' }));
  const root = map.outline.match(/\[(\w+)\]/)[1];
  const r = await call('edit_mindmap', { board_id: board, mindmap_id: map.id, ops: [{ op: 'add', node: root, text: 'New child' }, { op: 'rename', node: 'nope', text: 'x' }] });
  assert.equal(r.isError, true);
  assert.doesNotMatch((await call('read_board', { board_id: board })).content.map((c) => c.text).join('\n'), /New child/);
  // Ops see the ones before them: add, then indent the new node under its sibling.
  const ok = data(await call('edit_mindmap', { board_id: board, mindmap_id: map.id, ops: [{ op: 'add', node: root, text: 'Later' }] }));
  const child = ok.added[0];
  const both = data(await call('edit_mindmap', { board_id: board, mindmap_id: map.id, ops: [{ op: 'rename', node: child, text: 'Renamed' }, { op: 'indent', node: child }] }));
  assert.match(both.outline, /\n {4}- Renamed|\n {4}Renamed/);
});

test('icons: every name must exist, also a shape icon', async () => {
  const { id: board } = data(await call('create_board', { title: 'Icons' }));
  const bad = await call('add_objects', { board_id: board, objects: [{ type: 'shape', text: 'API', icon: 'not-a-real-icon' }] });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /Unknown icon "not-a-real-icon"/);
  assert.notEqual((await call('add_objects', { board_id: board, objects: [{ type: 'shape', text: 'API', icon: 'server' }] })).isError, true);
});
