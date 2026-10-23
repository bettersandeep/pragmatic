import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// Single sign-on plus passwords: the first SSO person is the admin, and nobody can take an account over through the
// first-admin form or an invite link. /auth/dev stands in for the SSO sign-in (it makes the session the same way).
process.env.PRAGMATIC_PGLITE = 'memory';
process.env.AUTH = 'oidc,password';
process.env.OIDC_ISSUER = 'http://127.0.0.1:9'; process.env.OIDC_CLIENT_ID = 'pragmatic';
process.env.PRAGMATIC_DEV_LOGIN = 'admin@team.test';
const auth = await import('./auth.ts');
const { parseCookies } = await import('./request.ts');

const app = express();
app.use((req, _res, next) => { req.cookies = parseCookies(req.headers.cookie); next(); });
app.use(auth.authRoutes());
app.get('/me', async (req, res) => { res.json((await auth.sessionUser(req)) ?? null); });
const server = app.listen(0);
const H = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const post = (path: string, body: object, cookie = '') => fetch(H + path, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
const cookieOf = (r: Response) => r.headers.getSetCookie().find((c) => c.startsWith('sid='))!.split(';')[0];
const me = async (cookie: string) => (await (await fetch(`${H}/me`, { headers: { cookie } })).json()) as { id: string; email: string } | null;

test('mixed modes: no takeover through setup or invites', async () => {
  assert.equal((await auth.authInfo()).setup, true, 'a new install offers the first-admin form');
  const sso = await fetch(`${H}/auth/dev`, { redirect: 'manual' });
  const admin = (await me(cookieOf(sso)))!;
  assert.equal((await auth.authInfo()).setup, false, 'the first SSO person is the admin, so the form closes');

  const grab = await post('/auth/password/setup', { email: 'admin@team.test', password: 'attacker password' });
  assert.equal(grab.status, 400, 'nobody can put a password on the admin account');
  assert.equal(grab.headers.getSetCookie().length, 0);

  // Signed out, the admin is still an account, not someone to invite.
  await post('/auth/logout', {}, cookieOf(sso));
  assert.equal((await auth.userByEmail('admin@team.test')).invited, false);

  // Only an admin gets an invite link for someone new; anyone else is told to ask an admin.
  const bo = await auth.userByEmail('bo@team.test');
  assert.equal(bo.invited, true);
  assert.match((await auth.inviteFor(admin.id, bo)).invite_link ?? '', /\/invite\//);
  assert.deepEqual(await auth.inviteFor(bo.id, await auth.userByEmail('cy@team.test')), { invite_needed: true });
  assert.deepEqual(await auth.inviteFor(bo.id, await auth.userByEmail('admin@team.test')), {}, 'never a link for an account');
  server.close();
});

test('cookies: a value that is not percent-encoding does not fail the request', () => {
  assert.deepEqual(parseCookies('other=50%; sid=a%3Db; =x; bare'), { other: '50%', sid: 'a=b' });
  assert.deepEqual(parseCookies(undefined), {});
});
