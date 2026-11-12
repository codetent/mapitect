import * as vscode from 'vscode';
import * as path from 'node:path';
import type { D2 } from '@d2lang/d2';
import {
  CompileCache,
  D2Compiler,
  DiagramSession,
  paths,
  type DiagramDocument,
  type FileSystem,
  type HostMessage,
  type HostShell,
  type PreviewConfig,
  type Problem,
  type Severity,
  type SourceRange,
  type TextEdit,
  type UiMessage,
} from '@mapitect/core';

const VIEW_TYPE = 'mapitect.preview';

let compiler: D2Compiler | undefined;

// The build copies the package's Node build (worker + WASM) next to the bundle.
function createD2(): D2 {
  const lib = require(path.join(__dirname, 'd2', 'index.js')) as typeof import('@d2lang/d2');
  return new lib.D2();
}

export function activate(context: vscode.ExtensionContext): void {
  compiler = new D2Compiler(createD2);
  const cache = new CompileCache<CodeDocument>(compiler, fileSystem);
  const diagnostics = vscode.languages.createDiagnosticCollection('d2');
  const previews = new Map<string, Preview>();
  const timers = new Map<string, NodeJS.Timeout>();

  const isD2 = (doc: vscode.TextDocument) => doc.languageId === 'd2' || doc.fileName.endsWith('.d2');

  const schedule = (doc: vscode.TextDocument, delay = 180) => {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => void cache.refresh(new CodeDocument(doc)), delay));
  };

  const updates = cache.onDidUpdate(({ doc, state }) => {
    diagnostics.set(
      doc.text.uri,
      state.issues.map((issue) => {
        const d = new vscode.Diagnostic(toRange(issue.range), issue.message, SEVERITY[issue.severity]);
        d.source = issue.source ?? 'd2';
        return d;
      }),
    );
    previews.get(doc.id)?.session.update(state);
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
    track(new Preview(context, panel, doc, cache));
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
    updates,
    vscode.commands.registerCommand('mapitect.openPreview', (uri?: vscode.Uri) => open(uri, vscode.ViewColumn.Active)),
    vscode.commands.registerCommand('mapitect.openPreviewToSide', (uri?: vscode.Uri) => open(uri, vscode.ViewColumn.Beside)),
    vscode.commands.registerCommand('mapitect.exportSvg', () => activePreview()?.session.post({ type: 'command', command: 'export-svg' })),
    vscode.commands.registerCommand('mapitect.exportPng', () => activePreview()?.session.post({ type: 'command', command: 'export-png' })),
    vscode.commands.registerCommand('mapitect.fit', () => activePreview()?.session.post({ type: 'command', command: 'fit' })),

    vscode.workspace.onDidOpenTextDocument((doc) => isD2(doc) && schedule(doc, 0)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics.delete(doc.uri);
      cache.forget(doc.uri.toString());
    }),
    vscode.workspace.onDidChangeTextDocument((ev) => isD2(ev.document) && schedule(ev.document)),
    vscode.window.onDidChangeVisibleTextEditors(() => {
      for (const p of previews.values()) p.restoreHighlight();
    }),
    vscode.window.onDidChangeTextEditorSelection((ev) => {
      if (!vscode.workspace.getConfiguration('mapitect').get('syncSelection', true)) return;
      previews.get(ev.textEditor.document.uri.toString())?.session.syncCursor(ev.selections[0].active.line);
    }),
    vscode.workspace.onDidChangeConfiguration((ev) => {
      if (!ev.affectsConfiguration('mapitect')) return;
      for (const p of previews.values()) {
        const state = cache.get(p.session.document);
        if (state) p.session.update(state);
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
          track(new Preview(context, panel, doc, cache));
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

// --------------------------------------------------------------- adapters

// The core works with '/'-separated paths; VS Code with URIs.
function toPath(uri: vscode.Uri): string {
  return paths.normalize(uri.fsPath.replace(/\\/g, '/'));
}

function toUri(file: string): vscode.Uri {
  return vscode.Uri.file(file);
}

const SEVERITY: Record<Severity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

function toRange(r: SourceRange): vscode.Range {
  return new vscode.Range(r.line, r.col, r.endLine, Math.max(r.endCol, r.line === r.endLine ? r.col + 1 : r.endCol));
}

// workspace.fs also reaches remote and virtual workspaces.
const fileSystem: FileSystem = {
  async readDir(dir) {
    const entries = await vscode.workspace.fs.readDirectory(toUri(dir));
    return entries.map(([name, type]) => ({
      name,
      kind: type === vscode.FileType.File ? 'file' : type === vscode.FileType.Directory ? 'directory' : 'other',
    }));
  },
  async readText(file) {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(toUri(file)));
  },
  async writeText(file, text) {
    await vscode.workspace.fs.writeFile(toUri(file), new TextEncoder().encode(text));
  },
  async mkdir(dir) {
    await vscode.workspace.fs.createDirectory(toUri(dir));
  },
  async exists(file) {
    try {
      await vscode.workspace.fs.stat(toUri(file));
      return true;
    } catch {
      return false;
    }
  },
};

// An open .d2 editor document, as the core sees it.
class CodeDocument implements DiagramDocument {
  readonly id: string;
  readonly path: string;

  constructor(readonly text: vscode.TextDocument) {
    this.id = text.uri.toString();
    this.path = toPath(text.uri);
  }

  get version(): number {
    return this.text.version;
  }

  getText(): string {
    return this.text.getText();
  }

  async applyEdits(edits: TextEdit[]): Promise<boolean> {
    const doc = this.text;
    const edit = new vscode.WorkspaceEdit();
    for (const e of edits) edit.replace(doc.uri, new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end)), e.text);
    return vscode.workspace.applyEdit(edit);
  }
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

// A webview panel showing one diagram. The session holds the preview's logic;
// this class is its window to VS Code.
class Preview implements HostShell {
  readonly session: DiagramSession<CodeDocument>;
  // The selected element's declaration, highlighted in the editor without moving the cursor.
  // mapitect's own theme colours: the built-in range highlight is nearly invisible in many dark themes.
  private readonly selection = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('mapitect.sourceHighlightBackground'),
    isWholeLine: true,
    overviewRulerColor: new vscode.ThemeColor('mapitect.sourceHighlightRuler'),
    overviewRulerLane: vscode.OverviewRulerLane.Full,
  });
  private highlighted: vscode.Range | undefined;
  // Problems in the decision records and from drawing, while the preview is open.
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('mapitect');

  constructor(
    private readonly context: vscode.ExtensionContext,
    readonly panel: vscode.WebviewPanel,
    readonly document: vscode.TextDocument,
    cache: CompileCache<CodeDocument>,
  ) {
    this.session = new DiagramSession(new CodeDocument(document), cache, fileSystem, this);
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
    panel.webview.html = this.html();
    panel.webview.onDidReceiveMessage((msg: UiMessage) => this.session.receive(msg));
    panel.onDidDispose(() => {
      this.selection.dispose();
      this.session.dispose();
      this.diagnostics.dispose();
    });
  }

  private editors(): vscode.TextEditor[] {
    return vscode.window.visibleTextEditors.filter((e) => e.document.uri.toString() === this.document.uri.toString());
  }

  // Re-apply after the editor is shown again; decorations don't survive an editor being hidden.
  restoreHighlight(): void {
    for (const editor of this.editors()) editor.setDecorations(this.selection, this.highlighted ? [this.highlighted] : []);
  }

  // ------------------------------------------------------------ HostShell

  post(msg: HostMessage): void {
    void this.panel.webview.postMessage(msg);
  }

  config(): PreviewConfig {
    const config = vscode.workspace.getConfiguration('mapitect');
    return { defaultDepth: config.get<number>('defaultDepth', 1), wheel: config.get<string>('wheel', 'auto') };
  }

  workspaceRoots(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f) => toPath(f.uri));
  }

  assetUrl(file: string): string {
    return this.panel.webview.asWebviewUri(toUri(file)).toString();
  }

  async showSource(r: SourceRange): Promise<void> {
    const range = toRange(r);
    const editor = this.editors()[0];
    const shown = await vscode.window.showTextDocument(this.document, {
      viewColumn: editor?.viewColumn ?? vscode.ViewColumn.One,
      selection: new vscode.Selection(range.start, range.start),
    });
    shown.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  // Only editors already showing the file are touched; a click never opens it.
  highlightSource(range: SourceRange | null): void {
    this.highlighted = range ? toRange(range) : undefined;
    for (const editor of this.editors()) {
      editor.setDecorations(this.selection, this.highlighted ? [this.highlighted] : []);
      if (this.highlighted) editor.revealRange(this.highlighted, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  }

  openFile(file: string, where: 'beside' | 'main'): void {
    void vscode.window.showTextDocument(
      toUri(file),
      where === 'beside' ? { viewColumn: vscode.ViewColumn.Beside, preview: true } : { viewColumn: vscode.ViewColumn.One },
    );
  }

  openExternal(url: string): void {
    void vscode.env.openExternal(vscode.Uri.parse(url));
  }

  async editFile(file: string, s: SourceRange): Promise<void> {
    await vscode.window.showTextDocument(toUri(file), {
      viewColumn: this.editors()[0]?.viewColumn ?? vscode.ViewColumn.Beside,
      preview: false,
      selection: new vscode.Selection(s.line, s.col, s.endLine, s.endCol),
    });
  }

  async saveImage(format: 'svg' | 'png', data: string, suggested: string): Promise<void> {
    const target = await vscode.window.showSaveDialog({
      defaultUri: toUri(suggested),
      filters: format === 'svg' ? { 'SVG image': ['svg'] } : { 'PNG image': ['png'] },
    });
    if (!target) return;
    const bytes = format === 'svg' ? new TextEncoder().encode(data) : Buffer.from(data, 'base64');
    await vscode.workspace.fs.writeFile(target, bytes);
    void vscode.window.showInformationMessage(`Exported ${path.basename(target.fsPath)}`);
  }

  async askText(o: { title: string; prompt: string; placeholder?: string; required: string }): Promise<string | undefined> {
    return vscode.window.showInputBox({
      title: o.title,
      prompt: o.prompt,
      placeHolder: o.placeholder,
      validateInput: (v) => (v.trim() ? undefined : o.required),
    });
  }

  showError(message: string): void {
    void vscode.window.showErrorMessage(message);
  }

  watch(dir: string, glob: string, onChange: () => void): vscode.Disposable {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(toUri(dir), glob));
    watcher.onDidCreate(onChange);
    watcher.onDidChange(onChange);
    watcher.onDidDelete(onChange);
    return watcher;
  }

  problems(problems: Problem[]): void {
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const p of problems) {
      const d = new vscode.Diagnostic(toRange(p.range), p.message, SEVERITY[p.severity]);
      d.source = 'mapitect';
      d.code = p.source;
      byFile.set(p.file, [...(byFile.get(p.file) ?? []), d]);
    }
    this.diagnostics.clear();
    for (const [file, list] of byFile) this.diagnostics.set(toUri(file), list);
  }

  // ---------------------------------------------------------------- html

  private html(): string {
    const webview = this.panel.webview;
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css'));
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
