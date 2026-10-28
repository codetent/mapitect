// Shared between the extension host (parser) and the webview (renderer).
// Everything here must be plain JSON so it can cross postMessage.

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface SourceRange {
  line: number; // 0-based
  col: number; // 0-based
  endLine: number;
  endCol: number;
}

export interface TableField {
  name: string;
  type: string;
  constraint?: string;
}

export interface DiagramNode {
  id: string; // full dotted path, e.g. "cloud.api.db"
  key: string; // last path segment
  parent: string | null;
  children: string[];
  label: string;
  labelFormat?: string; // e.g. "md" for block strings
  shape: string;
  style: Record<string, string>;
  icon?: string;
  tooltip?: string;
  link?: string;
  near?: string;
  direction?: Direction;
  classes: string[];
  fields?: TableField[]; // sql_table / class shapes
  range: SourceRange;
}

export interface DiagramEdge {
  id: string; // the compiler's connection id, e.g. "shop.(web -> api)[0]"
  source: string;
  target: string;
  label?: string;
  srcArrow: boolean;
  dstArrow: boolean;
  srcArrowhead?: string;
  dstArrowhead?: string;
  style: Record<string, string>;
  range: SourceRange;
}

export type Severity = 'error' | 'warning' | 'info';

export interface ParseIssue {
  message: string;
  severity: Severity;
  range: SourceRange;
}

// Visual edits requested by the webview; the host turns them into text edits.
// Only texts and appearance are editable: structure lives in the D2 source.
export type EditOp =
  | { op: 'setLabel'; id: string; label: string }
  | { op: 'setAttr'; id: string; attr: string[]; value: string | null } // tooltip, link, shape, icon, style.*
  | { op: 'setEdgeLabel'; id: string; label: string };

export interface TextEdit {
  start: number; // UTF-16 offsets into the document
  end: number;
  text: string;
}

export interface DiagramModel {
  direction: Direction;
  nodes: Record<string, DiagramNode>;
  roots: string[];
  edges: DiagramEdge[];
  issues: ParseIssue[];
  // false when the last compile failed and this is the last good model
  valid?: boolean;
  // line -> id of the element declared on that line (node id or "edge:<id>")
  lineIndex: Record<number, string>;
}
