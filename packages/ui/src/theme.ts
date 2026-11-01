import type { DiagramNode } from '@mapitect/core';

export interface TypeInfo {
  name: string;
  icon: IconName;
  accent: string;
}

// Lucide-style 24x24 stroke icons, drawn with stroke="currentColor".
export const ICONS = {
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
  server: 'M5 3h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM5 13h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zM7 7h.01M7 17h.01',
  database: 'M4 5c0-1.66 3.58-3 8-3s8 1.34 8 3-3.58 3-8 3-8-1.34-8-3zM4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3',
  queue: 'M3 6h18M3 12h18M3 18h11M18 15l3 3-3 3',
  cloud: 'M7 19a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.8 9 4.5 4.5 0 0 1 17.5 19z',
  hexagon: 'M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z',
  document: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5',
  package: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  diamond: 'M12 2.5l9.5 9.5-9.5 9.5L2.5 12z',
  circle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  table: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 10h18M9 10v10',
  code: 'M8 6l-6 6 6 6M16 6l6 6-6 6',
  layers: 'M12 2l10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5',
  image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21',
  text: 'M4 7V4h16v3M9 20h6M12 4v16',
  step: 'M5 6l6 6-6 6M13 6l6 6-6 6',
  callout: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  parallelogram: 'M7 4h14l-4 16H3z',
  home: 'M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  close: 'M18 6L6 18M6 6l12 12',
  external: 'M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  source: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M10 13l-2 2 2 2M14 13l2 2-2 2',
  drill: 'M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7',
  expand: 'M4 4h6M4 4v6M20 20h-6M20 20v-6M4 4l6 6M20 20l-6-6',
  collapse: 'M10 4v6H4M14 20v-6h6M10 10L4 4M14 14l6 6',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  sidebar: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 3v18',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  direction: 'M7 17L17 7M17 7H9M17 7v8',
  curve: 'M3 20C3 9 21 15 21 4',
  orthogonal: 'M3 20h8V4h10',
  warning: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  decision: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M9 15l2 2 4-4',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  reload: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  pencil: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  none: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 18.4L18.4 5.6',
  bidirectional: 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4',
} as const;

export type IconName = keyof typeof ICONS;

const TYPES: Record<string, TypeInfo> = {
  person: { name: 'Actor', icon: 'person', accent: '#8b5cf6' },
  'c4-person': { name: 'Actor', icon: 'person', accent: '#8b5cf6' },
  rectangle: { name: 'Service', icon: 'server', accent: '#3b82f6' },
  square: { name: 'Service', icon: 'server', accent: '#3b82f6' },
  hexagon: { name: 'Gateway', icon: 'hexagon', accent: '#14b8a6' },
  cylinder: { name: 'Data store', icon: 'database', accent: '#f59e0b' },
  stored_data: { name: 'Data store', icon: 'database', accent: '#f59e0b' },
  queue: { name: 'Queue', icon: 'queue', accent: '#f97316' },
  cloud: { name: 'Cloud service', icon: 'cloud', accent: '#0ea5e9' },
  page: { name: 'Document', icon: 'document', accent: '#84cc16' },
  document: { name: 'Document', icon: 'document', accent: '#84cc16' },
  package: { name: 'Package', icon: 'package', accent: '#eab308' },
  diamond: { name: 'Decision', icon: 'diamond', accent: '#f43f5e' },
  oval: { name: 'Event', icon: 'circle', accent: '#06b6d4' },
  circle: { name: 'Event', icon: 'circle', accent: '#06b6d4' },
  sql_table: { name: 'Table', icon: 'table', accent: '#10b981' },
  class: { name: 'Class', icon: 'code', accent: '#10b981' },
  code: { name: 'Code', icon: 'code', accent: '#64748b' },
  text: { name: 'Text', icon: 'text', accent: '#64748b' },
  image: { name: 'Image', icon: 'image', accent: '#64748b' },
  step: { name: 'Step', icon: 'step', accent: '#6366f1' },
  callout: { name: 'Note', icon: 'callout', accent: '#eab308' },
  parallelogram: { name: 'Input / output', icon: 'parallelogram', accent: '#6366f1' },
};

export function typeOf(node: DiagramNode, depth: number, hasChildren: boolean): TypeInfo {
  const base = TYPES[node.shape] ?? TYPES.rectangle;
  const accent = node.style.stroke && isColor(node.style.stroke) ? node.style.stroke : base.accent;
  if (hasChildren && (node.shape === 'rectangle' || node.shape === 'square')) {
    return { name: depth === 0 ? 'System' : 'Group', icon: 'layers', accent };
  }
  return { ...base, accent };
}

export function isColor(value: string): boolean {
  return /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|[a-z]+$)/i.test(value.trim()) && value !== 'transparent';
}

// Relative luminance check so text stays readable on user-provided fills.
export function isDark(color: string): boolean {
  const ctx = colorCtx();
  ctx.fillStyle = '#000';
  ctx.fillStyle = color;
  const hex = ctx.fillStyle as string;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) {
    const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(hex);
    if (!rgb) return false;
    return lum(+rgb[1], +rgb[2], +rgb[3]) < 0.45;
  }
  return lum(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)) < 0.45;
}

function lum(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

let ctxCache: CanvasRenderingContext2D | undefined;
function colorCtx(): CanvasRenderingContext2D {
  ctxCache ??= document.createElement('canvas').getContext('2d')!;
  return ctxCache;
}

export const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif';

export function measure(text: string, size: number, weight = 400): number {
  const ctx = colorCtx();
  ctx.font = `${weight} ${size}px ${FONT_FAMILY}`;
  return ctx.measureText(text).width;
}

// Greedy word wrap; long words are hard-broken. Truncates with an ellipsis after maxLines.
export function wrap(text: string, size: number, weight: number, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, size, weight) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (measure(line, size, weight) > maxWidth && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && measure(line.slice(0, cut), size, weight) > maxWidth) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && measure(`${last}…`, size, weight) > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last.trimEnd()}…`;
    return kept;
  }
  return lines;
}

// Strip markdown to readable plain text for labels.
export function plainLabel(label: string, format?: string): string {
  if (format !== 'md' && format !== 'markdown') return label;
  return label
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'))
    .filter((l) => l.trim())
    .join('\n');
}
