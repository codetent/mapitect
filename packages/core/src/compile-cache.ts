// Compiles open diagrams and keeps the latest result per document.

import type { ParseIssue } from './model.ts';
import { basename, dirname, join } from './path.ts';
import type { DiagramDocument, Disposable, FileSystem } from './ports.ts';
import type { D2Compiler } from './d2/compiler.ts';
import type { Built } from './d2/convert.ts';

export interface DocState {
  version: number;
  ok: boolean;
  built?: Built; // last successful build, kept while the file has errors
  issues: ParseIssue[];
}

type Listener<D> = (ev: { doc: D; state: DocState }) => void;

// `D` lets a host get its own document type back in update events.
export class CompileCache<D extends DiagramDocument = DiagramDocument> {
  private readonly states = new Map<string, DocState>();
  private readonly inflight = new Map<string, { version: number; promise: Promise<DocState> }>();
  private readonly listeners = new Set<Listener<D>>();
  private readonly compiler: D2Compiler;
  private readonly fs: FileSystem;

  constructor(compiler: D2Compiler, fs: FileSystem) {
    this.compiler = compiler;
    this.fs = fs;
  }

  onDidUpdate(listener: Listener<D>): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  get(doc: D): DocState | undefined {
    return this.states.get(doc.id);
  }

  forget(id: string): void {
    this.states.delete(id);
  }

  // Compile the current version of the document (deduplicated per version).
  // `force` compiles again anyway, e.g. after imported files changed on disk.
  refresh(doc: D, force = false): Promise<DocState> {
    const key = doc.id;
    const current = this.states.get(key);
    if (!force && current && current.version === doc.version) return Promise.resolve(current);
    const pending = this.inflight.get(key);
    if (!force && pending && pending.version === doc.version) return pending.promise;

    const version = doc.version;
    const text = doc.getText();
    const promise = (async () => {
      const files = text.includes('@') ? await siblingFiles(this.fs, doc.path) : {};
      const result = await this.compiler.compile(text, basename(doc.path), files);
      const previous = this.states.get(key);
      const state: DocState = result.ok
        ? { version, ok: true, built: result.built, issues: result.built.model.issues }
        : { version, ok: false, built: previous?.built, issues: result.issues };
      if (!previous || previous.version <= version) {
        this.states.set(key, state);
        for (const listener of this.listeners) listener({ doc, state });
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
    this.listeners.clear();
  }
}

// Other .d2 files near the document, so `@imports` resolve.
async function siblingFiles(fs: FileSystem, file: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const visit = async (dir: string, rel: string, depth: number) => {
    let entries;
    try {
      entries = await fs.readDir(dir);
    } catch {
      return;
    }
    for (const { name, kind } of entries) {
      if (Object.keys(files).length >= 200) return;
      const child = join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (kind === 'directory' && depth < 2 && !name.startsWith('.') && name !== 'node_modules') {
        await visit(child, relPath, depth + 1);
      } else if (kind === 'file' && name.endsWith('.d2') && child !== file) {
        files[relPath] = await fs.readText(child);
      }
    }
  };
  await visit(dirname(file), '', 0);
  return files;
}
