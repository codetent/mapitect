// Dev-only: serves the harness and plays the host with the real core session
// against in-memory copies of the files in examples/. It never writes to disk.
// Run with `node packages/dev/server.mts [port]` after `npm run build`.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  applyEdits,
  CompileCache,
  D2Compiler,
  DiagramSession,
  paths,
  type DiagramDocument,
  type FileSystem,
  type HostMessage,
  type HostShell,
  type TextEdit,
  type UiMessage,
} from '@mapitect/core';
import { createNodeD2, nodeFileSystem } from '@mapitect/core/node';

const root = path.resolve(import.meta.dirname, '../..');
const examples = path.join(root, 'examples');

const readOnly: FileSystem = {
  ...nodeFileSystem,
  writeText: async () => {
    throw new Error('The dev server never writes to disk');
  },
  mkdir: async () => {
    throw new Error('The dev server never writes to disk');
  },
};

class MemoryDocument implements DiagramDocument {
  version = 1;
  readonly path: string;
  private text: string;

  constructor(path: string, text: string) {
    this.path = path;
    this.text = text;
  }

  get id(): string {
    return `file://${this.path}`;
  }

  getText(): string {
    return this.text;
  }

  setText(text: string): void {
    this.text = text;
    this.version++;
  }

  async applyEdits(edits: TextEdit[]): Promise<boolean> {
    this.setText(applyEdits(this.text, edits));
    return true;
  }
}

interface Open {
  doc: MemoryDocument;
  session: DiagramSession<MemoryDocument>;
  clients: Set<http.ServerResponse>;
}

const cache = new CompileCache<MemoryDocument>(new D2Compiler(createNodeD2), readOnly);
const open = new Map<string, Open>();
cache.onDidUpdate(({ doc, state }) => open.get(doc.id)?.session.update(state));

function shell(clients: Set<http.ServerResponse>): HostShell {
  const post = (msg: HostMessage) => {
    for (const res of clients) res.write(`data: ${JSON.stringify(msg)}\n\n`);
  };
  const ignore = async () => {}; // editors, dialogs and links need a real host
  return {
    post,
    config: () => ({}),
    workspaceRoots: () => [examples],
    assetUrl: (file) => (paths.isWithin(root, file) ? `/${path.relative(root, file)}` : file),
    showSource: ignore,
    highlightSource: ignore,
    openFile: ignore,
    openExternal: ignore,
    editFile: ignore,
    saveImage: ignore,
    askText: async () => {
      post({ type: 'toast', message: 'New decisions are created in VS Code' });
      return undefined;
    },
    showError: (message) => post({ type: 'toast', message }),
  };
}

async function load(name: string): Promise<Open> {
  const file = path.join(examples, path.basename(name)).replaceAll('\\', '/'); // the core's path style
  let entry = open.get(`file://${file}`);
  if (!entry) {
    const doc = new MemoryDocument(file, await readFile(file, 'utf8'));
    const clients = new Set<http.ServerResponse>();
    entry = { doc, session: new DiagramSession(doc, cache, readOnly, shell(clients)), clients };
    open.set(doc.id, entry);
  }
  return entry;
}

async function api(route: string, body: Record<string, unknown>): Promise<unknown> {
  const { doc, session } = await load(String(body.file ?? 'platform.d2'));
  switch (route) {
    case 'message': {
      const msg = body.msg as UiMessage;
      // Reloading drops the in-memory copy: read the file again.
      if (msg.type === 'reload') doc.setText(await readFile(doc.path, 'utf8'));
      await session.receive(msg);
      return {};
    }
    case 'text':
      if (typeof body.text === 'string') {
        doc.setText(body.text);
        void cache.refresh(doc);
      }
      return { text: doc.getText() };
  }
  throw Object.assign(new Error(`unknown route ${route}`), { code: 'ENOENT' });
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.d2': 'text/plain', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/api/events') {
        const { clients } = await load(url.searchParams.get('file') ?? 'platform.d2');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const out = await api(url.pathname.slice(5), raw ? JSON.parse(raw) : {});
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(out));
        return;
      }
      const file = path.join(root, path.normalize(url.pathname === '/' ? '/packages/dev/index.html' : url.pathname));
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
