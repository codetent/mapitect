// The preview session against in-memory ports: no VS Code, no disk.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { CompileCache } from '../src/compile-cache.ts';
import { D2Compiler } from '../src/d2/compiler.ts';
import { applyEdits } from '../src/d2/edits.ts';
import type { TextEdit } from '../src/model.ts';
import { dirname, join } from '../src/path.ts';
import type { DiagramDocument, FileSystem, HostShell } from '../src/ports.ts';
import type { HostMessage } from '../src/protocol.ts';
import { DiagramSession } from '../src/session.ts';
import { createNodeD2 } from '../node/index.ts';

const compiler = new D2Compiler(createNodeD2);
after(() => compiler.dispose());

// Files by absolute path; folders exist implicitly.
function memoryFs(files: Record<string, string>): FileSystem {
  return {
    async readDir(dir) {
      const prefix = `${dir}/`;
      const names = new Map<string, 'file' | 'directory'>();
      for (const f of Object.keys(files)) {
        if (!f.startsWith(prefix)) continue;
        const [name, ...rest] = f.slice(prefix.length).split('/');
        names.set(name, rest.length ? 'directory' : 'file');
      }
      if (!names.size) throw new Error(`ENOENT ${dir}`);
      return [...names].map(([name, kind]) => ({ name, kind }));
    },
    async readText(file) {
      if (!(file in files)) throw new Error(`ENOENT ${file}`);
      return files[file];
    },
    async writeText(file, text) {
      files[file] = text;
    },
    async mkdir() {},
    async exists(path) {
      return path in files || Object.keys(files).some((f) => f.startsWith(`${path}/`));
    },
  };
}

class Doc implements DiagramDocument {
  version = 1;
  readonly id: string;
  readonly path: string;
  text: string;
  constructor(path: string, text: string) {
    this.id = `mem://${path}`;
    this.path = path;
    this.text = text;
  }
  getText() {
    return this.text;
  }
  async applyEdits(edits: TextEdit[]) {
    this.text = applyEdits(this.text, edits);
    this.version++;
    return true;
  }
}

function setup(text: string, files: Record<string, string> = {}) {
  const doc = new Doc('/work/shop/diagram.d2', text);
  const fs = memoryFs(files);
  const cache = new CompileCache<Doc>(compiler, fs);
  const posted: HostMessage[] = [];
  const calls: [string, ...unknown[]][] = [];
  let answer: string | undefined;
  const shell: HostShell = {
    post: (m) => posted.push(m),
    config: () => ({ defaultDepth: 2 }),
    workspaceRoots: () => ['/work'],
    assetUrl: (f) => `asset:${f}`,
    showSource: async (r) => void calls.push(['showSource', r]),
    highlightSource: (r) => void calls.push(['highlightSource', r]),
    openFile: (f, where) => void calls.push(['openFile', f, where]),
    openExternal: (url) => void calls.push(['openExternal', url]),
    editFile: async (f, s) => void calls.push(['editFile', f, s]),
    saveImage: async (format, _data, suggested) => void calls.push(['saveImage', format, suggested]),
    askText: async () => answer,
    showError: (m) => void calls.push(['showError', m]),
    watch: (dir, glob) => {
      calls.push(['watch', dir, glob]);
      return { dispose: () => void calls.push(['unwatch', dir]) };
    },
  };
  const session = new DiagramSession(doc, cache, fs, shell);
  cache.onDidUpdate(({ state }) => session.update(state));
  const updates = () => posted.filter((m) => m.type === 'update');
  const lastToast = () => posted.filter((m) => m.type === 'toast').at(-1);
  const settle = () => new Promise((r) => setTimeout(r, 50));
  return { doc, files, session, posted, calls, updates, lastToast, settle, answer: (a: string) => (answer = a) };
}

test('nothing is posted before the UI is ready; then a full update', async () => {
  const s = setup('api -> db\nicon: x\napi.icon: ./icons/api.svg\n');
  s.session.post({ type: 'toast', message: 'too early' });
  assert.equal(s.posted.length, 0);
  await s.session.receive({ type: 'ready' });
  const [update] = s.updates();
  assert.ok(update?.type === 'update');
  assert.equal(update.uri, 'mem:///work/shop/diagram.d2');
  assert.equal(update.fileName, 'diagram.d2');
  assert.deepEqual(update.config, { defaultDepth: 2 });
  assert.equal(update.model.valid, true);
  assert.equal(update.model.nodes.api.icon, 'asset:/work/shop/icons/api.svg', 'relative icons go through the host');
});

test('visual edits, undo and redo; undo stops when the text changed elsewhere', async () => {
  const s = setup('api -> db\n');
  await s.session.receive({ type: 'ready' });
  await s.session.receive({ type: 'edit', edit: { op: 'setLabel', id: 'api', label: 'Public API' } });
  assert.equal(s.doc.text, 'api -> db\napi: Public API\n');
  await s.settle();
  const renamed = s.updates().at(-1);
  assert.ok(renamed?.type === 'update' && renamed.model.nodes.api.label === 'Public API');

  await s.session.receive({ type: 'undo' });
  assert.equal(s.doc.text, 'api -> db\n');
  await s.session.receive({ type: 'redo' });
  assert.equal(s.doc.text, 'api -> db\napi: Public API\n');

  const doc: Doc = s.doc; // a change made in the editor, not in the diagram
  doc.text += 'web\n';
  await s.session.receive({ type: 'undo' });
  assert.equal(s.doc.text, 'api -> db\napi: Public API\nweb\n');
  assert.deepEqual(s.lastToast(), { type: 'toast', message: 'The file changed since that edit; use undo in the editor instead' });
  await s.session.receive({ type: 'redo' });
  assert.deepEqual(s.lastToast(), { type: 'toast', message: 'Nothing to redo' });
});

test('editing is refused while the file does not compile', async () => {
  const s = setup('api -> db\nweb: {\n');
  await s.session.receive({ type: 'ready' });
  assert.equal(s.updates()[0]?.type === 'update' && s.updates()[0].model.valid, false);
  await s.session.receive({ type: 'edit', edit: { op: 'setLabel', id: 'api', label: 'x' } });
  assert.deepEqual(s.lastToast(), { type: 'toast', message: 'Fix the errors in the D2 file before editing in the diagram' });
});

test('cursor sync posts each element once', async () => {
  const s = setup('api -> db\ndb.shape: cylinder\n');
  await s.session.receive({ type: 'ready' });
  s.session.syncCursor(1);
  s.session.syncCursor(1);
  assert.deepEqual(s.posted.filter((m) => m.type === 'cursor'), [{ type: 'cursor', id: 'db' }]);
});

test('ADRs come from the folders in vars, are watched, and new decisions are written', async () => {
  const adr = '/work/shop/adr/api/0001-use-rest.md';
  const s = setup('vars: {\n  adr-folders: [adr; ../decisions]\n}\napi -> db\n', { [adr]: '# Use REST\n\nBody\n' });
  await s.session.receive({ type: 'ready' });
  await s.settle();
  const update = s.updates().at(-1);
  assert.ok(update?.type === 'update');
  assert.deepEqual(update.adrs?.roots, ['adr', '../decisions']);
  assert.deepEqual(update.adrs?.components.api.map((a) => a.file), [adr]);
  assert.deepEqual(
    s.calls.filter((c) => c[0] === 'watch'),
    [
      ['watch', '/work/shop/adr', '**/*.md'],
      ['watch', '/work/decisions', '**/*.md'],
    ],
  );

  s.answer('Version the API');
  await s.session.receive({ type: 'newDecision', id: 'api' });
  const created = '/work/shop/adr/api/0002-version-the-api.md';
  assert.match(s.files[created], /^---\nstatus: proposed\n/);
  const edit = s.calls.find((c) => c[0] === 'editFile');
  assert.ok(edit);
  assert.equal(edit[1], created);
  assert.equal((edit[2] as { line: number }).line, s.files[created].split('\n').indexOf('## Context and Problem Statement') + 2);

  // Once the new file is scanned, the next one is numbered after it; an existing file is never overwritten.
  await s.settle();
  s.files[join(dirname(created), '0003-version-the-api.md')] = 'taken';
  await s.session.receive({ type: 'newDecision', id: 'api' });
  assert.deepEqual(s.calls.at(-1), ['showError', '0003-version-the-api.md already exists']);

  s.session.dispose();
  assert.deepEqual(
    s.calls.filter((c) => c[0] === 'unwatch').map((c) => c[1]),
    ['/work/shop/adr', '/work/decisions'],
  );
});

test('new decisions need adr-folders', async () => {
  const s = setup('api -> db\n');
  await s.session.receive({ type: 'ready' });
  await s.session.receive({ type: 'newDecision', id: 'api' });
  assert.deepEqual(s.lastToast(), { type: 'toast', message: "Add adr-folders to the file's vars to record decisions" });
});

test('links and files: external URLs, relative links, and only files the preview may open', async () => {
  const s = setup('api -> db\n');
  await s.session.receive({ type: 'ready' });
  await s.session.receive({ type: 'openLink', url: 'https://example.com/a' });
  await s.session.receive({ type: 'openLink', url: '../docs/api.md' });
  await s.session.receive({ type: 'openFile', path: '/work/other/notes.md' }); // in the workspace
  await s.session.receive({ type: 'openFile', path: '/etc/passwd' });
  await s.session.receive({ type: 'export', format: 'svg', data: '<svg/>' });
  await s.session.receive({ type: 'navigate', range: { line: 0, col: 0, endLine: 0, endCol: 3 } });
  assert.deepEqual(s.calls, [
    ['openExternal', 'https://example.com/a'],
    ['openFile', '/work/docs/api.md', 'main'],
    ['openFile', '/work/other/notes.md', 'beside'],
    ['saveImage', 'svg', '/work/shop/diagram.svg'],
    ['showSource', { line: 0, col: 0, endLine: 0, endCol: 3 }],
  ]);
});
