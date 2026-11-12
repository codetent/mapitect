// Runs against the real D2 compiler (@d2lang/d2 WASM build).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { D2Compiler } from '../src/d2/compiler.ts';
import type { Built } from '../src/d2/convert.ts';
import { applyEdits, EditError, planEdit } from '../src/d2/edits.ts';
import type { EditOp } from '../src/model.ts';

const require = createRequire(import.meta.url);
const { D2 } = require('@d2lang/d2');
const compiler = new D2Compiler(() => new D2());
after(() => compiler.dispose());

async function build(text: string): Promise<Built> {
  const r = await compiler.compile(text);
  if (!r.ok) throw new Error(`compile failed: ${JSON.stringify(r.issues)}\n---\n${text}`);
  return r.built;
}

async function edit(text: string, op: EditOp) {
  const before = await build(text);
  const out = applyEdits(text, planEdit(text, before, op));
  const built = await build(out);
  return { text: out, built, model: built.model };
}

test('model comes from the official compiler, ranges from its AST', async () => {
  const text = readFileSync(new URL('./fixtures/platform.d2', import.meta.url), 'utf8');
  const { model } = await build(text);
  assert.equal(model.direction, 'right');
  assert.equal(Object.keys(model.nodes).length, 18);
  assert.equal(model.edges.length, 16);
  const orders = model.nodes['shop.services.orders'];
  assert.equal(orders.label, 'Order Service');
  assert.equal(orders.parent, 'shop.services');
  assert.equal(orders.tooltip, 'Checkout orchestration and order lifecycle.');
  assert.equal(text.split('\n')[orders.range.line].trim(), 'orders: Order Service {');
  assert.equal(model.nodes.stripe.style.fill, '#64748b', 'class styles resolved by the compiler');
  assert.equal(model.nodes['shop.data.ordersdb'].fields?.[0].constraint, 'primary_key');
  assert.equal(model.nodes.shop.tooltip, 'Everything we build and run on Kubernetes.', 'vars substituted');
  const line = model.edges.find((e) => e.id.includes('payments -> stripe'))!.range.line;
  assert.equal(model.lineIndex[line], 'edge:(shop.services.payments -> stripe)[0]');
});

test('compile errors become located issues', async () => {
  const r = await compiler.compile('a -> b\nc: {\n  shape: circle\n');
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.issues[0].message, /maps must be terminated/);
  assert.equal(r.issues[0].range.line, 1);
});

test('what mapitect does not draw is reported as info', async () => {
  const built = await build('grid-rows: 2\na: { width: 80; height: 10 }\nlayers: {\n  x: { b }\n}\n');
  assert.deepEqual(
    built.model.issues.map((i) => [i.source, i.severity, i.message, i.range.line, i.range.col]),
    [
      ['mapitect', 'info', 'mapitect lays out diagrams itself, so grid-rows is ignored', 0, 0],
      ['mapitect', 'info', 'mapitect lays out diagrams itself, so width is ignored', 1, 5],
      ['mapitect', 'info', 'mapitect lays out diagrams itself, so height is ignored', 1, 16],
      ['mapitect', 'info', 'mapitect shows only the main board; layers are not displayed', 2, 0],
    ],
  );
});

test('a <- b is drawn as b -> a but keeps the compiler id', async () => {
  const { model } = await build('a <- b: back\n');
  assert.deepEqual([model.edges[0].source, model.edges[0].target, model.edges[0].dstArrow], ['b', 'a', true]);
  assert.equal(model.edges[0].id, '(a <- b)[0]');
});

test('setLabel handles scalar, block, bare and edge-only declarations', async () => {
  let r = await edit('a: Alpha\n', { op: 'setLabel', id: 'a', label: 'New "A"' });
  assert.equal(r.text, 'a: "New \\"A\\""\n');
  r = await edit('a: Alpha {\n  shape: circle\n}\n', { op: 'setLabel', id: 'a', label: 'Beta' });
  assert.equal(r.text, 'a: Beta {\n  shape: circle\n}\n');
  r = await edit('a: {\n  b\n}\n', { op: 'setLabel', id: 'a', label: 'Box' });
  assert.equal(r.text, 'a: Box {\n  b\n}\n');
  r = await edit('a\nb\n', { op: 'setLabel', id: 'a', label: 'X' });
  assert.equal(r.text, 'a: X\nb\n');
  r = await edit('x -> y\n', { op: 'setLabel', id: 'y', label: 'Why' });
  assert.equal(r.model.nodes.y.label, 'Why');
  r = await edit('a: A\na.label: Later\n', { op: 'setLabel', id: 'a', label: 'Z' });
  assert.equal(r.text, 'a: A\na.label: Z\n', 'the winning assignment is edited');
  r = await edit('a: Alpha {\n  shape: circle\n}\n', { op: 'setLabel', id: 'a', label: '' });
  assert.equal(r.model.nodes.a.label, 'a');
});

test('setAttr inserts into blocks, replaces, and removes', async () => {
  let r = await edit('s: {\n  a: A\n}\n', { op: 'setAttr', id: 's', attr: ['shape'], value: 'cloud' });
  assert.equal(r.text, 's: {\n  a: A\n  shape: cloud\n}\n');
  r = await edit(r.text, { op: 'setAttr', id: 's', attr: ['shape'], value: 'hexagon' });
  assert.equal(r.model.nodes.s.shape, 'hexagon');
  r = await edit(r.text, { op: 'setAttr', id: 's', attr: ['shape'], value: null });
  assert.equal(r.text, 's: {\n  a: A\n}\n');
  r = await edit('db: Database\n', { op: 'setAttr', id: 'db', attr: ['style', 'fill'], value: '#fde68a' });
  assert.equal(r.text, 'db: Database\ndb.style.fill: "#fde68a"\n');
  assert.equal(r.model.nodes.db.style.fill, '#fde68a');
  r = await edit('x: {shape: circle}\n', { op: 'setAttr', id: 'x', attr: ['tooltip'], value: 'hi there' });
  assert.equal(r.text, 'x: {shape: circle; tooltip: hi there}\n');
  r = await edit('x: {}\n', { op: 'setAttr', id: 'x', attr: ['link'], value: 'https://d2lang.com' });
  assert.equal(r.model.nodes.x.link, 'https://d2lang.com');
});

test('edge labels', async () => {
  let r = await edit('a -> b\n', { op: 'setEdgeLabel', id: '(a -> b)[0]', label: 'calls' });
  assert.equal(r.text, 'a -> b: calls\n');
  r = await edit('a -> b: x {style.stroke: red}\n', { op: 'setEdgeLabel', id: '(a -> b)[0]', label: 'y' });
  assert.equal(r.text, 'a -> b: y {style.stroke: red}\n');
  r = await edit('a -> b -> c: x\n', { op: 'setEdgeLabel', id: '(b -> c)[0]', label: 'z' });
  assert.equal(r.text, 'a -> b: x\nb -> c: z\n');
  r = await edit('a -> b: x\n', { op: 'setEdgeLabel', id: '(a -> b)[0]', label: '' });
  assert.equal(r.text, 'a -> b\n');
});

test('appearance edits: shape and any style property', async () => {
  let r = await edit('db\n', { op: 'setAttr', id: 'db', attr: ['style', 'stroke'], value: '#ef4444' });
  assert.equal(r.model.nodes.db.style.stroke, '#ef4444');
  r = await edit(r.text, { op: 'setAttr', id: 'db', attr: ['shape'], value: 'cylinder' });
  assert.equal(r.model.nodes.db.shape, 'cylinder');
});

test('setDirection rewrites or adds the root direction', async () => {
  let r = await edit('direction: right\na -> b\n', { op: 'setDirection', value: 'down' });
  assert.equal(r.text, 'direction: down\na -> b\n');
  assert.equal(r.model.direction, 'down');
  r = await edit('# Header\n\na -> b\nc: {direction: left}\n', { op: 'setDirection', value: 'right' });
  assert.equal(r.text, '# Header\n\ndirection: right\n\na -> b\nc: {direction: left}\n', 'container directions are left alone');
  assert.equal(r.model.direction, 'right');
  r = await edit('', { op: 'setDirection', value: 'up' });
  assert.equal(r.text, 'direction: up\n');
  const built = await build('a\n');
  assert.throws(() => planEdit('a\n', built, { op: 'setDirection', value: 'sideways' as never }), EditError);
});

test('status comes from the element\'s vars and applies to everything inside it', async () => {
  const { model } = await build(
    [
      'vars: {status: future}',
      'shop: {',
      '  vars: {status: deprecated; owner: team-a}',
      '  web: {vars: {status: future}}',
      '  api',
      '  api.db',
      '  cache: {vars: {status: live}}',
      '}',
      'stripe.vars: {status: Future}',
      'mail: {vars: {status: maybe}}',
      'other',
    ].join('\n'),
  );
  const status = (id: string) => [model.nodes[id].status, model.nodes[id].statusFrom];
  assert.deepEqual(status('shop'), ['deprecated', undefined]);
  assert.deepEqual(status('shop.web'), ['future', undefined], 'a child overrides');
  assert.deepEqual(status('shop.api'), ['deprecated', 'shop']);
  assert.deepEqual(status('shop.api.db'), ['deprecated', 'shop'], 'inherited from the element that sets it');
  assert.deepEqual(status('shop.cache'), ['live', undefined]);
  assert.deepEqual(status('stripe'), ['future', undefined], 'case-insensitive, also as x.vars');
  assert.deepEqual(status('other'), [undefined, undefined], 'board-level vars are not a status');
  assert.deepEqual(status('mail'), [undefined, undefined]);
  assert.equal(model.issues.length, 1);
  assert.equal(model.issues[0].severity, 'warning');
  assert.match(model.issues[0].message, /Unknown status "maybe"/);
  assert.equal(model.issues[0].range.line, 9);
});

test('removed is not a status any more', async () => {
  const { model } = await build('old: {vars: {status: removed}}\n');
  assert.equal(model.nodes.old.status, undefined);
  assert.match(model.issues[0].message, /Unknown status "removed"; use live, future, deprecated/);
  const built = await build('a\n');
  assert.throws(() => planEdit('a\n', built, { op: 'setStatus', id: 'a', value: 'removed' as never }), EditError);
});

test('setStatus writes vars: {status: …} and removes it again', async () => {
  let r = await edit('a: A {\n  shape: cloud\n}\n', { op: 'setStatus', id: 'a', value: 'future' });
  assert.equal(r.text, 'a: A {\n  shape: cloud\n  vars: {status: future}\n}\n');
  assert.equal(r.model.nodes.a.status, 'future');
  r = await edit(r.text, { op: 'setStatus', id: 'a', value: 'deprecated' });
  assert.equal(r.text, 'a: A {\n  shape: cloud\n  vars: {status: deprecated}\n}\n');
  r = await edit(r.text, { op: 'setStatus', id: 'a', value: null });
  assert.equal(r.text, 'a: A {\n  shape: cloud\n}\n', 'a vars block holding only the status goes too');
  r = await edit('a: {\n  vars: {\n    owner: x\n  }\n}\n', { op: 'setStatus', id: 'a', value: 'deprecated' });
  assert.equal(r.text, 'a: {\n  vars: {\n    owner: x\n    status: deprecated\n  }\n}\n', 'joins an existing vars block');
  r = await edit(r.text, { op: 'setStatus', id: 'a', value: null });
  assert.equal(r.text, 'a: {\n  vars: {\n    owner: x\n  }\n}\n', 'other vars stay');
  r = await edit('db: Database\n', { op: 'setStatus', id: 'db', value: 'live' });
  assert.equal(r.text, 'db: Database\ndb.vars: {status: live}\n');
  assert.equal(r.model.nodes.db.status, 'live');
  r = await edit(r.text, { op: 'setStatus', id: 'db', value: null });
  assert.equal(r.text, 'db: Database\n');
  const built = await build('a\n');
  assert.throws(() => planEdit('a\n', built, { op: 'setStatus', id: 'a', value: 'beta' as never }), EditError);
});

test('technology is freetext from the element\'s own vars and is not inherited', async () => {
  const { model } = await build(
    [
      'vars: {technology: Go}',
      'shop: {',
      '  vars: {technology: Kubernetes; status: future}',
      '  api: {vars: {technology: "Node.js 20"}}',
      '  web',
      '}',
      'db.vars: {technology: PostgreSQL 16}',
      'blank: {vars: {technology: ""}}',
    ].join('\n'),
  );
  assert.equal(model.nodes.shop.technology, 'Kubernetes');
  assert.equal(model.nodes.shop.status, 'future');
  assert.equal(model.nodes['shop.api'].technology, 'Node.js 20');
  assert.equal(model.nodes['shop.web'].technology, undefined, 'not inherited');
  assert.equal(model.nodes.db.technology, 'PostgreSQL 16');
  assert.equal(model.nodes.blank.technology, undefined);
  assert.equal(model.issues.length, 0);
});

test('setTechnology writes vars: {technology: …} next to other vars and removes it again', async () => {
  let r = await edit('a: A {\n  shape: cloud\n}\n', { op: 'setTechnology', id: 'a', value: 'Go' });
  assert.equal(r.text, 'a: A {\n  shape: cloud\n  vars: {technology: Go}\n}\n');
  assert.equal(r.model.nodes.a.technology, 'Go');
  r = await edit(r.text, { op: 'setStatus', id: 'a', value: 'future' });
  assert.equal(r.text, 'a: A {\n  shape: cloud\n  vars: {technology: Go; status: future}\n}\n', 'shares the vars block');
  r = await edit(r.text, { op: 'setTechnology', id: 'a', value: 'Spring Boot; Java 21' });
  assert.equal(r.text, 'a: A {\n  shape: cloud\n  vars: {technology: "Spring Boot; Java 21"; status: future}\n}\n', 'quoted when needed');
  assert.equal(r.model.nodes.a.technology, 'Spring Boot; Java 21');
  r = await edit(r.text, { op: 'setTechnology', id: 'a', value: '  ' });
  assert.equal(r.text, 'a: A {\n  shape: cloud\n  vars: {status: future}\n}\n', 'blank removes it, the status stays');
  r = await edit('db: Database\n', { op: 'setTechnology', id: 'db', value: 'PostgreSQL 16' });
  assert.equal(r.text, 'db: Database\ndb.vars: {technology: PostgreSQL 16}\n');
  r = await edit(r.text, { op: 'setTechnology', id: 'db', value: null });
  assert.equal(r.text, 'db: Database\n');
});

test('structural edits are refused: the D2 source owns elements and connections', async () => {
  const text = 'a -> b\nt: {shape: sql_table; id: int}\n';
  const built = await build(text);
  const refused = (op: unknown, msg?: string) => assert.throws(() => planEdit(text, built, op as EditOp), EditError, msg);
  refused({ op: 'addNode', parent: null, label: 'x' });
  refused({ op: 'deleteNode', id: 'a' });
  refused({ op: 'connect', source: 'a', target: 'b' });
  refused({ op: 'deleteEdge', id: '(a -> b)[0]' });
  refused({ op: 'setEdgeArrow', id: '(a -> b)[0]', arrow: '<->' });
  refused({ op: 'setAttr', id: 'a', attr: ['near'], value: 'top-center' });
  refused({ op: 'setAttr', id: 'a', attr: ['class'], value: 'x' });
  for (const shape of ['sql_table', 'class', 'page', 'diamond', 'oval', 'step', 'text', 'package']) {
    refused({ op: 'setAttr', id: 'a', attr: ['shape'], value: shape }, `${shape} is not an editable type`);
  }
  refused({ op: 'setAttr', id: 't', attr: ['shape'], value: 'rectangle' }, 'a table with columns keeps its shape');
});
