// Architecture decision records per component.
//
// The diagram lists its ADR roots in a top-level variable, relative to the
// .d2 file (or absolute):
//
//   vars: {
//     adr-folders: [adr; ../shared/decisions]
//   }
//
// Each root holds one folder per component, with MADR files inside:
//
//   adr/
//     bff/                      <- matches the element whose key is "bff"
//       0001-compose-with-hive-gateway.md
//     k2.services.content/      <- or the full element id
//     k2/frontends/ui/          <- or a path mirroring the diagram's nesting
//
// Files follow MADR (https://adr.github.io/madr/): metadata in YAML front
// matter (MADR 3/4) or as a bullet list under the title (MADR 2).

import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Adr, AdrIndex, AdrStatus, DiagramModel } from './model.ts';
import { boxText, splitId, type AstMap, type ValueBox } from './d2/ast.ts';

export const ADR_VAR = 'adr-folders';

// Reads `vars: { adr-folders: … }` from the top level of the file. The value is one
// folder or an array of them; like D2, the last declaration wins.
export function adrFoldersOf(ast: AstMap | undefined): string[] {
  let found: ValueBox | undefined;
  for (const n of ast?.nodes ?? []) {
    const mk = n.map_key;
    const key = mk?.key?.path;
    if (!mk?.value.map || key?.length !== 1 || boxText(key[0]).toLowerCase() !== 'vars') continue;
    for (const v of mk.value.map.nodes ?? []) {
      const name = v.map_key?.key?.path;
      if (name?.length === 1 && boxText(name[0]).toLowerCase() === ADR_VAR) found = v.map_key!.value;
    }
  }
  const values = found?.array ? (found.array.nodes ?? []) : found ? [found] : [];
  return [...new Set(values.map((v) => boxText(v).trim()).filter(Boolean))];
}

export interface AdrFolder {
  dir: string; // relative to its root, '/'-separated; '' for files directly in the root
  adrs: Adr[];
}

const IGNORED_FILE = /^(readme|index|template|adr-template)\.md$/i;
const MAX_DEPTH = 5;

export async function scanAdrFolders(baseDir: string, roots: string[]): Promise<AdrFolder[]> {
  const folders: AdrFolder[] = [];
  const visit = async (abs: string, rel: string, depth: number) => {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      return; // a missing root is fine
    }
    const adrs: Adr[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const child = path.join(abs, entry.name);
      if (entry.isDirectory() && depth < MAX_DEPTH && entry.name !== 'node_modules') {
        await visit(child, rel ? `${rel}/${entry.name}` : entry.name, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md') && !IGNORED_FILE.test(entry.name)) {
        adrs.push(parseMadr(await readFile(child, 'utf8'), child));
      }
    }
    if (adrs.length) folders.push({ dir: rel, adrs: adrs.sort(byNumber) });
  };
  for (const root of roots) await visit(path.resolve(baseDir, root), '', 0);
  return folders;
}

function byNumber(a: Adr, b: Adr): number {
  const na = a.number ? Number(a.number) : Infinity;
  const nb = b.number ? Number(b.number) : Infinity;
  return na - nb || a.name.localeCompare(b.name);
}

// ------------------------------------------------------------------ parsing

const STATUSES: AdrStatus[] = ['proposed', 'accepted', 'rejected', 'deprecated', 'superseded'];

export function parseMadr(text: string, file: string): Adr {
  let rest = text.replace(/\r\n?/g, '\n');
  const meta: Record<string, string> = {};

  // MADR 3/4: YAML front matter.
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(rest);
  if (fm) {
    Object.assign(meta, parseFrontMatter(fm[1]));
    rest = rest.slice(fm[0].length);
  }

  const heading = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(rest);
  const name = path.basename(file);
  const title = heading ? heading[1].trim() : name.replace(/\.md$/i, '').replace(/^\d+[-_]/, '').replace(/[-_]/g, ' ');
  if (heading) rest = rest.slice(0, heading.index) + rest.slice(heading.index + heading[0].length);

  // MADR 2: "* Status: accepted" style bullets right below the title.
  const bullets = /^\s*((?:[*-][ \t]+[A-Za-z][\w -]*:[^\n]*\n?)+)/.exec(rest);
  if (bullets && /status|date|deciders|decision-makers/i.test(bullets[1])) {
    for (const line of bullets[1].split('\n')) {
      const m = /^[*-][ \t]+([A-Za-z][\w -]*?):[ \t]*(.*)$/.exec(line.trim());
      if (m) meta[m[1].trim().toLowerCase().replace(/\s+/g, '-')] ??= m[2].trim();
    }
    rest = rest.slice(bullets[0].length);
  }

  const statusText = meta.status?.trim();
  const lower = statusText?.toLowerCase() ?? '';
  const status = STATUSES.find((s) => lower.startsWith(s) || (s === 'superseded' && lower.includes('superseded'))) ?? 'unknown';

  return {
    file,
    name,
    number: /^(\d+)[-_]/.exec(name)?.[1],
    title,
    status,
    statusText: statusText && statusText.toLowerCase() !== status ? statusText : undefined,
    date: meta.date,
    decisionMakers: meta['decision-makers'] ?? meta.deciders,
    consulted: meta.consulted,
    informed: meta.informed,
    body: rest.trim(),
  };
}

// A small YAML subset is enough for MADR metadata: scalars, [flow] lists and "- item" lists.
function parseFrontMatter(yaml: string): Record<string, string> {
  const out: Record<string, string> = {};
  let listKey: string | null = null;
  for (const line of yaml.split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      out[listKey] = out[listKey] ? `${out[listKey]}, ${unquote(item[1])}` : unquote(item[1]);
      continue;
    }
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2].replace(/\s+#.*$/, '').trim();
    listKey = value ? null : key;
    const flow = /^\[(.*)\]$/.exec(value);
    out[key] = flow ? flow[1].split(',').map((v) => unquote(v.trim())).filter(Boolean).join(', ') : unquote(value);
  }
  return out;
}

function unquote(v: string): string {
  return v.replace(/^(['"])(.*)\1$/, '$2');
}

// ------------------------------------------------------------------ matching

export function assignAdrs(folders: AdrFolder[], model: DiagramModel, roots: string[]): AdrIndex {
  const nodes = Object.values(model.nodes);
  const fullIds = new Map(nodes.map((n) => [splitId(n.id).map((s) => s.toLowerCase()).join('.'), n.id]));
  const byKey = groupBy(nodes, (n) => n.key.toLowerCase());
  const byLabel = groupBy(nodes, (n) => slug(n.label));

  const components: Record<string, Adr[]> = {};
  const unmatched: string[] = [];
  for (const folder of folders) {
    const id = matchFolder(folder.dir, fullIds, byKey, byLabel);
    if (!id) {
      unmatched.push(folder.dir || '.');
      continue;
    }
    components[id] = [...(components[id] ?? []), ...folder.adrs].sort(byNumber);
  }
  return { components, unmatched, roots };
}

function matchFolder(
  dir: string,
  fullIds: Map<string, string>,
  byKey: Map<string, { id: string }[]>,
  byLabel: Map<string, { id: string }[]>,
): string | undefined {
  if (!dir) return undefined;
  const asPath = dir.toLowerCase().split('/').join('.'); // k2/services/content
  const base = dir.split('/').pop()!;
  const unique = (list: { id: string }[] | undefined) => (list?.length === 1 ? list[0].id : undefined);
  return (
    fullIds.get(asPath) ??
    fullIds.get(base.toLowerCase()) ?? // k2.services.content
    unique(byKey.get(base.toLowerCase())) ?? // content
    unique(byLabel.get(slug(base))) // content-service, when the label is "Content Service"
  );
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return map;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
