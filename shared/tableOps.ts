import { DEFAULTS, cellKey, newId, type TableObj } from './model.ts';

export type Patch = { id: string } & Record<string, unknown>;
export const COL_W = 160;

export function newTable(data: string[][], at: { x: number; y: number }, z: number): TableObj {
  const rows = data.map(() => newId()), cols = (data[0] ?? ['']).map(() => newId());
  const t = { ...DEFAULTS.table, id: newId(), z, type: 'table', x: at.x, y: at.y, w: cols.length * COL_W, h: rows.length * 40, rows, cols, colW: {} } as TableObj;
  data.forEach((r, i) => cols.forEach((c, j) => { if (r[j]) (t as Record<string, unknown>)[cellKey(rows[i], c)] = r[j]; }));
  return t;
}

// "| a | b |\n| --- | --- |\n| 1 | 2 |" -> [["a","b"],["1","2"]]; the separator row is dropped.
export function parseMarkdownTable(md: string): string[][] {
  const rows = md.trim().split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
    .filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
  if (!rows.length) throw new Error('No table rows found');
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array(width - r.length).fill('')]);
}

export const tableData = (t: TableObj): string[][] => t.rows.map((r) => t.cols.map((c) => t[cellKey(r, c)] ?? ''));

export const toMarkdown = (t: TableObj) => {
  const [head = [], ...body] = tableData(t);
  const line = (r: string[]) => `| ${r.map((c) => c.replace(/\n/g, ' ')).join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...body.map(line)].join('\n');
};

export function addRow(t: TableObj, after?: string): { patch: Patch; row: string } {
  const row = newId(), i = after ? t.rows.indexOf(after) + 1 : t.rows.length;
  return { row, patch: { id: t.id, rows: [...t.rows.slice(0, i), row, ...t.rows.slice(i)] } };
}

export function addCol(t: TableObj, after?: string): { patch: Patch; col: string } {
  const col = newId(), i = after ? t.cols.indexOf(after) + 1 : t.cols.length;
  return { col, patch: { id: t.id, cols: [...t.cols.slice(0, i), col, ...t.cols.slice(i)], w: t.w + COL_W } };
}

export function deleteRow(t: TableObj, row: string): Patch | null {
  if (t.rows.length <= 1) return null;
  const patch: Patch = { id: t.id, rows: t.rows.filter((r) => r !== row) };
  t.cols.forEach((c) => { patch[cellKey(row, c)] = undefined; });
  return patch;
}

export function deleteCol(t: TableObj, col: string): Patch | null {
  if (t.cols.length <= 1) return null;
  const { [col]: _, ...colW } = t.colW;
  const patch: Patch = { id: t.id, cols: t.cols.filter((c) => c !== col), colW };
  t.rows.forEach((r) => { patch[cellKey(r, col)] = undefined; });
  return patch;
}
