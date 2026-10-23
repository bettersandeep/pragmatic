import express, { type Request, type Response, type NextFunction } from 'express';
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { all, newId, now, one, run, tx } from './db.ts';
import { DRIVE_SCOPE, hasDrive, saveRefreshToken } from './google.ts';
import { accessChanged } from './store.ts';
import { ALLOWED_EMAIL_DOMAINS, AUTH, BASE_URL, DEV_LOGIN, GOOGLE, LOCAL_USER, OIDC, emailAllowed } from './config.ts';
import { parseCookies } from './request.ts';

export type User = { id: string; email: string; name: string; picture: string | null };

// Sign-in modes (config.ts AUTH): local (one person, no sign-in), oidc, password, google. Every mode ends in the same
// session cookie; the database keeps only its hash. Drive copies use their own Google consent, in any mode.
const SESSION_DAYS = 30, INVITE_DAYS = 7, MIN_PASSWORD = 10;
const secure = BASE_URL.startsWith('https://');
const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url');
const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure, path: '/' };
const userCols = 'u.id, u.email, u.name, u.picture';
export class AuthError extends Error {}

// Where to go after sign-in: a path on this site only (the MCP consent page uses it).
const safeNext = (n: unknown) => (typeof n === 'string' && /^\/(?!\/)/.test(n) && !n.includes('\\') ? n : '/');

// --- people ---------------------------------------------------------------------------
// Someone who has not signed in yet, so a board can be shared with them; their first sign-in reuses this row.
export async function userByEmail(email: string): Promise<User & { invited: boolean }> {
  const e = email.trim().toLowerCase();
  if (AUTH.includes('local')) throw new AuthError('This pragmatic has one user (AUTH=local); there is nobody to share with');
  if (!emailAllowed(e)) throw new AuthError(ALLOWED_EMAIL_DOMAINS.length ? `Only ${ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(', ')} addresses` : 'Not an email address');
  await run('INSERT INTO users (id, email, name, picture, created_at) VALUES ($1, $2, $3, NULL, $4) ON CONFLICT (email) DO NOTHING', newId(), e, e.split('@')[0], now());
  const u = (await one<User & { activated_at: number | null }>(`SELECT ${userCols}, u.activated_at FROM users u WHERE u.email = $1`, e))!;
  // With passwords and no mail server, someone who never signed in needs an admin's invite link.
  return { id: u.id, email: u.email, name: u.name, picture: u.picture, invited: AUTH.includes('password') && !u.activated_at };
}

// One statement, so two first sign-ins at once make one row. The very first person of an install is its admin.
// A team-mode sign-in activates the row (see invited above); the local user of AUTH=local is never activated,
// so moving an install from AUTH=local to passwords still offers the first-admin setup.
async function upsertUser(email: string, name: string, picture: string | null, activate = true): Promise<User> {
  const u = (await one<User & { disabled_at: number | null }>(`INSERT INTO users (id, email, name, picture, created_at, is_admin, activated_at)
    VALUES ($1, $2, $3, $4, $5, NOT EXISTS (SELECT 1 FROM users), $6)
    ON CONFLICT (email) DO UPDATE SET name = excluded.name, picture = COALESCE(excluded.picture, users.picture),
      activated_at = COALESCE(users.activated_at, excluded.activated_at)
    RETURNING id, email, name, picture, disabled_at`, newId(), email, name, picture, now(), activate ? now() : null))!;
  if (u.disabled_at) throw new AuthError('Your access to this pragmatic was removed. Ask an admin.');
  return { id: u.id, email: u.email, name: u.name, picture: u.picture };
}

// --- sessions -------------------------------------------------------------------------
async function startSession(res: Response, user: User) {
  const sid = randomBytes(32).toString('base64url');
  await run('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', sha256(sid), user.id, now() + SESSION_DAYS * 864e5);
  res.cookie('sid', sid, { ...cookieOpts, maxAge: SESSION_DAYS * 864e5 });
}

// Short sessions for the server's own board renders (Drive copies, export_board).
export async function createSession(userId: string, ttl: number) {
  const sid = randomBytes(32).toString('base64url');
  await run('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', sha256(sid), userId, now() + ttl);
  return sid;
}
export const endSession = (sid: string) => run('DELETE FROM sessions WHERE id = $1', sha256(sid));

// AUTH=local: the one person, made on first use.
let localUser: Promise<User> | null = null;
const theLocalUser = () => (localUser ??= upsertUser(LOCAL_USER.email, LOCAL_USER.name, null, false).catch((e) => { localUser = null; throw e; }));

export const sessionUser = (req: Request) => userFromCookie(req.headers.cookie);

// Also used for WebSocket upgrades, which do not pass through Express middleware.
export async function userFromCookie(header: string | undefined): Promise<User | undefined> {
  const sid = parseCookies(header).sid;
  if (sid) {
    const u = await one<User>(`SELECT ${userCols} FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > $2 AND u.disabled_at IS NULL`, sha256(sid), now());
    if (u) return u;
  }
  if (AUTH.includes('local')) return theLocalUser();
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = await sessionUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in first' });
  res.locals.user = user;
  next();
}

export const isAdmin = async (userId: string) => !!(await one<{ is_admin: boolean }>('SELECT is_admin FROM users WHERE id = $1', userId))?.is_admin;

// --- MCP tokens (clients without OAuth) --------------------------------------------------
export async function tokenUser(header: string | undefined): Promise<User | undefined> {
  const token = header?.match(/^Bearer (pgm_[\w-]+)$/)?.[1];
  if (!token) return;
  return one<User>(`UPDATE tokens t SET last_used_at = $2 FROM users u WHERE u.id = t.user_id AND t.hash = $1 AND u.disabled_at IS NULL RETURNING ${userCols}`, sha256(token), now());
}
export async function createToken(userId: string, name: string) {
  const token = `pgm_${randomBytes(24).toString('base64url')}`;
  const id = newId();
  await run('INSERT INTO tokens (id, user_id, name, hash, created_at) VALUES ($1, $2, $3, $4, $5)', id, userId, name, sha256(token), now());
  return { id, token };
}
export const listTokens = (userId: string) =>
  all('SELECT id, name, created_at, last_used_at FROM tokens WHERE user_id = $1 ORDER BY created_at DESC', userId);
export const deleteToken = (userId: string, id: string) => run('DELETE FROM tokens WHERE id = $1 AND user_id = $2', id, userId);

// --- passwords ------------------------------------------------------------------------------
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export async function hashPassword(pw: string) {
  const salt = randomBytes(16), hash = await scrypt(pw, salt, 32, SCRYPT);
  return `scrypt:${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${salt.toString('base64')}:${hash.toString('base64')}`;
}
export async function checkPassword(pw: string, stored: string | null) {
  const [kind, N, r, p, salt, hash] = (stored ?? '').split(':');
  if (kind !== 'scrypt') { await scrypt(pw, randomBytes(16), 32, SCRYPT); return false; } // same time either way
  const want = Buffer.from(hash, 'base64'), got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
  return timingSafeEqual(want, got);
}
const checkNew = (pw: unknown) => {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) throw new AuthError(`A password needs at least ${MIN_PASSWORD} characters`);
  return pw;
};

// Ten failed sign-ins in 15 minutes per client address, and per email from one address: a stranger cannot lock
// someone out from elsewhere, and good sign-ins never count. Behind a reverse proxy, set TRUST_PROXY (config.ts),
// or every person shares the proxy's address.
const FAIL_WINDOW = 15 * 60e3, MAX_FAILS = 10;
const fails = new Map<string, number[]>();
const recentFails = (key: string) => (fails.get(key) ?? []).filter((t) => t > now() - FAIL_WINDOW);
function checkFails(keys: string[]) {
  if (keys.some((k) => recentFails(k).length >= MAX_FAILS)) throw new AuthError('Too many failed tries. Wait 15 minutes.');
}
function addFail(keys: string[]) {
  for (const k of keys) fails.set(k, [...recentFails(k), now()]);
  if (fails.size > 10_000) for (const k of [...fails.keys()]) if (!recentFails(k).length) fails.delete(k);
}

// An invite: a one-time link (hash stored) to set a name and password. Also how an admin resets a password.
export async function createInvite(userId: string, byId: string) {
  const token = randomBytes(24).toString('base64url');
  await tx(async () => {
    await run('DELETE FROM invites WHERE user_id = $1', userId);
    await run('INSERT INTO invites (hash, user_id, created_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)', sha256(token), userId, byId, now(), now() + INVITE_DAYS * 864e5);
  });
  return `${BASE_URL}/invite/${token}`;
}
// Sharing with someone who never signed in (passwords): they need an invite link. Only an admin gets one, because
// the link sets the account's password: anyone else holding it could become that person.
export async function inviteFor(sharerId: string, target: User & { invited: boolean }): Promise<{ invite_link?: string; invite_needed?: boolean }> {
  if (!target.invited) return {};
  return (await isAdmin(sharerId)) ? { invite_link: await createInvite(target.id, sharerId) } : { invite_needed: true };
}
const inviteOf = (token: string) => one<{ user_id: string; email: string; name: string; has_password: boolean }>(`SELECT i.user_id, u.email, u.name, u.password_hash IS NOT NULL AS has_password
  FROM invites i JOIN users u ON u.id = i.user_id WHERE i.hash = $1 AND i.expires_at > $2 AND u.disabled_at IS NULL`, sha256(String(token)), now());

// --- admin: the people of this install --------------------------------------------------------
export const listPeople = () => all(`SELECT u.id, u.email, u.name, u.picture, u.is_admin, u.disabled_at, u.password_hash IS NOT NULL AS has_password,
  (SELECT max(s.expires_at) - ${SESSION_DAYS * 864e5} FROM sessions s WHERE s.user_id = u.id) AS last_sign_in FROM users u ORDER BY lower(u.name)`);
export async function updatePerson(adminId: string, id: string, patch: { is_admin?: boolean; disabled?: boolean }) {
  if (id === adminId && (patch.is_admin === false || patch.disabled)) throw new AuthError('You cannot remove your own admin role or access');
  if (patch.is_admin !== undefined) await run('UPDATE users SET is_admin = $1 WHERE id = $2', !!patch.is_admin, id);
  if (patch.disabled !== undefined) {
    await run('UPDATE users SET disabled_at = $1 WHERE id = $2', patch.disabled ? now() : null, id);
    if (patch.disabled) await tx(async () => {
      await run('DELETE FROM sessions WHERE user_id = $1', id);
      await run('DELETE FROM tokens WHERE user_id = $1', id);
      await run('DELETE FROM oauth_tokens WHERE user_id = $1', id);
    });
    if (patch.disabled) accessChanged(); // ends their live board connections too
  }
}

// --- what the sign-in page shows ----------------------------------------------------------------
// The first-admin form is open only while nobody ever signed in to a team mode. With AUTH=oidc,password the
// first single sign-on person is the admin (upsertUser), so the form closes then too.
const setupOpen = async () => AUTH.includes('password') && !(await one('SELECT 1 FROM users WHERE activated_at IS NOT NULL'));
export async function authInfo() {
  const setup = await setupOpen();
  return {
    modes: AUTH, oidc: OIDC?.name ?? null, setup, dev: !!DEV_LOGIN,
    // "Connect Google Drive" (Settings): there when the server has a Google client.
    drive: !!GOOGLE,
  };
}

// --- Google (sign-in, and Drive consent in any mode) ---------------------------------------------------
type GoogleClaims = { email?: string; email_verified?: boolean; hd?: string; name?: string; picture?: string; aud?: string; iss?: string };
// With allowed domains, the account must belong to that Google Workspace (`hd`), so a gmail.com address with a matching
// suffix can never pass. Without, any verified Google account.
export const domainAllowed = (c: GoogleClaims, domains: string[]) => {
  const email = c.email?.toLowerCase() ?? '', domain = email.split('@')[1];
  return c.email_verified === true && !!domain && (!domains.length || (domains.includes(domain) && c.hd === domain));
};

function googleStart(req: Request, res: Response, purpose: 'signin' | 'drive') {
  if (!GOOGLE) return res.status(404).send('Google is not set up on this pragmatic (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET).');
  const state = randomBytes(16).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  const consent = purpose === 'drive' || req.query.consent === '1';
  res.cookie('g_oauth', JSON.stringify({ state, verifier, next: safeNext(req.query.next), consent, purpose }), { ...cookieOpts, maxAge: 10 * 60e3 });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: GOOGLE.id, redirect_uri: `${BASE_URL}/auth/google/callback`, response_type: 'code',
    // drive.file: copies of the person's own boards in their Drive; the app sees only files it made.
    scope: purpose === 'drive' ? DRIVE_SCOPE : `openid email profile ${DRIVE_SCOPE}`, access_type: 'offline', include_granted_scopes: 'true',
    state, code_challenge: sha256(verifier), code_challenge_method: 'S256', prompt: consent ? 'consent' : 'select_account',
    ...(ALLOWED_EMAIL_DOMAINS.length === 1 && purpose === 'signin' ? { hd: ALLOWED_EMAIL_DOMAINS[0] } : {}),
  }).toString();
  res.redirect(url.toString());
}

async function googleCallback(req: Request, res: Response) {
  const saved = JSON.parse(req.cookies?.g_oauth ?? 'null') as { state: string; verifier: string; next?: string; consent?: boolean; purpose?: string } | null;
  res.clearCookie('g_oauth', cookieOpts);
  if (!GOOGLE || !saved || req.query.state !== saved.state || typeof req.query.code !== 'string') return res.status(400).send('Sign-in failed: state mismatch. Try again.');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      code: req.query.code, client_id: GOOGLE.id, client_secret: GOOGLE.secret,
      redirect_uri: `${BASE_URL}/auth/google/callback`, grant_type: 'authorization_code', code_verifier: saved.verifier,
    }),
  });
  if (!r.ok) return res.status(400).send(`Sign-in failed: Google token exchange returned ${r.status}.`);
  const { id_token, refresh_token, scope } = (await r.json()) as { id_token?: string; refresh_token?: string; scope?: string };
  const drive = scope?.split(' ').includes(DRIVE_SCOPE);
  // Drive consent for someone already signed in (any sign-in mode).
  if (saved.purpose === 'drive') {
    const me = await sessionUser(req);
    if (!me) return res.status(401).send('Sign in to pragmatic first.');
    if (!drive || !refresh_token) return res.status(400).send('Google did not grant Drive access. Try again and allow it.');
    await saveRefreshToken(me.id, refresh_token);
    return res.redirect(safeNext(saved.next));
  }
  if (!AUTH.includes('google') || !id_token) return res.status(404).send('Google sign-in is not on for this pragmatic.');
  // The ID token came straight from Google's token endpoint over TLS, so Google's docs
  // allow using its claims without a signature check. We still check audience and issuer.
  const c = JSON.parse(Buffer.from(id_token.split('.')[1], 'base64url').toString()) as GoogleClaims;
  if (c.aud !== GOOGLE.id || !['accounts.google.com', 'https://accounts.google.com'].includes(c.iss ?? '')) return res.status(400).send('Sign-in failed: token is not for this app.');
  if (!domainAllowed(c, ALLOWED_EMAIL_DOMAINS)) return res.status(403).send(ALLOWED_EMAIL_DOMAINS.length ? `Only verified ${ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(', ')} Google Workspace accounts can sign in.` : 'Only verified Google accounts can sign in.');
  const user = await upsertUser(c.email!.toLowerCase(), c.name ?? c.email!, c.picture ?? null);
  await startSession(res, user);
  if (drive && refresh_token) await saveRefreshToken(user.id, refresh_token);
  // Google sends a refresh token only on a consent screen; ask once more if we have none for this person.
  else if (drive && !(await hasDrive(user.id)) && !saved.consent) return res.redirect(`/auth/google?consent=1&next=${encodeURIComponent(safeNext(saved.next))}`);
  res.redirect(safeNext(saved.next));
}

// --- OpenID Connect ----------------------------------------------------------------------------------
type Discovery = { authorization_endpoint: string; token_endpoint: string; userinfo_endpoint: string };
let discovery: Promise<Discovery> | null = null;
const discover = () => (discovery ??= fetch(`${OIDC!.issuer}/.well-known/openid-configuration`).then(async (r) => {
  if (!r.ok) throw new Error(`OIDC discovery at ${OIDC!.issuer} returned ${r.status}`);
  return r.json() as Promise<Discovery>;
}).catch((e) => { discovery = null; throw e; }));

async function oidcStart(req: Request, res: Response) {
  if (!AUTH.includes('oidc') || !OIDC) return res.status(404).end();
  const d = await discover();
  const state = randomBytes(16).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  res.cookie('o_oauth', JSON.stringify({ state, verifier, next: safeNext(req.query.next) }), { ...cookieOpts, maxAge: 10 * 60e3 });
  const url = new URL(d.authorization_endpoint);
  for (const [k, v] of Object.entries({ client_id: OIDC.id, redirect_uri: `${BASE_URL}/auth/oidc/callback`, response_type: 'code', scope: OIDC.scopes, state, code_challenge: sha256(verifier), code_challenge_method: 'S256' }))
    url.searchParams.set(k, v);
  res.redirect(url.toString());
}

async function oidcCallback(req: Request, res: Response) {
  const saved = JSON.parse(req.cookies?.o_oauth ?? 'null') as { state: string; verifier: string; next?: string } | null;
  res.clearCookie('o_oauth', cookieOpts);
  if (!OIDC || !saved || req.query.state !== saved.state || typeof req.query.code !== 'string') return res.status(400).send('Sign-in failed: state mismatch. Try again.');
  const d = await discover();
  // A confidential client authenticates with HTTP Basic (the spec's default); a public one relies on PKCE alone.
  const r = await fetch(d.token_endpoint, {
    method: 'POST',
    headers: OIDC.secret ? { authorization: `Basic ${Buffer.from(`${encodeURIComponent(OIDC.id)}:${encodeURIComponent(OIDC.secret)}`).toString('base64')}` } : {},
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: req.query.code, redirect_uri: `${BASE_URL}/auth/oidc/callback`, code_verifier: saved.verifier,
      ...(OIDC.secret ? {} : { client_id: OIDC.id }),
    }),
  });
  if (!r.ok) return res.status(400).send(`Sign-in failed: the identity provider returned ${r.status}.`);
  const { access_token } = (await r.json()) as { access_token?: string };
  // The person's details from the provider's userinfo endpoint (asked with their own token, so nothing to forge).
  const info = access_token ? await fetch(d.userinfo_endpoint, { headers: { authorization: `Bearer ${access_token}` } }) : null;
  if (!info?.ok) return res.status(400).send('Sign-in failed: no user details from the identity provider.');
  const c = (await info.json()) as { email?: string; email_verified?: boolean; name?: string; preferred_username?: string; picture?: string };
  const email = c.email?.toLowerCase();
  if (!email) return res.status(403).send('Sign-in failed: the identity provider sent no email address (add the "email" scope or claim).');
  if (c.email_verified === false) return res.status(403).send('Sign-in failed: the email address is not verified.');
  if (!emailAllowed(email)) return res.status(403).send(`Only ${ALLOWED_EMAIL_DOMAINS.map((x) => `@${x}`).join(', ')} accounts can sign in.`);
  await startSession(res, await upsertUser(email, c.name ?? c.preferred_username ?? email.split('@')[0], c.picture ?? null));
  res.redirect(safeNext(saved.next));
}

// --- routes ----------------------------------------------------------------------------------------
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try { await fn(req, res); } catch (e) {
    if (e instanceof AuthError) return void res.status(400).json({ error: e.message });
    throw e;
  }
};

export function authRoutes() {
  const r = express.Router();
  r.get('/auth/google', (req, res) => (AUTH.includes('google') ? googleStart(req, res, 'signin') : res.status(404).end()));
  r.get('/auth/drive', async (req, res) => ((await sessionUser(req)) ? googleStart(req, res, 'drive') : res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`)));
  const page = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch((e) => (e instanceof AuthError ? res.status(403).send(e.message) : next(e)));
  r.get('/auth/google/callback', page(googleCallback));
  r.get('/auth/oidc', page(oidcStart));
  r.get('/auth/oidc/callback', page(oidcCallback));

  // First start with passwords: the first account becomes the admin.
  r.post('/auth/password/setup', express.json(), wrap(async (req, res) => {
    const closed = 'This pragmatic already has an admin; sign in instead';
    if (!(await setupOpen())) throw new AuthError(closed);
    const email = String(req.body.email ?? '').trim().toLowerCase(), name = String(req.body.name ?? '').trim();
    if (!emailAllowed(email)) throw new AuthError('Give a valid email address' + (ALLOWED_EMAIL_DOMAINS.length ? ` (${ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(', ')})` : ''));
    const hash = await hashPassword(checkNew(req.body.password));
    // Checked again under a lock, so two forms sent at once make one admin.
    const u = await tx(async () => {
      await run('SELECT pg_advisory_xact_lock(7340212)');
      if (!(await setupOpen())) throw new AuthError(closed);
      const u = await upsertUser(email, name || email.split('@')[0], null);
      await run('UPDATE users SET password_hash = $1, is_admin = true WHERE id = $2', hash, u.id);
      return u;
    });
    await startSession(res, u);
    res.json({ ok: true });
  }));
  r.post('/auth/password/login', express.json(), wrap(async (req, res) => {
    if (!AUTH.includes('password')) return void res.status(404).end();
    const email = String(req.body.email ?? '').trim().toLowerCase(), keys = [`ip:${req.ip}`, `e:${email}|${req.ip}`];
    checkFails(keys);
    const u = await one<User & { password_hash: string | null; disabled_at: number | null }>(`SELECT ${userCols}, u.password_hash, u.disabled_at FROM users u WHERE u.email = $1`, email);
    if (!(await checkPassword(String(req.body.password ?? ''), u?.password_hash ?? null)) || !u || u.disabled_at) {
      addFail(keys);
      throw new AuthError('Wrong email or password');
    }
    await startSession(res, u);
    res.json({ ok: true });
  }));
  r.get('/auth/invite/:token', wrap(async (req, res) => {
    const i = await inviteOf(String(req.params.token));
    if (!i) throw new AuthError('This invite link expired or was used. Ask for a new one.');
    res.json({ email: i.email, name: i.name, reset: i.has_password });
  }));
  r.post('/auth/invite/:token', express.json(), wrap(async (req, res) => {
    const i = await inviteOf(String(req.params.token));
    if (!i) throw new AuthError('This invite link expired or was used. Ask for a new one.');
    const hash = await hashPassword(checkNew(req.body.password)), name = String(req.body.name ?? '').trim() || i.name;
    await tx(async () => {
      await run('UPDATE users SET password_hash = $1, name = $2, activated_at = COALESCE(activated_at, $4) WHERE id = $3', hash, name, i.user_id, now());
      await run('DELETE FROM invites WHERE user_id = $1', i.user_id);
      await run('DELETE FROM sessions WHERE user_id = $1', i.user_id); // a reset signs out everywhere else
    });
    await startSession(res, { id: i.user_id, email: i.email, name, picture: null });
    res.json({ ok: true });
  }));

  // Local testing without an identity provider. Off unless PRAGMATIC_DEV_LOGIN is set, and loopback only.
  r.get('/auth/dev', async (req, res) => {
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
    if (!DEV_LOGIN || !loopback) return res.status(404).end();
    await startSession(res, await upsertUser(DEV_LOGIN, DEV_LOGIN.split('@')[0], null));
    res.redirect(safeNext(req.query.next));
  });
  r.post('/auth/logout', async (req, res) => {
    if (req.cookies?.sid) await endSession(req.cookies.sid);
    res.clearCookie('sid', cookieOpts);
    res.status(204).end();
  });
  return r;
}
