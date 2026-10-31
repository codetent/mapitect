// Dev-only: serves the webview and plays the extension host's role (compile,
// visual edits, undo) against in-memory copies of the files in examples/.
// Run with `node dev/server.mts [port]`.
import http from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { D2Compiler } from '../src/d2/compiler.ts';
import type { Built } from '../src/d2/convert.ts';
import { applyEdits, EditError, planEdit } from '../src/d2/edits.ts';
import { assignAdrs, scanAdrFolders } from '../src/adr.ts';
import type { EditOp } from '../src/model.ts';

const root = path.resolve(import.meta.dirname, '..');
const { D2 } = createRequire(import.meta.url)('@d2lang/d2');
const compiler = new D2Compiler(() => new D2());

interface Doc {
  text: string;
  built?: Built;
  history: string[];
  future: string[];
}
const docs = new Map<string, Doc>();

async function load(file: string): Promise<Doc> {
  let doc = docs.get(file);
  if (!doc) {
    doc = { text: await readFile(path.join(root, 'examples', path.basename(file)), 'utf8'), history: [], future: [] };
    docs.set(file, doc);
  }
  return doc;
}

// The other .d2 files in examples/, so `...@imports` resolve.
async function siblings(file: string): Promise<Record<string, string>> {
  const dir = path.join(root, 'examples');
  const names = (await readdir(dir)).filter((n) => n.endsWith('.d2') && n !== path.basename(file));
  return Object.fromEntries(await Promise.all(names.map(async (n) => [n, await readFile(path.join(dir, n), 'utf8')])));
}

async function snapshot(file: string, doc: Doc) {
  const r = await compiler.compile(doc.text, file, await siblings(file));
  if (r.ok) doc.built = r.built;
  const model = doc.built?.model ?? { direction: 'down', nodes: {}, roots: [], edges: [], lineIndex: {}, issues: [] };
  // ADRs are read fresh from the folders in `vars.adr-folders` on every snapshot.
  const roots = doc.built?.adrFolders ?? [];
  const adrs = assignAdrs(await scanAdrFolders(path.join(root, 'examples'), roots), model, roots);
  return { type: 'update', uri: `file:///${file}`, fileName: file, config: {}, model: { ...model, issues: r.ok ? [] : r.issues, valid: r.ok }, adrs };
}

async function api(route: string, body: Record<string, unknown>) {
  const file = String(body.file ?? 'platform.d2');
  const doc = await load(file);
  switch (route) {
    case 'model':
      return snapshot(file, doc);
    case 'text':
      if (typeof body.text === 'string') doc.text = body.text;
      return body.text === undefined ? { text: doc.text } : snapshot(file, doc);
    case 'edit': {
      const r = await compiler.compile(doc.text, file, await siblings(file));
      if (!r.ok) return { type: 'toast', message: 'Fix the errors in the D2 file before editing in the diagram' };
      try {
        const edits = planEdit(doc.text, r.built, body.edit as EditOp);
        doc.history.push(doc.text);
        doc.future = [];
        doc.text = applyEdits(doc.text, edits);
        return snapshot(file, doc);
      } catch (err) {
        if (err instanceof EditError) return { type: 'toast', message: err.message };
        throw err;
      }
    }
    case 'reload': {
      // Drop the in-memory copy and read the file again; ADRs are rescanned by the snapshot.
      docs.delete(file);
      return snapshot(file, await load(file));
    }
    case 'undo':
    case 'redo': {
      const [from, to] = route === 'undo' ? [doc.history, doc.future] : [doc.future, doc.history];
      const text = from.pop();
      if (text === undefined) return { type: 'toast', message: `Nothing to ${route}` };
      to.push(doc.text);
      doc.text = text;
      return snapshot(file, doc);
    }
  }
  return { type: 'toast', message: `unknown route ${route}` };
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.d2': 'text/plain', '.map': 'application/json', '.svg': 'image/svg+xml' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const out = await api(url.pathname.slice(5), raw ? JSON.parse(raw) : {});
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(out));
        return;
      }
      const file = path.join(root, path.normalize(url.pathname === '/' ? '/dev/index.html' : url.pathname));
      if (!file.startsWith(root)) throw Object.assign(new Error('forbidden'), { code: 'ENOENT' });
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch (err) {
      const missing = (err as { code?: string }).code === 'ENOENT';
      res.writeHead(missing ? 404 : 500);
      res.end(missing ? 'not found' : String((err as Error).stack));
    }
  })
  .listen(Number(process.argv[2] ?? 5317), '127.0.0.1');
