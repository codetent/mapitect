import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const common = { bundle: true, minify: production, sourcemap: !production, logLevel: 'info' };

const contexts = await Promise.all([
  esbuild.context({
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
  }),
  // The UI with its styles: dist/webview.js and dist/webview.css.
  esbuild.context({
    ...common,
    entryPoints: ['src/webview.ts'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'iife',
  }),
]);

// The official D2 compiler (WASM + worker) runs from dist/d2 at runtime.
const d2 = path.resolve(path.dirname(createRequire(import.meta.url).resolve('@d2lang/d2')), '../..');
mkdirSync('dist/d2', { recursive: true });
cpSync(`${d2}/dist/node-cjs`, 'dist/d2', { recursive: true });
cpSync(`${d2}/LICENSE.txt`, 'dist/d2/LICENSE.txt');
cpSync(`${d2}/THIRD_PARTY_NOTICES.txt`, 'dist/d2/THIRD_PARTY_NOTICES.txt');

// vsce packages this folder; the license lives at the repository root.
if (production) cpSync('../../LICENSE', 'LICENSE');

if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
}
