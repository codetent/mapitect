// Path helpers for the core, which can't rely on node:path. Paths are absolute
// and '/'-separated ("/home/a/b.d2", "C:/a/b.d2", "//server/share/a"); hosts
// convert their native paths at the boundary.

const ROOT = /^(?:\/\/[^/]+\/[^/]+\/?|[A-Za-z]:\/?|\/)/;

export function isAbsolute(p: string): boolean {
  return ROOT.test(p);
}

// Resolves `.`/`..` segments and repeated slashes, keeping the root.
export function normalize(p: string): string {
  const root = ROOT.exec(p)?.[0] ?? '';
  const out: string[] = [];
  for (const seg of p.slice(root.length).split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out.at(-1) !== '..') out.pop();
      else if (!root) out.push('..');
    } else out.push(seg);
  }
  const base = root && !root.endsWith('/') ? `${root}/` : root;
  return base + out.join('/') || '.';
}

export function join(...parts: string[]): string {
  return normalize(parts.filter(Boolean).join('/'));
}

// Like node's path.resolve, without a working directory: `base` must be absolute.
export function resolve(base: string, ...parts: string[]): string {
  let out = base;
  for (const p of parts) out = isAbsolute(p) ? p : `${out}/${p}`;
  return normalize(out);
}

export function dirname(p: string): string {
  const n = normalize(p);
  const root = ROOT.exec(n)?.[0] ?? '';
  const i = n.lastIndexOf('/');
  if (i < root.length) return root || '.';
  return n.slice(0, i);
}

export function basename(p: string): string {
  return normalize(p).split('/').pop() ?? '';
}

// True when `target` is `dir` or lies somewhere below it.
export function isWithin(dir: string, target: string): boolean {
  const d = normalize(dir).replace(/\/$/, '');
  const t = normalize(target);
  return t === d || t.startsWith(`${d}/`);
}
