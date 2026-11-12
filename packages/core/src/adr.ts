// Architecture decision records.
//
// The diagram lists its ADR roots in a top-level variable, relative to the
// .d2 file (or absolute):
//
//   vars: {
//     adr-folders: [adr; ../shared/decisions]
//   }
//
// The roots hold MADR files (https://adr.github.io/madr/), in subfolders or
// not. Each file names the elements it applies to in its metadata; a file that
// names none is a system-wide decision:
//
//   ---
//   status: accepted
//   components: [gateway, shop.backend.orders]
//   ---
//
// Metadata is YAML front matter (MADR 3/4) or a bullet list under the title
// (MADR 2, "* Components: gateway, shop.backend.orders").

import type { Adr, AdrIndex, AdrStatus, DiagramModel, Problem, Severity, SourceRange } from './model.ts';
import * as path from './path.ts';
import type { FileSystem } from './ports.ts';
import { boxText, splitId, valueRange, type AstMap, type ValueBox } from './d2/ast.ts';

export const ADR_VAR = 'adr-folders';

export interface AdrFolderEntry {
  folder: string; // as written
  range?: string; // the value's range in the d2 source
}

// Reads `vars: { adr-folders: … }` from the top level of the file. The value is one
// folder or an array of them; like D2, the last declaration wins.
export function adrFolderEntries(ast: AstMap | undefined): AdrFolderEntry[] {
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
  const seen = new Set<string>();
  const entries: AdrFolderEntry[] = [];
  for (const v of values) {
    const folder = boxText(v).trim();
    if (!folder || seen.has(folder)) continue;
    seen.add(folder);
    entries.push({ folder, range: valueRange(v) });
  }
  return entries;
}

export function adrFoldersOf(ast: AstMap | undefined): string[] {
  return adrFolderEntries(ast).map((e) => e.folder);
}

// ------------------------------------------------------------------ scanning

// An ADR as read from disk, with what the checks need to point at.
export interface AdrFile {
  adr: Adr;
  root: string; // the absolute root it was found under
  ranges: Record<string, SourceRange>; // metadata key (and "title") -> where it is written
  hasComponents: boolean; // the metadata has a components entry, even an empty one
  brokenLinks: { target: string; range: SourceRange }[]; // relative links to files that don't exist
}

export interface AdrScan {
  files: AdrFile[];
  missingRoots: string[]; // roots, as written, that can't be read
}

const IGNORED_FILE = /^(readme|index|template|adr-template)\.md$/i;
const MAX_DEPTH = 5;

export async function scanAdrs(fs: FileSystem, baseDir: string, roots: string[]): Promise<AdrScan> {
  const files: AdrFile[] = [];
  const missingRoots: string[] = [];
  const links: { file: AdrFile; target: string; range: SourceRange }[] = [];
  const visit = async (root: string, abs: string, depth: number): Promise<boolean> => {
    let entries;
    try {
      entries = await fs.readDir(abs);
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const child = path.join(abs, entry.name);
      if (entry.kind === 'directory' && depth < MAX_DEPTH && entry.name !== 'node_modules') {
        await visit(root, child, depth + 1);
      } else if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md') && !IGNORED_FILE.test(entry.name)) {
        const parsed = parseMadrFile(await fs.readText(child), child);
        const file: AdrFile = { adr: parsed.adr, root, ranges: parsed.ranges, hasComponents: parsed.hasComponents, brokenLinks: [] };
        files.push(file);
        for (const link of parsed.links) links.push({ file, target: path.resolve(path.dirname(child), link.target), range: link.range });
      }
    }
    return true;
  };
  for (const root of roots) {
    const abs = path.resolve(baseDir, root);
    if (!(await visit(abs, abs, 0))) missingRoots.push(root);
  }
  const known = new Set(files.map((f) => path.normalize(f.adr.file)));
  for (const link of links) {
    if (!known.has(link.target) && !(await fs.exists(link.target))) {
      link.file.brokenLinks.push({ target: path.basename(link.target), range: link.range });
    }
  }
  return { files: files.sort((a, b) => byNumber(a.adr, b.adr)), missingRoots };
}

function byNumber(a: Adr, b: Adr): number {
  const na = a.number ? Number(a.number) : Infinity;
  const nb = b.number ? Number(b.number) : Infinity;
  return na - nb || a.name.localeCompare(b.name);
}

// ------------------------------------------------------------------ parsing

const STATUSES: AdrStatus[] = ['proposed', 'accepted', 'rejected', 'deprecated', 'superseded'];

export function parseMadr(text: string, file: string): Adr {
  return parseMadrFile(text, file).adr;
}

function parseMadrFile(
  text: string,
  file: string,
): { adr: Adr; ranges: Record<string, SourceRange>; hasComponents: boolean; links: { target: string; range: SourceRange }[] } {
  const source = text.replace(/\r\n?/g, '\n');
  let rest = source;
  const meta: Record<string, string[]> = {};

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
  if (bullets && /status|date|deciders|decision-makers|components/i.test(bullets[1])) {
    for (const line of bullets[1].split('\n')) {
      const m = /^[*-][ \t]+([A-Za-z][\w -]*?):[ \t]*(.*)$/.exec(line.trim());
      if (m) meta[m[1].trim().toLowerCase().replace(/\s+/g, '-')] ??= m[2].trim() ? [m[2].trim()] : [];
    }
    rest = rest.slice(bullets[0].length);
  }

  const one = (key: string) => meta[key]?.join(', ') || undefined;
  const statusText = one('status')?.trim();
  const lower = statusText?.toLowerCase() ?? '';
  const status = STATUSES.find((s) => lower.startsWith(s) || (s === 'superseded' && lower.includes('superseded'))) ?? 'unknown';
  const components = (meta.components ?? []).flatMap((c) => c.split(',')).map((c) => unquote(c.trim())).filter(Boolean);

  return {
    adr: {
      file,
      name,
      number: /^(\d+)[-_]/.exec(name)?.[1],
      title,
      status,
      statusText: statusText && statusText.toLowerCase() !== status ? statusText : undefined,
      date: one('date'),
      decisionMakers: one('decision-makers') ?? one('deciders'),
      consulted: one('consulted'),
      informed: one('informed'),
      components: [...new Set(components)],
      body: rest.trim(),
    },
    ranges: metadataRanges(source),
    hasComponents: 'components' in meta,
    links: linksOf(source),
  };
}

// A small YAML subset is enough for MADR metadata: scalars, [flow] lists and "- item" lists.
function parseFrontMatter(yaml: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let listKey: string | null = null;
  for (const line of yaml.split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      out[listKey].push(unquote(item[1].trim()));
      continue;
    }
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2].replace(/\s+#.*$/, '').trim();
    listKey = value ? null : key;
    const flow = /^\[(.*)\]$/.exec(value);
    out[key] = flow
      ? flow[1].split(',').map((v) => unquote(v.trim())).filter(Boolean)
      : value
        ? [unquote(value)]
        : [];
  }
  return out;
}

function unquote(v: string): string {
  if (/^"(.*)"$/.test(v)) {
    try {
      return JSON.parse(v) as string;
    } catch {
      return v.slice(1, -1);
    }
  }
  return v.replace(/^'(.*)'$/, '$1');
}

// Where the title and each metadata entry are written, for problems to point at.
function metadataRanges(text: string): Record<string, SourceRange> {
  const ranges: Record<string, SourceRange> = {};
  const lines = text.split('\n');
  let inFrontMatter = lines[0] === '---';
  for (let i = inFrontMatter ? 1 : 0; i < lines.length; i++) {
    const line = lines[i];
    if (inFrontMatter && line === '---') {
      inFrontMatter = false;
      continue;
    }
    if (!inFrontMatter && /^##\s/.test(line)) break; // the body starts
    const range = { line: i, col: 0, endLine: i, endCol: line.length };
    if (!inFrontMatter && /^#\s/.test(line)) ranges.title ??= range;
    const m = inFrontMatter ? /^([A-Za-z][\w-]*)\s*:/.exec(line) : /^\s*[*-][ \t]+([A-Za-z][\w -]*?):/.exec(line);
    if (m) ranges[m[1].trim().toLowerCase().replace(/\s+/g, '-')] ??= range;
  }
  return ranges;
}

// Relative links in the Markdown (outside code), for the broken-link check.
function linksOf(text: string): { target: string; range: SourceRange }[] {
  const links: { target: string; range: SourceRange }[] = [];
  let fenced = false;
  text.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) return;
    for (const m of line.matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
      const href = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) continue;
      let target = href.split(/[#?]/)[0];
      try {
        target = decodeURIComponent(target);
      } catch {
        // keep it as written
      }
      if (target) links.push({ target, range: { line: i, col: m.index!, endLine: i, endCol: m.index! + m[0].length } });
    }
  });
  return links;
}

// ------------------------------------------------------------------ matching

// Links every ADR to the elements its `components` name; ADRs that name none are
// system-wide. Also checks the files and reports what is wrong with them.
export function indexAdrs(scan: AdrScan, model: DiagramModel, roots: string[]): { index: AdrIndex; problems: Problem[] } {
  const resolveRef = resolver(model);
  const legacy = legacyMatcher(model);
  const components: Record<string, Adr[]> = {};
  const system: Adr[] = [];
  const problems: Problem[] = [];
  const report = (f: AdrFile, severity: Severity, message: string, range?: SourceRange) =>
    problems.push({ file: f.adr.file, severity, message, range: range ?? f.ranges.title ?? LINE_0, source: 'decisions' });

  for (const f of scan.files) {
    const { adr } = f;
    const ids = new Set<string>();
    for (const ref of adr.components) {
      const hit = resolveRef(ref);
      if (hit.id) ids.add(hit.id);
      else if (hit.ambiguous) report(f, 'warning', `"${ref}" matches several elements (${hit.ambiguous.join(', ')}); use the full id`, f.ranges.components);
      else report(f, 'warning', `No element "${ref}" in the diagram`, f.ranges.components);
    }
    for (const id of ids) (components[id] ??= []).push(adr);
    if (!adr.components.length) {
      system.push(adr);
      // Before `components`, the folder name chose the element: point out the field.
      const dir = path.dirname(adr.file).slice(f.root.length).replace(/^\/+/, '');
      const id = !f.hasComponents && dir ? legacy(dir) : undefined;
      if (id) {
        report(f, 'info', `Not linked to any element, so it is system-wide. Add "components: [${yamlId(id)}]" to link it to ${model.nodes[id].label.split('\n')[0]}`);
      }
    }

    if (adr.status === 'unknown') {
      if (adr.statusText) report(f, 'warning', `Unknown status "${adr.statusText}"; use ${STATUSES.join(', ')}`, f.ranges.status);
      else report(f, 'info', `No status; add one of ${STATUSES.join(', ')}`);
    }
    if (adr.date && !/^\d{4}-\d{2}-\d{2}$/.test(adr.date)) report(f, 'info', `Write the date as YYYY-MM-DD`, f.ranges.date);
    for (const link of f.brokenLinks) report(f, 'warning', `${link.target} does not exist`, link.range);
  }

  // Numbers only have to be unique within a folder.
  const byNumberInDir = new Map<string, AdrFile[]>();
  for (const f of scan.files) {
    if (!f.adr.number) continue;
    const key = `${path.dirname(f.adr.file)}\u0000${Number(f.adr.number)}`;
    byNumberInDir.set(key, [...(byNumberInDir.get(key) ?? []), f]);
  }
  for (const same of byNumberInDir.values()) {
    if (same.length < 2) continue;
    for (const f of same) {
      const others = same.filter((o) => o !== f).map((o) => o.adr.name);
      report(f, 'warning', `ADR-${f.adr.number} is also the number of ${others.join(', ')}`);
    }
  }

  for (const list of Object.values(components)) list.sort(byNumber);
  system.sort(byNumber);
  return { index: { components, system, roots }, problems };
}

const LINE_0: SourceRange = { line: 0, col: 0, endLine: 0, endCol: 0 };

// A component reference is an element's full id or, when only one element has
// it, its key. Both ignore case.
function resolver(model: DiagramModel): (ref: string) => { id?: string; ambiguous?: string[] } {
  const nodes = Object.values(model.nodes);
  const norm = (id: string) => splitId(id).map((s) => s.toLowerCase()).join('\u0000');
  const byId = new Map(nodes.map((n) => [norm(n.id), n.id]));
  const byKey = groupBy(nodes, (n) => n.key.toLowerCase());
  return (ref) => {
    if (model.nodes[ref]) return { id: ref };
    const id = byId.get(norm(ref));
    if (id) return { id };
    const segs = splitId(ref);
    const keyed = segs.length === 1 ? (byKey.get(segs[0].toLowerCase()) ?? []) : [];
    if (keyed.length === 1) return { id: keyed[0].id };
    return keyed.length ? { ambiguous: keyed.map((n) => n.id) } : {};
  };
}

// How folders used to pick their element: by full id, a path mirroring the
// nesting, a unique key or a unique label.
function legacyMatcher(model: DiagramModel): (dir: string) => string | undefined {
  const nodes = Object.values(model.nodes);
  const fullIds = new Map(nodes.map((n) => [splitId(n.id).map((s) => s.toLowerCase()).join('.'), n.id]));
  const byKey = groupBy(nodes, (n) => n.key.toLowerCase());
  const byLabel = groupBy(nodes, (n) => slug(n.label));
  const unique = (list: { id: string }[] | undefined) => (list?.length === 1 ? list[0].id : undefined);
  return (dir) => {
    const base = dir.split('/').pop()!;
    return (
      fullIds.get(dir.toLowerCase().split('/').join('.')) ??
      fullIds.get(base.toLowerCase()) ??
      unique(byKey.get(base.toLowerCase())) ??
      unique(byLabel.get(slug(base)))
    );
  };
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

// An element id as a YAML flow-list item.
function yamlId(id: string): string {
  return /^[\w][\w./ -]*$/.test(id) && !id.endsWith(' ') ? id : JSON.stringify(id);
}

// ------------------------------------------------------------------ creating

export interface NewAdr {
  file: string; // absolute path of the file to create
  text: string;
  cursor: number; // line to put the cursor on: the context placeholder
}

// Plans the next decision for an element, or a system-wide one when `id` is
// null. It goes next to the existing decisions of the same element (or the
// other system-wide ones), preferring the first root, and otherwise straight
// into the first root. It is numbered after the highest number in that folder.
export function planNewAdr(opts: {
  baseDir: string;
  roots: string[];
  model: DiagramModel;
  id: string | null;
  existing: Adr[]; // the element's decisions, or the system-wide ones
  all: Adr[]; // every decision, for the numbering
  title: string;
  date: string; // YYYY-MM-DD
}): NewAdr {
  const { model, id, existing } = opts;
  const roots = opts.roots.map((r) => path.resolve(opts.baseDir, r));
  if (!roots.length) throw new Error(`Add ${ADR_VAR} to the file's vars to record decisions`);
  if (id !== null && !model.nodes[id]) throw new Error(`Unknown element ${id}`);

  const dirs = existing.map((a) => path.dirname(a.file));
  const dir = roots.map((root) => dirs.find((d) => path.isWithin(root, d))).find(Boolean) ?? dirs[0] ?? roots[0];

  const numbers = opts.all.filter((a) => path.dirname(a.file) === dir && a.number).map((a) => a.number!);
  const next = Math.max(0, ...numbers.map(Number)) + 1;
  const width = Math.max(4, ...numbers.map((n) => n.length));
  const name = `${String(next).padStart(width, '0')}-${slug(opts.title) || 'decision'}.md`;

  const lines = [
    '---',
    'status: proposed',
    `date: ${opts.date}`,
    'decision-makers:',
    ...(id !== null ? [`components: [${yamlId(id)}]`] : []),
    '---',
    '',
    `# ${opts.title.trim()}`,
    '',
    '## Context and Problem Statement',
    '',
    '{Describe the context and the problem this decision solves.}',
    '',
    '## Considered Options',
    '',
    '* {Option 1}',
    '* {Option 2}',
    '',
    '## Decision Outcome',
    '',
    'Chosen option: "{Option 1}", because {justification}.',
    '',
    '### Consequences',
    '',
    '* Good, because {positive consequence}',
    '* Bad, because {negative consequence}',
    '',
  ];
  return { file: path.join(dir, name), text: lines.join('\n'), cursor: lines.indexOf('## Context and Problem Statement') + 2 };
}
