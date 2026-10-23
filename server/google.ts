import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { now, one, run } from './db.ts';
import { DATA_DIR, GOOGLE } from './config.ts';

// Each person's Google refresh token (drive.file scope), encrypted at rest with AES-256-GCM.
// The key comes from PRAGMATIC_SECRET (base64, 32 bytes) or, when unset, <data dir>/secret.key (made on first use, never in git).

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (cachedKey) return cachedKey;
  if (process.env.PRAGMATIC_SECRET) return (cachedKey = Buffer.from(process.env.PRAGMATIC_SECRET, 'base64'));
  if (process.env.PRAGMATIC_PGLITE === 'memory') return (cachedKey = randomBytes(32)); // tests
  const file = join(DATA_DIR, 'secret.key');
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(file)) { writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 }); chmodSync(file, 0o600); }
  return (cachedKey = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64'));
}
export function seal(text: string) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}
export function open(sealed: string) {
  const [iv, tag, data] = sealed.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const saveRefreshToken = (userId: string, token: string) =>
  run(`INSERT INTO google_tokens (user_id, refresh_enc, updated_at) VALUES ($1, $2, $3)
    ON CONFLICT (user_id) DO UPDATE SET refresh_enc = excluded.refresh_enc, updated_at = excluded.updated_at`, userId, seal(token), now());
export const hasDrive = async (userId: string) => !!(await one('SELECT 1 FROM google_tokens WHERE user_id = $1', userId));
export const forgetDrive = async (userId: string) => { access.delete(userId); await run('DELETE FROM google_tokens WHERE user_id = $1', userId); };
export const folderOf = async (userId: string) => (await one<{ folder_id: string | null }>('SELECT folder_id FROM google_tokens WHERE user_id = $1', userId))?.folder_id ?? null;
export const setFolder = (userId: string, id: string) => run('UPDATE google_tokens SET folder_id = $1 WHERE user_id = $2', id, userId);

export class NoDrive extends Error {}
// Short-lived access tokens, refreshed from the stored refresh token.
const access = new Map<string, { token: string; until: number }>();
export async function accessToken(userId: string, http: typeof fetch = fetch): Promise<string> {
  const hit = access.get(userId);
  if (hit && hit.until > now() + 60e3) return hit.token;
  const row = await one<{ refresh_enc: string }>('SELECT refresh_enc FROM google_tokens WHERE user_id = $1', userId);
  if (!row) throw new NoDrive('Connect Google Drive first');
  const r = await http('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: open(row.refresh_enc), client_id: GOOGLE?.id ?? '', client_secret: GOOGLE?.secret ?? '' }),
  });
  if (r.status === 400 || r.status === 401) { await forgetDrive(userId); throw new NoDrive('Google Drive access was removed; connect it again'); }
  if (!r.ok) throw new Error(`Google token refresh failed (${r.status})`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  access.set(userId, { token: j.access_token, until: now() + j.expires_in * 1000 });
  return j.access_token;
}
