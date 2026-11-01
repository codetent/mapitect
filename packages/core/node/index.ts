// @mapitect/core/node: core ports backed by Node, for tests, tools and the dev harness.

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { D2 } from '@d2lang/d2';
import type { FileSystem } from '../src/ports.ts';

export const nodeFileSystem: FileSystem = {
  async readDir(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, kind: e.isFile() ? 'file' : e.isDirectory() ? 'directory' : 'other' }));
  },
  readText: (file) => readFile(file, 'utf8'),
  writeText: (file, text) => writeFile(file, text, 'utf8'),
  async mkdir(dir) {
    await mkdir(dir, { recursive: true });
  },
  async exists(path) {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  },
};

// The official compiler's Node build (worker thread + WASM).
export function createNodeD2(): D2 {
  const { D2 } = createRequire(import.meta.url)('@d2lang/d2') as typeof import('@d2lang/d2');
  return new D2();
}
