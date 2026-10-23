import * as Y from 'yjs';
import { all, newId, now, one, run } from './db.ts';
import * as store from './store.ts';
import type { Message, Thread } from '../shared/comments.ts';
import { objectsOf } from '../shared/doc.ts';
import { addedMentions, plainOf } from '../shared/richtext.ts';

export type Kind = 'mention' | 'reply' | 'watch' | 'assign' | 'share';
type Note = { user: string; kind: Kind; board: string; object?: string; thread?: string; actor: { id?: string; name: string }; text?: string };

const canSee = async (userId: string, board: string) => (await store.roleOn(userId, board)) !== 'none';

// Nobody is told about their own actions, or about boards they cannot open.
// Text mentions told in this process: person|board|object -> when (set before any wait, so two edits in a row count once).
const textMentions = new Map<string, number>();
export async function notify(n: Note) {
  if (n.user === n.actor.id) return;
  // A mention in an object's text: once a day per person and object (editing can re-add a paragraph that holds it).
  if (n.kind === 'mention' && !n.thread && n.object) {
    const k = `${n.user}|${n.board}|${n.object}`, at = textMentions.get(k);
    if (at && at > now() - 864e5) return;
    if (textMentions.size > 10_000) for (const [key, t] of textMentions) if (t < now() - 864e5) textMentions.delete(key);
    textMentions.set(k, now());
  }
  if (!(await canSee(n.user, n.board))) return;
  if (n.kind === 'mention' && !n.thread && n.object && await one(`SELECT 1 FROM notifications WHERE user_id = $1 AND board_id = $2 AND object_id = $3
    AND kind = 'mention' AND thread_id IS NULL AND created_at > $4`, n.user, n.board, n.object, now() - 864e5)) return;
  await run(`INSERT INTO notifications (id, user_id, kind, board_id, object_id, thread_id, actor_id, actor_name, text, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, newId(), n.user, n.kind, n.board, n.object ?? null, n.thread ?? null, n.actor.id ?? null, n.actor.name, (n.text ?? '').slice(0, 280), now());
}
// From inside a document change, which cannot wait: a failed notification is logged, the change stands.
const inFlight = new Set<Promise<void>>();
function notifyLater(n: Note) {
  const p = notify(n).catch((e) => console.error('notification failed', n.board, (e as Error).message)).finally(() => inFlight.delete(p));
  inFlight.add(p);
  return p;
}
// Resolves when the notifications started so far are written.
export const settled = () => Promise.all([...inFlight]).then(() => {});

// A new comment or reply: mentioned people first, then earlier participants, then watchers of the card it is on.
// Resolves when they are written.
export function onComment(board: string, doc: Y.Doc, t: Thread, m: Message) {
  const told = new Set<string>([m.author.id]), sent: Promise<void>[] = [];
  const send = (user: string, kind: Kind) => {
    if (told.has(user)) return;
    told.add(user);
    sent.push(notifyLater({ user, kind, board, object: t.anchor.objectId, thread: t.id, actor: m.author, text: m.text }));
  };
  for (const u of m.mentions) send(u, 'mention');
  if (t.messages.length > 1) for (const x of t.messages) send(x.author.id, 'reply');
  const card = t.anchor.objectId ? objectsOf(doc).get(t.anchor.objectId) : undefined;
  if (card?.get('type') === 'task') for (const u of (card.get('watch') as string[] | undefined) ?? []) send(u, 'watch');
  return Promise.all(sent).then(() => {});
}

// Card assignments, from any source (browser or MCP), seen as changes to the board document.
export function onObjects(board: string, events: Y.YEvent<Y.Map<unknown>>[], actor: { id?: string; name: string }) {
  for (const e of events) {
    // An @mention typed into an object's rich text (path: object id, field, ...).
    if (e.path.length >= 2) {
      const ids = addedMentions(e as unknown as Y.YEvent<Y.AbstractType<unknown>>);
      if (!ids.length) continue;
      const [objectId, field] = e.path as [string, string];
      const f = (e.currentTarget as Y.Map<Y.Map<unknown>>).get(objectId)?.get(field);
      const text = f instanceof Y.XmlFragment ? plainOf(f) : '';
      for (const u of ids) void notifyLater({ user: u, kind: 'mention', board, object: objectId, actor, text });
      continue;
    }
    const m = e.target as Y.Map<unknown>;
    if (e.path.length !== 1 || !(e as Y.YMapEvent<unknown>).keysChanged.has('assignee') || m.get('type') !== 'task') continue;
    const to = m.get('assignee') as string | undefined;
    if (to) void notifyLater({ user: to, kind: 'assign', board, object: m.get('id') as string, actor, text: String(m.get('title') ?? '') });
  }
}

export type Notification = {
  id: string; kind: Kind; board_id: string; board_title: string; object_id: string | null; thread_id: string | null;
  actor_name: string; actor_picture: string | null; text: string; created_at: number; read_at: number | null;
};
// Only boards the person can still open.
export const list = (userId: string) =>
  all<Notification>(`SELECT n.id, n.kind, n.board_id, i.title AS board_title, n.object_id, n.thread_id, n.actor_name, u.picture AS actor_picture,
      n.text, n.created_at, n.read_at
    FROM notifications n JOIN items i ON i.id = n.board_id LEFT JOIN users u ON u.id = n.actor_id
    LEFT JOIN shares s ON s.item_id = i.id AND s.user_id = $1
    WHERE n.user_id = $1 AND i.deleted_at IS NULL AND (i.owner_id = $1 OR i.scope = 'team' OR s.user_id IS NOT NULL OR i.link_access <> 'none')
    ORDER BY n.created_at DESC LIMIT 200`, userId);

export const markRead = (userId: string, ids: string[] | 'all') => ids === 'all'
  ? run('UPDATE notifications SET read_at = $1 WHERE user_id = $2 AND read_at IS NULL', now(), userId)
  : run('UPDATE notifications SET read_at = $1 WHERE id = ANY($3::text[]) AND user_id = $2 AND read_at IS NULL', now(), userId, ids);
