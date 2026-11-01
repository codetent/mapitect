// One open preview of a diagram: answers the UI's messages, applies visual
// edits with their own undo history, loads the diagram's ADRs and sends the
// UI fresh models. Everything host-specific goes through HostShell.

import { assignAdrs, planNewAdr, scanAdrFolders, type AdrFolder } from './adr.ts';
import type { DocState, CompileCache } from './compile-cache.ts';
import { EditError, planEdit } from './d2/edits.ts';
import type { DiagramModel, EditOp } from './model.ts';
import { basename, dirname, isWithin, normalize, resolve } from './path.ts';
import type { DiagramDocument, Disposable, FileSystem, HostShell } from './ports.ts';
import type { HostMessage, UiMessage } from './protocol.ts';

const EMPTY: DiagramModel = { direction: 'down', nodes: {}, roots: [], edges: [], issues: [], lineIndex: {} };

export class DiagramSession<D extends DiagramDocument = DiagramDocument> {
  private ready = false;
  private lastCursor: string | null = null;
  // Visual edits as whole-text snapshots; only replayed while the text still matches.
  private readonly history: { before: string; after: string }[] = [];
  private readonly future: { before: string; after: string }[] = [];
  // ADR folders under the roots named in `vars.adr-folders`, reloaded when those
  // roots change or Markdown files in them do.
  private adrRoots: string[] = [];
  private adrFolders: AdrFolder[] = [];
  private adrWatchers: Disposable[] = [];
  private adrReload: ReturnType<typeof setTimeout> | undefined;
  readonly document: D;
  private readonly cache: CompileCache<D>;
  private readonly fs: FileSystem;
  private readonly shell: HostShell;

  constructor(document: D, cache: CompileCache<D>, fs: FileSystem, shell: HostShell) {
    this.document = document;
    this.cache = cache;
    this.fs = fs;
    this.shell = shell;
  }

  get fileName(): string {
    return basename(this.document.path);
  }

  private get dir(): string {
    return dirname(this.document.path);
  }

  // Messages wait until the UI has said it's ready.
  post(msg: HostMessage): void {
    if (this.ready) this.shell.post(msg);
  }

  // Sends the UI the document's latest compile result (also after a config change).
  update(state: DocState): void {
    const roots = state.built?.adrFolders ?? [];
    if (!sameList(roots, this.adrRoots)) return void this.loadAdrs(roots); // updates again once scanned
    const model = state.built ? this.resolveIcons(state.built.model) : EMPTY;
    this.post({
      type: 'update',
      uri: this.document.id,
      fileName: this.fileName,
      model: { ...model, issues: state.issues, valid: state.ok },
      adrs: assignAdrs(this.adrFolders, model, this.adrRoots),
      config: this.shell.config(),
    });
  }

  // The editor's cursor moved to `line`: point out the element declared there.
  syncCursor(line: number): void {
    const id = this.cache.get(this.document)?.built?.model.lineIndex[line] ?? null;
    if (id === this.lastCursor) return;
    this.lastCursor = id;
    this.post({ type: 'cursor', id });
  }

  async receive(msg: UiMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        this.update(await this.cache.refresh(this.document));
        return;
      case 'edit':
        return this.applyEdit(msg.edit);
      case 'highlight':
        return this.shell.highlightSource(msg.range);
      case 'undo':
      case 'redo':
        return this.travel(msg.type);
      case 'reload':
        return this.reload();
      case 'newDecision':
        return this.newDecision(msg.id);
      case 'navigate':
        return this.shell.showSource(msg.range);
      case 'openFile':
        if (this.mayOpen(msg.path)) this.shell.openFile(msg.path, 'beside');
        return;
      case 'openLink':
        if (/^[a-z][a-z0-9+.-]*:/i.test(msg.url)) this.shell.openExternal(msg.url);
        else this.shell.openFile(resolve(this.dir, msg.url), 'main');
        return;
      case 'export':
        return this.shell.saveImage(msg.format, msg.data, `${this.document.path.replace(/\.d2$/i, '')}.${msg.format}`);
    }
  }

  dispose(): void {
    for (const w of this.adrWatchers) w.dispose();
    clearTimeout(this.adrReload);
  }

  // Re-read everything from disk: the diagram with its imports, and the ADR folders.
  private async reload(): Promise<void> {
    await this.cache.refresh(this.document, true);
    await this.loadAdrs();
    this.toast('Reloaded');
  }

  private async loadAdrs(roots = this.adrRoots): Promise<void> {
    const base = this.dir;
    if (roots !== this.adrRoots) {
      this.adrRoots = roots;
      this.watchAdrs(roots.map((r) => resolve(base, r)));
    }
    const folders = await scanAdrFolders(this.fs, base, roots);
    if (roots !== this.adrRoots) return; // the variable changed while scanning
    this.adrFolders = folders;
    const state = this.cache.get(this.document);
    if (state) this.update(state);
  }

  private watchAdrs(dirs: string[]): void {
    for (const w of this.adrWatchers) w.dispose();
    const reload = () => {
      clearTimeout(this.adrReload);
      this.adrReload = setTimeout(() => void this.loadAdrs(), 250);
    };
    const watch = this.shell.watch?.bind(this.shell);
    this.adrWatchers = watch ? dirs.map((dir) => watch(dir, '**/*.md', reload)) : [];
  }

  // Links inside ADRs may point anywhere; only open files next to the diagram, in the workspace, or known ADRs.
  private mayOpen(file: string): boolean {
    const target = normalize(file);
    if (isWithin(this.dir, target)) return true;
    if (this.shell.workspaceRoots().some((root) => isWithin(root, target))) return true;
    return this.adrFolders.some((f) => f.adrs.some((a) => normalize(a.file) === target));
  }

  private toast(message: string): void {
    this.post({ type: 'toast', message });
  }

  // Asks for a title, writes the element's next MADR file and opens it next to the diagram.
  private async newDecision(id: string): Promise<void> {
    const model = this.cache.get(this.document)?.built?.model;
    const node = model?.nodes[id];
    if (!model || !node) return;
    if (!this.adrRoots.length) return this.toast("Add adr-folders to the file's vars to record decisions");
    const title = (
      await this.shell.askText({
        title: `New decision for ${node.label.split('\n')[0]}`,
        prompt: 'What was decided?',
        placeholder: 'Use Stripe for card payments',
        required: 'Enter a title',
      })
    )?.trim();
    if (!title) return;
    const plan = planNewAdr({
      baseDir: this.dir,
      roots: this.adrRoots,
      model,
      id,
      existing: assignAdrs(this.adrFolders, model, this.adrRoots).components[id] ?? [],
      title,
      date: today(),
    });
    if (await this.fs.exists(plan.file)) return this.shell.showError(`${basename(plan.file)} already exists`);
    await this.fs.mkdir(dirname(plan.file));
    await this.fs.writeText(plan.file, plan.text);
    void this.loadAdrs(); // watchers miss files in a root that didn't exist yet
    const line = plan.text.split('\n')[plan.cursor];
    await this.shell.editFile(plan.file, { line: plan.cursor, col: 0, endLine: plan.cursor, endCol: line.length });
  }

  private async applyEdit(op: EditOp): Promise<void> {
    const state = await this.cache.refresh(this.document);
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
    if (!(await this.document.applyEdits(edits))) {
      this.toast('The edit could not be applied');
      return;
    }
    this.history.push({ before, after: this.document.getText() });
    this.future.length = 0;
    void this.cache.refresh(this.document);
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
    const text = direction === 'undo' ? step.before : step.after;
    if (await this.document.applyEdits([{ start: 0, end: expected.length, text }])) {
      to.push(step);
      void this.cache.refresh(this.document);
    }
  }

  // Relative icon paths are resolved against the .d2 file and made loadable by the UI.
  private resolveIcons(model: DiagramModel): DiagramModel {
    const nodes = { ...model.nodes };
    for (const [id, node] of Object.entries(nodes)) {
      if (!node.icon || /^(https?:|data:)/i.test(node.icon)) continue;
      nodes[id] = { ...node, icon: this.shell.assetUrl(resolve(this.dir, node.icon)) };
    }
    return { ...model, nodes };
  }
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// The local date, as MADR writes it.
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
