// Shared between the extension host (parser) and the webview (renderer).
// Everything here must be plain JSON so it can cross postMessage.

export type Direction = 'up' | 'down' | 'left' | 'right';

// Where an element is in its lifecycle, from `vars: {status: …}` on the element.
export type Lifecycle = 'live' | 'future' | 'deprecated';
export const LIFECYCLES: Lifecycle[] = ['live', 'future', 'deprecated'];

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
  status?: Lifecycle; // set on the element or inherited from an ancestor
  statusFrom?: string; // the ancestor it is inherited from
  technology?: string; // freetext from `vars: {technology: …}`, e.g. "Go" or "PostgreSQL 16"
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
  source?: 'd2' | 'mapitect'; // the compiler (default), or mapitect about what it can't show
}

// A problem mapitect found outside the compiler: in the decision records, or
// while drawing the diagram. `file` is the ADR or the diagram it is about.
export interface Problem {
  file: string; // absolute path
  message: string;
  severity: Severity;
  range: SourceRange;
  source: 'decisions' | 'render';
}

// Visual edits requested by the webview; the host turns them into text edits.
// Only texts and appearance are editable: structure lives in the D2 source.
export type EditOp =
  | { op: 'setLabel'; id: string; label: string }
  | { op: 'setAttr'; id: string; attr: string[]; value: string | null } // tooltip, link, shape, icon, style.*
  | { op: 'setEdgeLabel'; id: string; label: string }
  | { op: 'setStatus'; id: string; value: Lifecycle | null } // `vars: {status: …}`; null inherits
  | { op: 'setTechnology'; id: string; value: string | null } // `vars: {technology: …}`; null removes it
  | { op: 'setDirection'; value: Direction }; // the board's layout direction

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

// ---------------------------------------------------------------- decisions

// Architecture decision records (MADR) from the folders in `vars.adr-folders`.
export type AdrStatus = 'proposed' | 'accepted' | 'rejected' | 'deprecated' | 'superseded' | 'unknown';

export interface Adr {
  file: string; // absolute path
  name: string; // file name, e.g. 0002-use-river.md
  number?: string; // from the file name prefix
  title: string;
  status: AdrStatus;
  statusText?: string; // as written, e.g. "superseded by ADR-0004"
  date?: string;
  decisionMakers?: string;
  consulted?: string;
  informed?: string;
  components: string[]; // element references from the metadata, as written; none: system-wide
  body: string; // Markdown after the title and metadata
}

export interface AdrIndex {
  components: Record<string, Adr[]>; // element id -> its decisions, ordered by number
  system: Adr[]; // decisions that name no element: they apply to the whole system
  roots: string[]; // ADR roots from `vars.adr-folders`, as written
}

