// Board shapes and connectors -> Mermaid flowchart text ("Copy as Mermaid").
import { isBox, type BoardObject, type ShapeKind } from './model.ts';

const WRAP: Partial<Record<ShapeKind, [string, string]>> = {
  rect: ['[', ']'], pill: ['([', '])'], oval: ['((', '))'], diamond: ['{', '}'], hexagon: ['{{', '}}'], cylinder: ['[(', ')]'],
  parallelogram: ['[/', '/]'], 'parallelogram-flip': ['[\\', '\\]'], trapezoid: ['[/', '\\]'],
};
const label = (t: string) => `"${(t || ' ').replace(/"/g, '#quot;').replace(/\n/g, '<br/>')}"`;

export function toMermaid(objs: BoardObject[]): string {
  const nodes = objs.filter((o) => o.type === 'shape' || o.type === 'sticky' || o.type === 'text');
  if (!nodes.length) return '';
  const ids = new Map(nodes.map((o, i) => [o.id, `n${i + 1}`]));
  const boxes = nodes.filter(isBox);
  const w = Math.max(...boxes.map((b) => b.x + b.w)) - Math.min(...boxes.map((b) => b.x));
  const h = Math.max(...boxes.map((b) => b.y + b.h)) - Math.min(...boxes.map((b) => b.y));
  const lines = [`flowchart ${w >= h ? 'LR' : 'TD'}`];
  for (const o of nodes) {
    const [a, b] = o.type === 'shape' ? WRAP[o.shape] ?? ['[', ']'] : ['[', ']'];
    lines.push(`  ${ids.get(o.id)}${a}${label('text' in o ? o.text : '')}${b}`);
  }
  for (const c of objs) {
    if (c.type !== 'connector' || !c.from.id || !c.to.id || !ids.has(c.from.id) || !ids.has(c.to.id)) continue;
    const arrow = c.dash ? (c.endCap === 'arrow' ? '-.->' : '-.-') : c.endCap === 'arrow' ? (c.startCap === 'arrow' ? '<-->' : '-->') : '---';
    lines.push(`  ${ids.get(c.from.id)} ${arrow}${c.text ? `|${label(c.text)}|` : ''} ${ids.get(c.to.id)}`);
  }
  return lines.join('\n');
}
