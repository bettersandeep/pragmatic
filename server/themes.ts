import { all, newId, now, one, run, tx } from './db.ts';
import { BadRequest, Forbidden, NotFound } from './store.ts';
import { COLOR_NAMES } from '../shared/model.ts';

// Color themes shared by the whole workspace. Any board can use one; one can be the default for boards without their own.
type Row = { id: string; name: string; base: string; created_by: string; by_name: string };

export async function listThemes() {
  const rows = await all<Row>(`SELECT t.id, t.name, t.base, t.created_by, u.name AS by_name FROM workspace_themes t JOIN users u ON u.id = t.created_by
    ORDER BY lower(t.name)`);
  const def = (await one<{ value: string }>(`SELECT value FROM workspace_settings WHERE key = 'default_theme'`))?.value ?? null;
  return { themes: rows.map((r) => ({ id: r.id, name: r.name, base: JSON.parse(r.base), created_by: r.created_by, by_name: r.by_name })), default_id: def };
}

// Only known color names with #rrggbb values are kept.
function cleanBase(base: unknown): Record<string, string> {
  if (!base || typeof base !== 'object') throw new BadRequest('base must map color names to #rrggbb');
  const out = Object.fromEntries(Object.entries(base).filter(([k, v]) => (COLOR_NAMES as string[]).includes(k) && typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)));
  if (!Object.keys(out).length) throw new BadRequest('The theme changes no colors');
  return out as Record<string, string>;
}

export async function saveTheme(userId: string, name: unknown, base: unknown) {
  const n = typeof name === 'string' ? name.trim().slice(0, 60) : '';
  if (!n) throw new BadRequest('A theme needs a name');
  const id = newId();
  await run('INSERT INTO workspace_themes (id, name, base, created_by, created_at) VALUES ($1, $2, $3, $4, $5)', id, n, JSON.stringify(cleanBase(base)), userId, now());
  return id;
}

export const deleteTheme = (userId: string, id: string) => tx(async () => {
  const t = await one<{ created_by: string }>('SELECT created_by FROM workspace_themes WHERE id = $1', id);
  if (!t) throw new NotFound('No such theme');
  if (t.created_by !== userId) throw new Forbidden('Only the person who saved a theme can delete it');
  await run('DELETE FROM workspace_themes WHERE id = $1', id);
  await run(`DELETE FROM workspace_settings WHERE key = 'default_theme' AND value = $1`, id);
});

// ponytail: any member can change the workspace default; add an admin role if that becomes a problem
export async function setDefaultTheme(id: string | null) {
  if (id === null) return void await run(`DELETE FROM workspace_settings WHERE key = 'default_theme'`);
  if (!(await one('SELECT 1 FROM workspace_themes WHERE id = $1', id))) throw new NotFound('No such theme');
  await run(`INSERT INTO workspace_settings (key, value) VALUES ('default_theme', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, id);
}
