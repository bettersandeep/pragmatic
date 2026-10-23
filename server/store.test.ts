import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PRAGMATIC_PGLITE = 'memory';
const { run } = await import('./db.ts');
const store = await import('./store.ts');

for (const id of ['ana', 'bo', 'cy']) await run('INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, 0)', id, `${id}@x`, id);

test('visibility and scope follow the folder on create and move', async () => {
  const team = await store.createItem('ana', { kind: 'folder', title: 'Team specs', scope: 'team' });
  const priv = await store.createItem('ana', { kind: 'folder', title: 'Mine' });
  const b = await store.createItem('ana', { kind: 'board', title: 'Draft' });
  assert.equal(b.scope, 'private');
  await assert.rejects(store.getItem('bo', b.id), store.NotFound);

  assert.equal((await store.updateItem('ana', b.id, { parent_id: team.id })).scope, 'team');
  assert.equal((await store.getItem('bo', b.id)).title, 'Draft'); // bo sees it now

  const bos = await store.createItem('bo', { kind: 'board', title: 'Bo board', parent_id: team.id });
  assert.equal(bos.scope, 'team');
  // ana moves the team folder (holding bo's board) into her private folder: refused, nothing changed.
  await assert.rejects(store.updateItem('ana', team.id, { parent_id: priv.id }), /you own/);
  assert.equal((await store.getItem('bo', team.id)).parent_id, null);
  assert.equal((await store.getItem('bo', bos.id)).scope, 'team');

  const loose = await store.createItem('ana', { kind: 'board', title: 'Loose' });
  await assert.rejects(store.updateItem('ana', team.id, { parent_id: loose.id }), /must be a folder/);
  const inner = await store.createItem('ana', { kind: 'folder', title: 'Inner', parent_id: team.id });
  await assert.rejects(store.updateItem('ana', team.id, { parent_id: inner.id }), /into itself/);
});

test('trash covers the subtree; search finds board text', async () => {
  const f = await store.createItem('ana', { kind: 'folder', title: 'F', scope: 'team' });
  const b = await store.createItem('ana', { kind: 'board', title: 'B', parent_id: f.id });
  await store.setDeleted('bo', f.id, true);
  assert.deepEqual((await store.listItems('ana', true)).map((i) => i.id).sort(), [f.id, b.id].sort());
  await store.setDeleted('bo', f.id, false);
  assert.equal((await store.listItems('ana', true)).length, 0);
  await run('UPDATE items SET search_text = $1 WHERE id = $2', 'Hello world', b.id);
  assert.deepEqual((await store.search('bo', 'hello')).map((i) => i.id), [b.id], 'any letter case');
  assert.deepEqual(await store.search('bo', '%'), (await store.search('bo', '')), 'LIKE wildcards are plain text');
});

test('sharing: roles per person, link access, and what each role may do', async () => {
  const b = await store.createItem('ana', { kind: 'board', title: 'Plan' });
  await assert.rejects(store.getBoard('bo', b.id), store.NotFound, 'private boards do not exist for others');
  assert.equal(await store.share('ana', b.id, 'bo', 'comment'), true, 'new member');
  assert.equal(await store.share('ana', b.id, 'bo', 'comment'), false, 'already a member');
  assert.equal((await store.getBoard('bo', b.id)).role, 'comment');
  await assert.rejects(store.getBoard('bo', b.id, 'edit'), store.Forbidden);
  await assert.rejects(store.share('bo', b.id, 'cy', 'edit'), store.Forbidden, 'commenters cannot share');
  assert.ok((await store.listItems('bo')).some((i) => i.id === b.id && i.role === 'comment'), 'shared boards are listed, with the role');
  await store.setLinkAccess('ana', b.id, 'view');
  assert.equal((await store.getBoard('cy', b.id)).role, 'view', 'link access');
  assert.ok(!(await store.listItems('cy')).some((i) => i.id === b.id), 'link access alone does not list the board');
  await store.share('ana', b.id, 'bo', 'edit');
  await store.updateItem('bo', b.id, { title: 'Plan v2' });
  await assert.rejects(store.setDeleted('bo', b.id, true), store.Forbidden, 'only the owner trashes a shared board');
  await store.share('ana', b.id, 'bo', 'none');
  assert.equal((await store.getBoard('bo', b.id)).role, 'view', 'back to link access');
});

test('stars list only items the person can still open', async () => {
  const b = await store.createItem('ana', { kind: 'board', title: 'Starred' });
  await store.share('ana', b.id, 'bo', 'view');
  await store.setStar('bo', b.id, '', true);
  await store.setStar('bo', b.id, '', true); // twice is once
  assert.deepEqual((await store.stars('bo')).map((s) => s.item_id), [b.id]);
  await store.share('ana', b.id, 'bo', 'none');
  assert.deepEqual(await store.stars('bo'), []);
});
