import { userInfo } from 'node:os';
import { join } from 'node:path';

// Every setting, from the environment (.env locally, the container's env elsewhere). See .env.example.
// An empty value (an empty line in .env) counts as not set.
const env = new Proxy(process.env, { get: (e, k: string) => (e[k] === '' ? undefined : e[k]) }) as NodeJS.ProcessEnv;
// A setting that cannot work: one clear line, then stop (no stack trace for a configuration mistake).
const fail = (msg: string): never => { console.error(`pragmatic: ${msg}`); process.exit(1); };
const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const PORT = Number(env.PORT ?? 3100);
// Loopback by default: only this machine. HOST=0.0.0.0 for a local network (the container sets it).
export const HOST = env.HOST ?? '127.0.0.1';
// The address people open pragmatic at; links, sign-in redirects and MCP use it.
export const BASE_URL = (env.BASE_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '');

// Where the board renderer (render.ts) opens boards: this address, or the server directly inside a container.
export const RENDER_URL = (env.RENDER_URL ?? BASE_URL).replace(/\/$/, '');
// Behind a reverse proxy: Express's "trust proxy" (true, a hop count, or addresses), so the sign-in limits see each
// person's address instead of the proxy's. Unset: the direct peer.
export const TRUST_PROXY = env.TRUST_PROXY === undefined ? false : env.TRUST_PROXY === 'true' ? true : /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY;

// Data on disk: the built-in database (when DATABASE_URL is not set), uploaded images, the encryption key.
export const DATA_DIR = env.PRAGMATIC_DATA ?? 'data';
export const FILES_DIR = env.PRAGMATIC_FILES ?? join(DATA_DIR, 'files');

// Sign-in: one or more of local (no sign-in, one person), oidc, password, google.
export type AuthMode = 'local' | 'oidc' | 'password' | 'google';
const MODES: AuthMode[] = ['local', 'oidc', 'password', 'google'];
export const AUTH = list(env.AUTH ?? 'local') as AuthMode[];
for (const m of AUTH) if (!MODES.includes(m)) fail(`AUTH=${env.AUTH}: "${m}" is not one of ${MODES.join(', ')}`);
if (AUTH.includes('local') && AUTH.length > 1) fail('AUTH=local is for one person and cannot be combined with other sign-in modes');

// Who may sign in and be shared with, by email domain. Empty: anyone the sign-in mode lets in.
// ALLOWED_DOMAIN (one domain) is the older name.
export const ALLOWED_EMAIL_DOMAINS = list(env.ALLOWED_EMAIL_DOMAINS ?? env.ALLOWED_DOMAIN);
export const emailAllowed = (email: string) =>
  /^[^@\s]+@[^@\s]+\.[^@\s]+$|^[^@\s]+@localhost$/.test(email) && (!ALLOWED_EMAIL_DOMAINS.length || ALLOWED_EMAIL_DOMAINS.some((d) => email.endsWith(`@${d}`)));

// AUTH=local: the one person who uses this install.
// (In a container the OS user is a service account such as "node", which is no name for a person.)
const osName = userInfo().username;
export const LOCAL_USER = { email: (env.LOCAL_USER_EMAIL ?? 'me@localhost').toLowerCase(), name: env.LOCAL_USER_NAME ?? (['node', 'root'].includes(osName) ? 'Me' : osName) };
const isLoopback = (h: string | undefined) => ['127.0.0.1', 'localhost', '::1'].includes(h ?? '');
// Without sign-in, anyone who reaches the server is that person. So only on loopback. In a container the server
// listens on 0.0.0.0 inside; docker-compose passes the address it publishes the port on (PRAGMATIC_BIND).
// LOCAL_MODE_EXPOSED=yes is for other setups that keep the port private themselves.
if (AUTH.includes('local') && !isLoopback(HOST) && !isLoopback(env.PRAGMATIC_BIND) && env.LOCAL_MODE_EXPOSED !== 'yes')
  fail(`AUTH=local has no sign-in, so the port must stay on this machine (HOST=${HOST}${env.PRAGMATIC_BIND ? `, PRAGMATIC_BIND=${env.PRAGMATIC_BIND}` : ''}). For a network, set AUTH=oidc or AUTH=password.`);

// Google: sign-in (AUTH=google) and Drive copies (any mode, "Connect Google Drive" in Settings).
export const GOOGLE = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET } : null;
if (AUTH.includes('google') && !GOOGLE) fail('AUTH=google needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');

// OpenID Connect: Keycloak, Authentik, Okta, Microsoft Entra, JumpCloud, Google Workspace and others.
export const OIDC = env.OIDC_ISSUER && env.OIDC_CLIENT_ID ? {
  issuer: env.OIDC_ISSUER.replace(/\/$/, ''), id: env.OIDC_CLIENT_ID, secret: env.OIDC_CLIENT_SECRET ?? '',
  name: env.OIDC_NAME ?? 'single sign-on', scopes: env.OIDC_SCOPES ?? 'openid email profile',
} : null;
if (AUTH.includes('oidc') && !OIDC) fail('AUTH=oidc needs OIDC_ISSUER and OIDC_CLIENT_ID (and OIDC_CLIENT_SECRET for a confidential client)');

// Local development only: /auth/dev signs in as this email from 127.0.0.1.
export const DEV_LOGIN = env.PRAGMATIC_DEV_LOGIN || null;
