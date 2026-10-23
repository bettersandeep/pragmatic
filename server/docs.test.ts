import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

process.env.PRAGMATIC_PGLITE = 'memory';
const { run } = await import('./db.ts');
const { blocksOf, docTools } = await import('./docs.ts');

await run('INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, 0)', 'ana', 'ana@x', 'Ana');
await run(`INSERT INTO items (id, kind, title, scope, owner_id, created_at, updated_at) VALUES ('b1', 'board', 'Flow', 'private', 'ana', 0, 0)`);

test('docs: Markdown round trip keeps custom blocks readable', async () => {
  const t = await docTools(), doc = new Y.Doc(), f = blocksOf(doc);
  t.write(doc, f, await t.parse('# Plan\n\nShip it.'), 'replace');
  // Blocks made in the editor: a callout and an embedded board.
  t.write(doc, f, [{ type: 'callout', props: { color: 'red' }, content: 'Ask first' }, { type: 'embed', props: { itemId: 'b1' } }] as never, 'append');
  const md = await t.toMarkdown(f);
  assert.match(md, /^# Plan\n\nShip it\./);
  assert.match(md, /> Ask first/);
  assert.match(md, /\[Flow\]\(http:\/\/localhost:\d+\/b\/b1\)/);
  assert.equal(t.write(doc, f, await t.parse('More'), 'append'), 5);
});

test('docs: append keeps what someone types at the same time', async () => {
  const t = await docTools(), server = new Y.Doc(), person = new Y.Doc();
  t.write(server, blocksOf(server), await t.parse('First para'), 'replace');
  Y.applyUpdate(person, Y.encodeStateAsUpdate(server));
  // The person types into the paragraph; the update is still on its way when Claude appends.
  const firstText = (n: Y.XmlElement | Y.XmlText | Y.XmlFragment): Y.XmlText | undefined =>
    n instanceof Y.XmlText ? n : n.toArray().map((c) => firstText(c as Y.XmlElement)).find(Boolean);
  const before = Y.encodeStateVector(person);
  firstText(blocksOf(person))!.insert('First para'.length, ' typed by a person');
  t.write(server, blocksOf(server), await t.parse('Appended'), 'append');
  Y.applyUpdate(server, Y.encodeStateAsUpdate(person, before));
  assert.match(await t.toMarkdown(blocksOf(server)), /^First para typed by a person\n\nAppended/);
});
