// Turns visual edits into minimal text edits on the D2 source, using the
// ranges of the official AST. The official package does not expose D2's
// d2oracle, so this implements the subset the preview needs while leaving
// formatting and comments around the touched statements alone.
//
// Only texts and appearance can be edited visually. Elements and connections
// are added, removed and rewired in the D2 source itself.

import type { EditOp, TextEdit } from '../model.ts';
import { formatKey, formatKeySeg, formatValue, segKey, span, splitId, valueRange, type Span } from './ast.ts';
import type { Built } from './convert.ts';
import { labelSpan, sameSegs, type Stmt } from './source.ts';

export class EditError extends Error {}

// Attributes the preview may change: descriptive text and how a node looks.
const EDITABLE_ATTRS = new Set(['tooltip', 'link', 'shape', 'icon']);
// Node types offered in the preview (rectangle is D2's default, written as no shape at all).
const EDITABLE_SHAPES = new Set(['rectangle', 'person', 'hexagon', 'cylinder', 'queue', 'cloud']);

export function planEdit(text: string, built: Built, op: EditOp): TextEdit[] {
  return new Planner(text, built).plan(op);
}

export function applyEdits(text: string, edits: TextEdit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

class Planner {
  private readonly text: string;
  private readonly built: Built;

  constructor(text: string, built: Built) {
    this.text = text;
    this.built = built;
  }

  plan(op: EditOp): TextEdit[] {
    switch (op.op) {
      case 'setLabel':
        return this.setLabel(this.segs(op.id), op.label);
      case 'setAttr':
        return this.setAttr(this.segs(op.id), op.attr, op.value);
      case 'setEdgeLabel':
        return this.setEdgeLabel(op.id, op.label);
      default:
        throw new EditError('Add, connect and delete elements in the D2 file');
    }
  }

  // ------------------------------------------------------------------ nodes

  private segs(id: string): string[] {
    if (!this.built.model.nodes[id]) throw new EditError(`Unknown element "${id}"`);
    return splitId(id);
  }

  private declarations(segs: string[]): Stmt[] {
    return this.built.index.stmts.filter((s) => s.kind === 'node' && sameSegs(s.node!, segs));
  }

  private attrStmts(segs: string[], attr: string[]): Stmt[] {
    const want = attr.join('.').toLowerCase();
    return this.built.index.stmts.filter(
      (s) => s.kind === 'attr' && sameSegs(s.node!, segs) && s.attr!.join('.').toLowerCase() === want && !s.mk.value.map,
    );
  }

  private setLabel(segs: string[], label: string): TextEdit[] {
    const value = label.trim();
    // The last assignment wins in D2, so edit whichever label source comes last.
    const sources = [
      ...this.declarations(segs).filter((s) => labelSpan(s.mk)),
      ...this.attrStmts(segs, ['label']),
    ].sort((a, b) => a.range.start - b.range.start);
    const last = sources[sources.length - 1];

    if (last?.kind === 'attr') {
      if (!value) return [this.remove(last)];
      return [this.replace(span(valueRange(last.mk.value)!), formatValue(value))];
    }
    if (last) return this.replaceLabel(last, value);

    if (!value) return [];
    const decl = this.declarations(segs)[0];
    if (decl) return [this.insertLabel(decl, value)];
    return [this.append(segs.slice(0, -1), `${formatKeySeg(segs[segs.length - 1])}: ${formatValue(value)}`)];
  }

  // Replace or clear the label on a node or edge statement that has one.
  private replaceLabel(stmt: Stmt, value: string): TextEdit[] {
    const label = labelSpan(stmt.mk)!;
    if (value) return [this.replace(label, formatValue(value))];
    if (stmt.mk.value.map) {
      // `x: Label {` -> `x: {`
      const end = this.text[label.end] === ' ' ? label.end + 1 : label.end;
      return [this.replace({ start: label.start, end }, '')];
    }
    // `x: Label` -> `x`
    return [this.replace({ start: this.keyEnd(stmt), end: label.end }, '')];
  }

  private insertLabel(stmt: Stmt, value: string): TextEdit {
    const keyEnd = this.keyEnd(stmt);
    const map = stmt.mk.value.map;
    if (map) {
      const mapStart = span(map.range).start;
      return this.replace({ start: keyEnd, end: mapStart }, `: ${formatValue(value)} `);
    }
    return this.replace({ start: keyEnd, end: stmt.range.end }, `: ${formatValue(value)}`);
  }

  private keyEnd(stmt: Stmt): number {
    if (stmt.mk.key) return span(stmt.mk.key.range).end;
    return stmt.edges![stmt.edges!.length - 1].range.end;
  }

  private setAttr(segs: string[], attr: string[], value: string | null): TextEdit[] {
    const kw = attr[0]?.toLowerCase();
    const allowed = (kw === 'style' && attr.length === 2) || (EDITABLE_ATTRS.has(kw) && attr.length === 1);
    if (!allowed) throw new EditError(`"${attr.join('.')}" can only be changed in the D2 file`);
    if (kw === 'shape') this.checkShapeChange(segs, value?.toLowerCase() ?? 'rectangle');
    const existing = this.attrStmts(segs, attr);
    if (value === null || value === '') return this.removeAll(existing);
    const formatted = formatValue(value);
    const last = existing[existing.length - 1];
    if (last) return [this.replace(span(valueRange(last.mk.value)!), formatted)];

    const line = `${attr.join('.')}: ${formatted}`;
    const blocks = this.built.index.blocks.get(segKey(segs));
    if (blocks?.length) return [this.insertInBlock(blocks[blocks.length - 1], line)];

    // No block: add a sibling statement right after the declaration.
    const decl = this.declarations(segs).pop();
    if (decl?.mk.key) {
      const keyText = this.text.slice(span(decl.mk.key.range).start, span(decl.mk.key.range).end);
      return [this.insert(decl.range.end, `\n${this.indentOf(decl.range.start)}${keyText}.${line}`)];
    }
    return [this.append(segs.slice(0, -1), `${formatKeySeg(segs[segs.length - 1])}.${line}`)];
  }

  private checkShapeChange(segs: string[], shape: string): void {
    if (!EDITABLE_SHAPES.has(shape)) throw new EditError(`The "${shape}" type is set in the D2 file`);
    // In sql_table and class shapes children are rows; another shape would turn them into elements.
    const node = this.built.model.nodes[this.built.ids.get(segKey(segs))!];
    if (node?.fields?.length) throw new EditError('Tables and classes keep their shape; change it in the D2 file');
  }

  private site(id: string) {
    const site = this.built.edgeSites.get(id);
    if (!site) throw new EditError('This connection is not declared in this file (glob or import?)');
    return site;
  }

  private setEdgeLabel(id: string, label: string): TextEdit[] {
    const { stmt, i } = this.site(id);
    const value = label.trim();
    if (stmt.edges!.length > 1) return [this.relabelInChain(stmt, i, value)];
    if (labelSpan(stmt.mk)) return this.replaceLabel(stmt, value);
    return value ? [this.insertLabel(stmt, value)] : [];
  }

  // `a -> b -> c: x` shares one label; split it into one statement per edge and relabel edge i.
  private relabelInChain(stmt: Stmt, relabel: number, label: string): TextEdit {
    const edges = stmt.edges!;
    const last = edges[edges.length - 1];
    const suffix = this.text.slice(last.range.end, stmt.range.end);
    const map = stmt.mk.value.map;
    const block = map ? ` ${this.text.slice(span(map.range).start, span(map.range).end)}` : '';
    const lines = edges.map((e, j) => {
      const src = this.text.slice(e.srcRange.start, e.srcRange.end);
      const dst = this.text.slice(e.dstRange.start, e.dstRange.end);
      const op = this.text.slice(e.srcRange.end, e.dstRange.start).trim();
      let tail = suffix;
      if (j === relabel) tail = label ? `: ${formatValue(label)}${block}` : block ? `:${block}` : '';
      return `${src} ${op} ${dst}${tail}`;
    });
    return this.replace(stmt.range, lines.join(`\n${this.indentOf(stmt.range.start)}`));
  }

  // --------------------------------------------------------------- plumbing

  private replace(s: Span, text: string): TextEdit {
    return { start: s.start, end: s.end, text };
  }

  private insert(at: number, text: string): TextEdit {
    return { start: at, end: at, text };
  }

  private indentOf(offset: number): string {
    const ls = this.text.lastIndexOf('\n', offset - 1) + 1;
    return /^[ \t]*/.exec(this.text.slice(ls))![0];
  }

  private removeAll(stmts: Stmt[]): TextEdit[] {
    return stmts.filter((s) => !stmts.some((o) => o !== s && o.range.start <= s.range.start && o.range.end >= s.range.end)).map((s) => this.remove(s));
  }

  // Remove a statement, taking its whole line when it stands alone on it.
  private remove(stmt: Stmt): TextEdit {
    const { start, end } = stmt.range;
    const ls = this.text.lastIndexOf('\n', start - 1) + 1;
    let le = this.text.indexOf('\n', end);
    if (le < 0) le = this.text.length;
    const before = this.text.slice(ls, start);
    const after = this.text.slice(end, le);
    if (!before.trim() && /^\s*(#.*)?$/.test(after)) {
      return { start: ls, end: Math.min(le + 1, this.text.length), text: '' };
    }
    const trailing = /^\s*;\s*/.exec(after);
    if (trailing) return { start, end: end + trailing[0].length, text: '' };
    const leading = /;\s*$/.exec(before);
    if (leading) return { start: start - leading[0].length, end, text: '' };
    return { start, end, text: '' };
  }

  // Add a statement inside a container's block, or at the end of the file.
  private append(scope: string[], line: string): TextEdit {
    if (scope.length) {
      const blocks = this.built.index.blocks.get(segKey(scope));
      if (blocks?.length) return this.insertInBlock(blocks[blocks.length - 1], line);
      line = `${formatKey(scope)}.${line}`;
    }
    const needsNewline = this.text.length > 0 && !this.text.endsWith('\n');
    return this.insert(this.text.length, `${needsNewline ? '\n' : ''}${line}\n`);
  }

  private insertInBlock(stmt: Stmt, line: string): TextEdit {
    const map = span(stmt.mk.value.map!.range);
    const close = map.end - 1; // position of `}`
    const inner = this.text.slice(map.start + 1, close);
    const indent = this.indentOf(stmt.range.start);
    if (!inner.includes('\n')) {
      if (!inner.trim()) return this.replace({ start: map.start + 1, end: close }, `\n${indent}  ${line}\n${indent}`);
      // `{shape: x}` -> `{shape: x; line}`
      const content = inner.trimEnd();
      return this.insert(map.start + 1 + content.length, `${content.endsWith(';') ? '' : ';'} ${line}`);
    }
    const closeLineStart = this.text.lastIndexOf('\n', close - 1) + 1;
    const firstChild = stmt.mk.value.map!.nodes?.find((n) => n.map_key)?.map_key;
    const childIndent = firstChild ? this.indentOf(span(firstChild.range).start) : `${indent}  `;
    if (!this.text.slice(closeLineStart, close).trim()) {
      return this.insert(closeLineStart, `${childIndent}${line}\n`);
    }
    return this.insert(close, `\n${childIndent}${line}\n${indent}`);
  }
}
