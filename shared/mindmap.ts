// Indented outline -> trees of nodes (shared/mindmapOps.ts mindmapFromOutline makes the live mind map from one).
export type OutlineNode = { text: string; children: OutlineNode[] };

// Every top-level line starts a tree; deeper lines go under the line above them. List markers (- * + • 1. 1) [ ])
// are dropped, and Markdown headings nest: the lines after "## A" go under A, whatever their indent.
export function parseForest(src: string): OutlineNode[] {
  const roots: OutlineNode[] = [], stack: { indent: number; node: OutlineNode }[] = [];
  let level = 0; // of the last heading
  for (const line of src.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const h = /^\s*(#{1,6})\s+/.exec(line);
    if (h) level = h[1].length;
    const indent = h ? (level - 1) * 1e4 : level * 1e4 + line.replace(/\t/g, '  ').search(/\S/);
    const text = line.trim().replace(/^#{1,6}\s+/, '').replace(/^([-*+•◦▪‣]|\d+[.)])\s+/, '').replace(/^\[[ xX]\]\s+/, '');
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

// Text that reads as a list (several lines, some indented or marked), not a sentence or a paragraph.
export const looksLikeOutline = (text: string) => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.length > 1 && lines.some((l) => /^\s+\S/.test(l) || /^\s*([-*+•◦▪‣]|\d+[.)]|#{1,6})\s+/.test(l));
};
