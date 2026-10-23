import type * as Y from 'yjs';
import { jsonEntries } from './model.ts';

// Comment threads live in the board document, so they sync live. The app writes them only through the server,
// which sets each message's author to the signed-in user. Editors' sockets can still write this map (README, Known
// limits), so readers skip values that do not parse.
export type Author = { id: string; name: string; picture: string | null };
export type Message = {
  id: string; author: Author; text: string; at: number; edited?: number;
  mentions: string[]; reactions: Record<string, string[]>;
};
// Anchor: a point on the board, or a point relative to an object's top-left (it moves with the object).
export type Anchor = { objectId?: string; x: number; y: number };
export type Thread = { id: string; anchor: Anchor; resolved: boolean; at: number; messages: Message[] };

export const REACTIONS = ['👍', '❤️', '😄', '🎉', '👀', '✅'] as const;

export const commentsOf = (doc: Y.Doc) => doc.getMap<string>('comments');
export const readThreads = (doc: Y.Doc): Thread[] =>
  jsonEntries<Thread>(commentsOf(doc).entries()).map(([, t]) => t).sort((a, b) => a.at - b.at);
