// Minimal typings and helpers for the d2ast JSON produced by the official
// D2 compiler (@d2lang/d2). Ranges look like "index,L:C:O-L:C:O" where O is a
// UTF-16 offset into the source, i.e. directly usable as a JS string index.

export interface Span {
  start: number;
  end: number;
}

interface StringPart {
  string?: string;
  raw_string?: string;
  substitution?: unknown;
}

interface AstString {
  range: string;
  value: StringPart[] | string;
}

export interface StringBox {
  unquoted_string?: AstString;
  double_quoted_string?: AstString;
  single_quoted_string?: AstString;
  block_string?: AstString & { tag?: string; quote?: string };
}

export interface ValueBox extends StringBox {
  map?: AstMap;
  array?: { range: string; nodes?: ValueBox[] };
  number?: { range: string; raw: string };
  boolean?: { range: string; value: boolean };
  null?: { range: string };
  import?: { range: string };
}

export interface KeyPath {
  range: string;
  path: StringBox[];
}

export interface AstEdge {
  range: string;
  src: KeyPath;
  src_arrow: string;
  dst: KeyPath;
  dst_arrow: string;
}

export interface MapKey {
  range: string;
  ampersand?: boolean;
  not_ampersand?: boolean;
  key?: KeyPath;
  edges?: AstEdge[];
  edge_index?: { range: string; int?: number; glob?: boolean };
  edge_key?: KeyPath;
  primary: ValueBox;
  value: ValueBox;
}

export interface AstMap {
  range: string;
  // omitted by the compiler for empty maps
  nodes?: Array<{ map_key?: MapKey; comment?: unknown; block_comment?: unknown; import?: unknown }>;
}

export function span(range: string): Span {
  const m = /(\d+):(\d+):(\d+)-(\d+):(\d+):(\d+)$/.exec(range);
  if (!m) return { start: 0, end: 0 };
  return { start: Number(m[3]), end: Number(m[6]) };
}

export function lineCol(range: string): { line: number; col: number; endLine: number; endCol: number } {
  const m = /(\d+):(\d+):(\d+)-(\d+):(\d+):(\d+)$/.exec(range);
  if (!m) return { line: 0, col: 0, endLine: 0, endCol: 0 };
  return { line: +m[1], col: +m[2], endLine: +m[4], endCol: +m[5] };
}

function stringOf(box: StringBox): AstString | undefined {
  return box.unquoted_string ?? box.double_quoted_string ?? box.single_quoted_string ?? box.block_string;
}

export function boxText(box: StringBox): string {
  const s = stringOf(box);
  if (!s) return '';
  if (typeof s.value === 'string') return s.value;
  return s.value.map((p) => p.string ?? (p.substitution ? '${…}' : '')).join('');
}

export function isGlob(box: StringBox): boolean {
  const s = box.unquoted_string;
  return !!s && boxText(s as StringBox).includes('*');
}

export function hasSubstitution(box: StringBox): boolean {
  const s = stringOf(box);
  return !!s && Array.isArray(s.value) && s.value.some((p) => p.substitution);
}

// The range of whichever scalar/map/array a value box holds.
export function valueRange(box: ValueBox | undefined): string | undefined {
  if (!box) return undefined;
  const v =
    box.map ?? box.array ?? box.number ?? box.boolean ?? box.null ?? box.import ?? stringOf(box);
  return v?.range;
}

export function isEmptyBox(box: ValueBox | undefined): boolean {
  return !valueRange(box);
}

// --------------------------------------------------------------- key texts

// Split an absolute D2 id such as `shop."a.b".x` into unquoted segments.
export function splitId(id: string): string[] {
  const segs: string[] = [];
  let i = 0;
  while (i < id.length) {
    const q = id[i];
    if (q === '"' || q === "'") {
      let s = '';
      i++;
      while (i < id.length && id[i] !== q) {
        if (id[i] === '\\' && q === '"') i++;
        s += id[i++];
      }
      i++; // closing quote
      segs.push(s);
    } else {
      const dot = id.indexOf('.', i);
      const end = dot < 0 ? id.length : dot;
      segs.push(id.slice(i, end).trim());
      i = end;
    }
    if (id[i] === '.') i++;
  }
  return segs;
}

// Case-insensitive identity, as D2 resolves keys case-insensitively.
export function segKey(segs: string[]): string {
  return segs.map((s) => s.toLowerCase()).join('\u0001');
}

const SAFE_KEY = /^[\p{L}\p{N}_][\p{L}\p{N}_ \-+]*$/u;

export function formatKeySeg(seg: string): string {
  if (SAFE_KEY.test(seg) && !seg.endsWith(' ') && !RESERVED.has(seg.toLowerCase()) && seg !== '_') return seg;
  return `"${seg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function formatKey(segs: string[]): string {
  return segs.map(formatKeySeg).join('.');
}

const SAFE_VALUE = /^[^\s;{}#|"'`\[\]$][^;{}\n|"`$]*$/;

export function formatValue(value: string): string {
  const v = value.trim();
  if (!v) return '""';
  if (SAFE_VALUE.test(v) && !/\s#/.test(v) && v !== 'null' && !v.endsWith(' ')) return v;
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export const RESERVED = new Set([
  'label', 'shape', 'icon', 'tooltip', 'link', 'near', 'style', 'class', 'classes', 'vars', 'direction',
  'width', 'height', 'constraint', 'top', 'left', 'source-arrowhead', 'target-arrowhead', 'grid-rows',
  'grid-columns', 'grid-gap', 'vertical-gap', 'horizontal-gap', 'layers', 'scenarios', 'steps', 'filled',
  'icon-position', 'label-position', 'tooltip-position', 'legend-label', 'suspend', 'unsuspend',
]);
