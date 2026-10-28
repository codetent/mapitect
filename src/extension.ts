import * as vscode from 'vscode';
import * as path from 'node:path';
import type { DiagramModel, SourceRange } from './model.ts';
import { parseD2 } from './parser/d2.ts';

const VIEW_TYPE = 'archer.preview';

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('d2');
  const previews = new Map<string, Preview>();

  const isD2 = (doc: vscode.TextDocument) => doc.languageId === 'd2' || doc.fileName.endsWith('.d2');

  const updateDiagnostics = (doc: vscode.TextDocument, model = parseD2(doc.getText())) => {
    diagnostics.set(
      doc.uri,
      model.issues.map((issue) => {
        const d = new vscode.Diagnostic(
          toRange(issue.range),
          issue.message,
          issue.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : issue.severity === 'warning'
              ? vscode.DiagnosticSeverity.Warning
              : vscode.DiagnosticSeverity.Information,
        );
        d.source = 'archer';
        return d;
      }),
    );
    return model;
  };

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
    track(new Preview(context, panel, doc));
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

  const timers = new Map<string, NodeJS.Timeout>();

  context.subscriptions.push(
    diagnostics,
    vscode.commands.registerCommand('archer.openPreview', (uri?: vscode.Uri) => open(uri, vscode.ViewColumn.Active)),
    vscode.commands.registerCommand('archer.openPreviewToSide', (uri?: vscode.Uri) => open(uri, vscode.ViewColumn.Beside)),
    vscode.commands.registerCommand('archer.exportSvg', () => activePreview()?.post({ type: 'command', command: 'export-svg' })),
    vscode.commands.registerCommand('archer.exportPng', () => activePreview()?.post({ type: 'command', command: 'export-png' })),
    vscode.commands.registerCommand('archer.fit', () => activePreview()?.post({ type: 'command', command: 'fit' })),

    vscode.workspace.onDidOpenTextDocument((doc) => isD2(doc) && updateDiagnostics(doc)),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri)),
    vscode.workspace.onDidChangeTextDocument((ev) => {
      const doc = ev.document;
      if (!isD2(doc)) return;
      const key = doc.uri.toString();
      clearTimeout(timers.get(key));
      timers.set(
        key,
        setTimeout(() => {
          const model = updateDiagnostics(doc);
          previews.get(key)?.update(model);
        }, 180),
      );
    }),
    vscode.window.onDidChangeTextEditorSelection((ev) => {
      if (!vscode.workspace.getConfiguration('archer').get('syncSelection', true)) return;
      previews.get(ev.textEditor.document.uri.toString())?.syncCursor(ev.selections[0].active.line);
    }),
    vscode.workspace.onDidChangeConfiguration((ev) => {
      if (ev.affectsConfiguration('archer')) for (const p of previews.values()) p.update();
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
          track(new Preview(context, panel, doc));
        } catch {
          panel.dispose();
        }
      },
    }),
  );

  for (const doc of vscode.workspace.textDocuments) if (isD2(doc)) updateDiagnostics(doc);
}

export function deactivate(): void {}

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
  | { type: 'openLink'; url: string }
  | { type: 'export'; format: 'svg' | 'png'; data: string };

class Preview {
  private model: DiagramModel | undefined;
  private ready = false;
  private lastCursor: string | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    readonly panel: vscode.WebviewPanel,
    readonly document: vscode.TextDocument,
  ) {
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
    panel.webview.html = this.html();
    panel.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg));
  }

  post(msg: unknown): void {
    if (this.ready) void this.panel.webview.postMessage(msg);
  }

  update(model?: DiagramModel): void {
    if (model) this.model = model;
    this.model ??= parseD2(this.document.getText());
    const config = vscode.workspace.getConfiguration('archer');
    this.post({
      type: 'update',
      uri: this.document.uri.toString(),
      fileName: path.basename(this.document.fileName),
      model: this.resolveIcons(this.model),
      config: { defaultDepth: config.get<number>('defaultDepth', 0), wheel: config.get<string>('wheel', 'auto') },
    });
  }

  syncCursor(line: number): void {
    const id = this.model?.lineIndex[line] ?? null;
    if (id === this.lastCursor) return;
    this.lastCursor = id;
    this.post({ type: 'cursor', id });
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        this.update(parseD2(this.document.getText()));
        return;
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
