// The decision reader: a drawer that renders a component's ADRs (MADR
// Markdown) with their status and metadata, one at a time.

import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { Adr, AdrStatus } from '../src/model.ts';
import { iconSvg } from './render.ts';

const STATUS_LABEL: Record<AdrStatus, string> = {
  proposed: 'Proposed',
  accepted: 'Accepted',
  rejected: 'Rejected',
  deprecated: 'Deprecated',
  superseded: 'Superseded',
  unknown: 'No status',
};

export function statusLabel(adr: Adr): string {
  return STATUS_LABEL[adr.status];
}

export function statusPill(adr: Adr): string {
  return `<span class="adr-status s-${adr.status}">${STATUS_LABEL[adr.status]}</span>`;
}

export function adrNumber(adr: Adr): string {
  return adr.number ? `ADR-${adr.number}` : 'ADR';
}

export interface ReaderHost {
  openFile(path: string): void;
  openLink(url: string): void;
  // Locate an ADR by absolute path, e.g. for links between ADRs.
  find(file: string): { component: string; index: number } | undefined;
  decisionsOf(component: string): Adr[];
  nameOf(component: string): string;
  // The reader opened, closed or moved to another decision.
  onChange(): void;
}

export class DecisionReader {
  private component: string | null = null;
  private index = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly host: ReaderHost,
  ) {
    el.addEventListener('click', (ev) => this.onClick(ev));
  }

  get openFor(): string | null {
    return this.component;
  }

  // The file shown, while open.
  get openFile(): string | undefined {
    return this.component ? this.el.dataset.file : undefined;
  }

  open(component: string, index = 0): void {
    this.component = component;
    this.index = index;
    this.render();
    this.el.classList.add('open');
    this.el.querySelector<HTMLElement>('.r-scroll')?.scrollTo(0, 0);
    this.host.onChange();
  }

  close(): void {
    if (!this.component) return;
    this.component = null;
    this.el.classList.remove('open');
    this.host.onChange();
  }

  step(delta: number): void {
    if (!this.component) return;
    const count = this.host.decisionsOf(this.component).length;
    const next = this.index + delta;
    if (next < 0 || next >= count) return;
    this.open(this.component, next);
  }

  // ADR files changed on disk: keep showing the same file if it still exists.
  refresh(): void {
    if (!this.component) return;
    const list = this.host.decisionsOf(this.component);
    if (!list.length) return this.close();
    const current = this.el.dataset.file;
    const at = list.findIndex((a) => a.file === current);
    this.index = at >= 0 ? at : Math.min(this.index, list.length - 1);
    this.render();
  }

  private render(): void {
    const list = this.host.decisionsOf(this.component!);
    const adr = list[this.index];
    if (!adr) return this.close();
    this.el.dataset.file = adr.file;
    const meta = [
      ['Date', adr.date],
      ['Status', adr.statusText],
      ['Decision-makers', adr.decisionMakers],
      ['Consulted', adr.consulted],
      ['Informed', adr.informed],
    ].filter(([, v]) => v);
    const html = DOMPurify.sanitize(marked.parse(adr.body, { gfm: true, async: false }) as string);
    this.el.innerHTML = `
      <header class="r-head">
        <div class="r-crumb">${iconSvg('decision', 14)}<span>Decisions · ${esc(this.host.nameOf(this.component!))}</span></div>
        <div class="r-nav">
          <button class="icon-btn" data-step="-1" title="Previous (←)" ${this.index === 0 ? 'disabled' : ''}>${iconSvg('arrowLeft', 14)}</button>
          <span class="r-count">${this.index + 1} / ${list.length}</span>
          <button class="icon-btn" data-step="1" title="Next (→)" ${this.index === list.length - 1 ? 'disabled' : ''}>${iconSvg('arrowRight', 14)}</button>
          <span class="sep"></span>
          <button class="icon-btn" data-act="file" title="Open the Markdown file">${iconSvg('source', 14)}</button>
          <button class="icon-btn" data-act="close" title="Close (Esc)">${iconSvg('close', 14)}</button>
        </div>
      </header>
      <div class="r-scroll">
        <div class="r-kicker"><span class="adr-num">${adrNumber(adr)}</span>${statusPill(adr)}</div>
        <h1 class="r-title">${esc(adr.title)}</h1>
        ${meta.length ? `<dl class="r-meta">${meta.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v!)}</dd>`).join('')}</dl>` : ''}
        <article class="markdown">${html}</article>
        <footer class="r-file">${esc(adr.name)}</footer>
      </div>`;
  }

  private onClick(ev: MouseEvent): void {
    const target = ev.target as Element;
    const btn = target.closest<HTMLElement>('button');
    if (btn?.dataset.step) return this.step(Number(btn.dataset.step));
    if (btn?.dataset.act === 'close') return this.close();
    if (btn?.dataset.act === 'file' && this.el.dataset.file) return this.host.openFile(this.el.dataset.file);

    const link = target.closest<HTMLAnchorElement>('article a[href]');
    if (!link) return;
    ev.preventDefault();
    const href = link.getAttribute('href')!;
    if (href.startsWith('#')) {
      this.el.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return this.host.openLink(href);
    // Relative link: another ADR opens here, any other file in the editor.
    const file = resolvePath(this.el.dataset.file!, decodeURIComponent(href.split('#')[0]));
    const hit = this.host.find(file);
    if (hit) this.open(hit.component, hit.index);
    else this.host.openFile(file);
  }
}

function resolvePath(from: string, rel: string): string {
  const sep = from.includes('\\') && !from.includes('/') ? '\\' : '/'; // Windows paths
  const parts = from.split(sep).slice(0, -1);
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join(sep);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
