import { select, type Selection } from 'd3-selection';
import 'd3-transition';
import { easeCubicInOut } from 'd3-ease';
import { CARD, TABLE, type Point, type Scene, type SEdge, type SNode } from './layout.ts';
import { ICONS, isColor, isDark, measure, type IconName } from './theme.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sel = Selection<any, any, any, any>;

export type EdgeStyle = 'orthogonal' | 'curved';

export interface RenderHandlers {
  select(id: string | null, event: MouseEvent): void;
  activate(id: string, event: MouseEvent): void; // double click
  toggle(id: string): void; // collapse / expand a container
  drill(id: string): void; // focus a container
  up(): void; // leave the current focus
  hover(id: string | null): void;
  contextMenu(id: string | null, ev: MouseEvent): void; // id is a node id or "edge:<id>"
  decisions(id: string): void; // the ADR badge was clicked
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const DURATION = 480;

export function icon(parent: Sel, name: IconName, size: number, x = 0, y = 0): Sel {
  return parent
    .append('path')
    .attr('class', 'glyph')
    .attr('d', ICONS[name])
    .attr('transform', `translate(${x},${y}) scale(${size / 24})`);
}

export function iconSvg(name: IconName, size = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name]}"/></svg>`;
}

export class Renderer {
  private readonly root: Sel;
  private readonly groupLayer: Sel;
  private readonly edgeLayer: Sel;
  private readonly nodeLayer: Sel;
  private readonly labelLayer: Sel;
  private readonly annotationLayer: Sel;
  scene: Scene | null = null;
  edgeStyle: EdgeStyle = 'orthogonal';
  adrCounts = new Map<string, number>(); // element id -> number of ADRs

  constructor(world: SVGGElement, private readonly on: RenderHandlers) {
    this.root = select(world);
    this.groupLayer = this.root.append('g').attr('class', 'layer-groups');
    this.edgeLayer = this.root.append('g').attr('class', 'layer-edges');
    this.nodeLayer = this.root.append('g').attr('class', 'layer-nodes');
    this.labelLayer = this.root.append('g').attr('class', 'layer-labels');
    this.annotationLayer = this.root.append('g').attr('class', 'layer-annotations');
  }

  render(scene: Scene, animate: boolean, annotations: { text: string; near: string }[] = []): void {
    this.scene = scene;
    const t = this.root.transition().duration(animate ? DURATION : 0).ease(easeCubicInOut);

    // ------------------------------------------------------------ groups
    const groups = this.groupLayer
      .selectAll<SVGGElement, SNode>('g.group')
      .data(scene.nodes.filter((n) => n.v.kind === 'group'), (d) => d.v.id);

    groups
      .exit()
      .transition(t as never)
      .style('opacity', 0)
      .remove();

    const groupsEnter = groups
      .enter()
      .append('g')
      .attr('class', 'group')
      .attr('data-id', (d) => d.v.id)
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .style('opacity', 0)
      .each(function () {
        const g = select(this);
        g.append('rect').attr('class', 'group-bg');
        const header = g.append('g').attr('class', 'group-header').attr('transform', 'translate(18,16)');
        header.append('rect').attr('class', 'icon-tile').attr('width', 32).attr('height', 32).attr('rx', 9);
        header.append('g').attr('class', 'icon-holder');
        header.append('text').attr('class', 'group-title').attr('x', 44).attr('y', 14);
        header.append('text').attr('class', 'group-meta').attr('x', 44).attr('y', 31);
        g.append('g').attr('class', 'btn btn-toggle');
        g.append('g').attr('class', 'btn btn-drill');
      });

    const groupsAll = groupsEnter.merge(groups);
    groupsAll.each((d, i, els) => this.drawGroup(select(els[i]), d));
    groupsAll
      .classed('frame', (d) => d.v.frame)
      .classed('context', (d) => d.v.context)
      .transition(t as never)
      .style('opacity', 1)
      .attr('transform', (d) => `translate(${d.x},${d.y})`);
    groupsAll.select('rect.group-bg').transition(t as never).attr('width', (d) => d.w).attr('height', (d) => d.h);
    groupsAll
      .select('g.btn-toggle')
      .transition(t as never)
      .attr('transform', (d) => `translate(${d.w - 46},16)`);
    groupsAll
      .select('g.btn-drill')
      .transition(t as never)
      .attr('transform', (d) => `translate(${d.w - (d.v.frame ? 46 : 82)},16)`);

    // ------------------------------------------------------------- nodes
    const nodes = this.nodeLayer
      .selectAll<SVGGElement, SNode>('g.node')
      .data(scene.nodes.filter((n) => n.v.kind !== 'group'), (d) => d.v.id);

    nodes
      .exit()
      .transition(t as never)
      .style('opacity', 0)
      .remove();

    const nodesEnter = nodes
      .enter()
      .append('g')
      .attr('class', 'node')
      .attr('data-id', (d) => d.v.id)
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .style('opacity', 0);

    const nodesAll = nodesEnter.merge(nodes);
    nodesAll.each((d, i, els) => this.drawNode(select(els[i]), d));
    nodesAll
      .attr('class', (d) => `node kind-${d.v.kind}`)
      .classed('context', (d) => d.v.context)
      .classed('collapsed', (d) => d.v.collapsed)
      .transition(t as never)
      .style('opacity', 1)
      .attr('transform', (d) => `translate(${d.x},${d.y})`);

    for (const sel of [groupsAll, nodesAll]) {
      sel
        .on('click', (ev: MouseEvent, d: SNode) => {
          ev.stopPropagation();
          this.on.select(d.v.id, ev);
        })
        .on('dblclick', (ev: MouseEvent, d: SNode) => {
          ev.stopPropagation();
          this.on.activate(d.v.id, ev);
        })
        .on('mouseenter', (_ev: MouseEvent, d: SNode) => this.on.hover(d.v.id))
        .on('mouseleave', () => this.on.hover(null))
        .on('contextmenu', (ev: MouseEvent, d: SNode) => {
          ev.preventDefault();
          ev.stopPropagation();
          this.on.contextMenu(d.v.id, ev);
        });
    }

    // ------------------------------------------------------------- edges
    const edges = this.edgeLayer
      .selectAll<SVGGElement, SEdge>('g.edge')
      .data(scene.edges, (d) => d.v.id);
    edges.exit().remove();

    const edgesEnter = edges
      .enter()
      .append('g')
      .attr('class', 'edge')
      .attr('data-id', (d) => d.v.id)
      .style('opacity', 0)
      .each(function () {
        const g = select(this);
        g.append('path').attr('class', 'edge-hit');
        g.append('path').attr('class', 'edge-line');
        g.append('path').attr('class', 'edge-arrow dst');
        g.append('path').attr('class', 'edge-arrow src');
      });

    const edgesAll = edgesEnter.merge(edges);
    edgesAll
      .classed('implied', (d) => d.v.implied)
      .classed('animated', (d) => d.v.style.animated === 'true')
      .each((d, i, els) => {
        const g = select(els[i]);
        const geom = this.edgeGeometry(d);
        const line = g.select('path.edge-line');
        const stroke = d.v.style.stroke && isColor(d.v.style.stroke) ? d.v.style.stroke : null;
        const dash = d.v.style['stroke-dash'];
        const seg = dash && dash !== '0' ? +dash * 1.5 + 2 : null;
        line
          .style('stroke', nullable(stroke))
          .style('stroke-width', nullable(d.v.style['stroke-width'] ? `${d.v.style['stroke-width']}px` : null))
          .style('stroke-dasharray', nullable(seg ? `${seg} ${seg}` : null))
          // One dash + gap, so the flow animation loops without a jump.
          .style('--dash-period', nullable(seg ? `${seg * 2}px` : null))
          .style('opacity', d.v.style.opacity ?? null);
        g.selectAll('path.edge-arrow').style('fill', nullable(stroke)).style('stroke', nullable(stroke));

        const prev = line.attr('d');
        const apply = () => {
          g.select('path.edge-hit').attr('d', geom.hit);
          line.attr('d', geom.line);
          g.select('path.edge-arrow.dst').attr('d', geom.dst).classed('open', geom.dstOpen);
          g.select('path.edge-arrow.src').attr('d', geom.src).classed('open', geom.srcOpen);
        };
        if (!animate || !prev || prev === geom.line) {
          apply();
          g.style('opacity', 1);
          return;
        }
        g.transition(t as never).tween('morph', () => {
          let swapped = false;
          return (k: number) => {
            if (k >= 0.5 && !swapped) {
              swapped = true;
              apply();
            }
            g.style('opacity', String(Math.abs(1 - 2 * k)));
          };
        });
      })
      .call((sel) => this.edgeEvents(sel));

    edgesEnter
      .transition()
      .delay(animate ? DURATION * 0.6 : 0)
      .duration(animate ? 240 : 0)
      .style('opacity', 1);

    // ------------------------------------------------------- edge labels
    const labels = this.labelLayer
      .selectAll<SVGGElement, SEdge>('g.edge-label')
      .data(
        scene.edges.filter((e) => e.label),
        (d) => d.v.id,
      );
    labels.exit().remove();
    const labelsEnter = labels
      .enter()
      .append('g')
      .attr('class', 'edge-label')
      .attr('data-id', (d) => d.v.id)
      .style('opacity', 0)
      .each(function () {
        const g = select(this);
        g.append('rect').attr('rx', 11);
        g.append('text').attr('dy', '0.35em');
      });
    const labelsAll = labelsEnter.merge(labels);
    labelsAll
      .classed('implied', (d) => d.v.implied)
      .each(function (d) {
        const g = select(this);
        const l = d.label!;
        g.select('rect').attr('width', l.w).attr('height', l.h);
        g.select('text').attr('x', l.w / 2).attr('y', l.h / 2).text(truncate(l.text, 12, 500, l.w - 16));
      })
      .call((sel) => this.edgeEvents(sel));
    labelsAll
      .transition(t as never)
      .style('opacity', 1)
      .attr('transform', (d) => `translate(${d.label!.x},${d.label!.y})`);
    labelsEnter.attr('transform', (d) => `translate(${d.label!.x},${d.label!.y})`);

    // --------------------------------------------------------- annotations
    const b = scene.bounds;
    const ann = this.annotationLayer.selectAll<SVGTextElement, { text: string; near: string }>('text').data(annotations);
    ann.exit().remove();
    ann
      .enter()
      .append('text')
      .attr('class', 'annotation')
      .merge(ann)
      .text((d) => d.text)
      .attr('text-anchor', (d) => (d.near.endsWith('left') ? 'start' : d.near.endsWith('right') ? 'end' : 'middle'))
      .attr('x', (d) => (d.near.endsWith('left') ? b.x + 40 : d.near.endsWith('right') ? b.x + b.w - 40 : b.x + b.w / 2))
      .attr('y', (d) => (d.near.startsWith('bottom') ? b.y + b.h + 24 : b.y - 8));
  }

  private edgeEvents(sel: Sel): void {
    sel
      .on('click', (ev: MouseEvent, d: SEdge) => {
        ev.stopPropagation();
        this.on.select(`edge:${d.v.id}`, ev);
      })
      .on('dblclick', (ev: MouseEvent, d: SEdge) => {
        ev.stopPropagation();
        this.on.activate(`edge:${d.v.id}`, ev);
      })
      .on('contextmenu', (ev: MouseEvent, d: SEdge) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.on.contextMenu(`edge:${d.v.id}`, ev);
      })
      .on('mouseenter', (_ev: MouseEvent, d: SEdge) => this.on.hover(`edge:${d.v.id}`))
      .on('mouseleave', () => this.on.hover(null));
  }

  // ------------------------------------------------------------- drawing

  private drawGroup(g: Sel, d: SNode): void {
    const v = d.v;
    const style = v.node.style;
    g.select('rect.group-bg')
      .attr('rx', 18)
      .style('fill', nullable(style.fill && isColor(style.fill) ? style.fill : null))
      .style('stroke', nullable(style.stroke && isColor(style.stroke) ? style.stroke : null))
      .style('stroke-dasharray', nullable(style['stroke-dash'] && style['stroke-dash'] !== '0' ? '6 5' : null))
      .style('--accent', v.type.accent);
    g.style('--accent', v.type.accent).classed('depth-odd', v.depth % 2 === 1);

    const header = g.select('g.group-header');
    const holder = header.select('g.icon-holder');
    holder.selectAll('*').remove();
    drawIcon(holder, v.node.icon, v.type.icon, 32, 18);
    header.select('text.group-title').text(v.node.label.replace(/\n/g, ' '));
    const adrs = this.adrCounts.get(v.id) ?? 0;
    const decisions = adrs ? ` · ${adrs} ADR${adrs === 1 ? '' : 's'}` : '';
    const meta = `${v.type.name}${v.frame ? ' · focused' : ''} · ${v.descendants} item${v.descendants === 1 ? '' : 's'}${decisions}`;
    header.select('text.group-meta').text(meta.toUpperCase());

    const toggle = g.select('g.btn-toggle').style('display', nullable(v.frame ? 'none' : null));
    button(toggle, 'collapse', 'Collapse', () => this.on.toggle(v.id));
    const drill = g.select('g.btn-drill');
    if (v.frame) button(drill, 'arrowUp', 'Go up a level', () => this.on.up());
    else button(drill, 'drill', 'Drill in', () => this.on.drill(v.id));
  }

  private drawNode(g: Sel, d: SNode): void {
    g.selectAll('*').remove();
    const v = d.v;
    const style = v.node.style;
    g.style('--accent', v.type.accent);
    g.style('opacity', style.opacity ?? null);

    if (v.kind === 'text') {
      let y = 4;
      const text = g.append('text').attr('class', 'free-text');
      for (const line of d.text!.lines) {
        y += line.size * 1.15;
        text
          .append('tspan')
          .attr('x', 4)
          .attr('y', y)
          .style('font-size', `${line.size}px`)
          .style('font-weight', line.weight)
          .text(line.text);
        y += line.size * 0.25;
      }
      g.insert('rect', 'text').attr('class', 'hit').attr('width', d.w).attr('height', d.h);
      return;
    }

    const fill = style.fill && isColor(style.fill) ? style.fill : null;
    const tone = fill ? (isDark(fill) ? 'on-dark' : 'on-light') : '';
    const radius = v.node.shape === 'circle' || v.node.shape === 'oval' ? Math.min(d.h / 2, 36) : CARD.radius;
    const stacked = v.collapsed || style.multiple === 'true' || style['3d'] === 'true';

    if (stacked) {
      g.append('rect').attr('class', 'stack s2').attr('x', 8).attr('y', 8).attr('width', d.w).attr('height', d.h).attr('rx', radius);
      g.append('rect').attr('class', 'stack s1').attr('x', 4).attr('y', 4).attr('width', d.w).attr('height', d.h).attr('rx', radius);
    }
    g.append('rect')
      .attr('class', `card ${tone}`)
      .attr('width', d.w)
      .attr('height', d.h)
      .attr('rx', radius)
      .style('fill', nullable(fill))
      .style('stroke', nullable(style.stroke && isColor(style.stroke) ? style.stroke : null))
      .style('stroke-width', nullable(style['stroke-width'] ? `${style['stroke-width']}px` : null))
      .style('stroke-dasharray', nullable(style['stroke-dash'] && style['stroke-dash'] !== '0' ? '6 5' : null));
    g.attr('data-tone', tone || null);

    if (v.kind === 'table') {
      this.drawTable(g, d);
      return;
    }

    const c = d.card!;
    const fontColor = style['font-color'] && isColor(style['font-color']) ? style['font-color'] : null;
    const tile = g.append('g').attr('class', 'icon-tile-g').attr('transform', `translate(${CARD.pad},${CARD.pad})`);
    tile.append('rect').attr('class', 'icon-tile').attr('width', CARD.icon).attr('height', CARD.icon).attr('rx', 9);
    drawIcon(tile, v.node.icon, v.type.icon, CARD.icon, 20);

    const tx = CARD.pad + CARD.icon + CARD.gap;
    const headerH = Math.max(CARD.icon, 16 + c.title.length * CARD.titleLine);
    const top = CARD.pad + (headerH - (16 + c.title.length * CARD.titleLine)) / 2;
    g.append('text').attr('class', 'type-label').attr('x', tx).attr('y', top + 9).text(c.typeLabel.toUpperCase());
    const title = g
      .append('text')
      .attr('class', 'title')
      .style('fill', nullable(fontColor))
      .style('font-weight', nullable(style.bold === 'false' ? 500 : null))
      .style('font-style', nullable(style.italic === 'true' ? 'italic' : null))
      .style('text-decoration', nullable(style.underline === 'true' ? 'underline' : null));
    c.title.forEach((line, i) =>
      title
        .append('tspan')
        .attr('x', tx)
        .attr('y', top + 16 + 13 + i * CARD.titleLine)
        .text(line),
    );

    let y = CARD.pad + headerH;
    if (c.desc.length) {
      const desc = g.append('text').attr('class', 'desc').style('fill', nullable(fontColor));
      y += 6;
      c.desc.forEach((line, i) =>
        desc
          .append('tspan')
          .attr('x', CARD.pad)
          .attr('y', y + 12 + i * CARD.descLine)
          .text(line),
      );
      y += c.desc.length * CARD.descLine;
    }

    if (c.footer) {
      const w = measure(c.footer, 11, 600) + 34;
      const chip = g
        .append('g')
        .attr('class', 'footer-chip')
        .attr('transform', `translate(${CARD.pad},${d.h - CARD.pad - CARD.footer})`);
      chip.append('rect').attr('width', w).attr('height', CARD.footer).attr('rx', 11);
      icon(chip, 'layers', 12, 9, 5);
      chip.append('text').attr('x', 26).attr('y', 15).text(c.footer);
      const expand = g.append('g').attr('class', 'btn btn-toggle').attr('transform', `translate(${d.w - 40},${d.h - 40})`);
      button(expand, 'expand', 'Expand', () => this.on.toggle(v.id));
    }

    const adrs = this.adrCounts.get(v.id) ?? 0;
    if (adrs) {
      const label = String(adrs);
      const w = measure(label, 10.5, 650) + 28;
      const right = d.w - 10 - (v.node.link ? 22 : 0);
      const badge = g.append('g').attr('class', 'adr-badge').attr('transform', `translate(${right - w},10)`);
      badge.append('title').text(`${adrs} architecture decision${adrs === 1 ? '' : 's'}`);
      badge.append('rect').attr('width', w).attr('height', 20).attr('rx', 10);
      icon(badge, 'decision', 12, 7, 4);
      badge.append('text').attr('x', 22).attr('y', 10).attr('dy', '0.35em').text(label);
      badge
        .on('click', (ev: MouseEvent) => {
          ev.stopPropagation();
          this.on.decisions(v.id);
        })
        .on('dblclick', (ev: MouseEvent) => ev.stopPropagation());
    }

    if (v.node.link) {
      const l = g.append('g').attr('class', 'link-mark').attr('transform', `translate(${d.w - 26},12)`);
      l.append('title').text(v.node.link);
      icon(l, 'external', 13);
    }
  }

  private drawTable(g: Sel, d: SNode): void {
    const v = d.v;
    g.append('path')
      .attr('class', 'table-header')
      .attr('d', `M0 ${CARD.radius}a${CARD.radius} ${CARD.radius} 0 0 1 ${CARD.radius} -${CARD.radius}h${d.w - 2 * CARD.radius}a${CARD.radius} ${CARD.radius} 0 0 1 ${CARD.radius} ${CARD.radius}v${TABLE.header - CARD.radius}h-${d.w}z`);
    const head = g.append('g').attr('transform', `translate(${TABLE.pad},${(TABLE.header - 18) / 2})`);
    icon(head, 'table', 18);
    head.append('text').attr('class', 'table-title').attr('x', 26).attr('y', 14).text(v.node.label);
    if (!v.node.fields?.length) {
      g.append('text').attr('class', 'table-empty').attr('x', d.w / 2).attr('y', TABLE.header + TABLE.row / 2 + 4).attr('text-anchor', 'middle').text('No columns yet');
    }

    (v.node.fields ?? []).forEach((f, i) => {
      const y = TABLE.header + i * TABLE.row;
      const row = g.append('g').attr('class', 'table-row').attr('transform', `translate(0,${y})`);
      if (i % 2 === 1) row.append('rect').attr('class', 'zebra').attr('x', 1).attr('width', d.w - 2).attr('height', TABLE.row);
      let x = TABLE.pad;
      const badge = constraintBadge(f.constraint);
      if (badge) {
        row.append('rect').attr('class', `badge ${badge.cls}`).attr('x', x).attr('y', 6).attr('width', 26).attr('height', 16).attr('rx', 4);
        row.append('text').attr('class', `badge-text ${badge.cls}`).attr('x', x + 13).attr('y', 17.5).attr('text-anchor', 'middle').text(badge.text);
      }
      x += 34;
      row.append('text').attr('class', 'field-name').attr('x', x).attr('y', 18).text(f.name);
      row.append('text').attr('class', 'field-type').attr('x', d.w - TABLE.pad).attr('y', 18).attr('text-anchor', 'end').text(f.type);
    });
  }

  // ------------------------------------------------------------ geometry

  private edgeGeometry(e: SEdge) {
    const pts = dedupe(e.points);
    const empty = { line: '', hit: '', dst: '', src: '', dstOpen: false, srcOpen: false };
    if (pts.length < 2) return empty;
    const len = 11;
    const linePts = pts.map((p) => ({ ...p }));
    const dstShape = e.v.dstArrowhead ?? 'triangle';
    const srcShape = e.v.srcArrowhead ?? 'triangle';
    if (e.v.dstArrow) pullBack(linePts, linePts.length - 1, linePts.length - 2, dstShape === 'arrow' ? 1 : len - 2);
    if (e.v.srcArrow) pullBack(linePts, 0, 1, srcShape === 'arrow' ? 1 : len - 2);
    const radius = this.edgeStyle === 'curved' ? 400 : 12;
    return {
      line: roundedPath(linePts, radius),
      hit: roundedPath(pts, radius),
      dst: e.v.dstArrow ? arrowhead(pts[pts.length - 1], pts[pts.length - 2], dstShape, len) : '',
      src: e.v.srcArrow ? arrowhead(pts[0], pts[1], srcShape, len) : '',
      dstOpen: dstShape === 'arrow' || dstShape === 'diamond' || dstShape === 'circle',
      srcOpen: srcShape === 'arrow' || srcShape === 'diamond' || srcShape === 'circle',
    };
  }
}

// ---------------------------------------------------------------- helpers

function drawIcon(parent: Sel, url: string | undefined, fallback: IconName, tile: number, size: number): void {
  const off = (tile - size) / 2;
  if (url) {
    const img = parent
      .append('image')
      .attr('href', url)
      .attr('x', off - 2)
      .attr('y', off - 2)
      .attr('width', size + 4)
      .attr('height', size + 4)
      .attr('preserveAspectRatio', 'xMidYMid meet');
    img.on('error', () => {
      img.remove();
      icon(parent, fallback, size, off, off);
    });
    return;
  }
  icon(parent, fallback, size, off, off);
}

function button(g: Sel, name: IconName, title: string, onClick: () => void): void {
  g.selectAll('*').remove();
  g.append('title').text(title);
  g.append('rect').attr('width', 28).attr('height', 28).attr('rx', 8);
  icon(g, name, 14, 7, 7);
  g.on('click', (ev: MouseEvent) => {
    ev.stopPropagation();
    onClick();
  }).on('dblclick', (ev: MouseEvent) => ev.stopPropagation());
}

function constraintBadge(constraint?: string): { text: string; cls: string } | null {
  if (!constraint) return null;
  const c = constraint.toLowerCase();
  if (c.includes('primary')) return { text: 'PK', cls: 'pk' };
  if (c.includes('foreign')) return { text: 'FK', cls: 'fk' };
  if (c.includes('unique')) return { text: 'UQ', cls: 'uq' };
  return { text: c.slice(0, 2).toUpperCase(), cls: 'other' };
}

function truncate(text: string, size: number, weight: number, max: number): string {
  if (measure(text, size, weight) <= max) return text;
  let t = text;
  while (t.length > 1 && measure(`${t}…`, size, weight) > max) t = t.slice(0, -1);
  return `${t}…`;
}

function dedupe(points: Point[]): Point[] {
  return points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 0.5);
}

function pullBack(points: Point[], tip: number, prev: number, by: number): void {
  const a = points[tip];
  const b = points[prev];
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  if (d < 1) return;
  const k = Math.min(by, d - 1) / d;
  a.x += (b.x - a.x) * k;
  a.y += (b.y - a.y) * k;
}

export function roundedPath(points: Point[], radius: number): string {
  if (points.length < 2) return '';
  let d = `M${r(points[0].x)},${r(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1];
    const p = points[i];
    const p1 = points[i + 1];
    const d0 = Math.hypot(p.x - p0.x, p.y - p0.y);
    const d1 = Math.hypot(p1.x - p.x, p1.y - p.y);
    const rad = Math.min(radius, d0 / 2, d1 / 2);
    const a = { x: p.x + ((p0.x - p.x) / d0) * rad, y: p.y + ((p0.y - p.y) / d0) * rad };
    const b = { x: p.x + ((p1.x - p.x) / d1) * rad, y: p.y + ((p1.y - p.y) / d1) * rad };
    d += `L${r(a.x)},${r(a.y)}Q${r(p.x)},${r(p.y)} ${r(b.x)},${r(b.y)}`;
  }
  const last = points[points.length - 1];
  return `${d}L${r(last.x)},${r(last.y)}`;
}

function arrowhead(tip: Point, from: Point, shape: string, len: number): string {
  const d = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const ux = (tip.x - from.x) / d;
  const uy = (tip.y - from.y) / d;
  const nx = -uy;
  const ny = ux;
  const w = len * 0.42;
  const at = (back: number, side: number) => `${r(tip.x - ux * back + nx * side)},${r(tip.y - uy * back + ny * side)}`;
  switch (shape) {
    case 'arrow':
      return `M${at(len, w)}L${at(0, 0)}L${at(len, -w)}`;
    case 'diamond':
    case 'filled-diamond':
      return `M${at(0, 0)}L${at(len * 0.75, w)}L${at(len * 1.5, 0)}L${at(len * 0.75, -w)}Z`;
    case 'circle':
    case 'filled-circle': {
      const c = { x: tip.x - ux * (len / 2), y: tip.y - uy * (len / 2) };
      const rad = len / 2;
      return `M${r(c.x - rad)},${r(c.y)}a${rad},${rad} 0 1,0 ${rad * 2},0a${rad},${rad} 0 1,0 ${-rad * 2},0`;
    }
    default:
      return `M${at(0, 0)}L${at(len, w)}Q${at(len * 0.8, 0)} ${at(len, -w)}Z`;
  }
}

// d3's typings reject `string | null` even though null removes the style.
function nullable(v: string | number | null | undefined): string {
  return v as string;
}

function r(n: number): number {
  return Math.round(n * 10) / 10;
}

export { SVG_NS };
