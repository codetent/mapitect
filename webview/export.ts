import type { Box } from './layout.ts';

// Presentation properties that come from the stylesheet and must be inlined so
// the exported file renders identically outside the webview.
const PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing',
  'text-decoration', 'display', 'visibility', 'paint-order', 'dominant-baseline',
];

const PAD = 32;

export function exportSvg(world: SVGGElement, bounds: Box): string {
  const clone = world.cloneNode(true) as SVGGElement;
  const src = [world, ...world.querySelectorAll('*')];
  const dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const out = dst[i] as SVGElement;
    const style = PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
    out.setAttribute('style', style);
    out.removeAttribute('class');
    out.removeAttribute('data-id');
  });
  // Interactive chrome and hit areas don't belong in a static picture.
  for (const el of clone.querySelectorAll('title')) el.remove();
  dst.forEach((el, i) => {
    const s = src[i] as Element;
    if (s.matches('.btn, .edge-hit, .far-title, .hit, .link-mark')) el.remove();
  });

  const bg = getComputedStyle(document.querySelector('.stage')!).backgroundColor || '#ffffff';
  const w = Math.ceil(bounds.w + PAD * 2);
  const h = Math.ceil(bounds.h + PAD * 2);
  const doc = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  doc.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  doc.setAttribute('width', String(w));
  doc.setAttribute('height', String(h));
  doc.setAttribute('viewBox', `${bounds.x - PAD} ${bounds.y - PAD} ${w} ${h}`);
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(bounds.x - PAD));
  rect.setAttribute('y', String(bounds.y - PAD));
  rect.setAttribute('width', String(w));
  rect.setAttribute('height', String(h));
  rect.setAttribute('fill', bg);
  doc.appendChild(rect);
  clone.removeAttribute('transform');
  doc.appendChild(clone);
  return new XMLSerializer().serializeToString(doc);
}

export async function exportPng(world: SVGGElement, bounds: Box, scale = 2): Promise<string> {
  const svgText = exportSvg(world, bounds);
  const w = Math.ceil(bounds.w + PAD * 2);
  const h = Math.ceil(bounds.h + PAD * 2);
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('could not rasterize the diagram'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  } finally {
    URL.revokeObjectURL(url);
  }
}
