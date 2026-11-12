import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { indexAdrs, parseMadr, planNewAdr, scanAdrs, type AdrScan } from '../src/adr.ts';
import { D2Compiler } from '../src/d2/compiler.ts';
import { nodeFileSystem } from '../node/index.ts';
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
  assert.deepEqual(adr.components, []);
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

// Writes the files below a temporary folder and scans its `adr` and `more` roots.
async function scanned(files: Record<string, string>, roots = ['adr', 'more']): Promise<{ dir: string; scan: AdrScan }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mapitect-adr-'));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), text);
  }
  return { dir, scan: await scanAdrs(nodeFileSystem, dir.split(path.sep).join('/'), roots) };
}

test('components link a decision to one or several elements; none makes it system-wide', async () => {
  const m = model({
    k2: 'K2 Platform',
    'k2.bff': 'BFF gateway',
    'k2.services': 'Domain services',
    'k2.services.content': 'Content',
    'k2.data.ui': 'ui db',
    'k2.frontends.ui': 'Web & app UI',
  });
  const { dir, scan } = await scanned({
    'adr/0001-a.md': '---\nstatus: accepted\ncomponents: [bff, K2.Services.Content]\n---\n# A\n',
    'adr/0002-b.md': '---\nstatus: accepted\ncomponents:\n  - k2.bff\n---\n# B\n',
    'adr/0003-c.md': '# C\n\n* Status: proposed\n* Components: k2.frontends.ui\n',
    'adr/0004-d.md': '---\nstatus: accepted\n---\n# Everything runs on AWS\n',
    'adr/0005-e.md': '---\nstatus: accepted\ncomponents: [ui, nope]\n---\n# E\n',
  });
  try {
    const { index, problems } = indexAdrs(scan, m, ['adr']);
    assert.deepEqual(index.components['k2.bff'].map((a) => a.name), ['0001-a.md', '0002-b.md'], 'sorted by number');
    assert.deepEqual(index.components['k2.services.content'].map((a) => a.name), ['0001-a.md'], 'one decision, two elements');
    assert.deepEqual(index.components['k2.frontends.ui'].map((a) => a.name), ['0003-c.md'], 'MADR 2 bullets');
    assert.deepEqual(index.system.map((a) => a.name), ['0004-d.md']);
    assert.equal(index.components['k2.data.ui'], undefined, 'an ambiguous key links nothing');
    assert.deepEqual(
      problems.map((p) => [path.basename(p.file), p.severity, p.message, p.range.line]),
      [
        ['0005-e.md', 'warning', '"ui" matches several elements (k2.data.ui, k2.frontends.ui); use the full id', 2],
        ['0005-e.md', 'warning', 'No element "nope" in the diagram', 2],
      ],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('checks status, dates, numbers, links and missing roots', async () => {
  const m = model({ gateway: 'API Gateway' });
  const { dir, scan } = await scanned({
    'adr/0001-a.md': '---\nstatus: draft\ndate: 3 May 2025\ncomponents: [gateway]\n---\n# A\n\nSee [B](0002-b.md), [gone](0009-gone.md) and [web](https://x.dev).\n',
    'adr/0002-b.md': '# B\n',
    'adr/0002-c.md': '---\nstatus: accepted\ncomponents: []\n---\n# C\n',
    'adr/gateway/0001-old-layout.md': '---\nstatus: accepted\n---\n# Old layout\n',
  });
  try {
    assert.deepEqual(scan.missingRoots, ['more']);
    const { index, problems } = indexAdrs(scan, m, ['adr', 'more']);
    assert.deepEqual(index.system.map((a) => a.name), ['0001-old-layout.md', '0002-b.md', '0002-c.md']);
    assert.deepEqual(
      problems.map((p) => [path.relative(path.join(dir, 'adr'), p.file).split(path.sep).join('/'), p.severity, p.message, p.range.line]),
      [
        ['0001-a.md', 'warning', 'Unknown status "draft"; use proposed, accepted, rejected, deprecated, superseded', 1],
        ['0001-a.md', 'info', 'Write the date as YYYY-MM-DD', 2],
        ['0001-a.md', 'warning', '0009-gone.md does not exist', 7],
        ['gateway/0001-old-layout.md', 'info', 'Not linked to any element, so it is system-wide. Add "components: [gateway]" to link it to API Gateway', 3],
        ['0002-b.md', 'info', 'No status; add one of proposed, accepted, rejected, deprecated, superseded', 0],
        ['0002-b.md', 'warning', 'ADR-0002 is also the number of 0002-c.md', 0],
        ['0002-c.md', 'warning', 'ADR-0002 is also the number of 0002-b.md', 4],
      ],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('scans several roots, skipping READMEs, templates and hidden files', async () => {
  const { dir, scan } = await scanned(
    {
      'adr/README.md': '# About\n',
      'adr/bff/0001-a.md': '---\nstatus: accepted\n---\n# A\n',
      'adr/bff/template.md': '# Template\n',
      'adr/bff/.draft.md': '# Hidden\n',
      'more/k2/services/content/0001-b.md': '# B\n',
    },
    ['adr', 'more', 'missing'],
  );
  try {
    assert.deepEqual(scan.files.map((f) => f.adr.title).sort(), ['A', 'B']);
    assert.deepEqual(scan.missingRoots, ['missing']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('plans a new decision in the first root, linked to its element', () => {
  const m = model({ shop: 'Shop', 'shop.api': 'API', 'shop.db': 'DB', 'ops.db': 'Ops DB', 'my svc': 'Mine' });
  const all = [parseMadr('# x\n', '/p/adr/0007-x.md'), parseMadr('# y\n', '/p/adr/sub/0012-y.md')];
  const plan = (id: string | null, title = 'Use Postgres for orders') =>
    planNewAdr({ baseDir: '/p', roots: ['adr', 'shared'], model: m, id, existing: [], all, title, date: '2026-10-31' });

  const api = plan('shop.api');
  assert.equal(api.file, path.join('/p/adr', '0008-use-postgres-for-orders.md'), 'numbered after the highest in that folder');
  const adr = parseMadr(api.text, api.file);
  assert.equal(adr.title, 'Use Postgres for orders');
  assert.equal(adr.status, 'proposed');
  assert.equal(adr.date, '2026-10-31');
  assert.equal(adr.number, '0008');
  assert.deepEqual(adr.components, ['shop.api']);
  assert.match(api.text.split('\n')[api.cursor], /^\{Describe/);

  assert.equal(path.basename(plan('shop.db', 'Café über alles!').file), '0008-cafe-uber-alles.md');
  assert.deepEqual(parseMadr(plan('my svc').text, 'x.md').components, ['my svc']);
  const system = plan(null, 'Run on AWS');
  assert.deepEqual(parseMadr(system.text, system.file).components, [], 'system-wide');
  assert.doesNotMatch(system.text, /components/);
});

test('a new decision goes next to the element’s existing ones, preferring the first root', () => {
  const m = model({ gateway: 'Gateway' });
  const existing = [parseMadr('# a\n', '/p/shared/gateway/0007-a.md'), parseMadr('# b\n', '/p/adr/gw/0002-b.md')];
  const all = [...existing, parseMadr('# c\n', '/p/adr/gw/0004-c.md')];
  const plan = planNewAdr({ baseDir: '/p', roots: ['adr', 'shared'], model: m, id: 'gateway', existing, all, title: 'C', date: '2026-10-31' });
  assert.equal(plan.file, path.join('/p/adr', 'gw', '0005-c.md'), 'first root wins, highest number in the folder + 1');
  const only = planNewAdr({ baseDir: '/p', roots: ['adr', 'shared'], model: m, id: 'gateway', existing: existing.slice(0, 1), all, title: 'C', date: '2026-10-31' });
  assert.equal(only.file, path.join('/p/shared', 'gateway', '0008-c.md'));
  assert.throws(() => planNewAdr({ baseDir: '/p', roots: [], model: m, id: 'gateway', existing: [], all, title: 'C', date: '2026-10-31' }), /adr-folders/);
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
  const r = await compiler.compile('vars: {\n  adr-folders: [adr; docs/decisions]\n}\na\n');
  assert.ok(r.ok);
  assert.deepEqual(r.built.adrFolderRanges['docs/decisions'], { line: 1, col: 21, endLine: 1, endCol: 35 });
});
