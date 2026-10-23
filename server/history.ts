import * as Y from 'yjs';
import { all, now, one, run, tx } from './db.ts';

// Board storage is an append-only log of Yjs updates plus checkpoints (the full state at a log position).
// Load = latest checkpoint + the updates after it. Any past moment = the checkpoint before it + updates up to it.
// Retention: every change for 30 days, then one point per hour for 6 months, then one point per day (see prune).
const DAY = 864e5, HOUR = 36e5;
export const KEEP_ALL_DAYS = 30, KEEP_HOURLY_DAYS = 180;
const CHECKPOINT_EVERY = 500; // updates; keeps load time flat
const SESSION_GAP = 5 * 60e3; // the time machine lists one point per editing session

type Row = { seq: number; at: number; authors: string; data: Uint8Array };
type Cp = { seq: number; at: number; authors: string; ydoc: Uint8Array };

const lastCheckpoint = (board: string, upTo = Number.MAX_SAFE_INTEGER) =>
  one<Cp>('SELECT seq, at, authors, ydoc FROM checkpoints WHERE board_id = $1 AND seq <= $2 ORDER BY seq DESC LIMIT 1', board, upTo);
const updatesAfter = (board: string, from: number, upTo = Number.MAX_SAFE_INTEGER) =>
  all<Row>('SELECT seq, at, authors, data FROM updates WHERE board_id = $1 AND seq > $2 AND seq <= $3 ORDER BY seq', board, from, upTo);

// The board's state at log position `upTo` (default: now), and the last position.
export async function stateAt(board: string, upTo?: number): Promise<{ doc: Y.Doc; seq: number }> {
  const doc = new Y.Doc(), cp = await lastCheckpoint(board, upTo);
  if (cp) Y.applyUpdate(doc, cp.ydoc);
  let seq = cp?.seq ?? 0;
  for (const u of await updatesAfter(board, seq, upTo)) { Y.applyUpdate(doc, u.data); seq = u.seq; }
  return { doc, seq };
}

export async function append(board: string, data: Uint8Array, authors: string[]): Promise<number> {
  const row = await one<{ seq: number }>('INSERT INTO updates (board_id, at, authors, data) VALUES ($1, $2, $3, $4) RETURNING seq', board, now(), JSON.stringify(authors), data);
  return row!.seq;
}

// `state` is the full document (Y.encodeStateAsUpdate) as of log position `seq`.
export const checkpoint = (board: string, state: Uint8Array, seq: number, at = now(), authors: string[] = []) =>
  run(`INSERT INTO checkpoints (board_id, seq, at, authors, ydoc) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (board_id, seq) DO UPDATE SET at = excluded.at, authors = excluded.authors, ydoc = excluded.ydoc`, board, seq, at, JSON.stringify(authors), state);

// After an append: write a checkpoint once enough updates piled up since the last one.
export async function maybeCheckpoint(board: string, state: Uint8Array, seq: number, force = false) {
  const cp = (await one<{ seq: number }>('SELECT max(seq) AS seq FROM checkpoints WHERE board_id = $1', board))?.seq ?? 0;
  if (seq <= cp) return;
  const since = force ? 0 : (await one<{ n: number }>('SELECT count(*) AS n FROM updates WHERE board_id = $1 AND seq > $2', board, cp))!.n;
  if (force || since >= CHECKPOINT_EVERY) await checkpoint(board, state, seq);
}

// Time machine points, newest first: one per editing session in the log, then the older checkpoints.
// ponytail: reads the board's whole log; page it if boards keep months of fine-grained edits
export async function listVersions(board: string) {
  const rows = await all<Omit<Row, 'data'>>('SELECT seq, at, authors FROM updates WHERE board_id = $1 ORDER BY seq', board);
  const points: { id: string; at: number; authors: string[] }[] = [];
  let cur: { seq: number; at: number; authors: Set<string> } | null = null;
  for (const r of rows) {
    if (cur && r.at - cur.at > SESSION_GAP) { points.push({ id: String(cur.seq), at: cur.at, authors: [...cur.authors] }); cur = null; }
    cur ??= { seq: r.seq, at: r.at, authors: new Set() };
    cur.seq = r.seq; cur.at = r.at;
    for (const a of JSON.parse(r.authors) as string[]) cur.authors.add(a);
  }
  if (cur) points.push({ id: String(cur.seq), at: cur.at, authors: [...cur.authors] });
  const first = rows[0]?.seq ?? Number.MAX_SAFE_INTEGER;
  const older = await all<Omit<Cp, 'ydoc'>>('SELECT seq, at, authors FROM checkpoints WHERE board_id = $1 AND seq < $2 ORDER BY seq', board, first);
  return [...older.map((c) => ({ id: String(c.seq), at: c.at, authors: JSON.parse(c.authors) as string[] })), ...points].reverse();
}

// Thin old history. Updates older than 30 days merge into one per hour, older than 6 months into one per day: each
// group becomes its last row holding the group's updates merged, so every listed point stays and costs only its own
// changes (a full copy per point would grow by the board's whole size each hour).
// Checkpoints only speed up loading once the log covers them, so only the newest of those stays. Checkpoints from
// before the first update in the log are the only copy of that history (earlier builds deleted old updates): they
// stay, one per UTC day past 6 months.
export function prune(board: string, t = now()) {
  return tx(async () => {
    for (const [age, size] of [[KEEP_HOURLY_DAYS * DAY, DAY], [KEEP_ALL_DAYS * DAY, HOUR]]) {
      const groups = await all<{ g: number }>(`SELECT at / ${size} AS g FROM updates WHERE board_id = $1 AND at < $2 GROUP BY at / ${size} HAVING count(*) > 1`, board, t - age);
      for (const { g } of groups) {
        const rows = await all<Row>(`SELECT seq, at, authors, data FROM updates WHERE board_id = $1 AND at < $2 AND at / ${size} = $3 ORDER BY seq`, board, t - age, g);
        const authors = new Set(rows.flatMap((r) => JSON.parse(r.authors) as string[])), last = rows.at(-1)!;
        await run('UPDATE updates SET data = $1, authors = $2 WHERE board_id = $3 AND seq = $4', Y.mergeUpdates(rows.map((r) => r.data)), JSON.stringify([...authors]), board, last.seq);
        await run('DELETE FROM updates WHERE board_id = $1 AND seq = ANY($2::bigint[])', board, rows.slice(0, -1).map((r) => r.seq));
      }
    }
    await run(`DELETE FROM checkpoints WHERE board_id = $1 AND seq >= (SELECT min(seq) FROM updates WHERE board_id = $1)
      AND seq < (SELECT max(seq) FROM checkpoints WHERE board_id = $1)`, board);
    await run(`DELETE FROM checkpoints WHERE board_id = $1 AND at < $2 AND seq NOT IN (
      SELECT max(seq) FROM checkpoints WHERE board_id = $1 AND at < $2 GROUP BY at / ${DAY})`, board, t - KEEP_HOURLY_DAYS * DAY);
  });
}

export async function pruneAll() {
  for (const { id } of await all<{ id: string }>(`SELECT id FROM items WHERE kind IN ('board', 'doc')`)) await prune(id);
}
