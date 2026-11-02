import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const common = { bundle: true, minify: production, sourcemap: !production, metafile: true, logLevel: 'info' };

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
  const results = await Promise.all(contexts.map((c) => c.rebuild()));
  if (production) writeNotices(results.map((r) => r.metafile));
  await Promise.all(contexts.map((c) => c.dispose()));
}

// The licenses of the npm packages bundled into dist/*.js. D2 brings its own in dist/d2.
function writeNotices(metafiles) {
  const dirs = new Set();
  for (const meta of metafiles) {
    for (const input of Object.keys(meta.inputs)) {
      const m = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
      if (m) dirs.add(m[1]);
    }
  }
  const sections = [...dirs]
    .map((dir) => {
      const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
      const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
      const files = readdirSync(dir).filter((f) => /^(licen[cs]e|copying)/i.test(f));
      if (!files.length) throw new Error(`No license file in ${dir}`);
      const texts = files.map((f) => readFileSync(`${dir}/${f}`, 'utf8').trim());
      return { name: pkg.name, text: [`${pkg.name} ${pkg.version}, ${pkg.license}`, repo && `Source: ${repo}`, '', ...texts].filter((l) => l !== undefined).join('\n') };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const header = 'mapitect bundles the following third-party packages. The D2 compiler and its notices are in d2/.';
  const rule = '\n\n' + '-'.repeat(78) + '\n\n';
  writeFileSync('dist/THIRD_PARTY_NOTICES.txt', [header, ...sections.map((s) => s.text)].join(rule) + '\n');
}
