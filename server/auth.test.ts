import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.PRAGMATIC_PGLITE = 'memory';
process.env.AUTH = 'password';
process.env.ALLOWED_EMAIL_DOMAINS = 'team.test';
const auth = await import('./auth.ts');
const { one } = await import('./db.ts');

const app = express();
app.use((req, _res, next) => { req.cookies = Object.fromEntries((req.headers.cookie ?? '').split(/;\s*/).filter(Boolean).map((c) => [c.slice(0, c.indexOf('=')), decodeURIComponent(c.slice(c.indexOf('=') + 1))])); next(); });
app.use(auth.authRoutes());
app.get('/me', async (req, res) => { res.json((await auth.sessionUser(req)) ?? null); });
const server = app.listen(0);
const H = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const post = (path: string, body: object) => fetch(H + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const cookieOf = (r: Response) => r.headers.getSetCookie().find((c) => c.startsWith('sid='))!.split(';')[0];
const me = async (cookie: string) => (await (await fetch(`${H}/me`, { headers: { cookie } })).json()) as { email: string } | null;

test('passwords: first account is the admin, invites set a password, a reset signs out, removed people cannot sign in', async () => {
  assert.equal((await auth.authInfo()).setup, true, 'a new install asks for the first account');
  assert.equal((await post('/auth/password/setup', { email: 'ann@other.test', password: 'long enough pw' })).status, 400, 'allowed domains apply');
  assert.equal((await post('/auth/password/setup', { email: 'ann@team.test', password: 'short' })).status, 400, 'short passwords are refused');
  const setup = await post('/auth/password/setup', { email: 'ann@team.test', name: 'Ann', password: 'long enough pw' });
  assert.equal(setup.status, 200);
  const ann = await one<{ id: string; is_admin: boolean; password_hash: string }>('SELECT id, is_admin, password_hash FROM users WHERE email = $1', 'ann@team.test');
  assert.equal(ann!.is_admin, true);
  assert.match(ann!.password_hash, /^scrypt:/, 'stored as a scrypt hash, not the password');
  assert.equal((await me(cookieOf(setup)))?.email, 'ann@team.test');
  assert.equal((await post('/auth/password/setup', { email: 'eve@team.test', password: 'long enough pw' })).status, 400, 'setup works once');

  assert.equal((await post('/auth/password/login', { email: 'ann@team.test', password: 'wrong password' })).status, 400);
  assert.equal((await post('/auth/password/login', { email: 'ann@team.test', password: 'long enough pw' })).status, 200);
  // Only failures count (the end of this test has ten bad ones).
  for (let i = 0; i < 12; i++) assert.equal((await post('/auth/password/login', { email: 'ann@team.test', password: 'long enough pw' })).status, 200);

  // Ann shares with Bo, who has no account: Bo gets an invite link.
  const bo = await auth.userByEmail('bo@team.test');
  assert.equal(bo.invited, true);
  await assert.rejects(auth.userByEmail('bo@gmail.com'), /@team.test/);
  const link = await auth.createInvite(bo.id, ann!.id), token = link.split('/invite/')[1];
  assert.deepEqual(await (await fetch(`${H}/auth/invite/${token}`)).json(), { email: 'bo@team.test', name: 'bo', reset: false });
  const accept = await post(`/auth/invite/${token}`, { name: 'Bo', password: 'bo password 1' });
  assert.equal(accept.status, 200);
  const boCookie = cookieOf(accept);
  assert.equal((await me(boCookie))?.email, 'bo@team.test');
  assert.equal((await post(`/auth/invite/${token}`, { password: 'again and again' })).status, 400, 'an invite works once');
  assert.equal((await auth.userByEmail('bo@team.test')).invited, false);

  // A reset link signs Bo out everywhere; the new password works.
  const reset = (await auth.createInvite(bo.id, ann!.id)).split('/invite/')[1];
  assert.equal((await (await fetch(`${H}/auth/invite/${reset}`)).json()).reset, true);
  await post(`/auth/invite/${reset}`, { password: 'new bo password' });
  assert.equal(await me(boCookie), null, 'old sessions end');
  assert.equal((await post('/auth/password/login', { email: 'bo@team.test', password: 'new bo password' })).status, 200);

  await assert.rejects(auth.updatePerson(ann!.id, ann!.id, { disabled: true }), /own/);
  await auth.updatePerson(ann!.id, bo.id, { disabled: true });
  assert.equal((await post('/auth/password/login', { email: 'bo@team.test', password: 'new bo password' })).status, 400, 'removed people cannot sign in');

  // Ten failed sign-ins from one address lock that address out for a while (two failures above, one for Bo).
  for (let i = 0; i < 7; i++) await post('/auth/password/login', { email: 'zed@team.test', password: 'guess guess guess' });
  assert.equal((await post('/auth/password/login', { email: 'ann@team.test', password: 'long enough pw' })).status, 200, 'nine failures: still open');
  await post('/auth/password/login', { email: 'zed@team.test', password: 'guess guess guess' });
  assert.match((await (await post('/auth/password/login', { email: 'ann@team.test', password: 'long enough pw' })).json()).error, /Too many/);
  server.close();
});
