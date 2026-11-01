import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { assignAdrs, parseMadr, planNewAdr, scanAdrFolders } from '../src/adr.ts';
import { D2Compiler } from '../src/d2/compiler.ts';
import type { DiagramModel, DiagramNode } from '../src/model.ts';

function model(ids: Record<string, string>): DiagramModel {
  const nodes: Record<string, DiagramNode> = {};
  for (const [id, label] of Object.entries(ids)) {
    const segs = id.split('.');
    nodes[id] = {
      id,
      key: segs[segs.length - 1],
      parent: segs.length > 1 ? segs.slice(0, -1).join('.') : null,
      children: [],
      label,
      shape: 'rectangle',
      style: {},
      classes: [],
      range: { line: 0, col: 0, endLine: 0, endCol: 0 },
    };
  }
  return { direction: 'down', nodes, roots: [], edges: [], issues: [], lineIndex: {} };
}

test('parses MADR 4 front matter', () => {
  const adr = parseMadr(
    [
      '---',
      'status: "superseded by ADR-0004"',
      'date: 2026-10-01',
      'decision-makers: [Ana, Ben]',
      'consulted:',
      '  - Platform team',
      '  - Security',
      '---',
      '',
      '# Use River for jobs',
      '',
      '## Context and Problem Statement',
      'Text.',
    ].join('\n'),
    '/x/adr/indexer/0002-use-river.md',
  );
  assert.equal(adr.number, '0002');
  assert.equal(adr.title, 'Use River for jobs');
  assert.equal(adr.status, 'superseded');
  assert.equal(adr.statusText, 'superseded by ADR-0004');
  assert.equal(adr.date, '2026-10-01');
  assert.equal(adr.decisionMakers, 'Ana, Ben');
  assert.equal(adr.consulted, 'Platform team, Security');
  assert.ok(adr.body.startsWith('## Context and Problem Statement'));
});

test('parses MADR 2 bullet metadata and files without any', () => {
  const v2 = parseMadr('# Pick Postgres\n\n* Status: accepted\n* Deciders: Ana\n* Date: 2024-01-02\n\n## Context\nWhy.\n', '/a/0001-pick.md');
  assert.equal(v2.status, 'accepted');
  assert.equal(v2.statusText, undefined);
  assert.equal(v2.decisionMakers, 'Ana');
  assert.equal(v2.date, '2024-01-02');
  assert.equal(v2.body, '## Context\nWhy.');
  const bare = parseMadr('Just text.\n', '/a/0003-keep-it-simple.md');
  assert.equal(bare.title, 'keep it simple');
  assert.equal(bare.status, 'unknown');
});

test('folders match by key, full id, nested path or label', () => {
  const m = model({
    k2: 'K2 Platform',
    'k2.bff': 'BFF gateway',
    'k2.services': 'Domain services',
    'k2.services.content': 'Content',
    'k2.data.ui': 'ui db',
    'k2.frontends.ui': 'Web & app UI',
  });
  const adr = (name: string) => parseMadr('# T\n', `/r/${name}`);
  const index = assignAdrs(
    [
      { dir: 'bff', adrs: [adr('0002-b.md'), adr('0001-a.md')] },
      { dir: 'k2.services.content', adrs: [adr('0001-c.md')] },
      { dir: 'k2/frontends/ui', adrs: [adr('0001-u.md')] },
      { dir: 'domain-services', adrs: [adr('0001-d.md')] },
      { dir: 'ui', adrs: [adr('0001-x.md')] }, // two elements have the key "ui"
      { dir: 'nope', adrs: [adr('0001-n.md')] },
    ],
    m,
    ['adr'],
  );
  assert.deepEqual(index.components['k2.bff'].map((a) => a.name), ['0001-a.md', '0002-b.md'], 'sorted by number');
  assert.equal(index.components['k2.services.content'].length, 1);
  assert.equal(index.components['k2.frontends.ui'].length, 1);
  assert.equal(index.components['k2.services'].length, 1);
  assert.deepEqual(index.unmatched, ['ui', 'nope']);
});

test('scans several roots, skipping READMEs, templates and hidden files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mapitect-adr-'));
  try {
    await mkdir(path.join(dir, 'adr', 'bff'), { recursive: true });
    await mkdir(path.join(dir, 'more', 'k2', 'services', 'content'), { recursive: true });
    await writeFile(path.join(dir, 'adr', 'README.md'), '# About\n');
    await writeFile(path.join(dir, 'adr', 'bff', '0001-a.md'), '---\nstatus: accepted\n---\n# A\n');
    await writeFile(path.join(dir, 'adr', 'bff', 'template.md'), '# Template\n');
    await writeFile(path.join(dir, 'adr', 'bff', '.draft.md'), '# Hidden\n');
    await writeFile(path.join(dir, 'more', 'k2', 'services', 'content', '0001-b.md'), '# B\n');
    const folders = await scanAdrFolders(dir, ['adr', 'more', 'missing']);
    assert.deepEqual(
      folders.map((f) => [f.dir, f.adrs.map((a) => a.title)]).sort(),
      [
        ['bff', ['A']],
        ['k2/services/content', ['B']],
      ],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('plans a new decision in a folder that matches the element', () => {
  const m = model({ shop: 'Shop', 'shop.api': 'API', 'shop.db': 'DB', 'ops.db': 'Ops DB' });
  const plan = (id: string, title = 'Use Postgres for orders') =>
    planNewAdr({ baseDir: '/p', roots: ['adr', 'shared'], model: m, id, existing: [], title, date: '2026-10-31' });
  const matched = (file: string) => {
    const dir = path.relative('/p/adr', path.dirname(file)).split(path.sep).join('/');
    return Object.keys(assignAdrs([{ dir, adrs: [parseMadr('# x\n', file)] }], m, ['adr']).components);
  };

  const api = plan('shop.api');
  assert.equal(api.file, path.join('/p/adr', 'api', '0001-use-postgres-for-orders.md'), 'unique key');
  assert.deepEqual(matched(api.file), ['shop.api']);

  const db = plan('shop.db', 'Café über alles!');
  assert.equal(db.file, path.join('/p/adr', 'shop.db', '0001-cafe-uber-alles.md'), 'full id when the key is shared');
  assert.deepEqual(matched(db.file), ['shop.db']);

  const adr = parseMadr(api.text, api.file);
  assert.equal(adr.title, 'Use Postgres for orders');
  assert.equal(adr.status, 'proposed');
  assert.equal(adr.date, '2026-10-31');
  assert.equal(adr.number, '0001');
  assert.match(api.text.split('\n')[api.cursor], /^\{Describe/);
});

test('a new decision goes next to existing ones, numbered after all of them', () => {
  const m = model({ gateway: 'Gateway' });
  const existing = [parseMadr('# a\n', '/p/shared/gateway/0007-a.md'), parseMadr('# b\n', '/p/adr/gw/0002-b.md')];
  const plan = planNewAdr({ baseDir: '/p', roots: ['adr', 'shared'], model: m, id: 'gateway', existing, title: 'C', date: '2026-10-31' });
  assert.equal(plan.file, path.join('/p/adr', 'gw', '0008-c.md'), 'first root wins, highest number + 1');
  const only = planNewAdr({ baseDir: '/p', roots: ['adr', 'shared'], model: m, id: 'gateway', existing: existing.slice(0, 1), title: 'C', date: '2026-10-31' });
  assert.equal(only.file, path.join('/p/shared', 'gateway', '0008-c.md'));
  assert.throws(() => planNewAdr({ baseDir: '/p', roots: [], model: m, id: 'gateway', existing: [], title: 'C', date: '2026-10-31' }), /adr-folders/);
});

const { D2 } = createRequire(import.meta.url)('@d2lang/d2');
const compiler = new D2Compiler(() => new D2());
after(() => compiler.dispose());

test('ADR folders come from the adr-folders variable', async () => {
  const folders = async (text: string) => {
    const r = await compiler.compile(text);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    return r.built.adrFolders;
  };
  assert.deepEqual(await folders('a\n'), []);
  assert.deepEqual(await folders('vars: {\n  stack: k8s\n  adr-folders: [adr; ../shared/adr; adr]\n}\na\n'), ['adr', '../shared/adr']);
  assert.deepEqual(await folders('vars: {\n  adr-folders: "docs/decisions"\n}\na\n'), ['docs/decisions']);
  assert.deepEqual(await folders('vars: {\n  adr-folders: [a]\n}\nvars: {\n  adr-folders: [b; c]\n}\nx\n'), ['b', 'c'], 'last one wins');
  assert.deepEqual(await folders('x: {\n  vars: {\n    adr-folders: [nested]\n  }\n}\n'), [], 'only the top level counts');
});
