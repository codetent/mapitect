// Smoke test for the extension host bundle against a minimal stub of the vscode API.
// Requires `npm run build` first (the `pretest` script does that).
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

  const doc = {
    uri: makeUri('/tmp/archer/diagram.d2'),
    fileName: '/tmp/archer/diagram.d2',
    languageId: 'd2',
    getText: () => text,
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
      textDocuments: [doc],
      workspaceFolders: [],
      openTextDocument: async () => doc,
      getConfiguration: () => ({ get: (_k: string, d: unknown) => d }),
      onDidOpenTextDocument: on('open'),
      onDidCloseTextDocument: on('close'),
      onDidChangeTextDocument: on('change'),
      onDidChangeConfiguration: on('config'),
    },
    window: {
      activeTextEditor: { document: doc },
      visibleTextEditors: [],
      createWebviewPanel: () => panel,
      onDidChangeTextEditorSelection: on('selection'),
      registerWebviewPanelSerializer: () => ({ dispose() {} }),
      showWarningMessage() {},
    },
    Uri: {
      file: makeUri,
      parse: (s: string) => makeUri(s.replace('file://', '')),
      joinPath: (u: any, ...p: string[]) => makeUri(path.join(u.fsPath, ...p)),
    },
    ViewColumn: { Active: -1, Beside: -2, One: 1 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
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
    Range: class {
      args: number[];
      constructor(...args: number[]) {
        this.args = args;
      }
    },
  };

  return {
    vscode,
    commands,
    listeners,
    posted,
    diagnostics,
    panel,
    doc,
    send: (m: unknown) => onMessage(m),
    setText: (t: string) => (text = t),
  };
}

test('extension opens a preview, streams updates and syncs the cursor', async () => {
  const h = harness('api -> db: queries\ndb.shape: cylinder\n');
  const original = Module._load;
  Module._load = function (req: string, ...rest: unknown[]) {
    return req === 'vscode' ? h.vscode : original.call(this, req, ...rest);
  };
  try {
    delete require.cache[require.resolve(path.join(root, 'dist/extension.js'))];
    const ext = require(path.join(root, 'dist/extension.js'));
    ext.activate({ subscriptions: [], extensionUri: makeUri(root) });

    assert.ok(h.commands['archer.openPreviewToSide'], 'command registered');
    await h.commands['archer.openPreviewToSide']();
    assert.match(h.panel.webview.html, /Content-Security-Policy/);
    assert.match(h.panel.webview.html, /dist\/webview\.js/);

    await h.send({ type: 'ready' });
    const update = h.posted.find((m) => m.type === 'update');
    assert.ok(update, 'update posted after ready');
    assert.deepEqual(Object.keys(update.model.nodes).sort(), ['api', 'db']);
    assert.equal(update.fileName, 'diagram.d2');

    h.listeners.selection({ textEditor: { document: h.doc }, selections: [{ active: { line: 1 } }] });
    assert.deepEqual(h.posted.at(-1), { type: 'cursor', id: 'db' });

    h.setText('api -> db\nweb: { shape: blob }\n');
    h.listeners.change({ document: h.doc });
    await new Promise((r) => setTimeout(r, 250));
    const last = h.posted.filter((m) => m.type === 'update').at(-1);
    assert.ok(last.model.nodes.web, 'edited model pushed');
    const diags = h.diagnostics.get(h.doc.uri.toString())!;
    assert.equal(diags.length, 1);
    assert.match(diags[0].message, /Unknown shape/);
  } finally {
    Module._load = original;
  }
});
