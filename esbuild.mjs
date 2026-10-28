import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

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
  esbuild.context({
    ...common,
    entryPoints: ['webview/main.ts'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'iife',
  }),
  ...(production
    ? []
    : [esbuild.context({ ...common, entryPoints: ['dev/harness.ts'], outfile: 'dist/harness.js', platform: 'browser', format: 'iife' })]),
]);

// The official D2 compiler (WASM + worker) runs from dist/d2 at runtime.
const d2 = 'node_modules/@d2lang/d2';
mkdirSync('dist/d2', { recursive: true });
cpSync(`${d2}/dist/node-cjs`, 'dist/d2', { recursive: true });
cpSync(`${d2}/LICENSE.txt`, 'dist/d2/LICENSE.txt');
cpSync(`${d2}/THIRD_PARTY_NOTICES.txt`, 'dist/d2/THIRD_PARTY_NOTICES.txt');

if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
}
