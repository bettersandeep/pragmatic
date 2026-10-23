import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

process.env.PRAGMATIC_PGLITE = 'memory';
const rt = await import('../shared/richtext.ts');
const { addObjects, readObjects, richOf, updateObjects, objectsOf } = await import('../shared/doc.ts');
const { indentNode, outdentNode, addChild } = await import('../shared/mindmapOps.ts');
const { mindmapFromOutline } = await import('../shared/mindmapOps.ts');

const rich: import('../shared/richtext.ts').RichJSON = [
  { p: [{ text: 'Ship ' }, { text: 'today', marks: { bold: {} } }, { text: ' with ' }, { mention: { id: 'bo', label: 'Bo' } }, { br: true }, { text: 'see ' }, { text: 'doc', marks: { link: { href: 'https://x.io' } } }] },
  { list: 'bullet_list', items: [[{ p: [{ text: 'one' }] }], [{ p: [{ text: 'two' }] }, { list: 'ordered_list', items: [[{ p: [{ text: 'deep' }] }]] }]] },
];

test('rich text: JSON round trip, plain text for readers, whole-object marks and lists', () => {
  const doc = new Y.Doc(), f = doc.getXmlFragment('t');
  rt.setRich(f, rich);
  assert.deepEqual(rt.richToJSON(f), rich);
  assert.equal(rt.plainOf(f), 'Ship today with @Bo\nsee doc\n- one\n- two\n  1. deep');
  assert.equal(rt.hasMarkEverywhere(f, 'bold'), false);
  rt.formatAll(f, 'bold', {});
  assert.equal(rt.hasMarkEverywhere(f, 'bold'), true);
  assert.equal(rt.jsonHasMark(rt.richToJSON(f), 'bold'), true);
  rt.formatAll(f, 'bold', null);
  assert.equal(rt.hasMarkEverywhere(f, 'bold'), false);
  rt.setListAll(f, 'ordered_list');
  assert.equal(rt.listKindOf(f), 'ordered_list');
  assert.equal(rt.plainOf(f).split('\n')[0], '1. Ship today with @Bo');
  rt.setListAll(f, null);
  assert.equal(rt.listKindOf(f), null);
  assert.equal(rt.safeHref('javascript:alert(1)'), null);
  assert.equal(rt.safeHref(' https://a.b '), 'https://a.b');
});

test('board objects: rich fields read as plain text, keep formatting through JSON, old text converts on first edit', () => {
  const doc = new Y.Doc();
  addObjects(doc, [{ id: 's', type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1, z: 1, color: 'blue', deco: 'fill', fontSize: 'm', align: 'center', text: 'x', rich: { text: rich } } as never]);
  const [s] = readObjects(doc) as { text: string; rich?: Record<string, unknown> }[];
  assert.equal(s.text, rt.plainOf(rich), 'plain text for search, MCP, Mermaid');
  assert.deepEqual(s.rich?.text, rich, 'formatting travels with the JSON (duplicate, paste, templates)');
  updateObjects(doc, [{ id: 's', text: s.text }]);
  assert.deepEqual(readObjects(doc)[0].rich?.text, rich, 'the same plain text changes nothing');
  updateObjects(doc, [{ id: 's', text: 'new words' }]);
  assert.equal((readObjects(doc)[0] as { text: string }).text, 'new words', 'other plain text (Claude, the API) replaces the content');
  // A board from before rich text: the field is a Y.Text.
  objectsOf(doc).get('s')!.set('text', new Y.Text('old\ntext'));
  assert.equal((readObjects(doc)[0] as { text: string }).text, 'old\ntext');
  const f = richOf(doc, 's', 'text')!;
  assert.ok(f instanceof Y.XmlFragment);
  assert.deepEqual(rt.richToJSON(f), [{ p: [{ text: 'old' }] }, { p: [{ text: 'text' }] }]);
});

test('mind map: indent under the node above, outdent after the parent', () => {
  const m = mindmapFromOutline('Root\n  A\n  B\n    B1', { x: 0, y: 0 }, 1);
  const id = (t: string) => Object.entries(m).find(([k, v]) => k.startsWith('n.') && (v as { text: string }).text === t)![0].slice(2);
  const a = id('A'), b = id('B'), b1 = id('B1');
  assert.equal(indentNode(m, a), null, 'nothing above A');
  const pb = indentNode(m, b)!;
  assert.equal((pb[`n.${b}`] as { parent: string }).parent, a);
  assert.equal(outdentNode(m, a), null, 'children of the root stay');
  const po = outdentNode(m, b1)!;
  const moved = po[`n.${b1}`] as { parent: string; order: number };
  assert.equal(moved.parent, (m[`n.${b}`] as { parent: string }).parent);
  assert.ok(moved.order > (m[`n.${b}`] as { order: number }).order, 'right after its old parent');
  assert.ok(addChild(m, b).nodeId);
});

test('inbox: a mention typed into board text notifies once a day, not the author, not outsiders', async () => {
  const { run } = await import('./db.ts');
  for (const u of ['ana', 'bo', 'cy']) await run('INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, 0)', u, `${u}@x`, u);
  const store = await import('./store.ts');
  const inbox = await import('./inbox.ts');
  const { editBoard, hooks } = await import('./collab.ts');
  hooks.objects = inbox.onObjects;
  const b = await store.createItem('ana', { kind: 'board', title: 'B' });
  await store.share('ana', b.id, 'bo', 'view');
  const mention = (who: string) => editBoard(b.id, (doc) => {
    const f = richOf(doc, 's', 'text')!;
    rt.setRich(f, [{ p: [{ text: 'hi ' }, { mention: { id: who, label: who } }] }]);
  }, { id: 'ana', name: 'ana' });
  await editBoard(b.id, (doc) => addObjects(doc, [{ id: 's', type: 'sticky', x: 0, y: 0, w: 1, h: 1, z: 1, color: 'yellow', fontSize: 'm', text: '' } as never]));
  await mention('bo');
  await mention('cy');
  await mention('ana');
  await mention('bo');
  await inbox.settled();
  const bo = (await inbox.list('bo')).filter((n) => n.board_id === b.id);
  assert.equal(bo.length, 1, 'once');
  assert.equal(bo[0].kind, 'mention');
  assert.equal(bo[0].object_id, 's');
  assert.equal(bo[0].text, 'hi @bo');
  assert.equal((await inbox.list('cy')).length, 0, 'cy cannot open the board');
  assert.equal((await inbox.list('ana')).length, 0, 'not the author');
});

test('plain text into rich text: only the changed words change, formatting elsewhere stays', () => {
  const doc = new Y.Doc(), f = doc.getXmlFragment('t');
  rt.setRich(f, [{ p: [{ text: 'Ship ' }, { text: 'today', marks: { bold: {} } }] }, { p: [{ text: 'second' }] }]);
  rt.setPlain(f, 'Ship today!\nsecond');
  assert.deepEqual(rt.richToJSON(f), [{ p: [{ text: 'Ship ' }, { text: 'today!', marks: { bold: {} } }] }, { p: [{ text: 'second' }] }], 'typing at the end of bold text stays bold');
  rt.setPlain(f, 'Ship today!\nsecond\nthird');
  assert.equal(rt.plainOf(f), 'Ship today!\nsecond\nthird');
  assert.equal(rt.jsonHasMark(rt.richToJSON(f).slice(0, 1), 'bold'), false, 'first line still part plain');
});
