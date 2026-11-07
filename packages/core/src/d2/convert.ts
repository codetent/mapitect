import type { CompileResponse, Connection, Shape } from '@d2lang/d2';
import { LIFECYCLES, type DiagramEdge, type DiagramModel, type DiagramNode, type Direction, type Lifecycle, type ParseIssue, type SourceRange, type TableField } from '../model.ts';
import { boxText, segKey, span, splitId, valueRange, type Span } from './ast.ts';
import { indexSource, type SourceIndex, type Stmt } from './source.ts';
import { adrFoldersOf } from '../adr.ts';

export interface Built {
  model: DiagramModel;
  index: SourceIndex;
  // compiler connection id -> the edge in the source that declared it
  edgeSites: Map<string, { stmt: Stmt; i: number }>;
  // segKey -> canonical node id
  ids: Map<string, string>;
  // ADR roots from `vars.adr-folders`, as written
  adrFolders: string[];
}

// D2 theme colour codes (N1…N7, B1…B6, AA2…) mean "not set by the user".
const THEME_COLOR = /^(N[1-7]|B[1-6]|A[AB]\d)$/;
const DIRECTIONS = new Set(['up', 'down', 'left', 'right']);

export function buildModel(res: CompileResponse, text: string): Built {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const toRange = (s: Span): SourceRange => {
    const a = locate(lineStarts, s.start);
    const b = locate(lineStarts, s.end);
    return { line: a.line, col: a.col, endLine: b.line, endCol: b.col };
  };

  const index = indexSource(res.graph.ast);
  const ids = new Map<string, string>();
  const nodes: Record<string, DiagramNode> = {};
  const roots: string[] = [];

  for (const shape of res.diagram.shapes as (Shape & Partial<TextFields>)[]) {
    const segs = splitId(shape.id);
    ids.set(segKey(segs), shape.id);
    const parent = segs.length > 1 ? (ids.get(segKey(segs.slice(0, -1))) ?? null) : null;
    nodes[shape.id] = {
      id: shape.id,
      key: segs[segs.length - 1],
      parent,
      children: [],
      label: shape.label ?? segs[segs.length - 1],
      labelFormat: shape.language === 'markdown' ? 'md' : shape.language || undefined,
      shape: shape.type || 'rectangle',
      style: shapeStyle(shape),
      icon: iconUrl(shape.icon),
      tooltip: shape.tooltip || undefined,
      link: shape.link || undefined,
      classes: shape.classes ?? [],
      fields: fieldsOf(shape),
      range: { line: 0, col: 0, endLine: 0, endCol: 0 },
    };
    if (parent && nodes[parent]) nodes[parent].children.push(shape.id);
    else roots.push(shape.id);
  }

  // Source locations: prefer a plain declaration, then an attribute, then an edge endpoint.
  const lineIndex: Record<number, string> = {};
  const issues: ParseIssue[] = [];
  const ownStatus = new Map<string, Lifecycle>(); // the last `vars: {status: …}` per element wins
  const located = new Map<string, number>(); // id -> priority of the range we stored
  const place = (id: string | undefined, span: Span, priority: number) => {
    if (!id || !nodes[id]) return;
    if ((located.get(id) ?? 99) <= priority) return;
    located.set(id, priority);
    nodes[id].range = toRange(span);
  };
  for (const stmt of index.stmts) {
    if (stmt.kind === 'node' || stmt.kind === 'attr') {
      const id = ids.get(segKey(stmt.node!));
      if (!id) continue;
      place(id, stmt.range, stmt.kind === 'node' ? 0 : 1);
      if (stmt.kind === 'attr' && stmt.attr![0].toLowerCase() === 'near' && !stmt.mk.value.map) {
        nodes[id].near = boxText(stmt.mk.value);
      }
      if (stmt.kind === 'attr' && isVar(stmt.attr!, 'technology') && !stmt.mk.value.map) {
        nodes[id].technology = boxText(stmt.mk.value).trim() || undefined; // the last one wins
      }
      if (stmt.kind === 'attr' && isVar(stmt.attr!, 'status') && !stmt.mk.value.map) {
        const value = boxText(stmt.mk.value).trim().toLowerCase() as Lifecycle;
        if (LIFECYCLES.includes(value)) ownStatus.set(id, value);
        else {
          issues.push({
            severity: 'warning',
            message: `Unknown status "${boxText(stmt.mk.value)}"; use ${LIFECYCLES.join(', ')}`,
            range: toRange(span(valueRange(stmt.mk.value) ?? stmt.mk.range)),
          });
        }
      }
      lineIndex[toRange(stmt.range).line] ??= id;
    } else if (stmt.kind === 'edge') {
      for (const e of stmt.edges!) {
        place(ids.get(segKey(e.src)), e.srcRange, 2);
        place(ids.get(segKey(e.dst)), e.dstRange, 2);
      }
    }
  }

  // A status applies to everything inside the element, until a descendant sets its own.
  // Shapes come out parents first, so a parent is resolved before its children.
  for (const shape of res.diagram.shapes) {
    const node = nodes[shape.id];
    const own = ownStatus.get(node.id);
    const parent = node.parent ? nodes[node.parent] : undefined;
    if (own) node.status = own;
    else if (parent?.status) {
      node.status = parent.status;
      node.statusFrom = parent.statusFrom ?? parent.id;
    }
  }

  // Connections come out in declaration order; match them to source edges by endpoints.
  const pending = new Map<string, { stmt: Stmt; i: number }[]>();
  for (const site of index.edges) {
    const e = site.stmt.edges![site.i];
    const key = `${segKey(e.src)}\u0000${segKey(e.dst)}`;
    pending.set(key, [...(pending.get(key) ?? []), site]);
  }
  const edgeSites = new Map<string, { stmt: Stmt; i: number }>();
  const edges: DiagramEdge[] = [];
  for (const c of res.diagram.connections) {
    const key = `${segKey(splitId(c.src))}\u0000${segKey(splitId(c.dst))}`;
    const site = pending.get(key)?.shift();
    const range = site ? toRange(site.stmt.range) : { line: 0, col: 0, endLine: 0, endCol: 0 };
    if (site) {
      edgeSites.set(c.id, site);
      lineIndex[range.line] ??= `edge:${c.id}`;
    }
    edges.push(edgeOf(c, range));
  }

  const root = res.graph.root as { attributes?: { direction?: { value?: string } } } | undefined;
  const dir = root?.attributes?.direction?.value ?? '';
  return {
    model: {
      direction: (DIRECTIONS.has(dir) ? dir : 'down') as Direction,
      nodes,
      roots,
      edges,
      issues,
      valid: true,
      lineIndex,
    },
    index,
    edgeSites,
    ids,
    adrFolders: adrFoldersOf(res.graph.ast),
  };
}

// `vars: {<name>: …}` inside an element's block, or `x.vars: {<name>: …}`.
function isVar(attr: string[], name: string): boolean {
  return attr.length === 2 && attr[0].toLowerCase() === 'vars' && attr[1].toLowerCase() === name;
}

function edgeOf(c: Connection, range: SourceRange): DiagramEdge {
  const src = c.srcArrow !== 'none';
  const dst = c.dstArrow !== 'none';
  // `a <- b` is drawn as b -> a so layered layout flows with the arrow.
  const flip = src && !dst;
  return {
    id: c.id,
    source: flip ? c.dst : c.src,
    target: flip ? c.src : c.dst,
    label: c.label || undefined,
    srcArrow: flip ? false : src,
    dstArrow: flip ? true : dst,
    srcArrowhead: flip ? undefined : arrowhead(c.srcArrow),
    dstArrowhead: arrowhead(flip ? c.srcArrow : c.dstArrow),
    style: lineStyle(c),
    range,
  };
}

function arrowhead(a: string): string | undefined {
  return a === 'none' || a === 'triangle' ? undefined : a;
}

function color(v: string | undefined): string | undefined {
  return v && !THEME_COLOR.test(v) && v !== 'transparent' ? v : undefined;
}

function lineStyle(c: Connection): Record<string, string> {
  const style: Record<string, string> = {};
  const stroke = color(c.stroke);
  if (stroke) style.stroke = stroke;
  if (c.strokeDash) style['stroke-dash'] = String(c.strokeDash);
  if (c.strokeWidth && c.strokeWidth !== 2) style['stroke-width'] = String(c.strokeWidth);
  if (c.opacity !== undefined && c.opacity !== 1) style.opacity = String(c.opacity);
  if (c.animated) style.animated = 'true';
  return style;
}

// Text properties every shape carries, though the typings only put them on the Text variant.
interface TextFields {
  label: string;
  language: string;
  color: string;
  italic: boolean;
  underline: boolean;
}

function shapeStyle(s: Shape & Partial<TextFields>): Record<string, string> {
  const style: Record<string, string> = {};
  const fill = color(s.fill);
  const stroke = color(s.stroke);
  const font = color(s.color);
  if (fill) style.fill = fill;
  if (stroke) style.stroke = stroke;
  if (font) style['font-color'] = font;
  if (s.strokeDash) style['stroke-dash'] = String(s.strokeDash);
  if (s.strokeWidth && s.strokeWidth !== 2) style['stroke-width'] = String(s.strokeWidth);
  if (s.opacity !== undefined && s.opacity !== 1) style.opacity = String(s.opacity);
  if (s.multiple) style.multiple = 'true';
  if (s['3d']) style['3d'] = 'true';
  if (s.animated) style.animated = 'true';
  if (s.italic) style.italic = 'true';
  if (s.underline) style.underline = 'true';
  return style;
}

function fieldsOf(s: Shape): TableField[] | undefined {
  const table = s as Partial<{ columns: { name: { label: string }; type: { label: string }; constraint?: string[] }[] }>;
  if (s.type === 'sql_table') {
    return (table.columns ?? []).map((c) => ({ name: c.name.label, type: c.type.label, constraint: c.constraint?.[0] }));
  }
  const cls = s as Partial<{ fields: { name: string; type: string; visibility: string }[]; methods: { name: string; return: string; visibility: string }[] }>;
  if (s.type === 'class' && (cls.fields || cls.methods)) {
    const vis = (v: string) => ({ public: '+', private: '-', protected: '#' })[v] ?? '';
    return [
      ...(cls.fields ?? []).map((f) => ({ name: `${vis(f.visibility)}${f.name}`, type: f.type })),
      ...(cls.methods ?? []).map((m) => ({ name: `${vis(m.visibility)}${m.name}`, type: m.return })),
    ];
  }
  return undefined;
}

// The compiler serialises Go's url.URL struct.
function iconUrl(u: unknown): string | undefined {
  if (!u) return undefined;
  if (typeof u === 'string') return u;
  const url = u as Record<string, string>;
  const scheme = url.Scheme ? `${url.Scheme}:` : '';
  const host = url.Host ? `//${url.Host}` : '';
  const query = url.RawQuery ? `?${url.RawQuery}` : '';
  const frag = url.Fragment ? `#${url.Fragment}` : '';
  return `${scheme}${host}${url.Path || url.Opaque || ''}${query}${frag}` || undefined;
}

function locate(lineStarts: number[], offset: number): { line: number; col: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, col: offset - lineStarts[lo] };
}

