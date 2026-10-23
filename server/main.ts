import express, { type Request, type Response, type NextFunction } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as auth from './auth.ts';
import * as store from './store.ts';
import { createMcpServer } from './mcp.ts';
import { boardAccess, editBoard, flushAll, handleUpgrade, listVersions, versionDoc } from './collab.ts';
import { readObjects } from '../shared/doc.ts';
import { copyFragment, objectsOf, portable } from '../shared/doc.ts';
import * as Y from 'yjs';
import { FILES_DIR, saveImage } from './files.ts';
import * as comments from './comments.ts';
import * as templates from './templates.ts';
import { unfurl } from './unfurl.ts';
import * as tasks from './tasks.ts';
import { pruneAll } from './history.ts';
import { connectedApps, oauthRoutes, oauthUser, resourceMetadataUrl, revokeApp } from './oauth.ts';
import * as inbox from './inbox.ts';
import * as themes from './themes.ts';
import * as drive from './drive.ts';
import { renderBoardPng } from './render.ts';
import * as google from './google.ts';
import { closeDb, one } from './db.ts';
import { readThreads } from '../shared/comments.ts';
import { hooks } from './collab.ts';
hooks.objects = inbox.onObjects;
// Automatic Drive copies into the board owner's Drive, when the owner connected Drive.
hooks.saved = (id, final) => drive.scheduleCopy(id, final, async () =>
  (await one<{ id: string; title: string }>('SELECT owner_id AS id, title FROM items WHERE id = $1 AND deleted_at IS NULL', id)) ?? null);

import { AUTH, BASE_URL, DATA_DIR, GOOGLE, HOST, PORT, TRUST_PROXY } from './config.ts';
import { hostAllowed, originAllowed, parseCookies } from './request.ts';
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', TRUST_PROXY);
app.use((req, res, next) => (hostAllowed(req.headers.host) ? next() : res.status(421).send(`pragmatic answers only at ${BASE_URL}. If you open it at another address, set BASE_URL to that address.`)));
app.use(express.json({ limit: '30mb' })); // screenshots arrive as base64

app.use((req, _res, next) => {
  req.cookies = parseCookies(req.headers.cookie);
  next();
});

// JSON (or raw image) writes only: a cross-site form cannot send these types without a CORS preflight.
app.use('/api', (req, res, next) => {
  const ok = req.is('application/json') || (req.path === '/files' && req.is('image/*'));
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !ok) return res.status(415).json({ error: 'Send JSON' });
  next();
});

// Liveness and readiness for Kubernetes: the process answers and the database answers.
app.get('/healthz', async (_req, res) => { await one('SELECT 1'); res.json({ ok: true }); });
app.use(oauthRoutes());
app.use(auth.authRoutes());

// Who is signed in, and how this install signs people in (for the sign-in page and Settings).
app.get('/api/me', async (req, res) => {
  const user = (await auth.sessionUser(req)) ?? null;
  res.json({ user, auth: await auth.authInfo(), admin: user ? await auth.isAdmin(user.id) : false });
});

const api = express.Router();
api.use(auth.requireUser);
const uid = (res: Response) => (res.locals.user as auth.User).id;

api.get('/items', async (_req, res) => { res.json(await store.listItems(uid(res))); });
api.get('/trash', async (_req, res) => { res.json(await store.listItems(uid(res), true)); });
api.get('/recent', async (_req, res) => { res.json(await store.recentBoards(uid(res))); });
api.get('/search', async (req, res) => { res.json(await store.search(uid(res), String(req.query.q ?? ''))); });
api.post('/items', async (req, res) => {
  const item = await store.createItem(uid(res), req.body);
  if (item.kind === 'board' && typeof req.body.template === 'string') await templates.applyTemplate(item.id, req.body.template);
  res.status(201).json(item);
});
api.patch('/items/:id', async (req, res) => { res.json(await store.updateItem(uid(res), req.params.id, req.body)); });
api.post('/items/:id/trash', async (req, res) => { await store.setDeleted(uid(res), req.params.id, true); res.status(204).end(); });
api.post('/items/:id/restore', async (req, res) => { await store.setDeleted(uid(res), req.params.id, false); res.status(204).end(); });

api.get('/boards/:id', async (req, res) => { res.json(await store.getBoard(uid(res), req.params.id)); });
api.post('/files', express.raw({ type: 'image/*', limit: '20mb' }), (req, res) => {
  res.status(201).json(saveImage(req.body as Buffer, req.headers['content-type']));
});

// Comments: the server writes them into the live board, with the signed-in user as author.
const me = (res: Response) => res.locals.user as auth.User;
const boardOf = async (req: Request, res: Response, need: store.Role = 'view') => (await store.getBoard(uid(res), String(req.params.id), need)).id;
api.get('/users', async (_req, res) => { res.json(await comments.listUsers()); });
api.get('/inbox', async (_req, res) => { res.json(await inbox.list(uid(res))); });
api.get('/themes', async (_req, res) => { res.json(await themes.listThemes()); });
api.post('/themes', async (req, res) => { res.status(201).json({ id: await themes.saveTheme(uid(res), req.body.name, req.body.base) }); });
api.delete('/themes/:id', async (req, res) => { await themes.deleteTheme(uid(res), String(req.params.id)); res.status(204).end(); });
api.put('/themes/default', async (req, res) => { await themes.setDefaultTheme(req.body.id ? String(req.body.id) : null); res.status(204).end(); });
api.get('/stars', async (_req, res) => {
  const list = await Promise.all((await store.stars(uid(res))).map(async (s) => ({
    ...s, card_title: s.object_id ? await editBoard(s.item_id, (doc) => (readObjects(doc).find((o) => o.id === s.object_id) as { title?: string } | undefined)?.title ?? null) : null,
  })));
  res.json(list.filter((s) => !s.object_id || s.card_title !== null));
});
api.put('/stars', async (req, res) => { await store.setStar(uid(res), String(req.body.item_id), String(req.body.object_id ?? ''), !!req.body.on); res.status(204).end(); });
api.post('/inbox/read', async (req, res) => { await inbox.markRead(uid(res), req.body.all ? 'all' : (Array.isArray(req.body.ids) ? req.body.ids.map(String) : [])); res.status(204).end(); });
api.get('/boards/:id/comments/:tid', async (req, res) => {
  const t = await editBoard(await boardOf(req, res), (doc) => readThreads(doc).find((x) => x.id === req.params.tid));
  if (!t) throw new store.NotFound('No such comment thread');
  res.json(t);
});
// Sharing: people with a role, and the role for anyone in the workspace who has the link.
api.get('/items/:id/shares', async (req, res) => { res.json(await store.shares(uid(res), String(req.params.id))); });
api.put('/items/:id/shares', async (req, res) => {
  const target = await auth.userByEmail(String(req.body.email ?? ''));
  const id = String(req.params.id);
  if (await store.share(uid(res), id, target.id, req.body.role))
    await inbox.notify({ user: target.id, kind: 'share', board: id, actor: me(res), text: req.body.role });
  const { invite_link, invite_needed } = req.body.role === 'none' ? {} : await auth.inviteFor(uid(res), target);
  // Optional: a view-only copy in the sharer's Drive, shared with the person.
  let drive_link: string | undefined;
  if (req.body.drive && req.body.role !== 'none') drive_link = await drive.shareDriveCopy(uid(res), id, target.email);
  res.json({ ...(await store.shares(uid(res), id)), drive_link, invite_link, invite_needed });
});
api.get('/drive', async (_req, res) => { res.json({ connected: await google.hasDrive(uid(res)), available: !!GOOGLE }); });

// The people of this install (admins): invite, reset a password, make admin, remove access.
const admin = async (res: Response) => { if (!(await auth.isAdmin(uid(res)))) throw new store.Forbidden('Only an admin can manage people'); };
api.get('/people', async (_req, res) => { await admin(res); res.json(await auth.listPeople()); });
api.post('/people', async (req, res) => {
  await admin(res);
  const u = await auth.userByEmail(String(req.body.email ?? ''));
  res.status(201).json({ user: u, invite_link: AUTH.includes('password') ? await auth.createInvite(u.id, uid(res)) : undefined });
});
api.post('/people/:id/invite', async (req, res) => {
  await admin(res);
  if (!AUTH.includes('password')) throw new store.BadRequest('Invite links are for AUTH=password');
  res.json({ invite_link: await auth.createInvite(String(req.params.id), uid(res)) });
});
api.patch('/people/:id', async (req, res) => {
  await admin(res);
  await auth.updatePerson(uid(res), String(req.params.id), { is_admin: req.body.is_admin, disabled: req.body.disabled });
  res.status(204).end();
});
api.delete('/drive', async (_req, res) => { await google.forgetDrive(uid(res)); res.status(204).end(); });
api.post('/boards/:id/png', async (req, res) => {
  const id = await boardOf(req, res), b = req.body ?? {};
  const png = await renderBoardPng(id, uid(res), Math.min(4, Math.max(1, Number(b.scale) || 2)), {
    theme: b.theme === 'dark' ? 'dark' : 'light', ids: Array.isArray(b.ids) ? b.ids.map(String).slice(0, 2000) : undefined, background: b.background !== false,
  });
  if (!png) throw new store.BadRequest('Nothing to draw');
  res.type('png').send(png);
});
api.post('/boards/:id/drive-copy', async (req, res) => {
  const item = await store.getBoard(uid(res), String(req.params.id));
  const f = await drive.copyToDrive(uid(res), item.id, item.title);
  res.json({ link: f?.webViewLink ?? null });
});
api.patch('/items/:id/link', async (req, res) => {
  await store.setLinkAccess(uid(res), String(req.params.id), req.body.access);
  res.json(await store.shares(uid(res), String(req.params.id)));
});
api.post('/boards/:id/comments', async (req, res) => { res.status(201).json(await comments.createThread(await boardOf(req, res, 'comment'), me(res), req.body)); });
api.post('/boards/:id/comments/:tid/replies', async (req, res) => { res.status(201).json(await comments.reply(await boardOf(req, res, 'comment'), String(req.params.tid), me(res), req.body)); });
api.patch('/boards/:id/comments/:tid', async (req, res) => { res.json(await comments.setResolved(await boardOf(req, res, 'comment'), String(req.params.tid), req.body.resolved)); });
api.patch('/boards/:id/comments/:tid/messages/:mid', async (req, res) => {
  res.json(await comments.editMessage(await boardOf(req, res, 'comment'), String(req.params.tid), String(req.params.mid), me(res), req.body));
});
api.delete('/boards/:id/comments/:tid/messages/:mid', async (req, res) => {
  res.json(await comments.deleteMessage(await boardOf(req, res, 'comment'), String(req.params.tid), String(req.params.mid), me(res)));
});
api.post('/boards/:id/comments/:tid/messages/:mid/reactions', async (req, res) => {
  res.json(await comments.toggleReaction(await boardOf(req, res, 'comment'), String(req.params.tid), String(req.params.mid), me(res), String(req.body.emoji)));
});

// Time machine: list, preview, restore (a new change everyone sees), fork into a new board.
api.get('/boards/:id/versions', async (req, res) => { res.json(await listVersions(await boardOf(req, res))); });
api.get('/boards/:id/versions/:vid', async (req, res) => {
  const doc = await versionDoc(await boardOf(req, res), String(req.params.vid));
  res.json(readObjects(doc));
  doc.destroy();
});
api.post('/boards/:id/versions/:vid/restore', async (req, res) => {
  const id = await boardOf(req, res, 'edit'), old = await versionDoc(id, String(req.params.vid));
  await editBoard(id, (doc) => doc.transact(() => {
    const live = objectsOf(doc);
    for (const k of [...live.keys()]) live.delete(k);
    for (const [k, m] of objectsOf(old)) { const copy = new Y.Map<unknown>(); for (const [f, v] of m) copy.set(f, portable(v)); live.set(k, copy); }
    // Doc content is an XML fragment outside the objects map.
    copyFragment(old.getXmlFragment('blocks'), doc.getXmlFragment('blocks'));
  }, 'restore'), me(res).name);
  old.destroy();
  res.status(204).end();
});
api.post('/boards/:id/versions/:vid/fork', async (req, res) => {
  const id = await boardOf(req, res), src = await store.getItem(uid(res), id), old = await versionDoc(id, String(req.params.vid));
  const copy = await store.createItem(uid(res), { kind: src.kind, title: `${src.title} (copy)`, parent_id: src.parent_id, scope: src.scope });
  await editBoard(copy.id, (doc) => { Y.applyUpdate(doc, Y.encodeStateAsUpdate(old)); }, me(res).name);
  old.destroy();
  res.status(201).json(copy);
});
api.get('/unfurl', async (req, res) => {
  const raw = String(req.query.url ?? '');
  res.json((await tasks.internalLink(uid(res), raw)) ?? await unfurl(raw));
});
api.get('/boards/:id/backlinks', async (req, res) => { res.json(await tasks.backlinks(uid(res), await boardOf(req, res), String(req.query.task ?? ''))); });
api.get('/templates', async (_req, res) => { res.json(await templates.listTemplates(uid(res))); });
api.get('/templates/:id/objects', async (req, res) => { res.json(await templates.templateObjects(String(req.params.id))); });
api.post('/templates', async (req, res) => { res.status(201).json(await templates.saveTemplate(uid(res), String(req.body.board_id), req.body.title, req.body.description)); });
api.delete('/templates/:id', async (req, res) => { await templates.deleteTemplate(uid(res), String(req.params.id)); res.status(204).end(); });

api.get('/tokens', async (_req, res) => { res.json(await auth.listTokens(uid(res))); });
api.get('/oauth/apps', async (_req, res) => { res.json(await connectedApps(uid(res))); });
api.delete('/oauth/apps/:id', async (req, res) => { await revokeApp(uid(res), String(req.params.id)); res.status(204).end(); });
api.post('/tokens', async (req, res) => { res.status(201).json(await auth.createToken(uid(res), String(req.body.name || 'Claude'))); });
api.delete('/tokens/:id', async (req, res) => { await auth.deleteToken(uid(res), req.params.id); res.status(204).end(); });
app.use('/api', api);

// MCP for Claude Code / Claude Desktop. Stateless: one server per request, bound to the token's user.
app.post('/mcp', async (req, res, next) => {
  const user = (await auth.tokenUser(req.headers.authorization)) ?? (await oauthUser(req.headers.authorization));
  // The header tells MCP clients where to sign in (OAuth discovery).
  if (!user) return res.status(401).set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}"`).json({ error: 'Sign in to pragmatic: connect with OAuth, or use a token from pragmatic Settings.' });
  try {
    const server = createMcpServer(user);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) { next(err); }
});
app.all('/mcp', (_req, res) => { res.status(405).json({ error: 'Use POST' }); });

// Uploaded images. Names are content hashes, so they never change.
app.get('/files/:name', auth.requireUser, (req, res) => {
  const name = String(req.params.name);
  if (!/^[a-f0-9]{32}\.(png|jpg|gif|webp)$/.test(name)) return res.status(404).end();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(resolve(FILES_DIR, name), { maxAge: '365d', immutable: true });
});

// The Claude Desktop extension, built by `npm run build:mcpb`.
app.get('/pragmatic.mcpb', (_req, res) => res.download(resolve('dist/pragmatic.mcpb'), 'pragmatic.mcpb', (e) => e && !res.headersSent && res.status(404).end()));

if (existsSync('dist/index.html')) {
  app.use(express.static('dist'));
  app.get(/^\/(?!api|auth|mcp|files|collab|assets\/).*/, (_req, res) => res.sendFile('index.html', { root: 'dist' }));
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof store.NotFound) return res.status(404).json({ error: err.message });
  if (err instanceof store.BadRequest) return res.status(400).json({ error: err.message });
  if (err instanceof store.Forbidden) return res.status(403).json({ error: err.message });
  if (err instanceof auth.AuthError) return res.status(400).json({ error: err.message });
  if (err instanceof google.NoDrive) return GOOGLE
    ? res.status(409).json({ error: err.message, connect: '/auth/drive' })
    : res.status(400).json({ error: 'Google Drive is not set up on this pragmatic (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)' });
  const status = (err as Error & { status?: number }).status; // body parser errors
  if (status && status < 500) return res.status(status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// History thinning (see history.ts): at start and every 6 hours.
const thin = () => void pruneAll().catch((e) => console.error('history thinning failed', (e as Error).message));
thin();
setInterval(thin, 6 * 36e5).unref();

// Loopback by default (config.ts); the container sets HOST=0.0.0.0.
const server = app.listen(PORT, HOST, () => console.log(`pragmatic on http://${HOST}:${PORT} (open ${BASE_URL}), sign-in: ${AUTH.join(', ')}, database: ${process.env.DATABASE_URL ? 'Postgres' : `built-in (${DATA_DIR})`}`));

// Live board sync: /collab/<boardId>, signed-in users with access only (collab.ts boardAccess, checked again
// whenever access changes).
server.on('upgrade', (req, socket, head) => void handleUpgrade(req, socket, head, async (r, boardId) => {
  if (!hostAllowed(r.headers.host) || !originAllowed(r.headers.origin, r.headers.host)) return null;
  const user = await auth.userFromCookie(r.headers.cookie);
  const canEdit = user ? await boardAccess(user.id, boardId) : null;
  return user && canEdit !== null ? { id: user.id, name: user.name, canEdit } : null;
}));

// Write what is still in memory to the database, then stop.
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => {
  server.close();
  try { await flushAll(); await closeDb(); } finally { process.exit(0); }
});
