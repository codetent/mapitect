// Turns the full model into the graph that is currently visible, given the
// drill-down focus and the set of collapsed containers. Edges whose endpoints
// are hidden are "lifted" to the nearest visible ancestor (implied
// connections) and aggregated.

import type { DiagramEdge, DiagramModel, DiagramNode, Lifecycle } from '@mapitect/core';
import { typeOf, type TypeInfo } from './theme.ts';

export interface ViewState {
  focus: string | null;
  collapsed: Set<string>;
  hidden?: Set<Lifecycle>; // statuses filtered out; elements without one count as live
}

export interface VNode {
  id: string;
  node: DiagramNode;
  kind: 'card' | 'group' | 'table' | 'text';
  collapsed: boolean; // a container drawn as a card
  context: boolean; // outside the drill-down focus
  frame: boolean; // the drill-down focus itself
  depth: number;
  descendants: number;
  children: VNode[];
  type: TypeInfo;
}

export interface VEdge {
  id: string;
  source: string;
  target: string;
  edges: DiagramEdge[];
  label?: string;
  implied: boolean;
  srcArrow: boolean;
  dstArrow: boolean;
  srcArrowhead?: string;
  dstArrowhead?: string;
  style: Record<string, string>;
}

export interface VisibleGraph {
  roots: VNode[];
  nodes: Map<string, VNode>;
  edges: VEdge[];
  annotations: DiagramNode[];
  focus: string | null;
}

const NEAR_CONSTANT = /^(top|bottom|center)-(left|center|right)$/;

export function ancestry(model: DiagramModel, id: string): string[] {
  const path: string[] = [];
  let cur: string | null = id;
  while (cur && model.nodes[cur]) {
    path.unshift(cur);
    cur = model.nodes[cur].parent;
  }
  return path;
}

export function depthOf(model: DiagramModel, id: string): number {
  return ancestry(model, id).length - 1;
}

export function descendantCount(model: DiagramModel, id: string): number {
  const node = model.nodes[id];
  if (!node) return 0;
  return node.children.reduce((n, c) => n + 1 + descendantCount(model, c), 0);
}

export function isWithin(model: DiagramModel, id: string, ancestor: string): boolean {
  let cur: string | null = id;
  while (cur) {
    if (cur === ancestor) return true;
    cur = model.nodes[cur]?.parent ?? null;
  }
  return false;
}

// Whether the status filter keeps an element: its own status is shown, or a
// descendant's is, so the container stays as structure around it.
function statusFilter(model: DiagramModel, hidden: Set<Lifecycle> | undefined): (id: string) => boolean {
  if (!hidden?.size) return () => true;
  const memo = new Map<string, boolean>();
  const keep = (id: string): boolean => {
    let k = memo.get(id);
    if (k === undefined) {
      const node = model.nodes[id];
      k = !!node && (!hidden.has(node.status ?? 'live') || node.children.some(keep));
      memo.set(id, k);
    }
    return k;
  };
  return keep;
}

export function buildView(model: DiagramModel, state: ViewState): VisibleGraph {
  const keep = statusFilter(model, state.hidden);
  const focus = state.focus && model.nodes[state.focus]?.children.length && keep(state.focus) ? state.focus : null;
  const nodes = new Map<string, VNode>();
  const touched = new Set<string>();
  for (const e of model.edges) {
    touched.add(e.source);
    touched.add(e.target);
  }

  const annotations: DiagramNode[] = [];

  const build = (id: string, frame: boolean, context: boolean): VNode => {
    const node = model.nodes[id];
    const hasChildren = node.children.length > 0;
    const collapsed = hasChildren && !frame && (context || state.collapsed.has(id));
    const depth = depthOf(model, id);
    let kind: VNode['kind'] = 'card';
    if (node.fields) kind = 'table';
    else if (hasChildren && !collapsed) kind = 'group';
    else if (!hasChildren && (node.shape === 'text' || node.labelFormat === 'md')) kind = 'text';

    const v: VNode = {
      id,
      node,
      kind,
      collapsed,
      context,
      frame,
      depth,
      descendants: hasChildren ? descendantCount(model, id) : 0,
      children: [],
      type: typeOf(node, depth, hasChildren),
    };
    nodes.set(id, v);
    if (kind === 'group') v.children = node.children.filter(keep).map((c) => build(c, false, context));
    return v;
  };

  const roots: VNode[] = [];
  if (focus) {
    roots.push(build(focus, true, false));
  } else {
    for (const id of model.roots.filter(keep)) {
      const n = model.nodes[id];
      if (n.near && NEAR_CONSTANT.test(n.near) && !touched.has(id) && !n.children.length) {
        annotations.push(n);
        continue;
      }
      roots.push(build(id, false, false));
    }
  }

  const focusPath = focus ? ancestry(model, focus) : [];

  // Map any model node to the visible node that stands in for it.
  const rep = (id: string): string | null => {
    if (!model.nodes[id] || !keep(id)) return null;
    const path = ancestry(model, id);
    if (focus && !isWithin(model, id, focus)) {
      let k = 0;
      while (k < path.length && k < focusPath.length && path[k] === focusPath[k]) k++;
      return k < path.length ? path[k] : null; // null: an ancestor of the focus
    }
    const startAt = focus ? focusPath.length - 1 : 0;
    for (let i = startAt; i < path.length; i++) {
      const v = nodes.get(path[i]);
      if (v?.collapsed) return path[i];
    }
    return nodes.has(id) ? id : null;
  };

  const direct: VEdge[] = [];
  const implied = new Map<string, VEdge>();
  for (const e of model.edges) {
    const s = rep(e.source);
    const t = rep(e.target);
    if (!s || !t) continue;
    if (s === t && e.source !== e.target) continue;
    const sOut = focus !== null && !isWithin(model, s, focus);
    const tOut = focus !== null && !isWithin(model, t, focus);
    if (sOut && tOut) continue;

    for (const id of [s, t]) {
      if (!nodes.has(id)) roots.push(build(id, false, true));
    }

    if (s === e.source && t === e.target) {
      direct.push({
        id: e.id,
        source: s,
        target: t,
        edges: [e],
        label: e.label,
        implied: false,
        srcArrow: e.srcArrow,
        dstArrow: e.dstArrow,
        srcArrowhead: e.srcArrowhead,
        dstArrowhead: e.dstArrowhead,
        style: e.style,
      });
      continue;
    }
    const key = `${s}=>${t}`;
    let agg = implied.get(key);
    if (!agg) {
      agg = { id: `implied:${key}`, source: s, target: t, edges: [], implied: true, srcArrow: false, dstArrow: false, style: {} };
      implied.set(key, agg);
    }
    agg.edges.push(e);
    agg.srcArrow ||= e.srcArrow;
    agg.dstArrow ||= e.dstArrow;
  }

  for (const agg of implied.values()) {
    const labels = [...new Set(agg.edges.map((e) => e.label).filter((l): l is string => !!l))];
    if (agg.edges.length === 1) agg.label = labels[0];
    else if (labels.length === 1) agg.label = `${labels[0]} ×${agg.edges.length}`;
    else if (labels.length === 2 && agg.edges.length === 2) agg.label = labels.join(', ');
    else agg.label = `${agg.edges.length} connections`;
  }

  return { roots, nodes, edges: [...direct, ...implied.values()], annotations, focus };
}

// Containers whose relative depth is >= level get collapsed (level 0 = show all).
export function collapseToLevel(model: DiagramModel, focus: string | null, level: number): Set<string> {
  const collapsed = new Set<string>();
  if (level <= 0) return collapsed;
  const base = focus ? depthOf(model, focus) + 1 : 0;
  for (const node of Object.values(model.nodes)) {
    if (!node.children.length || node.fields) continue;
    if (depthOf(model, node.id) - base >= level - 1) collapsed.add(node.id);
  }
  return collapsed;
}
