import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PRAGMATIC_PGLITE = 'memory';
const { run } = await import('./db.ts');
const store = await import('./store.ts');
const c = await import('./comments.ts');
const tpl = await import('./templates.ts');
const { editBoard } = await import('./collab.ts');
const { readThreads } = await import('../shared/comments.ts');
const { readObjects } = await import('../shared/doc.ts');

for (const id of ['ana', 'bo']) await run('INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, 0)', id, `${id}@x`, id);
const ana = { id: 'ana', email: 'ana@x', name: 'Ana', picture: null }, bo = { id: 'bo', email: 'bo@x', name: 'Bo', picture: null };
const board = await store.createItem('ana', { kind: 'board', title: 'B', scope: 'team' });

test('comments: server sets the author, keeps real mentions, guards edits, toggles reactions', async () => {
  const t = await c.createThread(board.id, ana, { anchor: { x: 1, y: 2 }, text: ' hi @Bo ', mentions: ['bo', 'ghost'] });
  assert.equal(t.messages[0].author.id, 'ana');
  assert.equal(t.messages[0].text, 'hi @Bo');
  assert.deepEqual(t.messages[0].mentions, ['bo']);
  await c.reply(board.id, t.id, bo, { text: 'ok' });
  await assert.rejects(c.editMessage(board.id, t.id, t.messages[0].id, bo, { text: 'hack' }), /Only the author/);
  assert.deepEqual(await c.toggleReaction(board.id, t.id, t.messages[0].id, bo, '👍'), { '👍': ['bo'] });
  assert.deepEqual(await c.toggleReaction(board.id, t.id, t.messages[0].id, bo, '👍'), {});
  await assert.rejects(c.toggleReaction(board.id, t.id, t.messages[0].id, bo, '💩'), /Unknown reaction/);
  await c.setResolved(board.id, t.id, true);
  const [live] = await editBoard(board.id, (doc) => readThreads(doc));
  assert.equal(live.resolved, true);
  assert.equal(live.messages.length, 2);
  await c.deleteMessage(board.id, t.id, t.messages[0].id, ana); // first message deletes the thread
  assert.equal((await editBoard(board.id, (doc) => readThreads(doc))).length, 0);
  await assert.rejects(c.createThread(board.id, ana, { anchor: { x: 0, y: 0 }, text: '   ' }), /required/);
});

test('templates: built-ins build, a board saves and re-applies with fresh ids', async () => {
  const list = await tpl.listTemplates('ana');
  assert.ok(list.some((t) => t.id === 'builtin:retro'));
  assert.equal(await tpl.applyTemplate(board.id, 'builtin:flowchart') > 5, true);
  const saved = await tpl.saveTemplate('ana', board.id, 'Mine');
  const first = (await editBoard(board.id, (doc) => readObjects(doc))).map((o) => o.id);
  const copy = await tpl.templateObjects(saved.id);
  assert.equal(copy.length, first.length);
  assert.ok(copy.every((o) => !first.includes(o.id)), 'template objects get new ids');
  assert.ok((await tpl.listTemplates('bo')).find((t) => t.id === saved.id && !t.mine));
  await assert.rejects(tpl.deleteTemplate('bo', saved.id), /No template of yours/);
  await tpl.deleteTemplate('ana', saved.id);
  await assert.rejects(tpl.templateObjects(saved.id), /No template/);
});

test('inbox: mentions, replies, watched cards and assignments reach the right people, never the actor or outsiders', async () => {
  const inbox = await import('./inbox.ts');
  const { hooks } = await import('./collab.ts');
  const { addObjects, updateObjects } = await import('../shared/doc.ts');
  hooks.objects = inbox.onObjects;
  await run('INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, 0)', 'cy', 'cy@x', 'cy');
  const priv = await store.createItem('ana', { kind: 'board', title: 'Secret' });
  await store.share('ana', priv.id, 'bo', 'comment');
  await editBoard(priv.id, (doc) => addObjects(doc, [{ id: 'card', type: 'task', title: 'Ship', x: 0, y: 0, w: 1, h: 1, z: 1, color: 'blue', size: 'm', watch: ['ana', 'bo'] } as any]));
  const kinds = async (u: string) => (await inbox.list(u)).filter((n) => n.board_id === priv.id).map((n) => n.kind).sort();

  const t = await c.createThread(priv.id, ana, { anchor: { objectId: 'card', x: 0, y: 0 }, text: '@Bo @cy look', mentions: ['bo', 'cy'] });
  assert.deepEqual(await kinds('bo'), ['mention'], 'mention wins over watch');
  assert.deepEqual(await kinds('cy'), [], 'no access, no notification');
  assert.deepEqual(await kinds('ana'), [], 'not told about own comment');
  await c.reply(priv.id, t.id, bo, { text: 'on it' });
  assert.deepEqual(await kinds('ana'), ['reply']);
  await editBoard(priv.id, (doc) => updateObjects(doc, [{ id: 'card', assignee: 'bo' }]), { id: 'ana', name: 'Ana' });
  await inbox.settled(); // assignments are noticed in the document change, then written
  assert.deepEqual(await kinds('bo'), ['assign', 'mention']);
  await inbox.markRead('bo', 'all');
  assert.ok((await inbox.list('bo')).every((n) => n.read_at));
});

test('comments: a damaged value from a socket does not break reading the others', async () => {
  const t = await c.createThread(board.id, ana, { anchor: { x: 0, y: 0 }, text: 'still here', mentions: [] });
  await editBoard(board.id, (doc) => doc.getMap<string>('comments').set('broken', '{not json'));
  const threads = await editBoard(board.id, (doc) => readThreads(doc));
  assert.ok(threads.some((x) => x.id === t.id));
  assert.ok(!threads.some((x) => x.id === 'broken'));
});
