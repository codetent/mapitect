// Walks the official D2 AST and records, for every statement, which node or
// edge it touches and where it sits in the source. Semantics (labels, shapes,
// classes, globs, imports…) come from the compiler; this index exists so the
// preview can navigate to source and turn visual edits into text edits.

import {
  boxText,
  isEmptyBox,
  isGlob,
  RESERVED,
  segKey,
  span,
  valueRange,
  type AstMap,
  type KeyPath,
  type MapKey,
  type Span,
} from './ast.ts';

export interface EdgeRef {
  src: string[]; // resolved, unquoted segments
  dst: string[];
  srcArrow: boolean;
  dstArrow: boolean;
  range: Span; // `a -> b`
  srcRange: Span;
  dstRange: Span;
}

export interface Stmt {
  kind: 'node' | 'attr' | 'edge' | 'root';
  mk: MapKey;
  range: Span;
  scope: string[]; // container the statement is written in
  parent?: Stmt; // enclosing statement, if nested
  // node / attr
  node?: string[];
  attr?: string[];
  // edge statements (including `(a -> b)[0].x` references)
  edges?: EdgeRef[];
  edgeRef?: boolean;
}

export interface SourceIndex {
  stmts: Stmt[];
  // Declarations of a node whose value is a `{ … }` block, keyed by segKey.
  blocks: Map<string, Stmt[]>;
  // Edges in declaration order, matching the compiler's connection order.
  edges: { stmt: Stmt; i: number }[];
}

export function indexSource(ast: AstMap | undefined): SourceIndex {
  const index: SourceIndex = { stmts: [], blocks: new Map(), edges: [] };
  if (ast) walk(ast, [], undefined, index);
  return index;
}

function segsOf(kp: KeyPath): string[] {
  return kp.path.map((b) => boxText(b));
}

function resolve(scope: string[], kp: KeyPath): { node: string[]; attr: string[] } | null {
  if (kp.path.some(isGlob)) return null;
  const node = [...scope];
  const segs = segsOf(kp);
  let i = 0;
  while (i < segs.length && segs[i] === '_') {
    if (!node.length) return null;
    node.pop();
    i++;
  }
  const attr: string[] = [];
  for (; i < segs.length; i++) {
    if (attr.length || RESERVED.has(segs[i].toLowerCase())) attr.push(segs[i]);
    else node.push(segs[i]);
  }
  return { node, attr };
}

function walk(map: AstMap, scope: string[], parent: Stmt | undefined, index: SourceIndex): void {
  for (const n of map.nodes ?? []) {
    const mk = n.map_key;
    if (!mk) continue;
    const range = span(mk.range);

    if (mk.edges?.length) {
      const edges: EdgeRef[] = [];
      for (const e of mk.edges) {
        const s = resolve(scope, e.src);
        const d = resolve(scope, e.dst);
        if (!s || !d || s.attr.length || d.attr.length || !s.node.length || !d.node.length) {
          edges.length = 0;
          break;
        }
        edges.push({
          src: s.node,
          dst: d.node,
          srcArrow: e.src_arrow === '<',
          dstArrow: e.dst_arrow === '>',
          range: span(e.range),
          srcRange: span(e.src.range),
          dstRange: span(e.dst.range),
        });
      }
      if (!edges.length) continue;
      const stmt: Stmt = { kind: 'edge', mk, range, scope, parent, edges, edgeRef: !!mk.edge_index };
      index.stmts.push(stmt);
      if (!stmt.edgeRef) stmt.edges!.forEach((_, i) => index.edges.push({ stmt, i }));
      continue;
    }

    if (!mk.key) continue;
    const r = resolve(scope, mk.key);
    if (!r) continue;

    if (!r.node.length) {
      // Board-level keywords (direction, vars, classes, layers…): recorded, not descended into.
      index.stmts.push({ kind: 'root', mk, range, scope, parent, attr: r.attr });
      continue;
    }

    if (!r.attr.length) {
      const stmt: Stmt = { kind: 'node', mk, range, scope, parent, node: r.node };
      index.stmts.push(stmt);
      if (mk.value.map) {
        const key = segKey(r.node);
        index.blocks.set(key, [...(index.blocks.get(key) ?? []), stmt]);
        walk(mk.value.map, r.node, stmt, index);
      }
      continue;
    }

    const stmt: Stmt = { kind: 'attr', mk, range, scope, parent, node: r.node, attr: r.attr };
    index.stmts.push(stmt);
    if (mk.value.map) walkAttrs(mk.value.map, r.node, r.attr, stmt, index);
  }
}

// Inside `style: { … }` and friends every key is an attribute of the same node.
function walkAttrs(map: AstMap, node: string[], prefix: string[], parent: Stmt, index: SourceIndex): void {
  for (const n of map.nodes ?? []) {
    const mk = n.map_key;
    if (!mk?.key) continue;
    const attr = [...prefix, ...segsOf(mk.key)];
    const stmt: Stmt = { kind: 'attr', mk, range: span(mk.range), scope: node, parent, node, attr };
    index.stmts.push(stmt);
    if (mk.value.map) walkAttrs(mk.value.map, node, attr, stmt, index);
  }
}

// ----------------------------------------------------------------- queries

export function isWithinSegs(segs: string[], ancestor: string[]): boolean {
  if (segs.length < ancestor.length) return false;
  return ancestor.every((s, i) => s.toLowerCase() === segs[i].toLowerCase());
}

export function sameSegs(a: string[], b: string[]): boolean {
  return a.length === b.length && isWithinSegs(a, b);
}

// The label-carrying part of a node or edge statement: the primary value when
// the statement also has a block, otherwise the scalar value.
export function labelBox(mk: MapKey) {
  if (mk.value.map) return isEmptyBox(mk.primary) ? undefined : mk.primary;
  if (isEmptyBox(mk.value) || mk.value.null) return undefined;
  return mk.value;
}

export function labelSpan(mk: MapKey): Span | undefined {
  const box = labelBox(mk);
  const r = box && valueRange(box);
  return r ? span(r) : undefined;
}
