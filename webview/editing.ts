// Canvas editing affordances: inline rename and the context menu. Edits
// themselves are sent to the extension host as EditOps.

import { iconSvg } from './render.ts';
import type { IconName } from './theme.ts';

// ------------------------------------------------------------ inline rename

let activeInput: HTMLInputElement | null = null;

export interface RenameOptions {
  anchor: Element; // the text element being renamed (or something to centre on)
  value: string;
  scale: number; // camera zoom, so the input matches the rendered text size
  fontSize: number;
  minWidth: number;
  placeholder?: string;
  onCommit(value: string): void;
}

export function startInlineRename(opts: RenameOptions): void {
  closeInlineRename(true);
  const rect = opts.anchor.getBoundingClientRect();
  const input = document.createElement('input');
  input.className = 'inline-rename';
  input.value = opts.value;
  input.placeholder = opts.placeholder ?? '';
  input.spellcheck = false;
  const size = Math.max(12, opts.fontSize * opts.scale);
  Object.assign(input.style, {
    left: `${rect.left - 6}px`,
    top: `${rect.top + rect.height / 2 - size * 0.9}px`,
    width: `${Math.max(rect.width, opts.minWidth * opts.scale) + 16}px`,
    height: `${size * 1.8}px`,
    fontSize: `${size}px`,
  });
  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    activeInput = null;
    input.remove();
    const value = input.value.trim();
    if (commit && value !== opts.value.trim()) opts.onCommit(value);
  };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') finish(true);
    else if (ev.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  (input as unknown as { finish: typeof finish }).finish = finish;
  document.body.appendChild(input);
  activeInput = input;
  input.focus();
  input.select();
}

export function closeInlineRename(commit: boolean): void {
  (activeInput as unknown as { finish?: (c: boolean) => void } | null)?.finish?.(commit);
}

// ------------------------------------------------------------- context menu

export interface MenuItem {
  label: string;
  icon?: IconName;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  run(): void;
}

let menuEl: HTMLDivElement | null = null;

export function showMenu(x: number, y: number, items: (MenuItem | 'sep')[]): void {
  hideMenu();
  const el = document.createElement('div');
  el.className = 'context-menu glass';
  el.setAttribute('role', 'menu');
  el.innerHTML = items
    .map((item, i) =>
      item === 'sep'
        ? '<div class="menu-sep"></div>'
        : `<button role="menuitem" data-i="${i}" class="${item.danger ? 'danger' : ''}" ${item.disabled ? 'disabled' : ''}>
            <span class="mi-icon">${item.icon ? iconSvg(item.icon, 14) : ''}</span>
            <span class="mi-label">${item.label}</span>
            ${item.hint ? `<kbd>${item.hint}</kbd>` : ''}
          </button>`,
    )
    .join('');
  document.body.appendChild(el);
  const { innerWidth: vw, innerHeight: vh } = window;
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.min(x, vw - r.width - 8)}px`;
  el.style.top = `${Math.min(y, vh - r.height - 8)}px`;
  el.addEventListener('click', (ev) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>('button[data-i]');
    if (!btn || btn.disabled) return;
    const item = items[Number(btn.dataset.i)] as MenuItem;
    hideMenu();
    item.run();
  });
  menuEl = el;
  setTimeout(() => {
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape, true);
  });
}

function outside(ev: PointerEvent): void {
  if (menuEl && !menuEl.contains(ev.target as Node)) hideMenu();
}

function escape(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') {
    ev.stopPropagation();
    hideMenu();
  }
}

export function hideMenu(): void {
  menuEl?.remove();
  menuEl = null;
  window.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('keydown', escape, true);
}
