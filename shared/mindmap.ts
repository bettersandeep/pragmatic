import type { MNode } from './model.ts';

// Indented outline -> trees of nodes (shared/mindmapOps.ts mindmapFromOutline makes the live mind map from one).
// A tree copied from a mind map also carries each node's look.
export type OutlineNode = { text: string; children: OutlineNode[] } & Pick<Partial<MNode>, 'color' | 'icon' | 'iconDeco' | 'dash'>;

const MARKER = String.raw`[-*+•◦▪‣]|\d+[.)]`;
const BULLET = /^[-*+]\s+/, MARKDOWN_MARKER = new RegExp(`^(${MARKER})\\s+`);
// A heading level outranks any indent: (level, column) compared as one number.
const LEVEL = 1e4;

// Every top-level line starts a tree; deeper lines go under the line above them, and "- * +" bullets are dropped.
// With `markdown` (paste and file import) also: numbered and other list markers, [ ] checkboxes, and headings, which
// nest: the lines after "## A" go under A, whatever their indent. Claude's outlines and the dialog keep the plain rules.
export function parseForest(src: string, markdown = false): OutlineNode[] {
  const roots: OutlineNode[] = [], stack: { indent: number; node: OutlineNode }[] = [];
  let level = 0; // of the last heading
  for (const line of src.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const h = markdown ? /^(#{1,6})\s+/.exec(line) : null;
    if (h) level = h[1].length;
    const indent = h ? (level - 1) * LEVEL : level * LEVEL + line.replace(/\t/g, '  ').search(/\S/);
    const text = markdown
      ? line.trim().replace(/^#{1,6}\s+/, '').replace(MARKDOWN_MARKER, '').replace(/^\[[ xX]\]\s+/, '')
      : line.trim().replace(BULLET, '');
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
    const node = { text, children: [] };
    (stack.at(-1)?.node.children ?? roots).push(node);
    stack.push({ indent, node });
  }
  return roots;
}

export function parseOutline(src: string): OutlineNode {
  const [root, second] = parseForest(src);
  if (!root) throw new Error('Outline is empty');
  if (second) throw new Error(`Only one root allowed, found second root "${second.text}"`);
  return root;
}

// Pasted text that reads as a list: several lines with list or heading markers, or a list in the HTML part (notes
// apps, Docs, Notion). Indented lines alone are not enough: code and JSON are indented too.
export const looksLikeOutline = (text: string, html = '') => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.length > 1 && (/<(ul|ol)[\s>]/i.test(html) || lines.some((l) => new RegExp(`^\\s*(${MARKER}|#{1,6})\\s+`).test(l)));
};
