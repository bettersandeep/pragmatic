import { randomHex } from '../../shared/model.ts';
export type User = { id: string; email: string; name: string; picture: string | null };
export type Item = {
  id: string; kind: 'folder' | 'board' | 'doc'; title: string; parent_id: string | null;
  scope: 'private' | 'team'; owner_id: string; created_at: number; updated_at: number; deleted_at: number | null;
  link_access: 'none' | 'view' | 'comment' | 'edit'; role?: Role; thumbnail: string | null;
};
export type Role = 'view' | 'comment' | 'edit' | 'owner';
// Stars changed somewhere: the sidebar listens for this and reloads its Starred section.
export const starsChanged = () => dispatchEvent(new Event('pragmatic:stars'));
// Where an item opens: boards at /b/<id>, docs at /d/<id>.
export const itemPath = (i: { id: string; kind: string }) => (i.kind === 'doc' ? `/d/${i.id}` : `/b/${i.id}`);
export const canEdit = (r?: Role) => r === 'edit' || r === 'owner';
export type Notification = {
  id: string; kind: 'mention' | 'reply' | 'watch' | 'assign' | 'share'; board_id: string; board_title: string; object_id: string | null; thread_id: string | null;
  actor_name: string; actor_picture: string | null; text: string; created_at: number; read_at: number | null;
};
export type Shares = {
  owner: Person; scope: Item['scope']; role: Role; link_access: Item['link_access'];
  members: { user_id: string; name: string; email: string; picture: string | null; role: Exclude<Role, 'owner'> }[];
};
export type TemplateInfo = { id: string; title: string; description: string; icon: string; source: 'built-in' | 'workspace'; owner?: string; mine?: boolean };
export type Person = { id: string; name: string; email: string; picture: string | null };
export type Token = { id: string; name: string; created_at: number; last_used_at: number | null };
// How this install signs people in (server/config.ts AUTH): one person with no sign-in, or team modes.
export type AuthInfo = { modes: ('local' | 'oidc' | 'password' | 'google')[]; oidc: string | null; setup: boolean; dev: boolean; drive: boolean };
export type Me = { user: User | null; auth: AuthInfo; admin: boolean };
export type PersonRow = Person & { is_admin: boolean; disabled_at: number | null; has_password: boolean; last_sign_in: number | null };

export const clientId = randomHex(16);

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'x-client-id': clientId, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && path.startsWith('/api/') && path !== '/api/me') location.assign('/');
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `${method} ${path} failed (${res.status})`);
  return res.status === 204 ? (undefined as T) : res.json();
}

// The signed-in person and the sign-in modes, asked once per page load.
let me: Promise<Me> | null = null;
export const meOnce = () => (me ??= api.me());

export const api = {
  me: () => call<Me>('GET', '/api/me'),
  setup: (b: { email: string; name: string; password: string }) => call<{ ok: true }>('POST', '/auth/password/setup', b),
  login: (b: { email: string; password: string }) => call<{ ok: true }>('POST', '/auth/password/login', b),
  invite: (token: string) => call<{ email: string; name: string; reset: boolean }>('GET', `/auth/invite/${token}`),
  acceptInvite: (token: string, b: { name: string; password: string }) => call<{ ok: true }>('POST', `/auth/invite/${token}`, b),
  people: () => call<PersonRow[]>('GET', '/api/people'),
  addPerson: (email: string) => call<{ user: Person; invite_link?: string }>('POST', '/api/people', { email }),
  inviteLink: (id: string) => call<{ invite_link: string }>('POST', `/api/people/${id}/invite`, {}),
  updatePerson: (id: string, patch: { is_admin?: boolean; disabled?: boolean }) => call<void>('PATCH', `/api/people/${id}`, patch),
  logout: () => call<void>('POST', '/auth/logout'),
  items: () => call<Item[]>('GET', '/api/items'),
  trash: () => call<Item[]>('GET', '/api/trash'),
  recent: () => call<Item[]>('GET', '/api/recent'),
  search: (q: string) => call<Item[]>('GET', `/api/search?q=${encodeURIComponent(q)}`),
  create: (b: { kind: Item['kind']; title: string; parent_id?: string | null; scope?: Item['scope']; template?: string }) => call<Item>('POST', '/api/items', b),
  templates: () => call<TemplateInfo[]>('GET', '/api/templates'),
  templateObjects: (id: string) => call<unknown[]>('GET', `/api/templates/${encodeURIComponent(id)}/objects`),
  saveTemplate: (board_id: string, title: string, description: string) => call<{ id: string }>('POST', '/api/templates', { board_id, title, description }),
  deleteTemplate: (id: string) => call<void>('DELETE', `/api/templates/${encodeURIComponent(id)}`),
  update: (id: string, b: { title?: string; parent_id?: string | null; thumbnail?: string | null }) => call<Item>('PATCH', `/api/items/${id}`, b),
  trashItem: (id: string) => call<void>('POST', `/api/items/${id}/trash`, {}),
  restore: (id: string) => call<void>('POST', `/api/items/${id}/restore`, {}),
  board: (id: string) => call<Item>('GET', `/api/boards/${id}`),
  uploadImage: async (file: Blob) => {
    const res = await fetch('/api/files', { method: 'POST', headers: { 'content-type': file.type || 'image/png' }, body: file });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Upload failed (${res.status})`);
    return res.json() as Promise<{ src: string; width?: number; height?: number }>;
  },
  users: () => call<Person[]>('GET', '/api/users'),
  stars: () => call<{ item_id: string; object_id: string; title: string; kind: Item['kind']; card_title: string | null }[]>('GET', '/api/stars'),
  star: (item_id: string, on: boolean, object_id = '') => call<void>('PUT', '/api/stars', { item_id, object_id, on }),
  themes: () => call<{ themes: { id: string; name: string; base: Record<string, string>; created_by: string; by_name: string }[]; default_id: string | null }>('GET', '/api/themes'),
  saveTheme: (name: string, base: Record<string, string>) => call<{ id: string }>('POST', '/api/themes', { name, base }),
  deleteTheme: (id: string) => call<void>('DELETE', `/api/themes/${id}`),
  setDefaultTheme: (id: string | null) => call<void>('PUT', '/api/themes/default', { id }),
  inbox: () => call<Notification[]>('GET', '/api/inbox'),
  readInbox: (ids: string[] | 'all') => call<void>('POST', '/api/inbox/read', ids === 'all' ? { all: true } : { ids }),
  thread: (b: string, t: string) => call<import('../../shared/comments.ts').Thread>('GET', `/api/boards/${b}/comments/${t}`),
  shares: (id: string) => call<Shares>('GET', `/api/items/${id}/shares`),
  share: (id: string, email: string, role: Role | 'none', drive = false) => call<Shares & { drive_link?: string; invite_link?: string; invite_needed?: boolean }>('PUT', `/api/items/${id}/shares`, { email, role, drive }),
  drive: () => call<{ connected: boolean; available: boolean }>('GET', '/api/drive'),
  forgetDrive: () => call<void>('DELETE', '/api/drive'),
  renderPng: async (id: string, body: { theme: 'light' | 'dark'; ids?: string[]; background?: boolean }) => {
    const res = await fetch(`/api/boards/${id}/png`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Render failed (${res.status})`);
    return res.blob();
  },
  driveCopy: (id: string) => call<{ link: string | null }>('POST', `/api/boards/${id}/drive-copy`, {}),
  linkAccess: (id: string, access: Item['link_access']) => call<Shares>('PATCH', `/api/items/${id}/link`, { access }),
  versions: (b: string) => call<{ id: string; at: number; authors: string[] }[]>('GET', `/api/boards/${b}/versions`),
  version: (b: string, v: string) => call<unknown[]>('GET', `/api/boards/${b}/versions/${v}`),
  restoreVersion: (b: string, v: string) => call<void>('POST', `/api/boards/${b}/versions/${v}/restore`, {}),
  forkVersion: (b: string, v: string) => call<Item>('POST', `/api/boards/${b}/versions/${v}/fork`, {}),
  backlinks: (b: string, task: string) => call<{ board_id: string; board_title: string; object_id: string; title: string }[]>('GET', `/api/boards/${b}/backlinks?task=${encodeURIComponent(task)}`),
  unfurl: (url: string) => call<{ url: string; title: string; site: string }>('GET', `/api/unfurl?url=${encodeURIComponent(url)}`),
  comment: (b: string, body: { anchor: { objectId?: string; x: number; y: number }; text: string; mentions: string[] }) => call<{ id: string }>('POST', `/api/boards/${b}/comments`, body),
  reply: (b: string, t: string, body: { text: string; mentions: string[] }) => call<unknown>('POST', `/api/boards/${b}/comments/${t}/replies`, body),
  resolve: (b: string, t: string, resolved: boolean) => call<unknown>('PATCH', `/api/boards/${b}/comments/${t}`, { resolved }),
  editMessage: (b: string, t: string, m: string, body: { text: string; mentions: string[] }) => call<unknown>('PATCH', `/api/boards/${b}/comments/${t}/messages/${m}`, body),
  deleteMessage: (b: string, t: string, m: string) => call<unknown>('DELETE', `/api/boards/${b}/comments/${t}/messages/${m}`),
  react: (b: string, t: string, m: string, emoji: string) => call<unknown>('POST', `/api/boards/${b}/comments/${t}/messages/${m}/reactions`, { emoji }),
  tokens: () => call<Token[]>('GET', '/api/tokens'),
  apps: () => call<{ id: string; name: string; connected_at: number; last_used_at: number | null }[]>('GET', '/api/oauth/apps'),
  disconnectApp: (id: string) => call<void>('DELETE', `/api/oauth/apps/${id}`),
  createToken: (name: string) => call<{ id: string; token: string }>('POST', '/api/tokens', { name }),
  deleteToken: (id: string) => call<void>('DELETE', `/api/tokens/${id}`),
};

// Tiny pushState router.
export const navigate = (path: string) => {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
};

export const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
