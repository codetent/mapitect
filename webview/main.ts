import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import 'd3-transition';
import { easeCubicOut } from 'd3-ease';
import type { Adr, AdrIndex, DiagramEdge, DiagramModel, DiagramNode, Direction, EditOp, SourceRange } from '../src/model.ts';
import { adrNumber, DecisionReader, statusLabel, statusPill } from './decisions.ts';
import { closeInlineRename, showMenu, startInlineRename, type MenuItem } from './editing.ts';
import { CARD, layoutScene, type Box, type Scene } from './layout.ts';
import { iconSvg, Renderer, type EdgeStyle } from './render.ts';
import { exportPng, exportSvg } from './export.ts';
import { typeOf, plainLabel, type IconName } from './theme.ts';
import { ancestry, buildView, collapseToLevel, depthOf, isWithin, type VEdge, type VisibleGraph } from './view.ts';

// ------------------------------------------------------------------ host api

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): PersistedState | undefined;
  setState(state: PersistedState): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode: VsCodeApi =
  typeof acquireVsCodeApi === 'function'
    ? acquireVsCodeApi()
    : { postMessage: (m) => console.log('[host]', m), getState: () => undefined, setState: () => undefined };

interface PersistedState {
  uri?: string;
  focus: string | null;
  collapsed: string[];
  transform?: { x: number; y: number; k: number };
  sidebar: boolean;
  minimap: boolean;
  edgeStyle: EdgeStyle;
}

type HostMessage =
  | {
      type: 'update';
      uri: string;
      model: DiagramModel;
      fileName: string;
      config?: { defaultDepth?: number; wheel?: string };
      adrs?: AdrIndex; // decisions per element, from the ADR folders
    }
  | { type: 'toast'; message: string }
  | { type: 'cursor'; id: string | null }
  | { type: 'command'; command: 'fit' | 'export-svg' | 'export-png' };

// ---------------------------------------------------------------------- dom

const app = document.getElementById('app')!;
app.innerHTML = `
  <aside class="sidebar glass">
    <div class="sidebar-head">
      <div class="brand"><span class="brand-mark">${iconSvg('layers', 16)}</span><span class="file-name">mapitect</span></div>
      <button class="icon-btn" data-action="sidebar" title="Hide sidebar">${iconSvg('sidebar', 16)}</button>
    </div>
    <label class="search">${iconSvg('search', 14)}<input type="text" placeholder="Search elements" spellcheck="false" /><kbd>/</kbd></label>
    <div class="tree" role="tree"></div>
    <div class="sidebar-foot"></div>
  </aside>
  <main class="stage">
    <svg id="canvas" tabindex="0"><g id="camera"><g id="world"></g></g></svg>
    <div class="topbar glass">
      <button class="icon-btn show-sidebar" data-action="sidebar" title="Show sidebar">${iconSvg('sidebar', 16)}</button>
      <nav class="crumbs"></nav>
    </div>
    <div class="toolbar glass">
      <button class="icon-btn" data-action="reload" title="Reload the diagram and decisions from disk">${iconSvg('reload', 16)}</button>
      <span class="sep"></span>
      <button class="icon-btn" data-action="undo" title="Undo (⌘Z)">${iconSvg('undo', 16)}</button>
      <button class="icon-btn" data-action="redo" title="Redo (⇧⌘Z)">${iconSvg('redo', 16)}</button>
      <span class="sep"></span>
      <div class="segmented" title="Detail level">
        <span class="seg-label">Level</span>
        <button data-level="1">1</button><button data-level="2">2</button><button data-level="3">3</button><button data-level="0">All</button>
      </div>
      <span class="sep"></span>
      <button class="icon-btn" data-action="direction" title="Layout direction (writes direction: … to the file)">${iconSvg('arrowRight', 16)}</button>
      <button class="icon-btn" data-action="edges" title="Edge style">${iconSvg('orthogonal', 16)}</button>
      <span class="sep"></span>
      <div class="menu-wrap">
        <button class="icon-btn" data-action="export" title="Export">${iconSvg('download', 16)}</button>
        <div class="menu glass">
          <button data-export="svg">Export as SVG</button>
          <button data-export="png">Export as PNG</button>
        </div>
      </div>
    </div>
    <aside class="details glass"></aside>
    <div class="minimap glass"><svg><use href="#world"></use><rect class="viewport"></rect></svg></div>
    <div class="zoombar glass">
      <button class="icon-btn" data-action="zoom-out" title="Zoom out (−)">${iconSvg('minus', 16)}</button>
      <button class="zoom-level" data-action="zoom-reset" title="Reset to 100% (1)">100%</button>
      <button class="icon-btn" data-action="zoom-in" title="Zoom in (+)">${iconSvg('plus', 16)}</button>
      <span class="sep"></span>
      <button class="icon-btn" data-action="fit" title="Fit to screen (F)">${iconSvg('fit', 16)}</button>
      <button class="icon-btn" data-action="minimap" title="Toggle minimap (M)">${iconSvg('map', 16)}</button>
    </div>
    <div class="toast"></div>
    <button class="error-banner glass"></button>
    <aside class="adr-reader glass"></aside>
    <div class="empty-state">
      <div class="empty-icon">${iconSvg('layers', 28)}</div>
      <div class="empty-title">Nothing to show yet</div>
      <div class="empty-sub">Add shapes and connections to your D2 file, e.g. <code>api -&gt; db: queries</code></div>
    </div>
  </main>`;

const $ = <T extends Element = HTMLElement>(sel: string) => app.querySelector(sel) as T;
const svg = $<SVGSVGElement>('#canvas');
const camera = $<SVGGElement>('#camera');
const world = $<SVGGElement>('#world');
const stage = $('.stage');
const treeEl = $('.tree');
const searchInput = $<HTMLInputElement>('.search input');
const detailsEl = $('.details');
const crumbsEl = $('.crumbs');
const minimapSvg = $<SVGSVGElement>('.minimap svg');
const minimapViewport = $<SVGRectElement>('.minimap .viewport');
const zoomLabel = $('.zoom-level');
const toastEl = $('.toast');

// -------------------------------------------------------------------- state

const saved = vscode.getState();
const view = {
  focus: saved?.focus ?? null,
  collapsed: new Set<string>(saved?.collapsed ?? []),
  selected: null as string | null,
  hover: null as string | null,
  cursor: null as string | null,
  sidebar: saved?.sidebar ?? false,
  minimap: saved?.minimap ?? true,
  edgeStyle: (saved?.edgeStyle ?? 'orthogonal') as EdgeStyle,
  level: null as number | null,
  wheel: 'auto',
};

let model: DiagramModel | null = null;
let adrIndex: AdrIndex | null = null;
let graph: VisibleGraph | null = null;
let scene: Scene | null = null;
let firstRender = true;
let docUri = saved?.uri;
let layoutSeq = 0;
const treeOpen = new Set<string>();

const renderer = new Renderer(world, {
  select: (id, ev) => {
    if (id && (ev.metaKey || ev.ctrlKey)) goToSource(id);
    setSelected(id);
  },
  activate: (id, ev) => activate(id, ev),
  toggle: (id) => toggleCollapse(id),
  drill: (id) => drillInto(id),
  up: () => goUp(),
  hover: (id) => {
    view.hover = id;
    applyHighlight();
  },
  contextMenu: (id, ev) => openContextMenu(id, ev),
  decisions: (id) => openDecisions(id),
});
renderer.edgeStyle = view.edgeStyle;

function persist(): void {
  const t = currentTransform();
  vscode.setState({
    uri: docUri,
    focus: view.focus,
    collapsed: [...view.collapsed],
    transform: { x: t.x, y: t.y, k: t.k },
    sidebar: view.sidebar,
    minimap: view.minimap,
    edgeStyle: view.edgeStyle,
  });
}

// ------------------------------------------------------------------- camera

const zoomer: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
  .scaleExtent([0.04, 4])
  .filter((ev: Event) => {
    if (ev.type === 'wheel') return false; // handled below
    if (ev.type === 'dblclick') return false;
    const me = ev as MouseEvent;
    return !me.button || me.button === 1;
  })
  .on('zoom', (ev: { transform: ZoomTransform }) => {
    camera.setAttribute('transform', ev.transform.toString());
    onCameraChange(ev.transform);
  })
  .on('end', () => persist());

const svgSel = select(svg);
svgSel.call(zoomer);

svg.addEventListener(
  'wheel',
  (ev) => {
    ev.preventDefault();
    closeInlineRename(true);
    const trackpadPan = ev.deltaX !== 0 || (ev.deltaMode === 0 && !Number.isInteger(ev.deltaY)) || Math.abs(ev.deltaY) < 40;
    const pan = !ev.ctrlKey && !ev.metaKey && (view.wheel === 'pan' || (view.wheel === 'auto' && trackpadPan));
    const t = currentTransform();
    if (pan) {
      zoomer.translateBy(svgSel, -ev.deltaX / t.k, -ev.deltaY / t.k);
    } else {
      const factor = Math.pow(2, -ev.deltaY * (ev.deltaMode === 1 ? 0.05 : ev.ctrlKey ? 0.01 : 0.002));
      const rect = svg.getBoundingClientRect();
      zoomer.scaleBy(svgSel, factor, [ev.clientX - rect.left, ev.clientY - rect.top]);
    }
    schedulePersist();
  },
  { passive: false },
);

let persistTimer: number | undefined;
function schedulePersist(): void {
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(persist, 300);
}

function currentTransform(): ZoomTransform {
  return (svg as unknown as { __zoom?: ZoomTransform }).__zoom ?? zoomIdentity;
}

function viewportSize(): { w: number; h: number } {
  const r = svg.getBoundingClientRect();
  return { w: r.width || 800, h: r.height || 600 };
}

function onCameraChange(t: ZoomTransform): void {
  zoomLabel.textContent = `${Math.round(t.k * 100)}%`;
  world.classList.toggle('far', t.k < 0.45);
  let step = 24;
  while (step * t.k < 14) step *= 2;
  const size = step * t.k;
  stage.style.backgroundSize = `${size}px ${size}px`;
  stage.style.backgroundPosition = `${t.x}px ${t.y}px`;
  updateMinimapViewport(t);
}

function fitBox(box: Box, opts: { maxScale?: number; animate?: boolean; padding?: number } = {}): void {
  const { w, h } = viewportSize();
  const pad = opts.padding ?? 64;
  const left = view.sidebar ? 272 : 0;
  const right = view.selected ? 332 : 0;
  const top = 64;
  const availW = Math.max(100, w - pad * 2 - left - right);
  const availH = Math.max(100, h - pad * 2 - top);
  const k = Math.min(opts.maxScale ?? 1.25, availW / Math.max(box.w, 1), availH / Math.max(box.h, 1));
  const tx = left + pad + (availW - box.w * k) / 2 - box.x * k;
  const ty = top + pad + (availH - box.h * k) / 2 - box.y * k;
  const t = zoomIdentity.translate(tx, ty).scale(Math.max(k, 0.04));
  if (opts.animate === false) svgSel.call(zoomer.transform, t);
  else svgSel.transition().duration(650).ease(easeCubicOut).call(zoomer.transform, t);
}

function fitAll(animate = true): void {
  if (scene) fitBox(scene.bounds, { animate });
}

function zoomBy(factor: number): void {
  const { w, h } = viewportSize();
  svgSel.transition().duration(220).call(zoomer.scaleBy, factor, [w / 2, h / 2]);
}

function ensureVisible(box: Box): void {
  const t = currentTransform();
  const { w, h } = viewportSize();
  const margin = 80;
  const x0 = box.x * t.k + t.x;
  const y0 = box.y * t.k + t.y;
  const x1 = x0 + box.w * t.k;
  const y1 = y0 + box.h * t.k;
  let dx = 0;
  let dy = 0;
  if (x0 < margin + (view.sidebar ? 280 : 0)) dx = margin + (view.sidebar ? 280 : 0) - x0;
  else if (x1 > w - margin) dx = w - margin - x1;
  if (y0 < margin + 40) dy = margin + 40 - y0;
  else if (y1 > h - margin) dy = h - margin - y1;
  if (dx || dy) svgSel.transition().duration(380).ease(easeCubicOut).call(zoomer.translateBy, dx / t.k, dy / t.k);
}

// ------------------------------------------------------------------- layout

async function refresh(opts: { animate?: boolean; fit?: 'all' | string; anchor?: string } = {}): Promise<void> {
  if (!model) return;
  const seq = ++layoutSeq;
  if (view.focus && !model.nodes[view.focus]) view.focus = null;
  for (const id of view.collapsed) if (!model.nodes[id]) view.collapsed.delete(id);

  const anchorBefore = opts.anchor && scene?.byId.get(opts.anchor);
  const g = buildView(model, view);
  let s: Scene;
  try {
    s = await layoutScene(g, model.direction);
  } catch (err) {
    console.error(err);
    toast(`Layout failed: ${(err as Error).message}`);
    return;
  }
  if (seq !== layoutSeq) return;
  graph = g;
  scene = s;

  const annotations = g.annotations.map((n) => ({ text: plainLabel(n.label, n.labelFormat).split('\n')[0], near: n.near! }));
  renderer.render(s, !!opts.animate && !firstRender, annotations);
  stage.classList.toggle('is-empty', s.nodes.length === 0);
  minimapSvg.setAttribute('viewBox', `${s.bounds.x - 20} ${s.bounds.y - 20} ${s.bounds.w + 40} ${s.bounds.h + 40}`);

  if (view.selected && !resolveSelection(view.selected)) view.selected = null;

  if (firstRender) {
    firstRender = false;
    if (saved?.transform) {
      svgSel.call(zoomer.transform, zoomIdentity.translate(saved.transform.x, saved.transform.y).scale(saved.transform.k));
    } else {
      fitAll(false);
    }
  } else if (opts.fit === 'all') {
    fitAll();
  } else if (opts.fit) {
    const box = s.byId.get(opts.fit);
    if (box) fitBox(box, { maxScale: 1.1 });
  } else if (anchorBefore) {
    // Keep the toggled element where it was on screen.
    const after = s.byId.get(opts.anchor!);
    if (after) {
      svgSel.transition().duration(480).call(zoomer.translateBy, anchorBefore.x - after.x, anchorBefore.y - after.y);
    }
  }

  renderCrumbs();
  renderTree();
  renderDetails();
  renderLevelButtons();
  applyHighlight();
  updateMinimapViewport(currentTransform());
  persist();
}

// -------------------------------------------------------------- navigation

// Double click: rename leaves, connections and group titles; navigate containers.
function activate(id: string, ev?: MouseEvent): void {
  if (id.startsWith('edge:')) return renameElement(id);
  const v = graph?.nodes.get(id);
  if (!v || !model) return;
  if (v.context) return reveal(id);
  if (v.collapsed) return toggleCollapse(id);
  if (v.kind === 'group') {
    if ((ev?.target as Element | undefined)?.closest?.('.group-header')) return renameElement(id);
    return v.frame ? goUp() : drillInto(id);
  }
  renameElement(id);
}

function drillInto(id: string): void {
  if (!model?.nodes[id]?.children.length) return;
  view.focus = id;
  view.collapsed.delete(id);
  view.selected = null;
  view.level = null;
  toast(`Focused on ${model.nodes[id].label} — press Esc to go back`);
  void refresh({ animate: true, fit: 'all' });
}

function goUp(): void {
  if (!model || !view.focus) return;
  const prev = view.focus;
  view.focus = model.nodes[prev]?.parent ?? null;
  view.selected = prev;
  void refresh({ animate: true, fit: prev });
}

function toggleCollapse(id: string): void {
  if (!model?.nodes[id]?.children.length) return;
  const collapsing = !view.collapsed.has(id);
  if (collapsing) view.collapsed.add(id);
  else view.collapsed.delete(id);
  view.level = null;
  void refresh({ animate: true, anchor: id, fit: collapsing ? undefined : id });
}

// Make an element visible: adjust focus and expand ancestors, then zoom to it.
function reveal(id: string, opts: { select?: boolean } = {}): void {
  if (!model?.nodes[id]) return;
  if (view.focus && !isWithin(model, id, view.focus)) view.focus = null;
  for (const a of ancestry(model, id).slice(0, -1)) view.collapsed.delete(a);
  if (opts.select !== false) view.selected = id;
  void refresh({ animate: true, fit: id });
}

function goToSource(idOrEdge: string): void {
  const range = rangeOf(idOrEdge);
  if (range) vscode.postMessage({ type: 'navigate', range });
}

function rangeOf(id: string): SourceRange | undefined {
  if (!model) return undefined;
  if (id.startsWith('edge:')) {
    const ve = findVEdge(id.slice(5));
    return ve?.edges[0]?.range ?? model.edges.find((e) => e.id === id.slice(5))?.range;
  }
  return model.nodes[id]?.range;
}

function findVEdge(id: string): VEdge | undefined {
  return graph?.edges.find((e) => e.id === id) ?? graph?.edges.find((e) => e.edges.some((x) => x.id === id));
}

function setSelected(id: string | null): void {
  view.selected = id;
  if (reader.openFor && reader.openFor !== id) reader.close();
  renderDetails();
  renderTree();
  applyHighlight();
}

function resolveSelection(id: string): boolean {
  if (!graph) return false;
  if (id.startsWith('edge:')) return !!findVEdge(id.slice(5));
  return !!model?.nodes[id];
}

// Map an arbitrary model node to whatever is drawn for it right now.
function visibleFor(id: string): string | null {
  if (!graph || !model) return null;
  if (graph.nodes.has(id)) return id;
  const path = ancestry(model, id);
  for (let i = path.length - 1; i >= 0; i--) if (graph.nodes.has(path[i])) return path[i];
  return null;
}

// ---------------------------------------------------------------- highlight

// Selecting an element highlights its declaration in the editor.
let highlighted: string | null = null;
function syncSourceHighlight(): void {
  if (view.selected === highlighted) return;
  highlighted = view.selected;
  const range = view.selected ? rangeOf(view.selected) : undefined;
  const known = range && (range.line || range.col || range.endLine || range.endCol);
  vscode.postMessage({ type: 'highlight', range: known ? range : null });
}

function applyHighlight(): void {
  if (!graph || !model) return;
  syncSourceHighlight();
  const related = new Set<string>();
  const activeEdges = new Set<string>();
  const hotEdges = new Set<string>();
  const hotNodes = new Set<string>();

  const collect = (id: string | null, nodes: Set<string>, edges: Set<string>) => {
    if (!id) return;
    if (id.startsWith('edge:')) {
      const e = findVEdge(id.slice(5));
      if (e) {
        edges.add(e.id);
        nodes.add(e.source).add(e.target);
      }
      return;
    }
    const vis = visibleFor(id);
    if (!vis) return;
    nodes.add(vis);
    // For an expanded group only connections crossing its boundary are interesting.
    const boundaryOnly = graph!.nodes.get(vis)?.kind === 'group';
    for (const e of graph!.edges) {
      const s = isWithin(model!, e.source, vis);
      const t = isWithin(model!, e.target, vis);
      if (boundaryOnly ? s !== t : s || t) {
        edges.add(e.id);
        nodes.add(e.source).add(e.target);
      }
    }
  };
  collect(view.selected, related, activeEdges);
  collect(view.hover, hotNodes, hotEdges);

  const selectedVis = view.selected && !view.selected.startsWith('edge:') ? visibleFor(view.selected) : null;
  const cursorVis = view.cursor && !view.cursor.startsWith('edge:') ? visibleFor(view.cursor) : null;
  const cursorEdge = view.cursor?.startsWith('edge:') ? findVEdge(view.cursor.slice(5))?.id : null;
  const hasSel = !!view.selected;

  world.classList.toggle('has-selection', hasSel);
  select(world)
    .selectAll<SVGGElement, unknown>('g.node, g.group')
    .each(function () {
      const id = this.getAttribute('data-id')!;
      const isGroup = this.classList.contains('group');
      const containsSel = isGroup && selectedVis && model!.nodes[selectedVis] && isWithin(model!, selectedVis, id);
      const insideSel = selectedVis && model!.nodes[id] && isWithin(model!, id, selectedVis);
      this.classList.toggle('selected', id === selectedVis);
      this.classList.toggle('related', related.has(id) || !!containsSel || !!insideSel);
      this.classList.toggle('hovered', id === view.hover);
      this.classList.toggle('hot', hotNodes.has(id));
      this.classList.toggle('cursor', id === cursorVis);
      this.classList.toggle('search-hit', searchHits.has(id));
    });
  select(world)
    .selectAll<SVGGElement, unknown>('g.edge, g.edge-label')
    .each(function () {
      const id = this.getAttribute('data-id')!;
      this.classList.toggle('active', activeEdges.has(id));
      this.classList.toggle('hot', hotEdges.has(id));
      this.classList.toggle('selected', view.selected === `edge:${id}`);
      this.classList.toggle('cursor', id === cursorEdge);
    });
}

// -------------------------------------------------------------- breadcrumbs

function renderCrumbs(): void {
  if (!model) return;
  const parts: { id: string | null; label: string; icon?: IconName }[] = [{ id: null, label: 'Overview', icon: 'home' }];
  if (view.focus) for (const id of ancestry(model, view.focus)) parts.push({ id, label: model.nodes[id].label });
  crumbsEl.innerHTML = parts
    .map((p, i) => {
      const last = i === parts.length - 1;
      const icon = p.icon ? iconSvg(p.icon, 14) : '';
      return `${i ? `<span class="crumb-sep">${iconSvg('chevronRight', 12)}</span>` : ''}<button class="crumb${last ? ' current' : ''}" data-focus="${p.id === null ? '' : esc(p.id)}">${icon}<span>${esc(firstLine(p.label))}</span></button>`;
    })
    .join('');
}

crumbsEl.addEventListener('click', (ev) => {
  const btn = (ev.target as Element).closest<HTMLElement>('[data-focus]');
  if (!btn || !model) return;
  const id = btn.dataset.focus || null;
  if (id === view.focus) return;
  const prev = view.focus;
  view.focus = id;
  void refresh({ animate: true, fit: prev && id && isWithin(model, prev, id) ? undefined : 'all' }).then(() => {
    if (prev) {
      const vis = visibleFor(prev);
      const box = vis && scene?.byId.get(vis);
      if (box) fitBox(box, { maxScale: 1 });
    }
  });
});

// --------------------------------------------------------------------- tree

function renderTree(): void {
  if (!model) return;
  const q = searchInput.value.trim().toLowerCase();
  const matches = new Set<string>();
  const keep = new Set<string>();
  const adrHit = (a: Adr) => a.title.toLowerCase().includes(q) || adrNumber(a).toLowerCase().includes(q);
  if (q) {
    for (const n of Object.values(model.nodes)) {
      const own = n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q) || n.tooltip?.toLowerCase().includes(q);
      if (own) matches.add(n.id);
      if (own || adrIndex?.components[n.id]?.some(adrHit)) for (const a of ancestry(model, n.id)) keep.add(a);
    }
  }
  const rows: string[] = [];
  // A component's decisions sit right below it, above its child elements.
  const decisionRows = (id: string, depth: number) => {
    (adrIndex?.components[id] ?? []).forEach((a, i) => {
      if (q && !adrHit(a)) return;
      const cls = ['tree-row', 'tree-adr', reader.openFile === a.file ? 'selected' : '', q ? 'match' : ''].join(' ');
      rows.push(
        `<div class="${cls}" data-adr-of="${esc(id)}" data-adr-index="${i}" style="--depth:${depth}" role="treeitem" title="${esc(a.name)}">
          <span class="twisty leaf"></span>
          <span class="tree-icon">${iconSvg('decision', 13)}</span>
          ${a.number ? `<span class="adr-num">${esc(a.number)}</span>` : ''}
          <span class="tree-label">${highlightMatch(a.title, q)}</span>
          <span class="adr-dot s-${a.status}" title="${statusLabel(a)}"></span>
        </div>`,
      );
    });
  };
  const walk = (ids: string[], depth: number) => {
    for (const id of ids) {
      if (q && !keep.has(id)) continue;
      const n = model!.nodes[id];
      const hasKids = n.children.length > 0 || !!adrIndex?.components[id]?.length;
      const open = q ? true : treeOpen.has(id);
      const t = typeOf(n, depthOf(model!, id), hasKids);
      const visible = graph?.nodes.has(id);
      const cls = [
        'tree-row',
        view.selected === id ? 'selected' : '',
        visible ? '' : 'hidden-node',
        matches.has(id) ? 'match' : '',
        view.focus === id ? 'focused' : '',
      ].join(' ');
      rows.push(
        `<div class="${cls}" data-id="${esc(id)}" style="--depth:${depth};--accent:${t.accent}" role="treeitem">
          <span class="twisty${hasKids ? '' : ' leaf'}${open ? ' open' : ''}" data-twisty="${esc(id)}">${hasKids ? iconSvg('chevronRight', 12) : ''}</span>
          <span class="tree-icon">${iconSvg(t.icon, 14)}</span>
          <span class="tree-label">${highlightMatch(firstLine(n.label), q)}</span>
          ${n.children.length ? `<span class="tree-count">${n.children.length}</span>` : ''}
        </div>`,
      );
      if (hasKids && open) {
        decisionRows(id, depth + 1);
        walk(n.children, depth + 1);
      }
    }
  };
  walk(model.roots, 0);
  treeEl.innerHTML = rows.join('') || `<div class="tree-empty">${q ? 'No matches' : 'No elements'}</div>`;

  const issues = model.issues.filter((i) => i.severity !== 'info');
  const foot = $('.sidebar-foot');
  foot.innerHTML = issues.length
    ? `<button class="problems" title="Go to first problem">${iconSvg('warning', 14)}<span>${issues.length} problem${issues.length === 1 ? '' : 's'}</span><span class="problem-msg">${esc(issues[0].message)}</span></button>`
    : `<span class="ok-dot"></span><span>${Object.keys(model.nodes).length} elements · ${model.edges.length} connections</span>`;
  const stray = adrIndex?.unmatched ?? [];
  if (stray.length) {
    foot.insertAdjacentHTML(
      'beforeend',
      `<span class="adr-unmatched" title="ADR folders that match no element: ${esc(stray.join(', '))}">${iconSvg('decision', 13)}${stray.length} unmatched</span>`,
    );
  }
}

treeEl.addEventListener('click', (ev) => {
  const target = ev.target as Element;
  const twisty = target.closest<HTMLElement>('[data-twisty]');
  if (twisty && !twisty.classList.contains('leaf')) {
    const id = twisty.dataset.twisty!;
    if (treeOpen.has(id)) treeOpen.delete(id);
    else treeOpen.add(id);
    renderTree();
    return;
  }
  const row = target.closest<HTMLElement>('.tree-row');
  if (row?.dataset.adrOf) {
    const id = row.dataset.adrOf;
    if (view.selected !== id) setSelected(id);
    reader.open(id, Number(row.dataset.adrIndex));
  } else if (row) reveal(row.dataset.id!);
});

treeEl.addEventListener('dblclick', (ev) => {
  const row = (ev.target as Element).closest<HTMLElement>('.tree-row');
  if (row?.dataset.id && model?.nodes[row.dataset.id]?.children.length) drillInto(row.dataset.id);
});

$('.sidebar-foot').addEventListener('click', () => {
  const issue = model?.issues.find((i) => i.severity !== 'info');
  if (issue) vscode.postMessage({ type: 'navigate', range: issue.range });
});

let searchHits = new Set<string>();
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  searchHits = new Set();
  if (q && model) {
    for (const n of Object.values(model.nodes)) {
      if (n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) {
        const vis = visibleFor(n.id);
        if (vis) searchHits.add(vis);
      }
    }
  }
  world.classList.toggle('searching', !!q);
  renderTree();
  applyHighlight();
});

searchInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    treeEl.querySelector<HTMLElement>('.tree-row.match')?.click();
  } else if (ev.key === 'Escape') {
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input'));
    svg.focus();
  }
  ev.stopPropagation();
});

// ------------------------------------------------------------------ details

const SHAPES: [string, string, IconName][] = [
  ['rectangle', 'Service', 'server'],
  ['person', 'Actor', 'person'],
  ['hexagon', 'Gateway', 'hexagon'],
  ['cylinder', 'Data store', 'database'],
  ['queue', 'Queue', 'queue'],
  ['cloud', 'Cloud service', 'cloud'],
];
const FILLS = ['#dbeafe', '#dcfce7', '#fef9c3', '#ffedd5', '#fee2e2', '#f3e8ff', '#e2e8f0', '#334155'];

let detailsFor: string | null = null;

function renderDetails(): void {
  const id = view.selected;
  // Don't rebuild the form under the cursor while the user is typing in it.
  const typing = document.activeElement?.matches('.details input, .details textarea');
  if (id === detailsFor && typing) return;
  detailsFor = id;
  if (!id || !model) {
    detailsEl.classList.remove('open');
    return;
  }
  const dis = model.valid === false ? 'disabled' : '';
  const paused = model.valid === false ? '<p class="d-note warn">Editing is paused until the D2 file compiles again.</p>' : '';
  const close = `<button class="icon-btn" data-action="close-details" title="Close">${iconSvg('close', 14)}</button>`;

  if (id.startsWith('edge:')) {
    const e = findVEdge(id.slice(5));
    if (!e) return detailsEl.classList.remove('open');
    const direct = e.implied ? undefined : e.edges[0];
    const conn = e.edges
      .map(
        (x) => `<button class="conn" data-goto-edge="${esc(x.id)}">
          <span class="conn-names">${esc(nameOf(x.source))} ${iconSvg('arrowRight', 12)} ${esc(nameOf(x.target))}</span>
          ${x.label ? `<span class="conn-label">${esc(x.label)}</span>` : ''}
        </button>`,
      )
      .join('');
    detailsEl.innerHTML = `
      <div class="d-head">
        <div class="d-tile" style="--accent:#64748b">${iconSvg('arrowRight', 18)}</div>
        <div class="d-titles"><div class="d-type">${e.implied ? 'Implied connection' : 'Connection'}</div>
        ${direct ? `<input class="d-title-input" data-field="edge-label" value="${esc(direct.label ?? '')}" placeholder="Add a label" spellcheck="false" ${dis} />` : `<div class="d-title">${esc(e.label ?? 'Unlabeled')}</div>`}</div>
        ${close}
      </div>
      <div class="d-route">
        <button class="pill" data-reveal="${esc(e.source)}">${esc(nameOf(e.source))}</button>
        <span>${iconSvg(e.srcArrow && e.dstArrow ? 'bidirectional' : 'arrowRight', 14)}</span>
        <button class="pill" data-reveal="${esc(e.target)}">${esc(nameOf(e.target))}</button>
      </div>
      ${direct ? '' : `<p class="d-note">Lifted from ${e.edges.length} connection${e.edges.length === 1 ? '' : 's'} between nested elements. Expand to edit their labels.</p>
      <div class="d-section-title">Underlying connections</div><div class="conn-list">${conn}</div>`}
      ${paused}`;
    detailsEl.classList.add('open');
    return;
  }

  const n = model.nodes[id];
  if (!n) return detailsEl.classList.remove('open');
  const t = typeOf(n, depthOf(model, id), n.children.length > 0);
  const path = ancestry(model, id).slice(0, -1);
  const outgoing = model.edges.filter((e) => isWithin(model!, e.source, id) && !isWithin(model!, e.target, id));
  const incoming = model.edges.filter((e) => isWithin(model!, e.target, id) && !isWithin(model!, e.source, id));
  const internal = n.children.length ? model.edges.filter((e) => isWithin(model!, e.source, id) && isWithin(model!, e.target, id)).length : 0;
  const isCollapsed = view.collapsed.has(id);
  const fill = n.style.fill?.toLowerCase();

  const connRow = (other: string, label: string | undefined, dir: 'out' | 'in', edgeId: string) =>
    `<button class="conn" data-reveal="${esc(other)}" data-edge="${esc(edgeId)}">
      <span class="conn-dir ${dir}">${iconSvg(dir === 'out' ? 'arrowRight' : 'arrowLeft', 12)}</span>
      <span class="conn-names">${esc(nameOf(other))}</span>
      ${label ? `<span class="conn-label">${esc(label)}</span>` : ''}
    </button>`;

  detailsEl.innerHTML = `
    <div class="d-head">
      <div class="d-tile" style="--accent:${t.accent}">${iconSvg(t.icon, 18)}</div>
      <div class="d-titles"><div class="d-type">${esc(t.name)}</div>
        <input class="d-title-input" data-field="label" value="${esc(n.label)}" placeholder="Name" spellcheck="false" ${dis} /></div>
      ${close}
    </div>
    ${path.length ? `<div class="d-path">${path.map((p) => `<button class="link" data-reveal="${esc(p)}">${esc(firstLine(model!.nodes[p].label))}</button>`).join(`<span>${iconSvg('chevronRight', 10)}</span>`)}</div>` : ''}
    <label class="field"><span class="field-label">Description</span>
      <textarea data-field="tooltip" rows="2" placeholder="What is it responsible for?" ${dis}>${esc(n.tooltip ?? '')}</textarea></label>
    ${n.fields?.length ? '' : `<div class="field"><span class="field-label">Type</span><div class="shape-grid">${SHAPES.map(([shape, name, icon]) => `<button data-shape="${shape}" title="${name}" class="${n.shape === shape ? 'active' : ''}" ${dis}>${iconSvg(icon, 16)}</button>`).join('')}</div></div>`}
    <div class="field"><span class="field-label">Color</span><div class="swatches">
      <button data-fill="" title="Default" class="${fill ? '' : 'active'}" ${dis}>${iconSvg('none', 14)}</button>
      ${FILLS.map((c) => `<button data-fill="${c}" title="${c}" style="--sw:${c}" class="${fill === c ? 'active' : ''}" ${dis}></button>`).join('')}
    </div></div>
    <label class="field"><span class="field-label">Link</span><div class="input-row">
      <input data-field="link" value="${esc(n.link ?? '')}" placeholder="https://…" spellcheck="false" ${dis} />
      ${n.link ? `<button class="icon-btn" data-open="${esc(n.link)}" title="Open link">${iconSvg('external', 14)}</button>` : ''}
    </div></label>
    ${n.children.length ? `<div class="d-actions">
      <button class="btn" data-action="drill">${iconSvg('drill', 14)}Drill in</button>
      ${view.focus !== id ? `<button class="btn" data-action="toggle">${iconSvg(isCollapsed ? 'expand' : 'collapse', 14)}${isCollapsed ? 'Expand' : 'Collapse'}</button>` : ''}
    </div>` : ''}
    ${paused}
    ${decisionsSection(id)}
    ${outgoing.length ? `<div class="d-section-title">Outgoing <span>${outgoing.length}</span></div><div class="conn-list">${outgoing.map((e) => connRow(e.target, e.label, 'out', e.id)).join('')}</div>` : ''}
    ${incoming.length ? `<div class="d-section-title">Incoming <span>${incoming.length}</span></div><div class="conn-list">${incoming.map((e) => connRow(e.source, e.label, 'in', e.id)).join('')}</div>` : ''}
    ${n.children.length ? `<div class="d-section-title">Contains <span>${n.children.length}</span>${internal ? `<em>${internal} internal connection${internal === 1 ? '' : 's'}</em>` : ''}</div>
      <div class="chip-list">${n.children.map((c) => `<button class="chip" data-reveal="${esc(c)}">${esc(firstLine(model!.nodes[c].label))}</button>`).join('')}</div>` : ''}`;
  detailsEl.classList.add('open');
}

detailsEl.addEventListener('click', (ev) => {
  const el = (ev.target as Element).closest<HTMLElement>('button');
  if (!el || !view.selected) return;
  const sel = view.selected;
  if (el.dataset.reveal) return reveal(el.dataset.reveal);
  if (el.dataset.adr !== undefined) return reader.open(sel, Number(el.dataset.adr));
  if (el.dataset.gotoEdge) return goToSource(`edge:${el.dataset.gotoEdge}`);
  if (el.dataset.open) return vscode.postMessage({ type: 'openLink', url: el.dataset.open });
  if (el.dataset.shape !== undefined) {
    const shape = el.dataset.shape;
    return sendEdit({ op: 'setAttr', id: sel, attr: ['shape'], value: shape === 'rectangle' ? null : shape });
  }
  if (el.dataset.fill !== undefined) return sendEdit({ op: 'setAttr', id: sel, attr: ['style', 'fill'], value: el.dataset.fill || null });
  switch (el.dataset.action) {
    case 'close-details':
      return setSelected(null);
    case 'drill':
      return drillInto(sel);
    case 'toggle':
      return toggleCollapse(sel);
    case 'new-decision':
      return newDecision(sel);
  }
});

// Inputs commit on blur / Enter (textarea: ⌘Enter); Escape reverts.
detailsEl.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement | HTMLTextAreaElement;
  const field = el.dataset.field;
  const sel = view.selected;
  if (!field || !sel) return;
  const value = el.value.trim();
  if (field === 'label') sendEdit({ op: 'setLabel', id: sel, label: value });
  else if (field === 'tooltip' || field === 'link') sendEdit({ op: 'setAttr', id: sel, attr: [field], value: value || null });
  else if (field === 'edge-label') {
    const e = directEdge(sel);
    if (e) sendEdit({ op: 'setEdgeLabel', id: e.id, label: value });
  }
});

detailsEl.addEventListener('keydown', (ev) => {
  const el = ev.target as HTMLInputElement | HTMLTextAreaElement;
  if (!el.matches('input, textarea')) return;
  if (ev.key === 'Escape') {
    el.value = el.defaultValue;
    el.blur();
    ev.stopPropagation();
  } else if (ev.key === 'Enter' && (el.tagName === 'INPUT' || ev.metaKey || ev.ctrlKey)) {
    ev.preventDefault();
    el.blur();
  }
});

detailsEl.addEventListener('mouseover', (ev) => {
  const el = (ev.target as Element).closest<HTMLElement>('[data-edge]');
  const next = el ? `edge:${el.dataset.edge}` : null;
  if (next !== view.hover) {
    view.hover = next;
    applyHighlight();
  }
});

// ----------------------------------------------------------------- minimap

function updateMinimapViewport(t: ZoomTransform): void {
  if (!scene) return;
  const { w, h } = viewportSize();
  minimapViewport.setAttribute('x', String(-t.x / t.k));
  minimapViewport.setAttribute('y', String(-t.y / t.k));
  minimapViewport.setAttribute('width', String(w / t.k));
  minimapViewport.setAttribute('height', String(h / t.k));
  minimapViewport.style.strokeWidth = `${Math.max(scene.bounds.w, scene.bounds.h) / 90}px`;
}

function minimapPan(ev: PointerEvent): void {
  const pt = minimapSvg.createSVGPoint();
  pt.x = ev.clientX;
  pt.y = ev.clientY;
  const p = pt.matrixTransform(minimapSvg.getScreenCTM()!.inverse());
  const t = currentTransform();
  const { w, h } = viewportSize();
  svgSel.call(zoomer.transform, zoomIdentity.translate(w / 2 - p.x * t.k, h / 2 - p.y * t.k).scale(t.k));
}
minimapSvg.addEventListener('pointerdown', (ev) => {
  minimapSvg.setPointerCapture(ev.pointerId);
  minimapPan(ev);
  const move = (e: PointerEvent) => minimapPan(e);
  const up = () => {
    minimapSvg.removeEventListener('pointermove', move);
    minimapSvg.removeEventListener('pointerup', up);
    persist();
  };
  minimapSvg.addEventListener('pointermove', move);
  minimapSvg.addEventListener('pointerup', up);
});

// ----------------------------------------------------------------- toolbar

function renderLevelButtons(): void {
  app.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.level) === activeLevel());
  });
  const dirBtn = $('[data-action="direction"]');
  const dir = model?.direction ?? 'down';
  dirBtn.style.transform = `rotate(${{ right: 0, down: 90, left: 180, up: 270 }[dir]}deg)`;
  $('[data-action="edges"]').innerHTML = iconSvg(view.edgeStyle === 'curved' ? 'curve' : 'orthogonal', 16);
  app.classList.toggle('no-sidebar', !view.sidebar);
  app.classList.toggle('no-minimap', !view.minimap);
}

// The level whose collapse state is showing; the last one picked wins ties.
function activeLevel(): number | null {
  if (!model) return null;
  const shows = (level: number) => {
    const want = collapseToLevel(model!, view.focus, level);
    return want.size === view.collapsed.size && [...want].every((id) => view.collapsed.has(id));
  };
  if (view.level !== null && shows(view.level)) return view.level;
  if (!view.collapsed.size) return 0;
  return [1, 2, 3].find(shows) ?? null;
}

function setLevel(level: number): void {
  if (!model) return;
  view.collapsed = collapseToLevel(model, view.focus, level);
  view.level = level;
  void refresh({ animate: true, fit: 'all' });
}

app.addEventListener('click', (ev) => {
  const el = (ev.target as Element).closest<HTMLElement>('[data-action], [data-level], [data-export]');
  if (!el || detailsEl.contains(el)) return;
  if (el.dataset.level !== undefined) return setLevel(Number(el.dataset.level));
  if (el.dataset.export) {
    $('.menu-wrap').classList.remove('open');
    return void doExport(el.dataset.export as 'svg' | 'png');
  }
  switch (el.dataset.action) {
    case 'sidebar':
      view.sidebar = !view.sidebar;
      renderLevelButtons();
      return persist();
    case 'minimap':
      view.minimap = !view.minimap;
      renderLevelButtons();
      return persist();
    case 'direction': {
      // Written to the file as `direction: …`; the diagram follows the next compile.
      const order: Direction[] = ['right', 'down', 'left', 'up'];
      const cur = model?.direction ?? 'down';
      return sendEdit({ op: 'setDirection', value: order[(order.indexOf(cur) + 1) % 4] });
    }
    case 'edges':
      view.edgeStyle = view.edgeStyle === 'curved' ? 'orthogonal' : 'curved';
      renderer.edgeStyle = view.edgeStyle;
      return void refresh({ animate: true });
    case 'export':
      $('.menu-wrap').classList.toggle('open');
      return;
    case 'zoom-in':
      return zoomBy(1.4);
    case 'zoom-out':
      return zoomBy(1 / 1.4);
    case 'zoom-reset': {
      const { w, h } = viewportSize();
      return void svgSel.transition().duration(300).call(zoomer.scaleTo, 1, [w / 2, h / 2]);
    }
    case 'fit':
      return fitAll();
    case 'undo':
    case 'redo':
    case 'reload':
      return vscode.postMessage({ type: el.dataset.action });
  }
});

document.addEventListener('pointerdown', (ev) => {
  if (!(ev.target as Element).closest('.menu-wrap')) $('.menu-wrap').classList.remove('open');
});

svg.addEventListener('click', () => {
  if (view.selected) setSelected(null);
});

// Element and edge handlers stop propagation, so this only fires on empty canvas.
svg.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  openContextMenu(null, ev);
});

$('.error-banner').addEventListener('click', () => {
  const issue = model?.issues[0];
  if (issue) vscode.postMessage({ type: 'navigate', range: issue.range });
});

async function doExport(format: 'svg' | 'png'): Promise<void> {
  if (!scene) return;
  const prev = view.selected;
  view.selected = null;
  view.hover = null;
  // Snap highlight transitions so computed styles reflect the neutral state.
  world.classList.add('exporting');
  world.classList.remove('far'); // exports are always the detailed view
  applyHighlight();
  void world.getBoundingClientRect();
  try {
    const data = format === 'svg' ? exportSvg(world, scene.bounds) : await exportPng(world, scene.bounds);
    vscode.postMessage({ type: 'export', format, data });
  } catch (err) {
    toast(`Export failed: ${(err as Error).message}`);
  } finally {
    world.classList.remove('exporting');
    onCameraChange(currentTransform());
    view.selected = prev;
    applyHighlight();
  }
}

// ---------------------------------------------------------------- keyboard

document.addEventListener('keydown', (ev) => {
  if (ev.target instanceof Element && ev.target.closest('input, textarea')) return;
  if (reader.openFor) {
    if (ev.key === 'Escape') return reader.close();
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      ev.preventDefault();
      return reader.step(ev.key === 'ArrowLeft' ? -1 : 1);
    }
  }
  const mod = ev.metaKey || ev.ctrlKey;
  if ((mod && ev.key === 'f') || ev.key === '/') {
    ev.preventDefault();
    if (!view.sidebar) {
      view.sidebar = true;
      renderLevelButtons();
    }
    searchInput.focus();
    searchInput.select();
    return;
  }
  if (mod && (ev.key === 'z' || ev.key === 'Z' || ev.key === 'y')) {
    ev.preventDefault();
    vscode.postMessage({ type: ev.key === 'y' || ev.shiftKey ? 'redo' : 'undo' });
    return;
  }
  if (mod) return;
  switch (ev.key) {
    case 'f':
    case 'F':
      return fitAll();
    case 'F2':
      if (view.selected) renameElement(view.selected);
      return;

    case '+':
    case '=':
      return zoomBy(1.4);
    case '-':
    case '_':
      return zoomBy(1 / 1.4);
    case '1': {
      const { w, h } = viewportSize();
      return void svgSel.transition().duration(300).call(zoomer.scaleTo, 1, [w / 2, h / 2]);
    }
    case 'm':
      view.minimap = !view.minimap;
      return renderLevelButtons();
    case 'Escape':
      if (view.selected) return setSelected(null);
      return goUp();
    case 'Backspace':
      return goUp();
    case 'Enter':
      if (view.selected && !view.selected.startsWith('edge:')) {
        const v = graph?.nodes.get(view.selected);
        if (v?.collapsed) return toggleCollapse(v.id);
        if (v?.kind === 'group' && !v.frame) return drillInto(v.id);
        return goToSource(view.selected);
      }
      return;
    case '[':
      if (view.selected && model?.nodes[view.selected]?.children.length && !view.collapsed.has(view.selected)) toggleCollapse(view.selected);
      return;
    case ']':
      if (view.selected && view.collapsed.has(view.selected)) toggleCollapse(view.selected);
      return;
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
      ev.preventDefault();
      return arrowKey(ev.key, ev.shiftKey);
  }
});

function arrowKey(key: string, fast: boolean): void {
  const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[key]!;
  const current = view.selected && !view.selected.startsWith('edge:') ? scene?.byId.get(visibleFor(view.selected) ?? '') : null;
  if (!current || !scene) {
    const t = currentTransform();
    const step = (fast ? 240 : 80) / t.k;
    zoomer.translateBy(svgSel, -dir[0] * step, -dir[1] * step);
    return;
  }
  // Spatial navigation: nearest element in the pressed direction.
  const cx = current.x + current.w / 2;
  const cy = current.y + current.h / 2;
  let best: { id: string; score: number } | null = null;
  for (const n of scene.nodes) {
    if (n.v.id === current.v.id || n.v.kind === 'group') continue;
    const dx = n.x + n.w / 2 - cx;
    const dy = n.y + n.h / 2 - cy;
    const along = dx * dir[0] + dy * dir[1];
    if (along <= 10) continue;
    const perp = Math.abs(dx * dir[1] - dy * dir[0]);
    const score = along + perp * 2.2;
    if (!best || score < best.score) best = { id: n.v.id, score };
  }
  if (best) {
    setSelected(best.id);
    ensureVisible(scene.byId.get(best.id)!);
  }
}

// ---------------------------------------------------------------- decisions

const reader = new DecisionReader($('.adr-reader'), {
  openFile: (path) => vscode.postMessage({ type: 'openFile', path }),
  openLink: (url) => vscode.postMessage({ type: 'openLink', url }),
  decisionsOf: (component) => adrIndex?.components[component] ?? [],
  nameOf: (component) => nameOf(component),
  find: (file) => {
    for (const [component, list] of Object.entries(adrIndex?.components ?? {})) {
      const index = list.findIndex((a) => a.file === file);
      if (index >= 0) return { component, index };
    }
    return undefined;
  },
  onChange: () => renderTree(),
});

function openDecisions(id: string): void {
  if (!adrIndex?.components[id]?.length) return;
  if (view.selected !== id) setSelected(id);
  reader.open(id, 0);
}

// The host asks for a title, then creates the MADR file and opens it.
function newDecision(id: string): void {
  if (!adrIndex?.roots.length) return toast("Add adr-folders to the file's vars to record decisions");
  vscode.postMessage({ type: 'newDecision', id });
}

function decisionsSection(id: string): string {
  const list = adrIndex?.components[id] ?? [];
  const add = adrIndex?.roots.length
    ? `<button class="icon-btn d-add" data-action="new-decision" title="New decision">${iconSvg('plus', 14)}</button>`
    : '';
  if (!list.length) {
    const key = esc(model!.nodes[id].key);
    return `<div class="d-section-title">Decisions${add}</div>
      <p class="d-note">${
        add
          ? 'No decisions recorded yet.'
          : `No ADR folders set. Add <code>adr-folders: [adr]</code> to the file's <code>vars</code> and MADR files to <code>adr/${key}/</code>.`
      }</p>`;
  }
  return `<div class="d-section-title">Decisions <span>${list.length}</span>${add}</div>
    <div class="adr-list">${list
      .map(
        (a, i) => `<button class="adr-row" data-adr="${i}" title="${esc(a.name)}">
          <span class="adr-num">${esc(adrNumber(a))}</span>
          <span class="adr-title">${esc(a.title)}</span>
          ${statusPill(a)}
        </button>`,
      )
      .join('')}</div>`;
}

// ------------------------------------------------------------------ editing

// Visual edits are limited to texts and appearance; structure is edited in the D2 file.
function sendEdit(edit: EditOp): void {
  if (model?.valid === false) return toast('Fix the errors in the D2 file to edit the diagram');
  vscode.postMessage({ type: 'edit', edit });
}

function directEdge(selection: string): DiagramEdge | undefined {
  const e = selection.startsWith('edge:') ? findVEdge(selection.slice(5)) : undefined;
  return e && !e.implied ? e.edges[0] : undefined;
}

function renameElement(id: string): void {
  if (model?.valid === false) return toast('Fix the errors in the D2 file to edit the diagram');
  const k = currentTransform().k;
  if (id.startsWith('edge:')) {
    const e = directEdge(id);
    const ve = findVEdge(id.slice(5));
    if (!e || !ve) return;
    const label = world.querySelector(`g.edge-label[data-id="${CSS.escape(ve.id)}"] text`);
    const line = world.querySelector<SVGPathElement>(`g.edge[data-id="${CSS.escape(ve.id)}"] path.edge-line`);
    let anchor: { getBoundingClientRect(): DOMRect } | null = label;
    if (!anchor && line) {
      const p = line.getPointAtLength(line.getTotalLength() / 2);
      const m = line.getScreenCTM()!;
      const x = p.x * m.a + p.y * m.c + m.e;
      const y = p.x * m.b + p.y * m.d + m.f;
      anchor = { getBoundingClientRect: () => new DOMRect(x - 50, y - 10, 100, 20) };
    }
    if (!anchor) return;
    startInlineRename({
      anchor: anchor as Element,
      value: e.label ?? '',
      scale: k,
      fontSize: 12,
      minWidth: 120,
      placeholder: 'Label',
      onCommit: (label) => sendEdit({ op: 'setEdgeLabel', id: e.id, label }),
    });
    return;
  }
  const n = model?.nodes[id];
  const g = world.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!n || !g) {
    setSelected(id);
    detailsEl.querySelector<HTMLInputElement>('.d-title-input')?.focus();
    return;
  }
  const isGroup = g.classList.contains('group');
  const text = g.querySelector('text.group-title, text.title, text.table-title, text.free-text') ?? g;
  startInlineRename({
    anchor: text,
    value: n.label,
    scale: k,
    fontSize: isGroup ? 15 : 14,
    minWidth: isGroup ? 220 : CARD.width - CARD.pad * 2 - CARD.icon - CARD.gap,
    placeholder: 'Name',
    onCommit: (label) => sendEdit({ op: 'setLabel', id, label }),
  });
}

function openContextMenu(id: string | null, ev: MouseEvent): void {
  if (!model) return;
  const ro = model.valid === false;
  let items: (MenuItem | 'sep')[];
  if (!id) {
    items = [
      { label: 'Undo', icon: 'undo', hint: '⌘Z', run: () => vscode.postMessage({ type: 'undo' }) },
      { label: 'Redo', icon: 'redo', hint: '⇧⌘Z', run: () => vscode.postMessage({ type: 'redo' }) },
      'sep',
      { label: 'Fit to screen', icon: 'fit', hint: 'F', run: () => fitAll() },
    ];
  } else if (id.startsWith('edge:')) {
    const e = directEdge(id);
    items = [
      { label: 'Edit label', icon: 'pencil', hint: 'F2', disabled: ro || !e, run: () => renameElement(id) },
      { label: 'Go to source', icon: 'source', run: () => goToSource(id) },
    ];
  } else {
    const n = model.nodes[id];
    const v = graph?.nodes.get(id);
    items = [
      { label: 'Rename', icon: 'pencil', hint: 'F2', disabled: ro, run: () => renameElement(id) },
      'sep',
      ...(n?.children.length
        ? [
            { label: 'Drill in', icon: 'drill' as IconName, run: () => drillInto(id) },
            ...(v && !v.frame
              ? [{ label: v.collapsed ? 'Expand' : 'Collapse', icon: (v.collapsed ? 'expand' : 'collapse') as IconName, run: () => toggleCollapse(id) }]
              : []),
          ]
        : []),
      ...(adrIndex?.components[id]?.length
        ? [{ label: `Decisions (${adrIndex.components[id].length})`, icon: 'decision' as IconName, run: () => openDecisions(id) }]
        : []),
      { label: 'New decision…', icon: 'plus', run: () => newDecision(id) },
      { label: 'Go to source', icon: 'source', hint: '⌘-click', run: () => goToSource(id) },
    ];
  }
  // Outline what the menu acts on instead of selecting it, which would open the details panel.
  const target = !id
    ? null
    : id.startsWith('edge:')
      ? world.querySelector(`g.edge[data-id="${CSS.escape(findVEdge(id.slice(5))?.id ?? '')}"]`)
      : world.querySelector(`[data-id="${CSS.escape(id)}"]`);
  target?.classList.add('menu-target');
  showMenu(ev.clientX, ev.clientY, items, () => target?.classList.remove('menu-target'));
}

function renderBanner(): void {
  const banner = $('.error-banner');
  const invalid = model?.valid === false && !!model.issues.length;
  app.classList.toggle('readonly', model?.valid === false);
  banner.classList.toggle('show', invalid);
  if (invalid) {
    const issue = model!.issues[0];
    banner.innerHTML = `${iconSvg('warning', 14)}<span><b>Line ${issue.range.line + 1}:</b> ${esc(issue.message)}</span><em>Showing the last valid diagram</em>`;
  }
}

// -------------------------------------------------------------------- misc

let toastTimer: number | undefined;
function toast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function nameOf(id: string): string {
  const n: DiagramNode | undefined = model?.nodes[id];
  return n ? firstLine(plainLabel(n.label, n.labelFormat)) : id;
}

function firstLine(s: string): string {
  return s.split('\n')[0];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function highlightMatch(label: string, q: string): string {
  if (!q) return esc(label);
  const i = label.toLowerCase().indexOf(q);
  if (i < 0) return esc(label);
  return `${esc(label.slice(0, i))}<mark>${esc(label.slice(i, i + q.length))}</mark>${esc(label.slice(i + q.length))}`;
}

new ResizeObserver(() => updateMinimapViewport(currentTransform())).observe(svg);

// ----------------------------------------------------------------- messages

window.addEventListener('message', (ev: MessageEvent<HostMessage>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'update': {
      const first = !model;
      const turned = !!model && model.direction !== msg.model.direction;
      model = msg.model;
      docUri = msg.uri;
      adrIndex = msg.adrs ?? null;
      renderer.adrCounts = new Map(Object.entries(adrIndex?.components ?? {}).map(([id, list]) => [id, list.length]));
      reader.refresh();
      renderBanner();
      $('.file-name').textContent = msg.fileName;
      if (msg.config?.wheel) view.wheel = msg.config.wheel;
      if (first && !saved) {
        // Open at the top level (systems collapsed), as a context view.
        const depth = msg.config?.defaultDepth ?? 1;
        view.collapsed = collapseToLevel(model, null, depth);
        view.level = depth;
      }
      if (first) for (const id of model.roots) treeOpen.add(id);
      // A new direction re-lays out everything, so re-fit.
      void refresh({ animate: true, fit: turned ? 'all' : undefined });
      break;
    }
    case 'toast':
      toast(msg.message);
      break;
    case 'cursor':
      view.cursor = msg.id;
      applyHighlight();
      break;
    case 'command':
      if (msg.command === 'fit') fitAll();
      else void doExport(msg.command === 'export-svg' ? 'svg' : 'png');
      break;
  }
});

renderLevelButtons();
vscode.postMessage({ type: 'ready' });
