import * as vscode from 'vscode';
import * as path from 'node:path';
import type { D2 } from '@d2lang/d2';
import type { DiagramModel, EditOp, ParseIssue, SourceRange } from './model.ts';
import { assignAdrs, scanAdrFolders, type AdrFolder } from './adr.ts';
import { D2Compiler } from './d2/compiler.ts';
import type { Built } from './d2/convert.ts';
import { EditError, planEdit } from './d2/edits.ts';

const VIEW_TYPE = 'archer.preview';

let compiler: D2Compiler | undefined;

// The build copies the package's Node build (worker + WASM) next to the bundle.
function createD2(): D2 {
  const lib = require(path.join(__dirname, 'd2', 'index.js')) as typeof import('@d2lang/d2');
  return new lib.D2();
}

export function activate(context: vscode.ExtensionContext): void {
  compiler = new D2Compiler(createD2);
  const models = new DocumentModels(compiler);
  const diagnostics = vscode.languages.createDiagnosticCollection('d2');
  const previews = new Map<string, Preview>();
  const timers = new Map<string, NodeJS.Timeout>();

  const isD2 = (doc: vscode.TextDocument) => doc.languageId === 'd2' || doc.fileName.endsWith('.d2');

  const schedule = (doc: vscode.TextDocument, delay = 180) => {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => void models.refresh(doc), delay));
  };

  models.onDidUpdate(({ doc, state }) => {
    diagnostics.set(
      doc.uri,
      state.issues.map((issue) => {
        const d = new vscode.Diagnostic(toRange(issue.range), issue.message, vscode.DiagnosticSeverity.Error);
        d.source = 'd2';
        return d;
      }),
    );
    previews.get(doc.uri.toString())?.update(state);
  });

  const open = async (uri: vscode.Uri | undefined, column: vscode.ViewColumn) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) {
      void vscode.window.showWarningMessage('Open a .d2 file to preview it.');
      return;
    }
    const existing = previews.get(target.toString());
    if (existing) {
      existing.panel.reveal(column);
      return;
    }
    const doc = await vscode.workspace.openTextDocument(target);
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, previewTitle(doc), column, webviewOptions(context, doc));
    track(new Preview(context, panel, doc, models, schedule));
  };

  const track = (preview: Preview) => {
    const key = preview.document.uri.toString();
    previews.set(key, preview);
    preview.panel.onDidDispose(() => previews.delete(key));
  };

  const activePreview = (): Preview | undefined => {
    for (const p of previews.values()) if (p.panel.active) return p;
    const doc = vscode.window.activeTextEditor?.document;
    return doc ? previews.get(doc.uri.toString()) : undefined;
  };

  context.subscriptions.push(
    diagnostics,
    models,
    vscode.commands.registerCommand('archer.openPreview', (uri?: vscode.Uri) => open(uri, vscode.ViewColumn.Active)),
    vscode.commands.registerCommand('archer.openPreviewToSide', (uri?: vscode.Uri) => open(uri, vscode.ViewColumn.Beside)),
    vscode.commands.registerCommand('archer.exportSvg', () => activePreview()?.post({ type: 'command', command: 'export-svg' })),
    vscode.commands.registerCommand('archer.exportPng', () => activePreview()?.post({ type: 'command', command: 'export-png' })),
    vscode.commands.registerCommand('archer.fit', () => activePreview()?.post({ type: 'command', command: 'fit' })),

    vscode.workspace.onDidOpenTextDocument((doc) => isD2(doc) && schedule(doc, 0)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics.delete(doc.uri);
      models.forget(doc.uri);
    }),
    vscode.workspace.onDidChangeTextDocument((ev) => isD2(ev.document) && schedule(ev.document)),
    vscode.window.onDidChangeVisibleTextEditors(() => {
      for (const p of previews.values()) p.restoreHighlight();
    }),
    vscode.window.onDidChangeTextEditorSelection((ev) => {
      if (!vscode.workspace.getConfiguration('archer').get('syncSelection', true)) return;
      previews.get(ev.textEditor.document.uri.toString())?.syncCursor(ev.selections[0].active.line);
    }),
    vscode.workspace.onDidChangeConfiguration((ev) => {
      if (!ev.affectsConfiguration('archer')) return;
      for (const p of previews.values()) {
        const state = models.get(p.document);
        if (state) p.update(state);
      }
    }),
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: { uri?: string } | undefined) {
        if (!state?.uri) {
          panel.dispose();
          return;
        }
        try {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(state.uri));
          panel.webview.options = webviewOptions(context, doc);
          track(new Preview(context, panel, doc, models, schedule));
        } catch {
          panel.dispose();
        }
      },
    }),
  );

  for (const doc of vscode.workspace.textDocuments) if (isD2(doc)) schedule(doc, 0);
}

export async function deactivate(): Promise<void> {
  await compiler?.dispose();
  compiler = undefined;
}

// ------------------------------------------------------------ compilation

interface DocState {
  version: number;
  ok: boolean;
  built?: Built; // last successful build, kept while the file has errors
  issues: ParseIssue[];
}

class DocumentModels implements vscode.Disposable {
  private readonly states = new Map<string, DocState>();
  private readonly inflight = new Map<string, { version: number; promise: Promise<DocState> }>();
  private readonly emitter = new vscode.EventEmitter<{ doc: vscode.TextDocument; state: DocState }>();
  readonly onDidUpdate = this.emitter.event;

  constructor(private readonly compiler: D2Compiler) {}

  get(doc: vscode.TextDocument): DocState | undefined {
    return this.states.get(doc.uri.toString());
  }

  forget(uri: vscode.Uri): void {
    this.states.delete(uri.toString());
  }

  // Compile the current version of the document (deduplicated per version).
  refresh(doc: vscode.TextDocument): Promise<DocState> {
    const key = doc.uri.toString();
    const current = this.states.get(key);
    if (current && current.version === doc.version) return Promise.resolve(current);
    const pending = this.inflight.get(key);
    if (pending && pending.version === doc.version) return pending.promise;

    const version = doc.version;
    const text = doc.getText();
    const promise = (async () => {
      const files = text.includes('@') ? await siblingFiles(doc) : {};
      const result = await this.compiler.compile(text, path.basename(doc.fileName), files);
      const previous = this.states.get(key);
      const state: DocState = result.ok
        ? { version, ok: true, built: result.built, issues: [] }
        : { version, ok: false, built: previous?.built, issues: result.issues };
      if (!previous || previous.version <= version) {
        this.states.set(key, state);
        this.emitter.fire({ doc, state });
      }
      return state;
    })();
    this.inflight.set(key, { version, promise });
    void promise.finally(() => {
      if (this.inflight.get(key)?.promise === promise) this.inflight.delete(key);
    });
    return promise;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

// Other .d2 files near the document, so `@imports` resolve.
async function siblingFiles(doc: vscode.TextDocument): Promise<Record<string, string>> {
  const dir = vscode.Uri.file(path.dirname(doc.uri.fsPath));
  const files: Record<string, string> = {};
  const visit = async (uri: vscode.Uri, rel: string, depth: number) => {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(uri);
    } catch {
      return;
    }
    for (const [name, type] of entries) {
      if (Object.keys(files).length >= 200) return;
      const child = vscode.Uri.joinPath(uri, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (type === vscode.FileType.Directory && depth < 2 && !name.startsWith('.') && name !== 'node_modules') {
        await visit(child, relPath, depth + 1);
      } else if (type === vscode.FileType.File && name.endsWith('.d2') && child.fsPath !== doc.uri.fsPath) {
        files[relPath] = new TextDecoder().decode(await vscode.workspace.fs.readFile(child));
      }
    }
  };
  await visit(dir, '', 0);
  return files;
}

// ---------------------------------------------------------------- preview

function webviewOptions(context: vscode.ExtensionContext, doc: vscode.TextDocument): vscode.WebviewPanelOptions & vscode.WebviewOptions {
  const roots = [
    vscode.Uri.joinPath(context.extensionUri, 'dist'),
    vscode.Uri.joinPath(context.extensionUri, 'media'),
    vscode.Uri.file(path.dirname(doc.uri.fsPath)),
    ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri),
  ];
  return { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: roots };
}

function previewTitle(doc: vscode.TextDocument): string {
  return `Diagram · ${path.basename(doc.fileName)}`;
}

function toRange(r: SourceRange): vscode.Range {
  return new vscode.Range(r.line, r.col, r.endLine, Math.max(r.endCol, r.line === r.endLine ? r.col + 1 : r.endCol));
}

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'navigate'; range: SourceRange }
  | { type: 'highlight'; range: SourceRange | null }
  | { type: 'openLink'; url: string }
  | { type: 'export'; format: 'svg' | 'png'; data: string }
  | { type: 'edit'; edit: EditOp }
  | { type: 'openFile'; path: string }
  | { type: 'undo' }
  | { type: 'redo' };

const EMPTY: DiagramModel = { direction: 'down', nodes: {}, roots: [], edges: [], issues: [], lineIndex: {} };

class Preview {
  private ready = false;
  private lastCursor: string | null = null;
  // The selected element's declaration, highlighted in the editor without moving the cursor.
  // Archer's own theme colours: the built-in range highlight is nearly invisible in many dark themes.
  private readonly selection = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('archer.sourceHighlightBackground'),
    isWholeLine: true,
    overviewRulerColor: new vscode.ThemeColor('archer.sourceHighlightRuler'),
    overviewRulerLane: vscode.OverviewRulerLane.Full,
  });
  private highlighted: vscode.Range | undefined;
  // Visual edits as whole-text snapshots; only replayed while the text still matches.
  private readonly history: { before: string; after: string }[] = [];
  private readonly future: { before: string; after: string }[] = [];
  // ADR folders under the roots named in `vars.adr-folders`, reloaded when those
  // roots change or Markdown files in them do.
  private adrRoots: string[] = [];
  private adrFolders: AdrFolder[] = [];
  private adrWatchers: vscode.Disposable[] = [];
  private adrReload: NodeJS.Timeout | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    readonly panel: vscode.WebviewPanel,
    readonly document: vscode.TextDocument,
    private readonly models: DocumentModels,
    private readonly schedule: (doc: vscode.TextDocument, delay?: number) => void,
  ) {
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
    panel.webview.html = this.html();
    panel.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg));
    panel.onDidDispose(() => {
      this.selection.dispose();
      for (const w of this.adrWatchers) w.dispose();
      clearTimeout(this.adrReload);
    });
  }

  private editors(): vscode.TextEditor[] {
    return vscode.window.visibleTextEditors.filter((e) => e.document.uri.toString() === this.document.uri.toString());
  }

  // Re-apply after the editor is shown again; decorations don't survive an editor being hidden.
  restoreHighlight(): void {
    for (const editor of this.editors()) editor.setDecorations(this.selection, this.highlighted ? [this.highlighted] : []);
  }

  // Only editors already showing the file are touched; a click never opens it.
  private highlight(range: SourceRange | null): void {
    this.highlighted = range ? toRange(range) : undefined;
    for (const editor of this.editors()) {
      editor.setDecorations(this.selection, this.highlighted ? [this.highlighted] : []);
      if (this.highlighted) editor.revealRange(this.highlighted, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  }

  post(msg: unknown): void {
    if (this.ready) void this.panel.webview.postMessage(msg);
  }

  update(state: DocState): void {
    const roots = state.built?.adrFolders ?? [];
    if (!sameList(roots, this.adrRoots)) return void this.loadAdrs(roots); // updates again once scanned
    const config = vscode.workspace.getConfiguration('archer');
    const model = state.built ? this.resolveIcons(state.built.model) : EMPTY;
    this.post({
      type: 'update',
      uri: this.document.uri.toString(),
      fileName: path.basename(this.document.fileName),
      model: { ...model, issues: state.issues, valid: state.ok },
      adrs: assignAdrs(this.adrFolders, model, this.adrRoots),
      config: { defaultDepth: config.get<number>('defaultDepth', 1), wheel: config.get<string>('wheel', 'auto') },
    });
  }

  syncCursor(line: number): void {
    const id = this.models.get(this.document)?.built?.model.lineIndex[line] ?? null;
    if (id === this.lastCursor) return;
    this.lastCursor = id;
    this.post({ type: 'cursor', id });
  }

  private async loadAdrs(roots = this.adrRoots): Promise<void> {
    const base = path.dirname(this.document.uri.fsPath);
    if (roots !== this.adrRoots) {
      this.adrRoots = roots;
      this.watchAdrs(roots.map((r) => path.resolve(base, r)));
    }
    const folders = await scanAdrFolders(base, roots);
    if (roots !== this.adrRoots) return; // the variable changed while scanning
    this.adrFolders = folders;
    const state = this.models.get(this.document);
    if (state) this.update(state);
  }

  private watchAdrs(dirs: string[]): void {
    for (const w of this.adrWatchers) w.dispose();
    const reload = () => {
      clearTimeout(this.adrReload);
      this.adrReload = setTimeout(() => void this.loadAdrs(), 250);
    };
    this.adrWatchers = dirs.map((dir) => {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(dir), '**/*.md'));
      watcher.onDidCreate(reload);
      watcher.onDidChange(reload);
      watcher.onDidDelete(reload);
      return watcher;
    });
  }

  // Links inside ADRs may point anywhere; only open files next to the diagram, in the workspace, or known ADRs.
  private mayOpen(file: string): boolean {
    const target = path.resolve(file);
    const within = (dir: string) => !path.relative(dir, target).startsWith('..') && !path.isAbsolute(path.relative(dir, target));
    if (within(path.dirname(this.document.uri.fsPath))) return true;
    if ((vscode.workspace.workspaceFolders ?? []).some((f) => within(f.uri.fsPath))) return true;
    return this.adrFolders.some((f) => f.adrs.some((a) => path.resolve(a.file) === target));
  }

  private toast(message: string): void {
    this.post({ type: 'toast', message });
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        this.update(await this.models.refresh(this.document));
        return;
      case 'edit':
        return this.applyEdit(msg.edit);
      case 'highlight':
        return this.highlight(msg.range);
      case 'undo':
      case 'redo':
        return this.travel(msg.type);
      case 'navigate': {
        const range = toRange(msg.range);
        const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === this.document.uri.toString());
        const shown = await vscode.window.showTextDocument(this.document, {
          viewColumn: editor?.viewColumn ?? vscode.ViewColumn.One,
          selection: new vscode.Selection(range.start, range.start),
        });
        shown.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        return;
      }
      case 'openFile': {
        if (!this.mayOpen(msg.path)) return;
        void vscode.window.showTextDocument(vscode.Uri.file(msg.path), { viewColumn: vscode.ViewColumn.Beside, preview: true });
        return;
      }
      case 'openLink': {
        if (/^[a-z][a-z0-9+.-]*:/i.test(msg.url)) {
          void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        } else {
          const file = vscode.Uri.file(path.resolve(path.dirname(this.document.uri.fsPath), msg.url));
          void vscode.window.showTextDocument(file, { viewColumn: vscode.ViewColumn.One });
        }
        return;
      }
      case 'export': {
        const base = this.document.uri.fsPath.replace(/\.d2$/i, '');
        const target = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(`${base}.${msg.format}`),
          filters: msg.format === 'svg' ? { 'SVG image': ['svg'] } : { 'PNG image': ['png'] },
        });
        if (!target) return;
        const bytes = msg.format === 'svg' ? new TextEncoder().encode(msg.data) : Buffer.from(msg.data, 'base64');
        await vscode.workspace.fs.writeFile(target, bytes);
        void vscode.window.showInformationMessage(`Exported ${path.basename(target.fsPath)}`);
        return;
      }
    }
  }

  private async applyEdit(op: EditOp): Promise<void> {
    const state = await this.models.refresh(this.document);
    if (!state.ok || !state.built) {
      this.toast('Fix the errors in the D2 file before editing in the diagram');
      return;
    }
    let edits;
    try {
      edits = planEdit(this.document.getText(), state.built, op);
    } catch (err) {
      if (err instanceof EditError) return this.toast(err.message);
      throw err;
    }
    if (!edits.length) return;

    const before = this.document.getText();
    const edit = new vscode.WorkspaceEdit();
    for (const e of edits) {
      edit.replace(this.document.uri, new vscode.Range(this.document.positionAt(e.start), this.document.positionAt(e.end)), e.text);
    }
    if (!(await vscode.workspace.applyEdit(edit))) {
      this.toast('The edit could not be applied');
      return;
    }
    this.history.push({ before, after: this.document.getText() });
    this.future.length = 0;
    this.schedule(this.document, 0);
  }

  private async travel(direction: 'undo' | 'redo'): Promise<void> {
    const from = direction === 'undo' ? this.history : this.future;
    const to = direction === 'undo' ? this.future : this.history;
    const step = from.pop();
    if (!step) return this.toast(direction === 'undo' ? 'Nothing to undo' : 'Nothing to redo');
    const expected = direction === 'undo' ? step.after : step.before;
    if (this.document.getText() !== expected) {
      this.history.length = 0;
      this.future.length = 0;
      return this.toast('The file changed since that edit; use undo in the editor instead');
    }
    const edit = new vscode.WorkspaceEdit();
    const all = new vscode.Range(this.document.positionAt(0), this.document.positionAt(expected.length));
    edit.replace(this.document.uri, all, direction === 'undo' ? step.before : step.after);
    if (await vscode.workspace.applyEdit(edit)) {
      to.push(step);
      this.schedule(this.document, 0);
    }
  }

  // Relative icon paths are resolved against the .d2 file and made loadable by the webview.
  private resolveIcons(model: DiagramModel): DiagramModel {
    const dir = path.dirname(this.document.uri.fsPath);
    const nodes = { ...model.nodes };
    for (const [id, node] of Object.entries(nodes)) {
      if (!node.icon || /^(https?:|data:)/i.test(node.icon)) continue;
      const file = vscode.Uri.file(path.resolve(dir, node.icon));
      nodes[id] = { ...node, icon: this.panel.webview.asWebviewUri(file).toString() };
    }
    return { ...model, nodes };
  }

  private html(): string {
    const webview = this.panel.webview;
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.css'));
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data: blob:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${style}" />
  <title>${previewTitle(this.document)}</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
