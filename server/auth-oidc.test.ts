import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import express from 'express';

// A small OpenID provider: discovery, authorize (the person approves at once), token (Basic auth + PKCE), userinfo.
const idp = express(), codes = new Map<string, { challenge: string; redirect: string }>();
let person: Record<string, unknown> = { email: 'Cy@Team.test', email_verified: true, name: 'Cy' };
const idpServer = idp.listen(0);
const ISSUER = `http://127.0.0.1:${(idpServer.address() as { port: number }).port}`;
idp.get('/.well-known/openid-configuration', (_q, r) => { r.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, userinfo_endpoint: `${ISSUER}/userinfo` }); });
idp.get('/authorize', (q, r) => {
  const p = q.query as Record<string, string>;
  assert.equal(p.client_id, 'pragmatic'); assert.equal(p.code_challenge_method, 'S256'); assert.match(p.scope, /email/);
  const code = `c${codes.size}`;
  codes.set(code, { challenge: p.code_challenge, redirect: p.redirect_uri });
  r.redirect(`${p.redirect_uri}?code=${code}&state=${p.state}`);
});
idp.post('/token', express.urlencoded({ extended: false }), (q, r) => {
  const c = codes.get(q.body.code);
  const basic = Buffer.from(String(q.headers.authorization).replace(/^Basic /, ''), 'base64').toString();
  if (!c || basic !== 'pragmatic:s3cret' || q.body.redirect_uri !== c.redirect
    || createHash('sha256').update(q.body.code_verifier).digest('base64url') !== c.challenge) return void r.status(400).json({ error: 'invalid_grant' });
  r.json({ access_token: `at-${q.body.code}`, token_type: 'Bearer' });
});
idp.get('/userinfo', (q, r) => { if (!String(q.headers.authorization).startsWith('Bearer at-')) return void r.status(401).end(); r.json(person); });

process.env.PRAGMATIC_PGLITE = 'memory';
process.env.AUTH = 'oidc';
process.env.ALLOWED_EMAIL_DOMAINS = 'team.test';
process.env.OIDC_ISSUER = ISSUER; process.env.OIDC_CLIENT_ID = 'pragmatic'; process.env.OIDC_CLIENT_SECRET = 's3cret'; process.env.OIDC_NAME = 'Keycloak';
const app = express();
app.use((req, _res, next) => { req.cookies = Object.fromEntries((req.headers.cookie ?? '').split(/;\s*/).filter(Boolean).map((c) => [c.slice(0, c.indexOf('=')), decodeURIComponent(c.slice(c.indexOf('=') + 1))])); next(); });
const auth = await import('./auth.ts');
app.use(auth.authRoutes());
app.get('/me', async (req, res) => { res.json((await auth.sessionUser(req)) ?? null); });
const server = app.listen(0);
const H = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

// The full round trip, as a browser would follow it (the callback is called on this test server, whatever BASE_URL says).
async function signIn(next = '/b/x') {
  const start = await fetch(`${H}/auth/oidc?next=${encodeURIComponent(next)}`, { redirect: 'manual' });
  const cookie = start.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const back = new URL((await fetch(start.headers.get('location')!, { redirect: 'manual' })).headers.get('location')!);
  const done = await fetch(`${H}${back.pathname}${back.search}`, { redirect: 'manual', headers: { cookie } });
  const sid = done.headers.getSetCookie().find((c) => c.startsWith('sid='))?.split(';')[0];
  return { status: done.status, location: done.headers.get('location'), body: done.status >= 400 ? await done.text() : '', sid };
}

test('OIDC: discovery, PKCE, client secret, userinfo; domains and unverified addresses refused', async () => {
  assert.deepEqual((await auth.authInfo()).modes, ['oidc']);
  assert.equal((await auth.authInfo()).oidc, 'Keycloak');
  const ok = await signIn();
  assert.equal(ok.status, 302);
  assert.equal(ok.location, '/b/x', 'back where the person started');
  assert.equal((await (await fetch(`${H}/me`, { headers: { cookie: ok.sid! } })).json()).email, 'cy@team.test', 'email in lower case');

  person = { email: 'eve@gmail.com', email_verified: true };
  assert.match((await signIn()).body, /@team.test/);
  person = { email: 'dan@team.test', email_verified: false };
  assert.match((await signIn()).body, /not verified/);
  person = { preferred_username: 'noemail' };
  assert.match((await signIn()).body, /no email/);
  server.close(); idpServer.close();
});
