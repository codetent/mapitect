// Smoke test for the extension host bundle against a minimal stub of the vscode API.
// Uses the real D2 compiler copied to dist/d2; requires `npm run build` (run by `pretest`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
const Module = require('node:module') as { _load: (req: string, ...rest: unknown[]) => unknown };
const root = path.resolve(import.meta.dirname, '..');

type Fn = (...args: any[]) => any;

function makeUri(fsPath: string) {
  return { fsPath, scheme: 'file', toString: () => `file://${fsPath}` };
}

function harness(initialText: string) {
  const commands: Record<string, Fn> = {};
  const listeners: Record<string, Fn> = {};
  const posted: any[] = [];
  const diagnostics = new Map<string, any[]>();
  let onMessage: Fn = () => {};
  let text = initialText;
  let version = 1;

  const decorations: any[][] = [];
  const watched: string[] = []; // live file watchers, by base folder
  const editor = {
    get document() {
      return doc;
    },
    setDecorations: (_type: unknown, ranges: any[]) => decorations.push(ranges),
    revealRange() {},
  };
  const doc = {
    uri: makeUri('/tmp/archer/diagram.d2'),
    fileName: '/tmp/archer/diagram.d2',
    languageId: 'd2',
    get version() {
      return version;
    },
    getText: () => text,
    positionAt: (offset: number) => ({ offset }),
  };
  const setText = (next: string) => {
    text = next;
    version++;
    listeners.change?.({ document: doc });
  };
  const panel = {
    active: true,
    iconPath: undefined,
    webview: {
      html: '',
      options: {},
      cspSource: 'vscode-webview://test',
      asWebviewUri: (u: any) => ({ ...u, toString: () => `webview:${u.fsPath}` }),
      onDidReceiveMessage: (fn: Fn) => (onMessage = fn),
      postMessage: async (m: unknown) => posted.push(m),
    },
    onDidDispose: () => ({ dispose() {} }),
    reveal() {},
  };
  const on = (name: string) => (fn: Fn) => {
    listeners[name] = fn;
    return { dispose() {} };
  };

  class Range {
    args: any[];
    constructor(...args: any[]) {
      this.args = args;
    }
  }
  class WorkspaceEdit {
    edits: { range: Range; text: string }[] = [];
    replace(_uri: unknown, range: Range, newText: string) {
      this.edits.push({ range, text: newText });
    }
  }
  class EventEmitter {
    listeners: Fn[] = [];
    event = (fn: Fn) => {
      this.listeners.push(fn);
      return { dispose() {} };
    };
    fire(v: unknown) {
      for (const l of this.listeners) l(v);
    }
    dispose() {}
  }

  const vscode = {
    languages: {
      createDiagnosticCollection: () => ({
        set: (uri: any, d: any[]) => diagnostics.set(uri.toString(), d),
        delete: (uri: any) => diagnostics.delete(uri.toString()),
        dispose() {},
      }),
    },
    commands: {
      registerCommand: (id: string, fn: Fn) => {
        commands[id] = fn;
        return { dispose() {} };
      },
    },
    workspace: {
      textDocuments: [] as unknown[],
      workspaceFolders: [],
      openTextDocument: async () => doc,
      getConfiguration: () => ({ get: (_k: string, d: unknown) => d }),
      onDidOpenTextDocument: on('open'),
      onDidCloseTextDocument: on('close'),
      onDidChangeTextDocument: on('change'),
      onDidChangeConfiguration: on('config'),
      createFileSystemWatcher: (pattern: { base: { fsPath: string } }) => {
        watched.push(pattern.base.fsPath);
        const dispose = () => watched.splice(watched.indexOf(pattern.base.fsPath), 1);
        return { onDidCreate() {}, onDidChange() {}, onDidDelete() {}, dispose };
      },
      applyEdit: async (edit: WorkspaceEdit) => {
        let next = text;
        const sorted = [...edit.edits].sort((a, b) => b.range.args[0].offset - a.range.args[0].offset);
        for (const e of sorted) next = next.slice(0, e.range.args[0].offset) + e.text + next.slice(e.range.args[1].offset);
        setText(next);
        return true;
      },
    },
    window: {
      activeTextEditor: { document: doc },
      visibleTextEditors: [editor] as unknown[],
      createWebviewPanel: () => panel,
      onDidChangeTextEditorSelection: on('selection'),
      onDidChangeVisibleTextEditors: on('visible'),
      createTextEditorDecorationType: () => ({ dispose() {} }),
      registerWebviewPanelSerializer: () => ({ dispose() {} }),
      showWarningMessage() {},
    },
    Uri: {
      file: makeUri,
      parse: (s: string) => makeUri(s.replace('file://', '')),
      joinPath: (u: any, ...p: string[]) => makeUri(path.join(u.fsPath, ...p)),
    },
    ViewColumn: { Active: -1, Beside: -2, One: 1 },
    ThemeColor: class {
      id: string;
      constructor(id: string) {
        this.id = id;
      }
    },
    OverviewRulerLane: { Full: 7 },
    TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
    FileType: { File: 1, Directory: 2 },
    Diagnostic: class {
      source?: string;
      range: unknown;
      message: string;
      severity: number;
      constructor(range: unknown, message: string, severity: number) {
        this.range = range;
        this.message = message;
        this.severity = severity;
      }
    },
    Range,
    RelativePattern: class {
      base: unknown;
      pattern: string;
      constructor(base: unknown, pattern: string) {
        this.base = base;
        this.pattern = pattern;
      }
    },
    WorkspaceEdit,
    EventEmitter,
  };

  return {
    vscode,
    commands,
    listeners,
    posted,
    diagnostics,
    panel,
    doc,
    text: () => text,
    decorations,
    watched,
    editor,
    send: (m: unknown) => onMessage(m),
    setText,
  };
}

async function until<T>(fn: () => T | undefined, what: string, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('extension compiles with the official D2 build, applies text edits and syncs the cursor', async () => {
  const h = harness('api -> db: queries\ndb.shape: cylinder\n');
  const original = Module._load;
  Module._load = function (req: string, ...rest: unknown[]) {
    return req === 'vscode' ? h.vscode : original.call(this, req, ...rest);
  };
  let ext: { activate: Fn; deactivate: Fn } | undefined;
  try {
    delete require.cache[require.resolve(path.join(root, 'dist/extension.js'))];
    ext = require(path.join(root, 'dist/extension.js'));
    ext!.activate({ subscriptions: [], extensionUri: makeUri(root) });

    await h.commands['archer.openPreviewToSide']();
    assert.match(h.panel.webview.html, /Content-Security-Policy/);
    await h.send({ type: 'ready' });
    const first = await until(() => h.posted.find((m) => m.type === 'update'), 'first update');
    assert.deepEqual(Object.keys(first.model.nodes).sort(), ['api', 'db']);
    assert.equal(first.model.nodes.db.shape, 'cylinder');
    assert.equal(first.model.edges[0].id, '(api -> db)[0]');
    assert.deepEqual(first.adrs, { components: {}, unmatched: [], roots: [] }, 'no adr-folders variable');
    assert.deepEqual(h.watched, []);

    // Reload compiles again even though the text is unchanged.
    const updates = h.posted.filter((m) => m.type === 'update').length;
    await h.send({ type: 'reload' });
    assert.ok(h.posted.filter((m) => m.type === 'update').length > updates, 'reload posts a fresh model');
    assert.deepEqual(h.posted.at(-1), { type: 'toast', message: 'Reloaded' });

    h.listeners.selection({ textEditor: { document: h.doc }, selections: [{ active: { line: 1 } }] });
    assert.deepEqual(h.posted.at(-1), { type: 'cursor', id: 'db' });

    // Selecting an element in the diagram highlights its source lines.
    await h.send({ type: 'highlight', range: first.model.nodes.db.range });
    assert.deepEqual(h.decorations.at(-1)?.[0]?.args, [1, 0, 1, 18]);
    await h.send({ type: 'highlight', range: null });
    assert.deepEqual(h.decorations.at(-1), []);

    // …but never opens the file when no editor shows it.
    let opened = false;
    (h.vscode.window as any).showTextDocument = async () => {
      opened = true;
    };
    h.vscode.window.visibleTextEditors = [];
    const before = h.decorations.length;
    await h.send({ type: 'highlight', range: first.model.nodes.api.range });
    assert.equal(opened, false);
    assert.equal(h.decorations.length, before);
    h.vscode.window.visibleTextEditors = [h.editor];

    // A visual edit becomes a document edit and a fresh model.
    await h.send({ type: 'edit', edit: { op: 'setLabel', id: 'api', label: 'Public API' } });
    assert.equal(h.text(), 'api -> db: queries\ndb.shape: cylinder\napi: Public API\n');
    await until(() => h.posted.find((m) => m.type === 'update' && m.model.nodes.api?.label === 'Public API'), 'renamed update');

    await h.send({ type: 'undo' });
    assert.equal(h.text(), 'api -> db: queries\ndb.shape: cylinder\n');

    // Structure is edited in the source only.
    await h.send({ type: 'edit', edit: { op: 'addNode', parent: null, label: 'Web App' } });
    assert.match(h.posted.at(-1).message, /in the D2 file/);
    assert.equal(h.text(), 'api -> db: queries\ndb.shape: cylinder\n');

    // ADR folders come from `vars.adr-folders`, relative to the file; each one is watched.
    h.setText('vars: {\n  adr-folders: [adr; ../shared/decisions]\n}\napi -> db\n');
    const withAdrs = await until(() => h.posted.find((m) => m.type === 'update' && m.adrs?.roots.length), 'ADR roots');
    assert.deepEqual(withAdrs.adrs.roots, ['adr', '../shared/decisions']);
    assert.deepEqual(h.watched, ['/tmp/archer/adr', '/tmp/shared/decisions']);
    h.setText('vars: {\n  adr-folders: docs/adr\n}\napi -> db\n');
    await until(() => h.posted.find((m) => m.type === 'update' && m.adrs?.roots[0] === 'docs/adr'), 'changed ADR roots');
    assert.deepEqual(h.watched, ['/tmp/archer/docs/adr'], 'old watchers are dropped');

    // Compile errors become diagnostics; the preview keeps the last good model.
    h.setText('api -> db\nweb: {\n');
    const broken = await until(
      () => h.posted.find((m) => m.type === 'update' && m.model.valid === false),
      'invalid update',
    );
    assert.ok(broken.model.nodes.api, 'last good model kept');
    const diags = h.diagnostics.get(h.doc.uri.toString())!;
    assert.match(diags[0].message, /maps must be terminated/);

    await h.send({ type: 'edit', edit: { op: 'setLabel', id: 'api', label: 'x' } });
    assert.equal(h.posted.at(-1).type, 'toast', 'edits are refused while the file does not compile');
  } finally {
    Module._load = original;
    await ext?.deactivate();
  }
});
