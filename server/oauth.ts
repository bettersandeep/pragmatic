import express, { type Request, type Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { all, now, one, run, tx } from './db.ts';
import * as auth from './auth.ts';
import { BASE_URL } from './tasks.ts';

// OAuth 2.1 for the MCP endpoint, so any MCP client signs in with pragmatic's own sign-in (any AUTH mode) instead of a
// pasted token: metadata discovery, dynamic client registration, consent, PKCE (S256), rotating refresh tokens.

const ACCESS_TTL = 3600e3, REFRESH_TTL = 30 * 864e5, CODE_TTL = 60e3;
const sha = (s: string) => createHash('sha256').update(s).digest('base64url');
const secret = (prefix: string) => `${prefix}${randomBytes(32).toString('base64url')}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const resourceMetadataUrl = `${BASE_URL}/.well-known/oauth-protected-resource`;

// Native and CLI clients listen on loopback; anything else must be https.
const okRedirect = (u: string) => {
  try { const x = new URL(u); return x.protocol === 'https:' || (x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname)); } catch { return false; }
};
const clientOf = async (id: unknown) =>
  typeof id === 'string' ? one<{ id: string; name: string; redirect_uris: string }>('SELECT id, name, redirect_uris FROM oauth_clients WHERE id = $1', id) : undefined;

function issue(clientId: string, userId: string) {
  const access = secret('pgo_'), refresh = secret('pgr_'), t = now();
  return tx(async () => {
    await run('DELETE FROM oauth_tokens WHERE user_id = $1 AND expires_at < $2', userId, t);
    const ins = 'INSERT INTO oauth_tokens (hash, kind, client_id, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6)';
    await run(ins, sha(access), 'access', clientId, userId, t + ACCESS_TTL, t);
    await run(ins, sha(refresh), 'refresh', clientId, userId, t + REFRESH_TTL, t);
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: 'mcp' };
  });
}

// The user behind an OAuth access token (pgo_...), if it is valid.
export async function oauthUser(header: string | undefined): Promise<auth.User | undefined> {
  const token = header?.match(/^Bearer (pgo_[\w-]+)$/)?.[1];
  if (!token) return;
  return one<auth.User>(`UPDATE oauth_tokens t SET last_used_at = $2 FROM users u
    WHERE u.id = t.user_id AND t.hash = $1 AND t.kind = 'access' AND t.expires_at > $2 RETURNING u.id, u.email, u.name, u.picture`, sha(token), now());
}

export const connectedApps = (userId: string) =>
  all(`SELECT c.id, c.name, min(t.created_at) AS connected_at, max(t.last_used_at) AS last_used_at FROM oauth_tokens t
    JOIN oauth_clients c ON c.id = t.client_id WHERE t.user_id = $1 AND t.expires_at > $2 GROUP BY c.id, c.name ORDER BY c.name`, userId, now());
export const revokeApp = (userId: string, clientId: string) => run('DELETE FROM oauth_tokens WHERE user_id = $1 AND client_id = $2', userId, clientId);

const oops = (res: Response, status: number, error: string, description: string) => res.status(status).json({ error, error_description: description });

function consentPage(res: Response, user: auth.User, client: { name: string }, fields: Record<string, string>, csrf: string) {
  res.cookie('oauth_csrf', csrf, { httpOnly: true, sameSite: 'strict', secure: BASE_URL.startsWith('https://'), path: '/oauth', maxAge: 10 * 60e3 });
  const hidden = Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to pragmatic</title><link rel="icon" href="/favicon.svg">
<style>:root{color-scheme:light dark;--bg:#fff;--card:#fff;--text:#1d1d22;--muted:#6b6b76;--border:#e3e3e8}
@media (prefers-color-scheme:dark){:root{--bg:#121418;--card:#1a1d23;--text:#e8e8ee;--muted:#9a9ca8;--border:#2c3039}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}
main{width:min(420px,calc(100% - 32px));padding:28px;border:1px solid var(--border);border-radius:14px;background:var(--card);text-align:center}
img{width:56px;height:56px}h1{font-size:20px;margin:12px 0 6px}p{color:var(--muted);margin:0 0 20px}
.row{display:flex;gap:10px;justify-content:center}button{height:38px;padding:0 18px;border-radius:8px;border:1px solid var(--border);background:none;color:var(--text);font:inherit;cursor:pointer}
button[value=allow]{background:#6d5dfc;border-color:#6d5dfc;color:#fff}</style></head>
<body><main><img src="/favicon.svg" alt=""><h1>Allow ${esc(client.name)} to use pragmatic?</h1>
<p>It will read and edit the boards you can access, as ${esc(user.email)}. You can disconnect it in Settings.</p>
<form method="post" action="/oauth/authorize">${hidden}<input type="hidden" name="csrf" value="${esc(csrf)}">
<div class="row"><button name="decision" value="deny">Cancel</button><button name="decision" value="allow">Allow</button></div></form></main></body></html>`);
}

export function oauthRoutes() {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false }));

  const resourceMeta = (_req: Request, res: Response) =>
    res.json({ resource: `${BASE_URL}/mcp`, authorization_servers: [BASE_URL], bearer_methods_supported: ['header'], scopes_supported: ['mcp'] });
  r.get('/.well-known/oauth-protected-resource', resourceMeta);
  r.get('/.well-known/oauth-protected-resource/mcp', resourceMeta);
  r.get('/.well-known/oauth-authorization-server', (_req, res) => res.json({
    issuer: BASE_URL, authorization_endpoint: `${BASE_URL}/oauth/authorize`, token_endpoint: `${BASE_URL}/oauth/token`,
    registration_endpoint: `${BASE_URL}/oauth/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['mcp'],
  }));

  // Dynamic client registration (public clients only; PKCE protects the code).
  r.post('/oauth/register', express.json(), async (req, res) => {
    const uris = req.body?.redirect_uris;
    if (!Array.isArray(uris) || !uris.length || !uris.every((u) => typeof u === 'string' && okRedirect(u)))
      return oops(res, 400, 'invalid_redirect_uri', 'redirect_uris must be https, or http on localhost');
    const id = `pgc_${randomBytes(16).toString('base64url')}`, name = String(req.body.client_name ?? 'MCP client').slice(0, 80);
    await run('INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES ($1, $2, $3, $4)', id, name, JSON.stringify(uris), now());
    res.status(201).json({ client_id: id, client_name: name, redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
  });

  r.get('/oauth/authorize', async (req, res) => {
    const q = req.query as Record<string, string>, client = await clientOf(q.client_id);
    if (!client || !(JSON.parse(client.redirect_uris) as string[]).includes(q.redirect_uri)) return res.status(400).send('Unknown client or redirect URI.');
    const back = new URL(q.redirect_uri);
    if (q.state) back.searchParams.set('state', q.state);
    if (q.response_type !== 'code' || q.code_challenge_method !== 'S256' || !q.code_challenge) {
      back.searchParams.set('error', 'invalid_request');
      return res.redirect(back.toString());
    }
    const user = await auth.sessionUser(req);
    if (!user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    consentPage(res, user, client, { client_id: client.id, redirect_uri: q.redirect_uri, code_challenge: q.code_challenge, state: q.state ?? '' }, randomBytes(16).toString('base64url'));
  });

  r.post('/oauth/authorize', async (req, res) => {
    const b = req.body as Record<string, string>, user = await auth.sessionUser(req), client = await clientOf(b.client_id);
    if (!user || !b.csrf || b.csrf !== req.cookies?.oauth_csrf) return res.status(400).send('This request expired. Start the connection again.');
    if (!client || !(JSON.parse(client.redirect_uris) as string[]).includes(b.redirect_uri)) return res.status(400).send('Unknown client or redirect URI.');
    res.clearCookie('oauth_csrf', { path: '/oauth' });
    const back = new URL(b.redirect_uri);
    if (b.state) back.searchParams.set('state', b.state);
    if (b.decision !== 'allow') { back.searchParams.set('error', 'access_denied'); return res.redirect(back.toString()); }
    const code = secret('pgk_');
    await run('INSERT INTO oauth_codes (hash, client_id, user_id, redirect_uri, challenge, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
      sha(code), client.id, user.id, b.redirect_uri, b.code_challenge, now() + CODE_TTL);
    back.searchParams.set('code', code);
    res.redirect(back.toString());
  });

  r.post('/oauth/token', express.json(), async (req, res) => {
    const b = (req.body ?? {}) as Record<string, string>;
    res.set('Cache-Control', 'no-store');
    if (b.grant_type === 'authorization_code') {
      // Taken and removed in one statement: a code works once, even for two requests at the same time.
      const row = await one<{ client_id: string; user_id: string; redirect_uri: string; challenge: string; expires_at: number }>(
        'DELETE FROM oauth_codes WHERE hash = $1 RETURNING client_id, user_id, redirect_uri, challenge, expires_at', sha(String(b.code ?? '')));
      if (!row || row.expires_at < now() || row.client_id !== b.client_id || row.redirect_uri !== b.redirect_uri || sha(String(b.code_verifier ?? '')) !== row.challenge)
        return oops(res, 400, 'invalid_grant', 'The code is invalid, expired or does not match');
      return res.json(await issue(row.client_id, row.user_id));
    }
    if (b.grant_type === 'refresh_token') {
      const h = sha(String(b.refresh_token ?? ''));
      // Rotation: the old refresh token is removed as it is used, once.
      const row = await one<{ client_id: string; user_id: string }>(
        `DELETE FROM oauth_tokens WHERE hash = $1 AND kind = 'refresh' AND expires_at > $2 AND client_id = $3 RETURNING client_id, user_id`, h, now(), String(b.client_id ?? ''));
      if (!row) return oops(res, 400, 'invalid_grant', 'The refresh token is invalid or expired');
      return res.json(await issue(row.client_id, row.user_id));
    }
    oops(res, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token');
  });
  return r;
}
