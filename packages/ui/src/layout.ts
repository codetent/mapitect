import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { Direction } from '@mapitect/core';
import { measure, plainLabel, wrap } from './theme.ts';
import type { VEdge, VisibleGraph, VNode } from './view.ts';

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardMetrics {
  typeLabel: string;
  title: string[];
  desc: string[];
  footer?: string;
}

export interface TextMetrics {
  lines: { text: string; size: number; weight: number }[];
}

export interface SNode extends Box {
  v: VNode;
  card?: CardMetrics;
  text?: TextMetrics;
}

export interface SEdge {
  v: VEdge;
  points: Point[];
  label?: Box & { text: string };
}

export interface Scene {
  nodes: SNode[]; // groups first (outer to inner), then leaves
  edges: SEdge[];
  byId: Map<string, SNode>;
  bounds: Box;
}

export const CARD = {
  width: 248,
  pad: 14,
  icon: 34,
  gap: 12,
  titleSize: 14,
  titleLine: 18,
  typeSize: 10.5,
  descSize: 12,
  descLine: 16,
  footer: 22,
  radius: 12,
};

export const GROUP = { headerHeight: 64, pad: 24 };
export const TABLE = { header: 42, row: 28, pad: 14 };

const elk = new ELK();

const ELK_DIRECTION: Record<Direction, string> = { down: 'DOWN', up: 'UP', right: 'RIGHT', left: 'LEFT' };

function cardMetrics(v: VNode): { metrics: CardMetrics; w: number; h: number } {
  const title = plainLabel(v.node.label, v.node.labelFormat).replace(/\n/g, ' ');
  const titleWidth = CARD.width - CARD.pad * 2 - CARD.icon - CARD.gap;
  const titleLines = wrap(title, CARD.titleSize, 600, titleWidth, 2);
  const descText = v.node.tooltip ? plainLabel(v.node.tooltip, 'md') : '';
  const desc = descText ? wrap(descText, CARD.descSize, 400, CARD.width - CARD.pad * 2, 3) : [];
  const footer = v.collapsed ? `${v.descendants} item${v.descendants === 1 ? '' : 's'} inside` : undefined;

  const header = Math.max(CARD.icon, 14 + 2 + titleLines.length * CARD.titleLine);
  let h = CARD.pad + header + CARD.pad;
  if (desc.length) h += 6 + desc.length * CARD.descLine;
  if (footer) h += 10 + CARD.footer;
  const typeLabel = v.context ? `${v.type.name} · external` : v.type.name;
  return { metrics: { typeLabel, title: titleLines, desc, footer }, w: CARD.width, h };
}

function textMetrics(v: VNode): { metrics: TextMetrics; w: number; h: number } {
  const raw = v.node.label.split('\n').filter((l) => l.trim());
  const md = v.node.labelFormat === 'md' || v.node.labelFormat === 'markdown';
  const lines = raw.flatMap((line) => {
    const heading = md ? /^(#+)\s*(.*)$/.exec(line) : null;
    const size = heading ? Math.max(16, 28 - heading[1].length * 4) : 14;
    const weight = heading ? 700 : 400;
    const text = md ? plainLabel(heading ? heading[2] : line, 'md') : line;
    return wrap(text, size, weight, 420, 6).map((t) => ({ text: t, size, weight }));
  });
  const w = Math.max(40, ...lines.map((l) => measure(l.text, l.size, l.weight))) + 8;
  const h = lines.reduce((sum, l) => sum + l.size * 1.4, 0) + 8;
  return { metrics: { lines }, w, h };
}

function tableSize(v: VNode): { w: number; h: number } {
  const fields = v.node.fields ?? [];
  const nameW = Math.max(...fields.map((f) => measure(f.name, 12.5, 500)), 0);
  const typeW = Math.max(...fields.map((f) => measure(f.type, 12, 400)), 0);
  const titleW = measure(v.node.label, 14, 600) + 40;
  const w = Math.max(220, titleW + TABLE.pad * 2, nameW + typeW + 34 + 40 + TABLE.pad * 2);
  return { w: Math.ceil(w), h: TABLE.header + Math.max(1, fields.length) * TABLE.row + 6 };
}

function groupMinWidth(v: VNode): number {
  return measure(v.node.label, 15, 600) + CARD.icon + 180;
}

export async function layoutScene(graph: VisibleGraph, direction: Direction): Promise<Scene> {
  const metrics = new Map<string, Partial<SNode>>();

  const toElk = (v: VNode): ElkNode => {
    if (v.kind === 'group') {
      return {
        id: v.id,
        layoutOptions: {
          'elk.padding': `[top=${GROUP.headerHeight},left=${GROUP.pad},bottom=${GROUP.pad},right=${GROUP.pad}]`,
          'elk.nodeSize.constraints': 'MINIMUM_SIZE',
          'elk.nodeSize.minimum': `(${Math.ceil(groupMinWidth(v))}, 120)`,
        },
        children: v.children.map(toElk),
      };
    }
    if (v.kind === 'table') {
      const { w, h } = tableSize(v);
      return { id: v.id, width: w, height: h };
    }
    if (v.kind === 'text') {
      const { metrics: text, w, h } = textMetrics(v);
      metrics.set(v.id, { text });
      return { id: v.id, width: w, height: h };
    }
    const { metrics: card, w, h } = cardMetrics(v);
    metrics.set(v.id, { card });
    return { id: v.id, width: w, height: h };
  };

  const labelSize = (text: string) => ({ width: Math.min(200, measure(text, 12, 500)) + 18, height: 22 });

  const elkEdges: ElkExtendedEdge[] = graph.edges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
    labels: e.label ? [{ id: `${e.id}#label`, text: e.label, ...labelSize(e.label) }] : [],
  }));

  const root: ElkNode = {
    id: '__root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': ELK_DIRECTION[direction],
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '84',
      'elk.spacing.edgeNode': '28',
      'elk.spacing.edgeEdge': '16',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '16',
      'elk.layered.spacing.edgeNodeBetweenLayers': '28',
      'elk.spacing.edgeLabel': '6',
      'elk.spacing.labelNode': '8',
      'elk.edgeLabels.inline': 'true',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.unnecessaryBendpoints': 'true',
      'elk.spacing.componentComponent': '72',
      'elk.padding': '[top=40,left=40,bottom=40,right=40]',
    },
    children: graph.roots.map(toElk),
    edges: elkEdges,
  };

  const out = await elk.layout(root);

  const nodes: SNode[] = [];
  const byId = new Map<string, SNode>();
  const abs = new Map<string, Point>([['__root', { x: 0, y: 0 }]]);

  const walk = (n: ElkNode, ox: number, oy: number, depth: number) => {
    for (const c of n.children ?? []) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      abs.set(c.id, { x, y });
      const v = graph.nodes.get(c.id)!;
      const s: SNode = { v, x, y, w: c.width ?? 0, h: c.height ?? 0, ...metrics.get(c.id) };
      nodes.push(s);
      byId.set(c.id, s);
      walk(c, x, y, depth + 1);
    }
  };
  walk(out, 0, 0, 0);
  nodes.sort((a, b) => {
    const ga = a.v.kind === 'group' ? 0 : 1;
    const gb = b.v.kind === 'group' ? 0 : 1;
    return ga - gb || a.v.depth - b.v.depth;
  });

  const vEdges = new Map(graph.edges.map((e) => [e.id, e]));
  const edges: SEdge[] = [];
  for (const e of (out.edges ?? []) as (ElkExtendedEdge & { container?: string })[]) {
    const origin = abs.get(e.container ?? '__root') ?? { x: 0, y: 0 };
    const points: Point[] = [];
    for (const s of e.sections ?? []) {
      points.push({ x: origin.x + s.startPoint.x, y: origin.y + s.startPoint.y });
      for (const b of s.bendPoints ?? []) points.push({ x: origin.x + b.x, y: origin.y + b.y });
      points.push({ x: origin.x + s.endPoint.x, y: origin.y + s.endPoint.y });
    }
    const l = e.labels?.[0];
    const label =
      l && l.text
        ? { x: origin.x + (l.x ?? 0), y: origin.y + (l.y ?? 0), w: l.width ?? 0, h: l.height ?? 0, text: l.text }
        : undefined;
    edges.push({ v: vEdges.get(e.id)!, points, label });
  }

  const bounds = { x: 0, y: 0, w: out.width ?? 0, h: out.height ?? 0 };
  return { nodes, edges, byId, bounds };
}
