import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PRAGMATIC_PGLITE = 'memory';
const { one, run } = await import('./db.ts');
const google = await import('./google.ts');
const drive = await import('./drive.ts');

await run('INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, 0)', 'ana', 'ana@x', 'Ana');
await run(`INSERT INTO items (id, kind, title, scope, owner_id, created_at, updated_at) VALUES ('b1', 'board', 'Plan', 'private', 'ana', 0, 0)`);

// A fake Google: records calls, hands out ids, and can forget a file to test re-creation.
function fakeGoogle() {
  const calls: { method: string; url: string; body?: string }[] = [];
  const files = new Set<string>();
  let n = 0;
  const http = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET', u = String(url);
    calls.push({ method, url: u, body: init.body == null ? undefined : typeof init.body === "string" || Buffer.isBuffer(init.body) ? init.body.toString() : String(init.body) });
    const json = (o: object, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (u.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'at', expires_in: 3600 });
    const id = u.match(/files\/([^/?]+)/)?.[1];
    if (method === 'GET') return id && files.has(id) ? json({ id }) : json({}, 404);
    if (method === 'PATCH') return files.has(id!) ? json({ id, webViewLink: `https://drive/${id}` }) : json({}, 404);
    if (u.includes('/permissions')) return json({ id: 'perm' });
    const fid = `f${++n}`; files.add(fid);
    return json({ id: fid, webViewLink: `https://drive/${fid}` });
  }) as typeof fetch;
  return { http, calls, files };
}

test('refresh tokens are stored encrypted', async () => {
  await google.saveRefreshToken('ana', '1//refresh-secret');
  const row = (await one<{ refresh_enc: string }>('SELECT refresh_enc FROM google_tokens WHERE user_id = $1', 'ana'))!;
  assert.ok(!row.refresh_enc.includes('refresh-secret'));
  assert.equal(google.open(row.refresh_enc), '1//refresh-secret');
});

test('Drive copies: one folder, files updated in place, re-created when deleted in Drive, shared view-only', async () => {
  const g = fakeGoogle();
  const a = await drive.upsert('ana', 'b1', 'json', 'Plan.pragmatic.json', '{"v":1}', g.http);
  const folderCreates = g.calls.filter((c) => c.method === 'POST' && c.body?.includes('application/vnd.google-apps.folder'));
  assert.equal(folderCreates.length, 1);
  assert.ok(g.calls.at(-1)!.body!.includes('"parents":["f1"]'), 'new files go in the pragmatic folder');
  const b = await drive.upsert('ana', 'b1', 'json', 'Plan.pragmatic.json', '{"v":2}', g.http);
  assert.equal(b.id, a.id, 'same file, a new revision');
  assert.equal(g.calls.at(-1)!.method, 'PATCH');
  g.files.delete(a.id);
  const c = await drive.upsert('ana', 'b1', 'json', 'Plan.pragmatic.json', '{"v":3}', g.http);
  assert.notEqual(c.id, a.id, 'deleted in Drive: made again');
  await drive.shareViewOnly('ana', c.id, 'bo@x', g.http);
  const perm = g.calls.at(-1)!;
  assert.match(perm.url, /permissions\?sendNotificationEmail=false/);
  assert.deepEqual(JSON.parse(perm.body!), { type: 'user', role: 'reader', emailAddress: 'bo@x' });
  assert.equal(g.calls.filter((x) => x.url.startsWith('https://oauth2')).length, 1, 'access token is cached');
});
