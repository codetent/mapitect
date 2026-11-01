// What a host (VS Code, a desktop app, a browser…) provides to the core.
// Paths are absolute and '/'-separated (see path.ts); hosts convert their
// native paths and URIs at the boundary.

import type { SourceRange, TextEdit } from './model.ts';
import type { HostMessage, PreviewConfig } from './protocol.ts';

export interface Disposable {
  dispose(): void;
}

export interface DirEntry {
  name: string;
  kind: 'file' | 'directory' | 'other'; // 'other': symlinks, devices…
}

export interface FileSystem {
  readDir(dir: string): Promise<DirEntry[]>; // rejects when the folder can't be read
  readText(file: string): Promise<string>;
  writeText(file: string, text: string): Promise<void>;
  mkdir(dir: string): Promise<void>; // including missing parents
  exists(path: string): Promise<boolean>;
}

// A .d2 file as the host's editor holds it, unsaved changes included.
export interface DiagramDocument {
  readonly id: string; // stable key, e.g. its URI
  readonly path: string;
  readonly version: number; // grows with every change
  getText(): string;
  applyEdits(edits: TextEdit[]): Promise<boolean>; // offsets into getText(); false when refused
}

// What only the surrounding application can do for a preview.
export interface HostShell {
  post(msg: HostMessage): void; // to the UI
  config(): PreviewConfig;
  workspaceRoots(): string[]; // folders the preview may open files from, besides the diagram's own
  assetUrl(file: string): string; // a URL the UI can load a local file (an icon) from

  showSource(range: SourceRange): Promise<void>; // reveal and select in the diagram's editor
  highlightSource(range: SourceRange | null): void; // mark without moving the cursor or opening anything
  openFile(file: string, where: 'beside' | 'main'): void; // beside the diagram, or in the main editor area
  openExternal(url: string): void;
  editFile(file: string, selection: SourceRange): Promise<void>; // a file just created, ready to type in

  saveImage(format: 'svg' | 'png', data: string, suggested: string): Promise<void>; // png data is base64
  askText(options: { title: string; prompt: string; placeholder?: string; required: string }): Promise<string | undefined>;
  showError(message: string): void;

  watch?(dir: string, glob: string, onChange: () => void): Disposable; // optional: changes reload ADRs
}
