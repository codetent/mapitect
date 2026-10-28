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
  id: string;
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

export interface DiagramModel {
  direction: Direction;
  nodes: Record<string, DiagramNode>;
  roots: string[];
  edges: DiagramEdge[];
  issues: ParseIssue[];
  // line -> id of the element declared on that line (node id or "edge:<id>")
  lineIndex: Record<number, string>;
}
