import type * as Y from 'yjs';
import type { Patch } from './doc.ts';
import { COLOR_NAMES, jsonEntries, type BoardObject, type ColorName, type StackObj, type TaskObj } from './model.ts';

// Stack layout: a title strip, then the cards top to bottom at the stack's width.
export const STACK_HEAD = 44, STACK_PAD = 12, STACK_GAP = 8, STACK_EMPTY = 64;

export const stackCards = (stackId: string, objs: BoardObject[]) =>
  objs.filter((o): o is TaskObj => o.type === 'task' && o.stack === stackId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.z - b.z);

// Patches that put every stack's cards in place and fit the stack to them. `skip` holds cards being dragged.
export function layoutStacks(objs: BoardObject[], skip: Set<string> = new Set()): Patch[] {
  const out: Patch[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  for (const s of objs) {
    if (s.type !== 'stack') continue;
    let y = s.y + STACK_HEAD;
    const w = s.w - 2 * STACK_PAD;
    const cards = stackCards(s.id, objs);
    for (const c of cards) {
      if (!skip.has(c.id) && !(near(c.x, s.x + STACK_PAD) && near(c.y, y) && near(c.w, w))) out.push({ id: c.id, x: s.x + STACK_PAD, y, w });
      y += c.h + STACK_GAP;
    }
    const h = (cards.length ? y - STACK_GAP - s.y : STACK_HEAD + STACK_EMPTY) + STACK_PAD;
    if (!near(h, s.h)) out.push({ id: s.id, h });
  }
  return out;
}

// Order value that places a card at `y` (its center) among the stack's other cards.
export function orderAt(stack: StackObj, y: number, objs: BoardObject[], cardId: string) {
  const others = stackCards(stack.id, objs).filter((c) => c.id !== cardId);
  const i = others.findIndex((c) => y < c.y + c.h / 2);
  const at = (k: number) => others[k].order ?? k;
  if (!others.length) return 1;
  if (i === -1) return at(others.length - 1) + 1;
  if (i === 0) return at(0) - 1;
  return (at(i - 1) + at(i)) / 2;
}

// Tags get a stable color from their name.
const TAG_COLORS = COLOR_NAMES.filter((c) => !['default', 'white', 'light-gray', 'silver', 'gray'].includes(c));
export function tagColor(tag: string): ColorName {
  let h = 0;
  for (const ch of tag.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

// Activity of task cards: one entry per change, keyed so that simultaneous writers never collide.
export type Activity = { task: string; at: number; by: string; what: string };
export const activityOf = (doc: Y.Doc) => doc.getMap<string>('activity');
export function logActivity(doc: Y.Doc, task: string, by: string, what: string) {
  const at = Date.now();
  activityOf(doc).set(`${task}:${at}:${Math.random().toString(36).slice(2, 8)}`, JSON.stringify({ task, at, by, what } satisfies Activity));
}
export const readActivity = (doc: Y.Doc, task: string): Activity[] =>
  jsonEntries<Activity>([...activityOf(doc).entries()].filter(([k]) => k.startsWith(`${task}:`))).map(([, a]) => a).sort((a, b) => a.at - b.at);

// What changed on a card, in words, for the activity log.
export function describeChange(before: TaskObj, patch: Partial<TaskObj>, names: (id: string) => string, stackTitle: (id: string) => string): string[] {
  const out: string[] = [];
  if (patch.title !== undefined && patch.title !== before.title) out.push(`renamed the card to "${patch.title}"`);
  if ('desc' in patch && patch.desc !== before.desc) out.push('changed the description');
  if ('assignee' in patch && patch.assignee !== before.assignee) out.push(patch.assignee ? `assigned ${names(patch.assignee)}` : 'removed the assignee');
  if (patch.color && patch.color !== before.color) out.push(`changed the color to ${patch.color}`);
  if ('stack' in patch && patch.stack !== before.stack) out.push(patch.stack ? `moved the card to ${stackTitle(patch.stack)}` : 'took the card out of its stack');
  if (patch.tags) {
    const old = new Set(before.tags ?? []), now = new Set(patch.tags);
    for (const t of now) if (!old.has(t)) out.push(`added the tag ${t}`);
    for (const t of old) if (!now.has(t)) out.push(`removed the tag ${t}`);
  }
  return out;
}
