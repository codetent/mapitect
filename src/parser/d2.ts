// A hand-written parser for the subset of the D2 language (https://d2lang.com)
// that matters for architecture diagrams: nested containers, edges and edge
// chains, labels, shapes, styles, classes, vars, sql_table / class shapes.

import type {
  DiagramEdge,
  DiagramModel,
  DiagramNode,
  Direction,
  ParseIssue,
  Severity,
  SourceRange,
} from '../model.ts';

const RESERVED = new Set([
  'label', 'shape', 'icon', 'tooltip', 'link', 'near', 'style', 'class', 'classes', 'vars',
  'direction', 'width', 'height', 'constraint', 'top', 'left', 'source-arrowhead', 'target-arrowhead',
  'grid-rows', 'grid-columns', 'grid-gap', 'vertical-gap', 'horizontal-gap', 'layers', 'scenarios',
  'steps', 'filled',
]);

const IGNORED_NODE_ATTRS = new Set([
  'width', 'height', 'top', 'left', 'grid-rows', 'grid-columns', 'grid-gap', 'vertical-gap', 'horizontal-gap',
]);

export const KNOWN_SHAPES = new Set([
  'rectangle', 'square', 'page', 'parallelogram', 'document', 'cylinder', 'queue', 'package', 'step',
  'callout', 'stored_data', 'person', 'c4-person', 'diamond', 'oval', 'circle', 'hexagon', 'cloud', 'text',
  'code', 'class', 'sql_table', 'image',
]);

const DIRECTIONS = new Set<Direction>(['up', 'down', 'left', 'right']);

type Value =
  | { kind: 'string'; text: string; format?: string }
  | { kind: 'array'; items: string[] }
  | { kind: 'null' };

interface Segment {
  text: string;
  start: number;
  end: number;
}

interface KeyChain {
  paths: Segment[][];
  ops: string[];
}

type AttrTarget =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; edge: DiagramEdge }
  | { kind: 'class'; name: string };

type Scope =
  | { kind: 'node'; path: string[] }
  | { kind: 'attrs'; targets: AttrTarget[]; prefix: string[] }
  | { kind: 'classes' }
  | { kind: 'vars'; prefix: string[] }
  | { kind: 'skip' };

interface ClassOp {
  path: string[];
  value: Value;
  range: SourceRange;
}

export function parseD2(source: string): DiagramModel {
  return new D2Parser(source).parse();
}

class D2Parser {
  private readonly src: string;
  private pos = 0;
  private readonly lineStarts: number[] = [0];

  private readonly nodes: Record<string, DiagramNode> = {};
  private readonly roots: string[] = [];
  private readonly edges: DiagramEdge[] = [];
  private readonly issues: ParseIssue[] = [];
  private readonly lineIndex: Record<number, string> = {};
  private direction: Direction = 'down';

  private readonly declared = new Set<string>();
  private readonly explicit = new Set<string>(); // "<target>|<attr.path>" set directly, not via class
  private readonly classDefs: Record<string, ClassOp[]> = {};
  private readonly edgeClasses = new Map<DiagramEdge, string[]>();
  private readonly constraints: Record<string, string> = {};
  private readonly vars: Record<string, string> = {};
  private readonly edgeCount = new Map<string, number>();
  private readonly warnedOnce = new Set<string>();

  constructor(source: string) {
    this.src = source.replace(/\r\n?/g, '\n');
    for (let i = 0; i < this.src.length; i++) {
      if (this.src[i] === '\n') this.lineStarts.push(i + 1);
    }
  }

  parse(): DiagramModel {
    this.parseMap({ kind: 'node', path: [] }, -1);
    this.finish();
    return {
      direction: this.direction,
      nodes: this.nodes,
      roots: this.roots,
      edges: this.edges,
      issues: this.issues,
      lineIndex: this.lineIndex,
    };
  }

  // ---------------------------------------------------------------- scanning

  private get ch(): string {
    return this.src[this.pos] ?? '';
  }

  private at(offset: number): string {
    return this.src[this.pos + offset] ?? '';
  }

  private get atEnd(): boolean {
    return this.pos >= this.src.length;
  }

  private loc(offset: number): { line: number; col: number } {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, col: offset - this.lineStarts[lo] };
  }

  private range(start: number, end: number): SourceRange {
    const a = this.loc(start);
    const b = this.loc(Math.max(start, end));
    return { line: a.line, col: a.col, endLine: b.line, endCol: b.col };
  }

  private issue(severity: Severity, message: string, start: number, end = start + 1): void {
    this.issues.push({ severity, message, range: this.range(start, end) });
  }

  private warnOnce(key: string, message: string, start: number, end: number): void {
    if (this.warnedOnce.has(key)) return;
    this.warnedOnce.add(key);
    this.issue('info', message, start, end);
  }

  private isCommentStart(): boolean {
    if (this.ch !== '#') return false;
    if (this.pos === 0) return true;
    const prev = this.src[this.pos - 1];
    return /[\s;{}]/.test(prev);
  }

  private skipInline(): void {
    while (!this.atEnd) {
      const c = this.ch;
      if (c === ' ' || c === '\t') this.pos++;
      else if (c === '\\' && this.at(1) === '\n') this.pos += 2; // line continuation
      else break;
    }
  }

  private skipToLineEnd(): void {
    let depth = 0;
    while (!this.atEnd) {
      const c = this.ch;
      if (c === '"' || c === "'") {
        this.readQuoted();
        continue;
      }
      if (c === '{') depth++;
      if (c === '}') {
        if (depth === 0) return;
        depth--;
      }
      if (c === '\n' && depth === 0) return;
      this.pos++;
    }
  }

  // Skips whitespace, newlines, statement separators and comments.
  private skipTrivia(): void {
    while (!this.atEnd) {
      const c = this.ch;
      if (c === ' ' || c === '\t' || c === '\n' || c === ';') {
        this.pos++;
      } else if (this.src.startsWith('"""', this.pos)) {
        const end = this.src.indexOf('"""', this.pos + 3);
        if (end < 0) {
          this.issue('error', 'Unterminated block comment', this.pos, this.pos + 3);
          this.pos = this.src.length;
        } else {
          this.pos = end + 3;
        }
      } else if (this.isCommentStart()) {
        while (!this.atEnd && this.ch !== '\n') this.pos++;
      } else {
        break;
      }
    }
  }

  private edgeOpAt(): string | null {
    if (this.src.startsWith('<->', this.pos)) return '<->';
    if (this.src.startsWith('->', this.pos)) return '->';
    if (this.src.startsWith('<-', this.pos)) return '<-';
    if (this.src.startsWith('--', this.pos)) return '--';
    return null;
  }

  private readQuoted(): string {
    const quote = this.ch;
    const start = this.pos;
    this.pos++;
    let out = '';
    while (!this.atEnd && this.ch !== quote) {
      if (this.ch === '\n') break;
      if (this.ch === '\\' && quote === '"') {
        const next = this.at(1);
        out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
        this.pos += 2;
        continue;
      }
      out += this.ch;
      this.pos++;
    }
    if (this.ch !== quote) {
      this.issue('error', 'Unterminated string', start, this.pos);
    } else {
      this.pos++;
    }
    return out;
  }

  // ----------------------------------------------------------------- grammar

  private parseMap(scope: Scope, openBrace: number): void {
    for (;;) {
      this.skipTrivia();
      if (this.atEnd) {
        if (openBrace >= 0) this.issue('error', 'Missing closing "}"', openBrace, openBrace + 1);
        return;
      }
      if (this.ch === '}') {
        if (openBrace >= 0) {
          this.pos++;
          return;
        }
        this.issue('error', 'Unexpected "}"', this.pos);
        this.pos++;
        continue;
      }
      this.parseStatement(scope);
    }
  }

  private parseStatement(scope: Scope): void {
    const start = this.pos;

    if (this.ch === '(') {
      this.skipToLineEnd();
      this.warnOnce('edge-ref', 'Edge references like (a -> b)[0] are not supported yet and are ignored', start, this.pos);
      return;
    }
    if (this.src.startsWith('...@', this.pos) || this.ch === '@') {
      this.skipToLineEnd();
      this.issue('warning', 'Imports are not supported yet and are ignored', start, this.pos);
      return;
    }

    const chain = this.parseKeyChain();
    if (!chain) {
      this.issue('error', `Unexpected character "${this.ch}"`, this.pos);
      this.pos++;
      this.skipToLineEnd();
      return;
    }

    this.skipInline();
    let value: Value | undefined;
    if (this.ch === ':') {
      this.pos++;
      this.skipInline();
      value = this.parseValue();
      this.skipInline();
    }
    const stmtRange = this.range(start, this.pos);

    let child: Scope | undefined;
    try {
      child = this.apply(scope, chain, value, stmtRange, start);
    } catch (e) {
      this.issue('error', (e as Error).message, start, this.pos);
    }

    if (this.ch === '{') {
      const brace = this.pos;
      this.pos++;
      this.parseMap(child ?? { kind: 'skip' }, brace);
      this.skipInline();
    }

    if (!this.atEnd && this.ch !== '\n' && this.ch !== ';' && this.ch !== '}' && !this.isCommentStart()) {
      const junk = this.pos;
      this.skipToLineEnd();
      this.issue('error', 'Unexpected text after statement', junk, this.pos);
    }
  }

  private parseKeyChain(): KeyChain | null {
    const first = this.parseKeyPath();
    if (!first) return null;
    const chain: KeyChain = { paths: [first], ops: [] };
    for (;;) {
      this.skipInline();
      const op = this.edgeOpAt();
      if (!op) break;
      const opStart = this.pos;
      this.pos += op.length;
      this.skipInline();
      const next = this.parseKeyPath();
      if (!next) {
        this.issue('error', `Missing edge target after "${op}"`, opStart, this.pos);
        break;
      }
      chain.ops.push(op);
      chain.paths.push(next);
    }
    return chain;
  }

  private parseKeyPath(): Segment[] | null {
    const segments: Segment[] = [];
    for (;;) {
      this.skipInline();
      const seg = this.parseKeySegment();
      if (!seg) break;
      segments.push(seg);
      this.skipInline();
      if (this.ch === '.') {
        this.pos++;
        continue;
      }
      break;
    }
    return segments.length ? segments : null;
  }

  private parseKeySegment(): Segment | null {
    const start = this.pos;
    if (this.ch === '"' || this.ch === "'") {
      const text = this.readQuoted();
      return { text, start, end: this.pos };
    }
    let end = this.pos;
    while (!this.atEnd) {
      const c = this.ch;
      if (c === '\n' || c === ';' || c === ':' || c === '.' || c === '{' || c === '}' || c === '[' || c === ']') break;
      if (this.edgeOpAt()) break;
      if (this.isCommentStart()) break;
      this.pos++;
      if (c !== ' ' && c !== '\t') end = this.pos;
    }
    const text = this.src.slice(start, end);
    if (!text) {
      this.pos = start;
      return null;
    }
    return { text, start, end };
  }

  private parseValue(): Value | undefined {
    const c = this.ch;
    if (c === '"' || c === "'") {
      return { kind: 'string', text: this.substitute(this.readQuoted()) };
    }
    if (c === '|') return this.parseBlockString();
    if (c === '[') return this.parseArray();
    if (c === '{' || c === '\n' || c === ';' || c === '}' || this.atEnd) return undefined;

    const start = this.pos;
    while (!this.atEnd) {
      const ch = this.ch;
      if (ch === '$' && this.at(1) === '{') {
        const close = this.src.indexOf('}', this.pos);
        const eol = this.src.indexOf('\n', this.pos);
        if (close > 0 && (eol < 0 || close < eol)) {
          this.pos = close + 1;
          continue;
        }
      }
      if (ch === '\n' || ch === ';' || ch === '{' || ch === '}') break;
      if (this.isCommentStart()) break;
      this.pos++;
    }
    const text = this.src.slice(start, this.pos).trim();
    if (!text) return undefined;
    if (text === 'null') return { kind: 'null' };
    return { kind: 'string', text: this.substitute(text) };
  }

  private parseBlockString(): Value {
    const start = this.pos;
    const m = /^(\|+)(`?)([A-Za-z0-9_+#-]*)/.exec(this.src.slice(this.pos, this.pos + 64));
    const pipes = m ? m[1] : '|';
    const tick = m ? m[2] : '';
    const format = (m && m[3]) || undefined;
    this.pos += m ? m[0].length : 1;
    const terminator = tick + pipes;
    const end = this.src.indexOf(terminator, this.pos);
    if (end < 0) {
      this.issue('error', 'Unterminated block string', start, this.pos);
      const text = this.src.slice(this.pos);
      this.pos = this.src.length;
      return { kind: 'string', text: dedent(text), format };
    }
    const text = this.src.slice(this.pos, end);
    this.pos = end + terminator.length;
    return { kind: 'string', text: dedent(text), format };
  }

  private parseArray(): Value {
    const start = this.pos;
    this.pos++; // [
    const items: string[] = [];
    for (;;) {
      while (!this.atEnd && /[\s;,]/.test(this.ch)) this.pos++;
      if (this.atEnd) {
        this.issue('error', 'Missing closing "]"', start);
        break;
      }
      if (this.ch === ']') {
        this.pos++;
        break;
      }
      if (this.ch === '"' || this.ch === "'") {
        items.push(this.readQuoted());
        continue;
      }
      const itemStart = this.pos;
      while (!this.atEnd && !/[;,\]\n]/.test(this.ch)) this.pos++;
      const item = this.src.slice(itemStart, this.pos).trim();
      if (item) items.push(this.substitute(item));
    }
    return { kind: 'array', items };
  }

  private substitute(text: string): string {
    if (!text.includes('${')) return text;
    return text.replace(/\$\{([^}]+)\}/g, (all, name: string) => this.vars[name.trim()] ?? all);
  }

  // ------------------------------------------------------------- semantics

  private apply(scope: Scope, chain: KeyChain, value: Value | undefined, range: SourceRange, start: number): Scope | undefined {
    const isEdge = chain.ops.length > 0;

    switch (scope.kind) {
      case 'skip':
        return scope;

      case 'vars': {
        const path = [...scope.prefix, ...chain.paths[0].map((s) => s.text)];
        if (value?.kind === 'string') this.vars[path.join('.')] = value.text;
        return { kind: 'vars', prefix: path };
      }

      case 'classes': {
        const segs = chain.paths[0].map((s) => s.text);
        const name = segs[0];
        this.classDefs[name] ??= [];
        const target: AttrTarget = { kind: 'class', name };
        if (value && segs.length > 1) this.setAttr(target, segs.slice(1), value, range);
        return { kind: 'attrs', targets: [target], prefix: segs.slice(1) };
      }

      case 'attrs': {
        if (isEdge) throw new Error('Edges cannot be declared inside an attribute block');
        const path = [...scope.prefix, ...chain.paths[0].map((s) => s.text)];
        if (value) for (const t of scope.targets) this.setAttr(t, path, value, range);
        return { kind: 'attrs', targets: scope.targets, prefix: path };
      }

      case 'node':
        return isEdge
          ? this.applyEdges(scope.path, chain, value, range)
          : this.applyKey(scope.path, chain.paths[0], value, range, start);
    }
  }

  private resolve(base: string[], segs: Segment[]): { nodePath: string[]; attrPath: string[] } {
    const nodePath = [...base];
    let i = 0;
    while (i < segs.length && segs[i].text === '_') {
      if (!nodePath.length) throw new Error('"_" refers above the root of the diagram');
      nodePath.pop();
      i++;
    }
    const attrPath: string[] = [];
    for (; i < segs.length; i++) {
      const text = segs[i].text;
      if (attrPath.length || RESERVED.has(text)) attrPath.push(text);
      else nodePath.push(text);
    }
    return { nodePath, attrPath };
  }

  private applyKey(base: string[], segs: Segment[], value: Value | undefined, range: SourceRange, start: number): Scope | undefined {
    const { nodePath, attrPath } = this.resolve(base, segs);

    if (!nodePath.length) {
      const kw = attrPath[0];
      if (kw === 'direction') {
        if (value?.kind === 'string' && DIRECTIONS.has(value.text as Direction)) this.direction = value.text as Direction;
        else this.issue('error', 'direction must be one of: up, down, left, right', start, this.pos);
        return undefined;
      }
      if (kw === 'vars') return { kind: 'vars', prefix: attrPath.slice(1) };
      if (kw === 'classes') return { kind: 'classes' };
      if (kw === 'layers' || kw === 'scenarios' || kw === 'steps') {
        this.warnOnce('boards', `"${kw}" (multi-board diagrams) are not supported yet; only the main board is shown`, start, this.pos);
        return { kind: 'skip' };
      }
      // Root-level label/style etc. apply to the board itself; nothing to render.
      return { kind: 'skip' };
    }

    if (!attrPath.length) {
      const id = this.ensureNode(nodePath, range);
      this.markDeclared(id, range);
      this.lineIndex[range.line] ??= id;
      if (value?.kind === 'null') {
        this.deleteNode(id);
        return { kind: 'skip' };
      }
      if (value?.kind === 'string') {
        const node = this.nodes[id];
        node.label = value.text;
        node.labelFormat = value.format;
        this.explicit.add(`${id}|label`);
      } else if (value?.kind === 'array') {
        this.issue('error', 'A node label cannot be an array', start, this.pos);
      }
      return { kind: 'node', path: nodePath };
    }

    const id = this.ensureNode(nodePath, range);
    this.lineIndex[range.line] ??= id;
    if (value) this.setAttr({ kind: 'node', id }, attrPath, value, range);
    return { kind: 'attrs', targets: [{ kind: 'node', id }], prefix: attrPath };
  }

  private applyEdges(base: string[], chain: KeyChain, value: Value | undefined, range: SourceRange): Scope {
    const ids = chain.paths.map((segs) => {
      const { nodePath, attrPath } = this.resolve(base, segs);
      if (attrPath.length) throw new Error(`Edge endpoint cannot use the reserved keyword "${attrPath[0]}"`);
      if (!nodePath.length) throw new Error('Edge endpoint is empty');
      return this.ensureNode(nodePath, range);
    });

    const created: DiagramEdge[] = [];
    chain.ops.forEach((op, i) => {
      let source = ids[i];
      let target = ids[i + 1];
      let srcArrow = false;
      let dstArrow = true;
      if (op === '<-') [source, target] = [target, source];
      else if (op === '<->') srcArrow = true;
      else if (op === '--') dstArrow = false;

      const base = `${source}->${target}`;
      const n = this.edgeCount.get(base) ?? 0;
      this.edgeCount.set(base, n + 1);
      const edge: DiagramEdge = { id: `${base}[${n}]`, source, target, srcArrow, dstArrow, style: {}, range };
      if (value?.kind === 'string') {
        edge.label = value.text;
        this.explicit.add(`${edge.id}|label`);
      }
      this.edges.push(edge);
      created.push(edge);
    });

    if (created.length) this.lineIndex[range.line] ??= `edge:${created[0].id}`;
    return { kind: 'attrs', targets: created.map((edge) => ({ kind: 'edge', edge })), prefix: [] };
  }

  private setAttr(target: AttrTarget, path: string[], value: Value, range: SourceRange, fromClass = false): void {
    const startOffset = this.lineStarts[range.line] + range.col;
    const endOffset = this.lineStarts[range.endLine] + range.endCol;
    const text = value.kind === 'string' ? value.text : value.kind === 'array' ? value.items.join(', ') : '';
    const kw = path[0];

    if (target.kind === 'class') {
      this.classDefs[target.name].push({ path, value, range });
      return;
    }

    const key = `${target.kind === 'node' ? target.id : target.edge.id}|${path.join('.')}`;
    if (fromClass && this.explicit.has(key)) return;
    if (!fromClass) this.explicit.add(key);

    if (kw === 'style') {
      if (path.length !== 2) {
        if (path.length > 2) this.issue('warning', `Unknown style path "${path.join('.')}"`, startOffset, endOffset);
        return;
      }
      const styles = target.kind === 'node' ? this.nodes[target.id].style : target.edge.style;
      if (value.kind === 'null') delete styles[path[1]];
      else styles[path[1]] = text;
      return;
    }

    if (target.kind === 'edge') {
      const edge = target.edge;
      switch (kw) {
        case 'label':
          if (path.length === 1) edge.label = value.kind === 'null' ? undefined : text;
          return;
        case 'source-arrowhead':
        case 'target-arrowhead': {
          if (path[1] === 'shape') {
            if (kw === 'source-arrowhead') {
              edge.srcArrowhead = text;
              edge.srcArrow = text !== 'none' ? true : edge.srcArrow;
            } else {
              edge.dstArrowhead = text;
              if (text === 'none') edge.dstArrow = false;
            }
          }
          return;
        }
        case 'class':
          this.edgeClasses.set(edge, value.kind === 'array' ? value.items : [text]);
          return;
        case 'icon':
        case 'tooltip':
        case 'near':
          return;
        default:
          this.issue('warning', `"${kw}" is not a valid edge attribute`, startOffset, endOffset);
          return;
      }
    }

    const node = this.nodes[target.id];
    if (!node) return;
    switch (kw) {
      case 'label':
        if (path.length === 1 && value.kind === 'string') {
          node.label = text;
          node.labelFormat = value.format;
        }
        return;
      case 'shape': {
        const shape = text.toLowerCase();
        if (!KNOWN_SHAPES.has(shape)) this.issue('warning', `Unknown shape "${text}"`, startOffset, endOffset);
        node.shape = shape;
        return;
      }
      case 'icon':
        if (path.length === 1) node.icon = text;
        return;
      case 'tooltip':
        node.tooltip = text;
        return;
      case 'link':
        node.link = text;
        return;
      case 'near':
        node.near = text;
        return;
      case 'direction':
        if (DIRECTIONS.has(text as Direction)) node.direction = text as Direction;
        else this.issue('error', 'direction must be one of: up, down, left, right', startOffset, endOffset);
        return;
      case 'class':
        node.classes = value.kind === 'array' ? value.items : [text];
        return;
      case 'constraint':
        this.constraints[node.id] = text;
        return;
      case 'source-arrowhead':
      case 'target-arrowhead':
        this.issue('warning', `"${kw}" only applies to edges`, startOffset, endOffset);
        return;
      default:
        if (IGNORED_NODE_ATTRS.has(kw)) {
          this.warnOnce(`ignored-${kw}`, `"${kw}" is ignored: layout is computed automatically`, startOffset, endOffset);
          return;
        }
        this.issue('warning', `"${kw}" is not supported on shapes`, startOffset, endOffset);
    }
  }

  private ensureNode(path: string[], range: SourceRange): string {
    let parent: string | null = null;
    let id = '';
    for (const key of path) {
      const seg = key.includes('.') ? `"${key}"` : key;
      id = parent ? `${parent}.${seg}` : seg;
      if (!this.nodes[id]) {
        this.nodes[id] = {
          id,
          key,
          parent,
          children: [],
          label: key,
          shape: 'rectangle',
          style: {},
          classes: [],
          range,
        };
        if (parent) this.nodes[parent].children.push(id);
        else this.roots.push(id);
      }
      parent = id;
    }
    return id;
  }

  private markDeclared(id: string, range: SourceRange): void {
    if (this.declared.has(id)) return;
    this.declared.add(id);
    this.nodes[id].range = range;
  }

  private deleteNode(id: string): void {
    const node = this.nodes[id];
    if (!node) return;
    for (const child of [...node.children]) this.deleteNode(child);
    const siblings = node.parent ? this.nodes[node.parent].children : this.roots;
    siblings.splice(siblings.indexOf(id), 1);
    delete this.nodes[id];
    for (let i = this.edges.length - 1; i >= 0; i--) {
      if (this.edges[i].source === id || this.edges[i].target === id) this.edges.splice(i, 1);
    }
  }

  // ------------------------------------------------------------ post-pass

  private finish(): void {
    for (const node of Object.values(this.nodes)) {
      for (const cls of node.classes) this.applyClass(cls, { kind: 'node', id: node.id }, node.range);
    }
    for (const [edge, classes] of this.edgeClasses) {
      for (const cls of classes) this.applyClass(cls, { kind: 'edge', edge }, edge.range);
    }

    // Children of sql_table / class shapes are rows, not nodes.
    for (const node of Object.values(this.nodes)) {
      if ((node.shape !== 'sql_table' && node.shape !== 'class') || !this.nodes[node.id]) continue;
      node.fields = node.children.map((childId) => {
        const child = this.nodes[childId];
        return {
          name: child.key,
          type: child.label !== child.key ? child.label : '',
          constraint: this.constraints[childId],
        };
      });
      const owned = new Set<string>();
      const collect = (id: string) => {
        owned.add(id);
        for (const c of this.nodes[id].children) collect(c);
      };
      node.children.forEach(collect);
      for (const id of owned) delete this.nodes[id];
      node.children = [];
      for (const edge of this.edges) {
        if (owned.has(edge.source)) edge.source = node.id;
        if (owned.has(edge.target)) edge.target = node.id;
      }
      for (const [line, id] of Object.entries(this.lineIndex)) {
        if (owned.has(id)) this.lineIndex[Number(line)] = node.id;
      }
    }
  }

  private applyClass(name: string, target: AttrTarget, range: SourceRange): void {
    const ops = this.classDefs[name];
    if (!ops) {
      const start = this.lineStarts[range.line] + range.col;
      this.issue('warning', `Unknown class "${name}"`, start, this.lineStarts[range.endLine] + range.endCol);
      return;
    }
    for (const op of ops) this.setAttr(target, op.path, op.value, op.range, true);
  }
}

function dedent(text: string): string {
  const lines = text.replace(/^\n/, '').replace(/\n\s*$/, '').split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join('\n');
}
