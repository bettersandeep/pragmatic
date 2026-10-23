// Indented outline -> a tree of nodes (shared/mindmapOps.ts mindmapFromOutline makes the live mind map from it).
type Node = { text: string; children: Node[] };

export function parseOutline(src: string): Node {
  const lines = src
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => ({
      indent: l.replace(/\t/g, '  ').search(/\S/),
      text: l.trim().replace(/^[-*+]\s+/, ''),
    }));
  if (!lines.length) throw new Error('Outline is empty');
  const root: Node = { text: lines[0].text, children: [] };
  const stack = [{ indent: lines[0].indent, node: root }];
  for (const l of lines.slice(1)) {
    while (stack.length > 1 && stack.at(-1)!.indent >= l.indent) stack.pop();
    if (l.indent <= stack[0].indent) throw new Error(`Only one root allowed, found second root "${l.text}"`);
    const node = { text: l.text, children: [] };
    stack.at(-1)!.node.children.push(node);
    stack.push({ indent: l.indent, node });
  }
  return root;
}
