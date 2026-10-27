import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

process.env.PRAGMATIC_PGLITE = 'memory';
process.env.PRAGMATIC_FILES = (await import('node:os')).tmpdir() + '/pragmatic-test-files';
const { parseOutline, parseForest, looksLikeOutline } = await import('../shared/mindmap.ts');
const { domainAllowed } = await import('./auth.ts');
const { connectorGeometry, autoSide } = await import('../shared/route.ts');
const { fromExcalidraw, nearestColor } = await import('../shared/excalidraw.ts');
const { placeBatch, bounds } = await import('../shared/layout.ts');
const { addObjects, deleteObjects, readObjects, updateObjects, objectsOf, searchText } = await import('../shared/doc.ts');
const { build } = await import('./mcp.ts');
const { imageSize } = await import('./files.ts');
import type { BoardObject, BoxObject, ConnectorObj } from '../shared/model.ts';

const box = (id: string, x: number, y: number, w = 100, h = 50): BoxObject =>
  ({ id, z: 1, type: 'shape', shape: 'rect', x, y, w, h, color: 'white', deco: 'outline', text: id, fontSize: 'm', align: 'center' });
const conn = (id: string, from: string, to: string, route: ConnectorObj['route'] = 'elbow'): ConnectorObj =>
  ({ id, z: 2, type: 'connector', from: { id: from }, to: { id: to }, route, startCap: 'none', endCap: 'arrow', color: 'silver', dash: false, text: '' });

test('outline parsing handles bullets, tabs and uneven indents', () => {
  const root = parseOutline('Product\n  - Web\n\t- Auth\n  - Desktop\n    * Shell');
  assert.equal(root.text, 'Product');
  assert.deepEqual(root.children.map((c) => c.text), ['Web', 'Auth', 'Desktop']);
  assert.equal(root.children[2].children[0].text, 'Shell');
  assert.throws(() => parseOutline('A\nB'), /one root/);
});

test('google domain check needs a verified email in the allowed hosted domain', () => {
  assert.equal(domainAllowed({ email: 'a@example.com', email_verified: true, hd: 'example.com' }, ['example.com']), true);
  assert.equal(domainAllowed({ email: 'a@example.com', email_verified: false, hd: 'example.com' }, ['example.com']), false);
  assert.equal(domainAllowed({ email: 'a@gmail.com', email_verified: true }, ['example.com']), false);
  assert.equal(domainAllowed({ email: 'a@evil.com', email_verified: true, hd: 'evil.com' }, ['example.com']), false);
  assert.equal(domainAllowed({ email: 'a@gmail.com', email_verified: true }, []), true, 'no domains set: any verified Google account');
  assert.equal(domainAllowed({ email: 'a@gmail.com', email_verified: false }, []), false);
});

test('connectors pick facing sides and route orthogonally', () => {
  const a = box('a', 0, 0), b = box('b', 300, 0), c = box('c', 0, 300);
  assert.equal(autoSide(a, { x: 350, y: 25 }), 'right');
  assert.equal(autoSide(a, { x: 50, y: 325 }), 'bottom');
  const byId = new Map<string, BoardObject>([['a', a], ['b', b], ['c', c]]);
  const g = connectorGeometry(conn('x', 'a', 'b'), byId)!;
  assert.deepEqual([g.start, g.end], [{ x: 100, y: 25 }, { x: 300, y: 25 }]);
  assert.deepEqual(g.endDir, { x: 1, y: 0 });
  const down = connectorGeometry(conn('y', 'a', 'c'), byId)!;
  assert.deepEqual([down.start, down.end, down.endDir], [{ x: 50, y: 50 }, { x: 50, y: 300 }, { x: 0, y: 1 }]);
  // An elbow between offset boxes bends: the path has corners.
  const d = box('d', 300, 200);
  byId.set('d', d);
  assert.match(connectorGeometry(conn('z', 'a', 'd'), byId)!.d, /Q/);
  assert.equal(connectorGeometry(conn('gone', 'a', 'missing'), byId), null);
});

test('excalidraw import keeps labels, bindings and colors', () => {
  const objs = fromExcalidraw([
    { id: 'r', type: 'rectangle', x: 0, y: 0, width: 120, height: 60, backgroundColor: '#a5d8ff', strokeColor: '#1e1e1e' },
    { id: 't', type: 'text', containerId: 'r', text: 'Start', x: 10, y: 10 },
    { id: 'e', type: 'ellipse', x: 300, y: 0, width: 80, height: 80, label: { text: 'End' } },
    { id: 'a', type: 'arrow', x: 120, y: 30, points: [[0, 0], [180, 0]], startBinding: { elementId: 'r' }, end: { id: 'e' }, label: { text: 'go' } },
    { id: 'free', type: 'text', text: 'Note', x: 0, y: 200, fontSize: 27 },
    { id: 'dead', type: 'rectangle', isDeleted: true, x: 0, y: 0 },
  ]);
  const [r, e, note, a] = [objs.find((o) => o.type === 'shape' && o.shape === 'rect'), objs.find((o) => o.type === 'shape' && o.shape === 'oval'), objs.find((o) => o.type === 'text'), objs.find((o) => o.type === 'connector')] as [any, any, any, any];
  assert.equal(objs.length, 4);
  assert.equal(r.text, 'Start');
  assert.equal(r.color, 'blue');
  assert.equal(e.text, 'End');
  assert.equal(note.fontSize, 'l1');
  assert.deepEqual([a.from.id, a.to.id, a.text], [r.id, e.id, 'go']);
  assert.equal(nearestColor('#888888', 'white'), 'white');
});

test('a new batch lands right of existing content, or at the given point', () => {
  const existing = [box('a', 0, 0, 200, 100)];
  const placed = placeBatch([box('n', 50, 50)], existing);
  assert.deepEqual([(placed[0] as BoxObject).x, (placed[0] as BoxObject).y], [360, 0]);
  const at = placeBatch([box('n', 50, 50), box('m', 150, 90)], existing, { x: -500, y: 10 });
  assert.deepEqual(bounds(at), { x: -500, y: 10, w: 200, h: 90 });
});

test('doc helpers: field-level updates, cascading deletes, search text', () => {
  const doc = new Y.Doc();
  addObjects(doc, [box('a', 0, 0), box('b', 300, 0), conn('c', 'a', 'b')]);
  let changes = 0;
  objectsOf(doc).observeDeep(() => changes++);
  updateObjects(doc, [{ id: 'a', x: 0, text: 'a' }]); // nothing changed
  assert.equal(changes, 0);
  updateObjects(doc, [{ id: 'a', x: 10 }]);
  assert.equal((readObjects(doc).find((o) => o.id === 'a') as BoxObject).x, 10);
  assert.match(searchText(doc), /a\s+b|a.*\n.*b/s);
  assert.deepEqual(deleteObjects(doc, ['b']).sort(), ['b', 'c']);
  assert.deepEqual(readObjects(doc).map((o) => o.id), ['a']);
});

test('MCP batch builder maps ids, binds connectors and rejects unknown ids', () => {
  const { objs, ids } = build([
    { type: 'shape', id: 'web', text: 'Web', x: 0, y: 0 },
    { type: 'shape', id: 'db', shape: 'cylinder', text: 'DB', x: 300, y: 0, color: 'green', deco: 'fill' },
    { type: 'connector', from_id: 'web', to_id: 'db', text: 'SQL', route: 'straight' },
    { type: 'section', text: 'Backend', x: -40, y: -40, w: 500, h: 200 },
  ], new Set(['existing']), 10);
  const [web, db, c, s] = objs as [any, any, any, any];
  assert.equal(web.id, ids.web);
  assert.deepEqual([db.shape, db.w, db.h, db.color, db.deco], ['cylinder', 120, 140, 'green', 'fill']);
  assert.deepEqual([c.from.id, c.to.id, c.text, c.route, c.endCap], [ids.web, ids.db, 'SQL', 'straight', 'arrow']);
  assert.ok(s.z < web.z, 'sections stay below other objects');
  assert.equal(s.title, 'Backend');
  assert.equal(build([{ type: 'connector', from_id: 'existing', to_id: 'existing' }], new Set(['existing']), 1).objs.length, 1);
  assert.throws(() => build([{ type: 'connector', from_id: 'nope', to_id: 'web' }], new Set(), 1), /Unknown object id/);
});

test('image size is read from PNG, GIF and JPEG headers', () => {
  const png = Buffer.alloc(24); png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20);
  assert.deepEqual(imageSize(png, 'image/png'), { width: 640, height: 480 });
  const gif = Buffer.from('GIF89a\x20\x03\x58\x02', 'latin1');
  assert.deepEqual(imageSize(gif, 'image/gif'), { width: 800, height: 600 });
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03]);
  assert.deepEqual(imageSize(jpg, 'image/jpeg'), { width: 400, height: 300 });
});

const { layoutMindmap, estimateMeasure, buildTree } = await import('../shared/mindmapLayout.ts');
const mm = await import('../shared/mindmapOps.ts');
const tops = await import('../shared/tableOps.ts');

test('mind map ops: child, sibling order, parent insert, delete subtree, outline', () => {
  let o = mm.mindmapFromOutline('Root\n  A\n    A1\n  B', { x: 0, y: 0 }, 1);
  const apply = (p: Record<string, unknown> | null) => { assert.ok(p); for (const [k, v] of Object.entries(p!)) if (k !== 'id') (v === undefined ? delete (o as any)[k] : ((o as any)[k] = v)); };
  const id = (text: string) => Object.entries(o).find(([k, v]) => k.startsWith('n.') && (v as any).text === text)![0].slice(2);
  assert.equal(mm.toOutline(o), 'Root\n  A\n    A1\n  B');
  const s = mm.addSibling(o, id('A'), false, 'A.5')!; apply(s.patch);       // between A and B
  const b = mm.addSibling(o, id('A'), true, 'before A')!; apply(b.patch);
  assert.equal(mm.toOutline(o), 'Root\n  before A\n  A\n    A1\n  A.5\n  B');
  apply(mm.addParent(o, id('A1'), 'mid')!.patch);
  assert.equal(mm.toOutline(o), 'Root\n  before A\n  A\n    mid\n      A1\n  A.5\n  B');
  apply(mm.deleteNode(o, id('A')));
  assert.equal(mm.toOutline(o), 'Root\n  before A\n  A.5\n  B');
  assert.equal(mm.deleteNode(o, id('Root')), null);
  assert.equal(mm.addSibling(o, id('Root')), null);
  assert.equal(mm.neighbour(o, id('A.5'), 'prev'), id('before A'));
  assert.equal(mm.neighbour(o, id('Root'), 'child'), id('before A'));
});

test('mind map ops: reorder, fold all, paste branches, branch outline', () => {
  const o = mm.mindmapFromOutline('Root\n  A\n    A1\n      A1a\n  B', { x: 0, y: 0 }, 1);
  const apply = (p: Record<string, unknown> | null) => { assert.ok(p); for (const [k, v] of Object.entries(p!)) if (k !== 'id') (o as any)[k] = v; };
  const id = (text: string) => Object.entries(o).find(([k, v]) => k.startsWith('n.') && (v as any).text === text)![0].slice(2);
  apply(mm.moveNode(o, id('A'), 1));
  assert.equal(mm.toOutline(o), 'Root\n  B\n  A\n    A1\n      A1a');
  assert.equal(mm.moveNode(o, id('A'), 1), null);
  assert.equal(mm.moveNode(o, id('Root'), -1), null);
  apply(mm.foldAll(o, id('A')));
  assert.equal((o as any)[`n.${id('A1')}`].collapsed, true);
  assert.equal(mm.foldAll(o, id('B')), null); // no branches under B
  apply(mm.foldAll(o, id('A')));
  assert.equal((o as any)[`n.${id('A1')}`].collapsed, false);
  apply(mm.addTrees(o, id('B'), parseForest('- X\n  - X1\n- Y')));
  assert.equal(mm.toOutline(o, false, id('B')), 'B\n  X\n    X1\n  Y');
});

test('outline forest: several roots, list markers, Markdown headings (paste and import only)', () => {
  const f = parseForest('# Plan\nIntro\n## Steps\n1. One\n2) Two\n   - [x] done\n# Later\n• Idea', true);
  const show = (n: any, d = 0): string => `${'  '.repeat(d)}${n.text}\n${n.children.map((c: any) => show(c, d + 1)).join('')}`;
  assert.equal(f.map((n) => show(n)).join(''), 'Plan\n  Intro\n  Steps\n    One\n    Two\n      done\nLater\n  Idea\n');
  // Claude's outlines and the dialog keep the plain rules: only "- * +" bullets go, "#" and "1." are text.
  assert.deepEqual(parseOutline('Metrics\n  # of users\n  1. Revenue\n  - Cost').children.map((c) => c.text), ['# of users', '1. Revenue', 'Cost']);
  assert.ok(looksLikeOutline('- A\n- B'));
  assert.ok(looksLikeOutline('# A\nB'));
  assert.ok(looksLikeOutline('A\n\tB', '<ul><li>A<ul><li>B</li></ul></li></ul>')); // a notes app's list
  assert.ok(!looksLikeOutline('A\n  B')); // indent alone: could be code
  assert.ok(!looksLikeOutline('function f() {\n  return 1;\n}'));
  assert.ok(!looksLikeOutline('{\n  "a": 1\n}'));
  assert.ok(!looksLikeOutline('- One line'));
  assert.ok(!looksLikeOutline('A paragraph.\nAnother line.'));
});

const ops = await import('../web/src/engine/ops.ts');

test('clipboard: cells, branch copies and object copies', () => {
  assert.deepEqual(ops.clipTable('', 'Name\tAge\nAsha\t31'), [['Name', 'Age'], ['Asha', '31']]);
  assert.deepEqual(ops.clipTable('', 'Name\tAge\n\t30'), [['Name', 'Age'], ['', '30']]); // an empty first cell
  assert.equal(ops.clipTable('', 'A\n\tB'), null); // an indented list
  assert.equal(ops.clipTable('', '\tA\n\t\tB'), null);
  assert.equal(ops.clipTable('', 'Just text'), null);

  const o = mm.mindmapFromOutline('Root\n  A\n    A1\n  B\n    B1', { x: 0, y: 0 }, 1);
  const id = (text: string) => Object.entries(o).find(([k, v]) => k.startsWith('n.') && (v as any).text === text)![0].slice(2);
  const [a, a1, b] = [id('A'), id('A1'), id('B')];
  Object.assign(o, { [`n.${a}`]: { ...(o as any)[`n.${a}`], text: 'Q3 plan\nowner: Ana', color: 'red', icon: 'star' }, [`n.${a1}`]: { ...(o as any)[`n.${a1}`], text: '1. Hire' }, [`n.${b}`]: { ...(o as any)[`n.${b}`], text: '' } });
  const c = ops.clipOf([o.id], [o], { id: o.id, node: a });
  assert.equal(c.text, 'Q3 plan owner: Ana\n  1. Hire'); // readable for other apps
  assert.ok(c.html.includes('<li>Q3 plan<br>owner: Ana<ul><li>1. Hire</li></ul></li>'));
  assert.deepEqual(ops.branchOf(c.html), { text: 'Q3 plan\nowner: Ana', color: 'red', icon: 'star', children: [{ text: '1. Hire', children: [] }] });
  // Pasted on B, the branch keeps its text, its shape and its look.
  const p = mm.addTrees(o, b, [ops.branchOf(c.html)!])!;
  Object.assign(o, p);
  assert.equal(mm.toOutline(o, false, b), '\n  B1\n  Q3 plan owner: Ana\n    1. Hire'); // B is empty; the branch goes last
  const pasted = Object.values(p).find((v: any) => v?.text === 'Q3 plan\nowner: Ana') as any;
  assert.equal(pasted.color, 'red');
  assert.equal(pasted.icon, 'star');

  // Whole objects: readable text, and the objects themselves for pragmatic. The focused root copies the whole map.
  const root = Object.entries(o).find(([k, v]) => k.startsWith('n.') && (v as any).parent === null)![0].slice(2);
  assert.deepEqual(ops.fromClipHtml(ops.clipOf([o.id], [o], { id: o.id, node: root }).html), [o]);
  assert.equal(ops.branchOf(ops.clipOf([], [o], { id: o.id, node: a }).html), null); // focus without selection: nothing of it
  const all = ops.clipOf([o.id], [o], null);
  assert.ok(all.text.startsWith('Root\n  Q3 plan owner: Ana'));
  assert.deepEqual(ops.fromClipHtml(all.html), [o]);
  assert.deepEqual(ops.deserialize(all.fallback), [o]); // plain http: the objects go as text
});

test('mind map: a node left empty goes unless it has branches or an icon; an empty root takes its map', () => {
  const o = mm.mindmapFromOutline('Root\n  A\n    A1\n  B\n  C', { x: 0, y: 0 }, 1);
  const id = (text: string) => Object.entries(o).find(([k, v]) => k.startsWith('n.') && (v as any).text === text)![0].slice(2);
  const empty = (n: string, extra = {}) => Object.assign(o, { [`n.${n}`]: { ...(o as any)[`n.${n}`], text: '', ...extra } });
  assert.equal(mm.emptyNodeFate(o, id('B'), 1), 'keep'); // has text
  const b = id('B'); empty(b);
  assert.equal(mm.emptyNodeFate(o, b, 1), 'node');
  const a = id('A'); empty(a, { collapsed: true });
  assert.equal(mm.emptyNodeFate(o, a, 1), 'keep'); // a folded branch hangs from it
  const c = id('C'); empty(c, { icon: 'star' });
  assert.equal(mm.emptyNodeFate(o, c, 1), 'keep'); // an icon
  const lone = mm.mindmapFromOutline('Root', { x: 0, y: 0 }, 1), r = Object.keys(lone).find((k) => k.startsWith('n.'))!.slice(2);
  Object.assign(lone, { [`n.${r}`]: { ...(lone as any)[`n.${r}`], text: ' ' } });
  assert.equal(mm.emptyNodeFate(lone, r, 2), 'map');
  assert.equal(mm.emptyNodeFate(lone, r, 1), 'keep'); // all the board has
});

test('mind map: ⌥↑/⌥↓ move a node even when siblings share an order', () => {
  const o = mm.mindmapFromOutline('Root\n  A\n  B\n  C', { x: 0, y: 0 }, 1);
  const id = (text: string) => Object.entries(o).find(([k, v]) => k.startsWith('n.') && (v as any).text === text)![0].slice(2);
  Object.assign(o, { [`n.${id('B')}`]: { ...(o as any)[`n.${id('B')}`], order: 1 } }); // A and B both at 1
  const before = mm.toOutline(o).split('\n').slice(1).map((l) => l.trim());
  const first = before[0], second = before[1];
  Object.assign(o, mm.moveNode(o, id(first), 1));
  assert.deepEqual(mm.toOutline(o).split('\n').slice(1).map((l) => l.trim()), [second, first, 'C']);
});

test('mind map layout: children right of the parent, no overlaps, collapsed hides the subtree', () => {
  const o = mm.mindmapFromOutline('Root\n  A\n    A1\n    A2\n  B\n  C', { x: 0, y: 0 }, 1);
  const l = layoutMindmap(o, estimateMeasure)!;
  const nodes = [...l.nodes.values()];
  const root = l.nodes.get(l.rootId)!;
  assert.ok(nodes.filter((n) => n.depth === 1).every((n) => n.x > root.x + root.w));
  const col = nodes.filter((n) => n.depth === 1).sort((a, b) => a.y - b.y);
  col.slice(1).forEach((n, i) => assert.ok(n.y >= col[i].y + col[i].h, 'siblings overlap'));
  assert.equal(l.edges.length, 5);
  const a = nodes.find((n) => n.text === 'A')!;
  (o as any)[`n.${a.id}`] = { ...(o as any)[`n.${a.id}`], collapsed: true };
  const c = layoutMindmap(o, estimateMeasure)!;
  assert.equal(c.nodes.size, 4);
  assert.equal(c.nodes.get(a.id)!.hidden, 2);
  assert.equal(buildTree({ ...o, ...Object.fromEntries(Object.keys(o).filter((k) => k.startsWith('n.')).map((k) => [k, undefined])) } as any), null);
});

test('table ops: markdown round trip, add and delete rows and columns', () => {
  const data = tops.parseMarkdownTable('| Name | Age |\n|---|---|\n| Ana | 30 |\n| Bo |');
  assert.deepEqual(data, [['Name', 'Age'], ['Ana', '30'], ['Bo', '']]);
  const t = tops.newTable(data, { x: 0, y: 0 }, 1);
  assert.equal(tops.toMarkdown(t), '| Name | Age |\n| --- | --- |\n| Ana | 30 |\n| Bo |  |');
  const r = tops.addRow(t, t.rows[0]);
  assert.equal((r.patch.rows as string[])[1], r.row);
  const del = tops.deleteCol(t, t.cols[1])!;
  assert.deepEqual(del.cols, [t.cols[0]]);
  assert.ok(Object.keys(del).some((k) => k.endsWith(t.cols[1]) && del[k] === undefined));
  assert.equal(tops.deleteRow({ ...t, rows: [t.rows[0]] }, t.rows[0]), null);
  assert.throws(() => tops.parseMarkdownTable('  '), /No table rows/);
});

test('link previews never fetch private, loopback or metadata addresses', async () => {
  const { privateAddress, unfurl } = await import('./unfurl.ts');
  for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.1.9', '100.64.0.1', '0.1.2.3', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe'])
    assert.equal(privateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:808:808']) assert.equal(privateAddress(ip), false, ip);
  // A page on this machine, by IP and by a name that resolves to it: only the host name comes back, never its title.
  const { createServer } = await import('node:http');
  const inside = createServer((_q, r) => { r.setHeader('content-type', 'text/html'); r.end('<title>internal secret</title>'); }).listen(0, '127.0.0.1');
  await new Promise((r) => inside.once('listening', r));
  const port = (inside.address() as { port: number }).port;
  assert.equal((await unfurl(`http://127.0.0.1:${port}/`)).title, '127.0.0.1');
  assert.equal((await unfurl(`http://localhost:${port}/`)).title, 'localhost');
  inside.close();
  await assert.rejects(unfurl('file:///etc/passwd'), /Only http/);
});

test('board themes keep color names and derive tint and stroke from the base', async () => {
  const { paletteOf, PRESETS } = await import('../shared/themes.ts');
  const { PALETTE } = await import('../shared/model.ts');
  assert.equal(paletteOf(null).blue.base, PALETTE.blue.base);
  const p = paletteOf({ name: 'x', base: { blue: '#000000', red: 'nope' } });
  assert.deepEqual(p.blue, { base: '#000000', fill: '#CCCCCC', stroke: '#000000' });
  assert.equal(p.red.base, PALETTE.red.base, 'invalid colors are ignored');
  assert.ok(PRESETS.every((t) => Object.values(paletteOf(t)).every((s) => /^#[0-9A-F]{6}$/i.test(s.base))));
});

test('wireframe builder: frame at its layer, components stacked on the screen, fields stretched', async () => {
  const { buildWireframe } = await import('../shared/wireframe.ts');
  const { frameScreen, FRAME_Z } = await import('../shared/model.ts');
  const objs = buildWireframe({ device: 'iphone', title: 'Login', components: [
    { kind: 'input', label: 'Email' }, { kind: 'input', text: 'Password' }, { kind: 'button', text: 'Sign in' }, { kind: 'link', x: 200, y: 500 },
  ] }, 10);
  const [frame, email, pass, btn, link] = objs as any[];
  assert.equal(frame.type, 'frame');
  assert.equal(frame.z, FRAME_Z + 10);
  const s = frameScreen(frame);
  assert.ok(objs.slice(1).every((o: any) => o.type === 'wf' && o.z > 0));
  assert.equal(email.y, s.y + 16);
  assert.equal(email.w, s.w - 32, 'fields fill the screen width');
  assert.ok(email.h > pass.h, 'a label adds height');
  assert.ok(pass.y >= email.y + email.h && btn.y >= pass.y + pass.h, 'no overlap when stacked');
  assert.equal(btn.w, 120, 'buttons keep their own width');
  assert.deepEqual([link.x, link.y], [s.x + 200, s.y + 500], 'given positions are relative to the screen');
  const land = buildWireframe({ device: 'iphone', landscape: true, components: [] }, 0)[0] as any;
  assert.ok(land.w > land.h);
  assert.equal(buildWireframe({ components: [{ kind: 'button' }] }, 0).length, 1, 'no frame without a device');
});

test('frames hit only on title and chrome; containers carry their contents', async () => {
  const { hitBox, sectionContents } = await import('../web/src/engine/ops.ts');
  const { buildWireframe } = await import('../shared/wireframe.ts');
  const [frame, btn] = buildWireframe({ device: 'iphone', components: [{ kind: 'button' }] }, 1) as any[];
  const objs = [frame, btn];
  assert.equal(hitBox({ x: frame.x + frame.w / 2, y: frame.y + 400 }, objs, 1), undefined, 'empty screen area falls through');
  assert.equal(hitBox({ x: frame.x + 4, y: frame.y + 400 }, objs, 1)?.id, frame.id, 'bezel selects the frame');
  assert.equal(hitBox({ x: btn.x + 5, y: btn.y + 5 }, objs, 1)?.id, btn.id);
  const section = { id: 's', type: 'section', x: -100, y: -100, w: 2000, h: 2000, z: -1e6, title: '', color: 'light-gray', deco: 'outline' } as any;
  assert.deepEqual(sectionContents(frame, [section, ...objs]).map((o) => o.id), [btn.id]);
  assert.deepEqual(sectionContents(section, [section, ...objs]).map((o) => o.id), [frame.id, btn.id]);
});

test('task stacks: cards fill the stack in order, the stack fits them, drops pick the slot, deleting a stack takes its cards', async () => {
  const { layoutStacks, orderAt, stackCards, describeChange, STACK_HEAD, STACK_PAD, STACK_GAP } = await import('../shared/tasks.ts');
  const { DEFAULTS, TASK_H } = await import('../shared/model.ts');
  const { addObjects, deleteObjects, readObjects, updateObjects } = await import('../shared/doc.ts');
  const stack = { ...DEFAULTS.stack, id: 's', z: -1, type: 'stack', x: 100, y: 50 } as any;
  const card = (id: string, order: number, size = 'm') => ({ ...DEFAULTS.task, id, z: order, type: 'task', size, h: (TASK_H as any)[size], x: 0, y: 0, stack: 's', order }) as any;
  const doc = new Y.Doc();
  addObjects(doc, [stack, card('b', 2, 'l'), card('a', 1), { ...DEFAULTS.task, id: 'loose', z: 9, type: 'task', x: 900, y: 900 } as any]);
  updateObjects(doc, layoutStacks(readObjects(doc)));
  const objs = readObjects(doc), by = new Map(objs.map((o) => [o.id, o as any]));
  assert.deepEqual(stackCards('s', objs).map((c) => c.id), ['a', 'b']);
  assert.deepEqual([by.get('a').x, by.get('a').y, by.get('a').w], [100 + STACK_PAD, 50 + STACK_HEAD, stack.w - 2 * STACK_PAD]);
  assert.equal(by.get('b').y, 50 + STACK_HEAD + TASK_H.m + STACK_GAP);
  assert.equal(by.get('s').h, STACK_HEAD + TASK_H.m + STACK_GAP + TASK_H.l + STACK_PAD);
  assert.deepEqual([by.get('loose').x, by.get('loose').y], [900, 900], 'cards outside stacks stay put');
  assert.equal(layoutStacks(objs).length, 0, 'layout is stable');
  assert.ok(orderAt(by.get('s'), 0, objs, 'loose') < 1, 'above the first card');
  const mid = orderAt(by.get('s'), by.get('b').y + 1, objs, 'loose');
  assert.ok(mid > 1 && mid < 2, 'between the cards');
  assert.ok(orderAt(by.get('s'), 10_000, objs, 'loose') > 2, 'after the last card');
  assert.deepEqual(describeChange(by.get('a'), { tags: ['x'], stack: undefined, assignee: 'u1' } as any, () => 'Asha', () => 'Doing'),
    ['assigned Asha', 'took the card out of its stack', 'added the tag x']);
  assert.deepEqual(deleteObjects(doc, ['s']).sort(), ['a', 'b', 's']);
  assert.deepEqual(readObjects(doc).map((o) => o.id), ['loose']);
});

test('typed text is shared text: two people changing different parts both keep their edits', async () => {
  const { addObjects, updateObjects, readObjects, textOf } = await import('../shared/doc.ts');
  const a = new Y.Doc(), b = new Y.Doc();
  addObjects(a, [{ id: 's', type: 'sticky', text: 'Hello world', x: 0, y: 0, w: 1, h: 1, z: 1, color: 'yellow', fontSize: 'm' } as any]);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  updateObjects(a, [{ id: 's', text: 'Hello world from A' }]);
  updateObjects(b, [{ id: 's', text: 'B says: Hello world' }]);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  assert.equal((readObjects(a)[0] as any).text, 'B says: Hello world from A');
  assert.equal((readObjects(b)[0] as any).text, 'B says: Hello world from A');
  const old = new Y.Doc();
  const m = new Y.Map(); old.getMap('objects').set('t', m); m.set('type', 'task'); m.set('title', 'Plain'); m.set('z', 1);
  assert.equal(textOf(old, 't', 'title')!.toString(), 'Plain', 'old plain text becomes shared text on first edit');
  assert.equal(textOf(old, 't', 'color'), null, 'other fields stay plain');
});
