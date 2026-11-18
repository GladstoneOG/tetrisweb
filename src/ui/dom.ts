/** Tiny DOM + formatting helpers shared by the UI modules. */

type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') {
      el.className = String(value);
    } else if (key === 'text') {
      el.textContent = String(value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

const numberFormatter =
  typeof Intl !== 'undefined' ? new Intl.NumberFormat('en-US') : null;

export function formatNumber(value: number): string {
  const n = Number.isFinite(value) ? Math.floor(value) : 0;
  return numberFormatter ? numberFormatter.format(n) : String(n);
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Sets text only when it changes, avoiding needless layout work every frame. */
export function setText(el: Element | null | undefined, text: string): void {
  if (el && el.textContent !== text) {
    el.textContent = text;
  }
}

export function rgbCss(rgb: { r: number; g: number; b: number }): string {
  return `${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}`;
}
