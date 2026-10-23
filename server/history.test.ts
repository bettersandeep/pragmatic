import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

process.env.PRAGMATIC_PGLITE = 'memory';
const { all, run } = await import('./db.ts');
const history = await import('./history.ts');

await run('INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, 0)', 'u', 'u@x', 'u');
const board = (id: string) => run(`INSERT INTO items (id, kind, title, scope, owner_id, created_at, updated_at) VALUES ($1, 'board', 't', 'private', 'u', 0, 0)`, id);

// Write edits as separate log entries at the given times; each sets key k<i> on a map. Returns the doc and the log positions.
async function edits(id: string, times: number[]) {
  const doc = new Y.Doc(), seqs: number[] = [];
  for (const [i, at] of times.entries()) {
    let up: Uint8Array | null = null;
    doc.once('update', (u: Uint8Array) => { up = u; });
    doc.getMap('m').set(`k${i}`, i);
    const seq = await history.append(id, up!, [`p${i % 2}`]);
    await run('UPDATE updates SET at = $1 WHERE board_id = $2 AND seq = $3', at, id, seq);
    seqs.push(seq);
  }
  return { doc, seqs };
}
const keys = (d: Y.Doc) => [...d.getMap('m').keys()].sort();

test('the log rebuilds any past moment, with or without checkpoints', async () => {
  await board('a');
  const { doc: live, seqs: s } = await edits('a', [1000, 2000, 3000]);
  assert.deepEqual(keys((await history.stateAt('a')).doc), keys(live));
  assert.deepEqual(keys((await history.stateAt('a', s[1])).doc), ['k0', 'k1']);
  await history.checkpoint('a', Y.encodeStateAsUpdate((await history.stateAt('a', s[1])).doc), s[1]);
  assert.deepEqual(keys((await history.stateAt('a')).doc), ['k0', 'k1', 'k2'], 'checkpoint + later updates');
  assert.ok(await history.append('a', Y.encodeStateAsUpdate(new Y.Doc()), []) > s[2], 'positions keep growing');
});

test('versions are editing sessions; old history thins to hourly, then daily points', async () => {
  await board('b');
  const DAY = 864e5, HOUR = 36e5, t = 1000 * DAY;
  const old = t - 200 * DAY, mid = t - 40 * DAY;
  // 200 days ago: 2 edits in one hour, 1 two hours later, 1 the next day. 40 days ago: 3 edits over two hours. Now: 2 edits 10 minutes apart.
  const { seqs: s } = await edits('b', [old, old + 60e3, old + 2 * HOUR, old + DAY, mid, mid + 10 * 60e3, mid + HOUR + 1, t - 20 * 60e3, t - 10 * 60e3]);
  assert.equal((await history.listVersions('b')).length, 8, 'gaps over 5 minutes split sessions');
  // Session-end checkpoints pile up; the log can rebuild them, so only the newest stays.
  for (const at of [s[5], s[7], s[8]]) await history.checkpoint('b', Y.encodeStateAsUpdate((await history.stateAt('b', at)).doc), at);
  await history.prune('b', t);
  const rows = await all<{ seq: number }>('SELECT seq FROM updates WHERE board_id = $1 ORDER BY seq', 'b');
  assert.deepEqual(rows.map((r) => r.seq), [s[2], s[3], s[5], s[6], s[7], s[8]], 'one merged update per day past 6 months, per hour before, all of the last 30 days');
  const cps = await all<{ seq: number }>('SELECT seq FROM checkpoints WHERE board_id = $1 ORDER BY seq', 'b');
  assert.deepEqual(cps.map((c) => c.seq), [s[8]], 'only the newest checkpoint');
  assert.deepEqual(keys((await history.stateAt('b', s[5])).doc), ['k0', 'k1', 'k2', 'k3', 'k4', 'k5']);
  assert.deepEqual(keys((await history.stateAt('b', s[2])).doc), ['k0', 'k1', 'k2']);
  assert.equal(keys((await history.stateAt('b')).doc).length, 9, 'nothing lost from the current state');
  assert.deepEqual((await history.listVersions('b')).map((v) => Number(v.id)), [s[8], s[7], s[6], s[5], s[3], s[2]]);
  await history.prune('b', t);
  assert.equal((await all('SELECT seq FROM updates WHERE board_id = $1', 'b')).length, 6, 'pruning again changes nothing');
});

test('history from earlier builds (checkpoints older than the log) stays', async () => {
  await board('c');
  const DAY = 864e5, t = 1000 * DAY;
  const { seqs: s } = await edits('c', [t - 300 * DAY, t - 299 * DAY, t - DAY]);
  // An earlier build turned the first two edits into checkpoints and deleted them from the log.
  for (const [i, seq] of s.slice(0, 2).entries())
    await history.checkpoint('c', Y.encodeStateAsUpdate((await history.stateAt('c', seq)).doc), seq, t - (300 - i) * DAY);
  await run('DELETE FROM updates WHERE board_id = $1 AND seq <= $2', 'c', s[1]);
  await history.prune('c', t);
  assert.deepEqual((await all<{ seq: number }>('SELECT seq FROM checkpoints WHERE board_id = $1 ORDER BY seq', 'c')).map((c) => c.seq), [s[0], s[1]]);
  assert.deepEqual(keys((await history.stateAt('c', s[0])).doc), ['k0']);
  assert.deepEqual(keys((await history.stateAt('c')).doc), ['k0', 'k1', 'k2']);
});
