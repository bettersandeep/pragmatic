import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.ts';

// Postgres. With DATABASE_URL (a Postgres server) the server talks to that database with `pg`.
// Without it (local development, tests) it runs PGlite, the Postgres engine in-process, so no database server is needed:
// data in data/pg, or in memory when PRAGMATIC_PGLITE=memory (each test file gets an empty database).
type Result<T> = { rows: T[]; rowCount?: number | null; affectedRows?: number };
type Conn = { query<T>(sql: string, params?: unknown[]): Promise<Result<T>> };
type Db = { conn: Conn; exec(sql: string): Promise<unknown>; tx<T>(fn: (c: Conn) => Promise<T>): Promise<T>; close(): Promise<void> };

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: pg } = await import('pg');
    pg.types.setTypeParser(pg.types.builtins.INT8, Number); // millisecond times and counts fit a JS number
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    pool.on('error', (e) => console.error('postgres connection error', e.message));
    return {
      conn: pool as unknown as Conn,
      exec: (sql) => pool.query(sql),
      async tx(fn) {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const r = await fn(c as unknown as Conn);
          await c.query('COMMIT');
          return r;
        } catch (e) {
          await c.query('ROLLBACK').catch(() => {});
          throw e;
        } finally { c.release(); }
      },
      close: () => pool.end(),
    };
  }
  const lite = await import('@electric-sql/pglite');
  const dir = process.env.PRAGMATIC_PGLITE || join(DATA_DIR, 'pg');
  if (dir !== 'memory') mkdirSync(dir, { recursive: true }); // a new install: the data folder does not exist yet
  const pgl = await lite.PGlite.create({ ...(dir === 'memory' ? {} : { dataDir: dir }), parsers: { [lite.types.INT8]: Number } });
  return { conn: pgl, exec: (sql) => pgl.exec(sql), tx: (fn) => pgl.transaction(fn), close: () => pgl.close() };
}

const db = await open();
// Queries inside tx() run on the transaction's connection.
const inTx = new AsyncLocalStorage<Conn>();
const conn = () => inTx.getStore() ?? db.conn;
// Work started from inside a transaction that must not use its connection (it may be released by then).
export const outsideTx = <T>(fn: () => T) => inTx.exit(fn);

export const all = async <T = Record<string, unknown>>(sql: string, ...params: unknown[]) => (await conn().query<T>(sql, params)).rows;
export const one = async <T = Record<string, unknown>>(sql: string, ...params: unknown[]) => (await all<T>(sql, ...params))[0] as T | undefined;
// Rows changed.
export async function run(sql: string, ...params: unknown[]) {
  const r = await conn().query(sql, params);
  return r.rowCount ?? r.affectedRows ?? 0;
}
export const tx = <T>(fn: () => Promise<T>): Promise<T> => (inTx.getStore() ? fn() : db.tx((c) => inTx.run(c, fn)));
export const closeDb = () => db.close();

// Schema changes, applied once each, in order. Never edit a released step: add a new one.
const MIGRATIONS = [`
CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, picture TEXT, created_at BIGINT NOT NULL
);
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at BIGINT NOT NULL);
CREATE TABLE tokens (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
  hash TEXT UNIQUE NOT NULL, created_at BIGINT NOT NULL, last_used_at BIGINT
);
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('folder', 'board', 'doc')),
  title TEXT NOT NULL,
  parent_id TEXT REFERENCES items(id),
  scope TEXT NOT NULL CHECK (scope IN ('private', 'team')),
  owner_id TEXT NOT NULL REFERENCES users(id),
  -- Anyone in the workspace who has the link gets this role.
  link_access TEXT NOT NULL DEFAULT 'none' CHECK (link_access IN ('none', 'view', 'comment', 'edit')),
  thumbnail TEXT, -- an uploaded picture of part of the board, for the Recent page
  search_text TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, deleted_at BIGINT
);
CREATE INDEX items_parent ON items (parent_id);
CREATE INDEX items_owner ON items (owner_id);
-- Board storage (see history.ts): an append-only log of Yjs updates, and checkpoints of the full state at a log position.
-- seq comes from one sequence for all boards, so it orders the updates of each board.
CREATE TABLE updates (
  board_id TEXT NOT NULL REFERENCES items(id), seq BIGINT GENERATED ALWAYS AS IDENTITY, at BIGINT NOT NULL,
  authors TEXT NOT NULL DEFAULT '[]', data BYTEA NOT NULL, PRIMARY KEY (board_id, seq)
);
CREATE TABLE checkpoints (
  board_id TEXT NOT NULL REFERENCES items(id), seq BIGINT NOT NULL, at BIGINT NOT NULL,
  authors TEXT NOT NULL DEFAULT '[]', ydoc BYTEA NOT NULL, PRIMARY KEY (board_id, seq)
);
-- Per-person access to a board (sharing on demand). The owner and, for team items, everyone else edit anyway.
CREATE TABLE shares (
  item_id TEXT NOT NULL REFERENCES items(id), user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('view', 'comment', 'edit')), by_id TEXT NOT NULL, created_at BIGINT NOT NULL,
  PRIMARY KEY (item_id, user_id)
);
CREATE INDEX shares_user ON shares (user_id);
-- Inbox: what happened that concerns a person (mentions, replies, watched cards, assignments, shares).
CREATE TABLE notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('mention', 'reply', 'watch', 'assign', 'share')),
  board_id TEXT NOT NULL REFERENCES items(id), object_id TEXT, thread_id TEXT,
  actor_id TEXT, actor_name TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL, read_at BIGINT
);
CREATE INDEX notifications_user ON notifications (user_id, created_at);
-- Stars: a person's favorite boards and task cards (object_id '' = the board itself).
CREATE TABLE stars (
  user_id TEXT NOT NULL REFERENCES users(id), item_id TEXT NOT NULL REFERENCES items(id), object_id TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL, PRIMARY KEY (user_id, item_id, object_id)
);
-- Workspace color themes, and workspace-wide settings (key/value, e.g. the default theme).
CREATE TABLE workspace_themes (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, base TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at BIGINT NOT NULL
);
CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- Workspace templates: a saved copy of a board's objects.
CREATE TABLE templates (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', owner_id TEXT NOT NULL REFERENCES users(id),
  data TEXT NOT NULL, created_at BIGINT NOT NULL
);
-- Each person's Google refresh token (drive.file scope), encrypted (see google.ts), and their Drive folder.
CREATE TABLE google_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id), refresh_enc TEXT NOT NULL, folder_id TEXT, updated_at BIGINT NOT NULL
);
-- Drive copies of boards, per person and file kind.
CREATE TABLE drive_files (
  board_id TEXT NOT NULL REFERENCES items(id), user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('json', 'png')), file_id TEXT NOT NULL,
  updated_at BIGINT NOT NULL, PRIMARY KEY (board_id, user_id, kind)
);
-- OAuth 2.1 for MCP clients (see oauth.ts). Codes and tokens are stored as hashes.
CREATE TABLE oauth_clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL, created_at BIGINT NOT NULL);
CREATE TABLE oauth_codes (
  hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, user_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE TABLE oauth_tokens (
  hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')), client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id), expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL, last_used_at BIGINT
);
CREATE INDEX oauth_tokens_user ON oauth_tokens (user_id);
`, `
-- Sign-in modes beyond Google (see auth.ts): passwords, admins who manage people, and invite links.
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN disabled_at BIGINT;
-- The first person of an existing install manages it.
UPDATE users SET is_admin = true WHERE id = (SELECT id FROM users ORDER BY created_at, id LIMIT 1);
CREATE TABLE invites (
  hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_by TEXT NOT NULL REFERENCES users(id),
  created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE INDEX invites_user ON invites (user_id);
`, `
-- When a person first signed in to a team mode (see auth.ts). Until then the row is only a name to share with,
-- and only an admin's invite link may give it a password.
ALTER TABLE users ADD COLUMN activated_at BIGINT;
UPDATE users SET activated_at = created_at WHERE email NOT LIKE '%@localhost'
  AND (password_hash IS NOT NULL OR EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = users.id));
`];

await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at BIGINT NOT NULL)');
for (let v = 1; v <= MIGRATIONS.length; v++) {
  await tx(async () => {
    await run('SELECT pg_advisory_xact_lock(7340211)'); // two servers starting at once apply each step once
    if (await one('SELECT 1 FROM schema_migrations WHERE version = $1', v)) return;
    for (const stmt of MIGRATIONS[v - 1].split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await run(stmt);
    await run('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)', v, Date.now());
  });
}

export const now = () => Date.now();
export const newId = () => crypto.randomUUID();
