import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import express from 'express';

process.env.PRAGMATIC_PGLITE = 'memory';
const { run } = await import('./db.ts');
const { oauthRoutes, oauthUser } = await import('./oauth.ts');

const sha = (s: string) => createHash('sha256').update(s).digest('base64url');
await run('INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, 0)', 'ana', 'ana@x', 'Ana');
const sid = 'session-secret';
await run('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', sha(sid), 'ana', Date.now() + 60e3);

const app = express();
app.use((req, _res, next) => { req.cookies = Object.fromEntries((req.headers.cookie ?? '').split(/;\s*/).filter(Boolean).map((c) => c.split('='))); next(); });
app.use(oauthRoutes());
const server = app.listen(0);
const H = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const form = (path: string, body: Record<string, string>, cookie = '') =>
  fetch(H + path, { method: 'POST', body: new URLSearchParams(body), headers: cookie ? { cookie } : {}, redirect: 'manual' });

test('MCP OAuth: register, consent, PKCE, single-use codes, rotating refresh tokens', async () => {
  const redirect = 'http://127.0.0.1:9999/cb';
  assert.equal((await fetch(`${H}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.com/cb'] }) })).status, 400);
  const { client_id } = await (await fetch(`${H}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'T', redirect_uris: [redirect] }) })).json();
  const verifier = randomBytes(32).toString('base64url');
  const page = await fetch(`${H}/oauth/authorize?response_type=code&client_id=${client_id}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${sha(verifier)}&code_challenge_method=S256&state=s1`, { headers: { cookie: `sid=${sid}` } });
  const csrf = (await page.text()).match(/name="csrf" value="([^"]+)"/)![1];
  const csrfCookie = page.headers.getSetCookie()[0].split(';')[0];
  const fields = { client_id, redirect_uri: redirect, code_challenge: sha(verifier), state: 's1', decision: 'allow' };
  assert.equal((await form('/oauth/authorize', { ...fields, csrf: 'forged' }, `sid=${sid}; ${csrfCookie}`)).status, 400, 'CSRF token must match');
  const back = new URL((await form('/oauth/authorize', { ...fields, csrf }, `sid=${sid}; ${csrfCookie}`)).headers.get('location')!);
  assert.equal(back.searchParams.get('state'), 's1');
  const code = back.searchParams.get('code')!;
  const exchange = (v: string) => form('/oauth/token', { grant_type: 'authorization_code', code, client_id, redirect_uri: redirect, code_verifier: v });
  const ok = await (await exchange(verifier)).json();
  assert.equal((await oauthUser(`Bearer ${ok.access_token}`))?.id, 'ana');
  assert.equal((await exchange(verifier)).status, 400, 'codes are single use');
  const next = await (await form('/oauth/token', { grant_type: 'refresh_token', refresh_token: ok.refresh_token, client_id })).json();
  assert.ok(next.access_token);
  assert.equal((await form('/oauth/token', { grant_type: 'refresh_token', refresh_token: ok.refresh_token, client_id })).status, 400, 'refresh tokens rotate');
  assert.equal(await oauthUser('Bearer pgo_wrong'), undefined);
  server.close();
});
