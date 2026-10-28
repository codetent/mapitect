import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseD2 } from '../src/parser/d2.ts';

test('nodes, containers and edge chains', () => {
  const m = parseD2(`
a: Alpha
b.c: Charlie {
  shape: cylinder
}
a -> b.c -> d: flows
x <- y
p <-> q; r -- s
`);
  assert.deepEqual(m.roots, ['a', 'b', 'd', 'x', 'y', 'p', 'q', 'r', 's']);
  assert.equal(m.nodes.a.label, 'Alpha');
  assert.equal(m.nodes['b.c'].shape, 'cylinder');
  assert.equal(m.nodes['b.c'].parent, 'b');
  assert.deepEqual(m.edges.map((e) => [e.source, e.target, e.label ?? '']), [
    ['a', 'b.c', 'flows'],
    ['b.c', 'd', 'flows'],
    ['y', 'x', ''],
    ['p', 'q', ''],
    ['r', 's', ''],
  ]);
  assert.equal(m.edges[3].srcArrow, true);
  assert.equal(m.edges[4].dstArrow, false);
  assert.equal(m.issues.length, 0);
});

test('scoped edges, parent references and styles', () => {
  const m = parseD2(`
cloud: {
  api -> db: query {
    style.stroke: red
    target-arrowhead.shape: diamond
  }
  api.style: { fill: "#fff"; bold: true }
  _.user -> api
}
`);
  assert.equal(m.edges[0].source, 'cloud.api');
  assert.equal(m.edges[0].style.stroke, 'red');
  assert.equal(m.edges[0].dstArrowhead, 'diamond');
  assert.equal(m.nodes['cloud.api'].style.fill, '#fff');
  assert.equal(m.nodes['cloud.api'].style.bold, 'true');
  assert.equal(m.edges[1].source, 'user');
  assert.ok(m.nodes.user && m.nodes.user.parent === null);
});

test('keys with spaces, dashes, quotes and comments', () => {
  const m = parseD2(`
my server -> api-gateway # trailing comment
"a.b" -> c
"""
block comment -> ignored
"""
`);
  assert.ok(m.nodes['my server']);
  assert.ok(m.nodes['api-gateway']);
  assert.ok(m.nodes['"a.b"']);
  assert.equal(m.edges.length, 2);
});

test('classes, vars and block strings', () => {
  const m = parseD2(`
vars: { env: prod }
classes: { db: { shape: cylinder; style.fill: blue } }
store: Store (\${env}) { class: db; style.fill: green }
doc: |md
  # Title
  some text
|
`);
  assert.equal(m.nodes.store.label, 'Store (prod)');
  assert.equal(m.nodes.store.shape, 'cylinder');
  assert.equal(m.nodes.store.style.fill, 'green', 'explicit style wins over class');
  assert.equal(m.nodes.doc.labelFormat, 'md');
  assert.equal(m.nodes.doc.label, '# Title\nsome text');
});

test('sql_table rows become fields and edges attach to the table', () => {
  const m = parseD2(`
users: { shape: sql_table; id: int {constraint: primary_key}; name: varchar }
orders: { shape: sql_table; user_id: int }
orders.user_id -> users.id
`);
  assert.deepEqual(m.nodes.users.fields, [
    { name: 'id', type: 'int', constraint: 'primary_key' },
    { name: 'name', type: 'varchar', constraint: undefined },
  ]);
  assert.equal(m.nodes['users.id'], undefined);
  assert.equal(m.edges[0].source, 'orders');
  assert.equal(m.edges[0].target, 'users');
});

test('direction, null deletion and diagnostics', () => {
  const m = parseD2(`
direction: right
a -> b
b: null
c: { shape: blob
`);
  assert.equal(m.direction, 'right');
  assert.equal(m.nodes.b, undefined);
  assert.equal(m.edges.length, 0);
  const msgs = m.issues.map((i) => `${i.severity}:${i.range.line}:${i.message}`);
  assert.ok(msgs.some((s) => s.startsWith('warning:4:Unknown shape')), msgs.join('\n'));
  assert.ok(msgs.some((s) => s.startsWith('error:4:Missing closing')), msgs.join('\n'));
});

test('line index maps source lines to elements', () => {
  const m = parseD2('a\nb: {\n  c -> d\n}\n');
  assert.equal(m.lineIndex[0], 'a');
  assert.equal(m.lineIndex[1], 'b');
  assert.equal(m.lineIndex[2], 'edge:b.c->b.d[0]');
});

test('example file parses cleanly', () => {
  const m = parseD2(readFileSync(new URL('../examples/platform.d2', import.meta.url), 'utf8'));
  assert.deepEqual(m.issues, []);
  assert.equal(m.nodes['shop.data.ordersdb'].fields?.length, 4);
  assert.ok(m.edges.length >= 15);
});
