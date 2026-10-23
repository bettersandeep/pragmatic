import * as Y from 'yjs';
import { all } from './db.ts';
import { BASE_URL } from './tasks.ts';
import { calloutConfig, embedConfig } from '../shared/docSchema.ts';

// Docs are BlockNote content in the item's Y.Doc (XML fragment "blocks").
// The server converts Markdown with BlockNote's own server tools, loaded on first use (they bring jsdom).
// Load them with `docTools()` first; writes are then synchronous, so they can run inside editBoard (which records the author).
type Tools = Awaited<ReturnType<typeof load>>;
async function load() {
  const [{ ServerBlockNoteEditor }, { BlockNoteSchema, createBlockSpec, defaultBlockSpecs }] = await Promise.all([import('@blocknote/server-util'), import('@blocknote/core')]);
  // Markdown has no embeds or callouts: an embed becomes a link, a callout a quote.
  // Export renders synchronously, so the embedded items' titles are read before it (`known`).
  const known = new Map<string, { kind: string; title: string }>();
  const embed = createBlockSpec(embedConfig, {
    render: (block) => {
      const p = document.createElement('p'), a = document.createElement('a'), id = block.props.itemId;
      const item = known.get(id);
      a.href = `${BASE_URL}/${item?.kind === 'doc' ? 'd' : 'b'}/${id}`;
      a.textContent = item?.title ?? 'Embedded item';
      p.append(a);
      return { dom: p };
    },
  });
  const callout = createBlockSpec(calloutConfig, {
    render: () => { const q = document.createElement('blockquote'); return { dom: q, contentDOM: q }; },
  });
  const e = ServerBlockNoteEditor.create({ schema: BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, embed: embed(), callout: callout() } }) });
  return {
    async toMarkdown(fragment: Y.XmlFragment) {
      const blocks = e.yXmlFragmentToBlocks(fragment), ids: string[] = [];
      const walk = (bs: typeof blocks) => bs.forEach((b) => { if (b.type === 'embed' && b.props.itemId) ids.push(b.props.itemId); walk(b.children); });
      walk(blocks);
      if (ids.length) for (const r of await all<{ id: string; kind: string; title: string }>('SELECT id, kind, title FROM items WHERE id = ANY($1::text[])', ids)) known.set(r.id, r);
      return e.blocksToMarkdownLossy(blocks);
    },
    parse: (markdown: string) => e.tryParseMarkdownToBlocks(markdown),
    // Replace the content, or add blocks after it, in one transaction. Returns the number of top-level blocks.
    // Append inserts only the new blocks: rebuilding the whole doc would drop what someone types at the same time
    // (their edit lands in deleted nodes). A BlockNote fragment is one blockGroup that holds the blocks.
    write(doc: Y.Doc, fragment: Y.XmlFragment, add: Awaited<ReturnType<typeof e.tryParseMarkdownToBlocks>>, mode: 'replace' | 'append', origin?: unknown) {
      const group = fragment.get(0);
      if (mode === 'append' && group instanceof Y.XmlElement) {
        const scratch = new Y.Doc().getXmlFragment('blocks');
        e.blocksToYXmlFragment(add, scratch);
        const fresh = (scratch.get(0) as Y.XmlElement).toArray().map((n) => (n as Y.XmlElement).clone());
        doc.transact(() => group.insert(group.length, fresh), origin);
        return group.length;
      }
      doc.transact(() => {
        fragment.delete(0, fragment.length);
        e.blocksToYXmlFragment(add, fragment);
      }, origin);
      return add.length;
    },
  };
}
let tools: Promise<Tools> | null = null;
export const docTools = () => (tools ??= load());

export const blocksOf = (doc: Y.Doc) => doc.getXmlFragment('blocks');
