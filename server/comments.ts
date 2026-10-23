import type * as Y from 'yjs';
import { all, now } from './db.ts';
import { editBoard } from './collab.ts';
import { BadRequest, NotFound } from './store.ts';
import type { User } from './auth.ts';
import { commentsOf, REACTIONS, type Anchor, type Message, type Thread } from '../shared/comments.ts';
import { newId, parseJson } from '../shared/model.ts';
import { onComment } from './inbox.ts';

const MAX = 5000;

function cleanText(text: unknown) {
  if (typeof text !== 'string' || !text.trim()) throw new BadRequest('Comment text is required');
  if (text.length > MAX) throw new BadRequest(`Comments are limited to ${MAX} characters`);
  return text.trim();
}

// Only ids of real users count as mentions.
async function cleanMentions(ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids) || !ids.length) return [];
  const list = ids.filter((i) => typeof i === 'string').slice(0, 50);
  const known = new Set((await all<{ id: string }>('SELECT id FROM users WHERE id = ANY($1::text[])', list)).map((k) => k.id));
  return list.filter((id) => known.has(id)); // the order the author wrote them
}

const author = (u: User) => ({ id: u.id, name: u.name, picture: u.picture });

// Read-modify-write of one thread inside the board document.
function withThread<T>(boardId: string, threadId: string, fn: (t: Thread, doc: Y.Doc) => T): Promise<T> {
  return editBoard(boardId, (doc) => {
    const map = commentsOf(doc);
    const raw = map.get(threadId);
    if (!raw) throw new NotFound(`No comment thread ${threadId}`);
    const t = parseJson<Thread>(raw);
    if (!t) throw new NotFound(`Comment thread ${threadId} is damaged`);
    const out = fn(t, doc);
    doc.transact(() => (t.messages.length ? map.set(threadId, JSON.stringify(t)) : map.delete(threadId)), 'comments');
    return out;
  });
}

export async function createThread(boardId: string, user: User, body: { anchor?: Anchor; text?: string; mentions?: string[] }) {
  const a = body.anchor;
  if (!a || typeof a.x !== 'number' || typeof a.y !== 'number') throw new BadRequest('anchor {x, y} is required');
  const msg: Message = { id: newId(), author: author(user), text: cleanText(body.text), at: now(), mentions: await cleanMentions(body.mentions), reactions: {} };
  const t: Thread = { id: newId(), anchor: { x: a.x, y: a.y, ...(typeof a.objectId === 'string' ? { objectId: a.objectId } : {}) }, resolved: false, at: now(), messages: [msg] };
  await editBoard(boardId, (doc) => { doc.transact(() => commentsOf(doc).set(t.id, JSON.stringify(t)), 'comments'); return onComment(boardId, doc, t, msg); });
  return t;
}

export const reply = async (boardId: string, threadId: string, user: User, body: { text?: string; mentions?: string[] }) => {
  const text = cleanText(body.text), mentions = await cleanMentions(body.mentions);
  let told: Promise<void> | undefined;
  const m = await withThread(boardId, threadId, (t, doc) => {
    const m: Message = { id: newId(), author: author(user), text, at: now(), mentions, reactions: {} };
    t.messages.push(m);
    t.resolved = false;
    told = onComment(boardId, doc, t, m);
    return m;
  });
  await told;
  return m;
};

export const setResolved = (boardId: string, threadId: string, resolved: boolean) =>
  withThread(boardId, threadId, (t) => { t.resolved = !!resolved; return t; });

export const editMessage = async (boardId: string, threadId: string, msgId: string, user: User, body: { text?: string; mentions?: string[] }) => {
  const text = cleanText(body.text), mentions = await cleanMentions(body.mentions);
  return withThread(boardId, threadId, (t) => {
    const m = t.messages.find((x) => x.id === msgId);
    if (!m) throw new NotFound('No such message');
    if (m.author.id !== user.id) throw new BadRequest('Only the author can edit a comment');
    Object.assign(m, { text, mentions, edited: now() });
    return m;
  });
};

// Deleting the first message deletes the whole thread.
export const deleteMessage = (boardId: string, threadId: string, msgId: string, user: User) =>
  withThread(boardId, threadId, (t) => {
    const i = t.messages.findIndex((x) => x.id === msgId);
    if (i < 0) throw new NotFound('No such message');
    if (t.messages[i].author.id !== user.id) throw new BadRequest('Only the author can delete a comment');
    if (i === 0) t.messages = []; else t.messages.splice(i, 1);
    return { deleted: msgId };
  });

export const toggleReaction = (boardId: string, threadId: string, msgId: string, user: User, emoji: string) =>
  withThread(boardId, threadId, (t) => {
    if (!(REACTIONS as readonly string[]).includes(emoji)) throw new BadRequest('Unknown reaction');
    const m = t.messages.find((x) => x.id === msgId);
    if (!m) throw new NotFound('No such message');
    const who = m.reactions[emoji] ?? [];
    m.reactions[emoji] = who.includes(user.id) ? who.filter((u) => u !== user.id) : [...who, user.id];
    if (!m.reactions[emoji].length) delete m.reactions[emoji];
    return m.reactions;
  });

// Everyone who can be mentioned. ponytail: all users of this pragmatic install; scope to the team when hosted
export const listUsers = () => all<{ id: string; name: string; email: string; picture: string | null }>('SELECT id, name, email, picture FROM users ORDER BY lower(name)');
