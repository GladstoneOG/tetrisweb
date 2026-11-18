/**
 * Crisp inline SVG icon builders for all UI controls, badges, and modals.
 * All icons inherit `currentColor` and set `aria-hidden="true"`.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export type IconName =
  | 'play'
  | 'pause'
  | 'trophy'
  | 'volumeOn'
  | 'volumeOff'
  | 'musicNote'
  | 'ghost'
  | 'close'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronDown'
  | 'star'
  | 'exitDoor';

export interface IconOptions {
  size?: number;
  className?: string;
}

type SvgNodeSpec = {
  tag: 'path' | 'rect' | 'circle' | 'polygon' | 'polyline' | 'line';
  attrs: Record<string, string | number>;
};

const ICON_SPECS: Record<IconName, { viewBox?: string; nodes: SvgNodeSpec[] }> = {
  play: {
    nodes: [
      {
        tag: 'path',
        attrs: {
          d: 'M7 5.25C7 4.45 7.88 3.96 8.56 4.38L19.31 11.13C19.95 11.53 19.95 12.47 19.31 12.87L8.56 19.62C7.88 20.04 7 19.55 7 18.75V5.25Z',
          fill: 'currentColor',
          stroke: 'none',
        },
      },
    ],
  },
  pause: {
    nodes: [
      {
        tag: 'rect',
        attrs: { x: 3.5, y: 4, width: 5.6, height: 16, rx: 1.7, fill: 'currentColor', stroke: 'none' },
      },
      {
        tag: 'rect',
        attrs: { x: 14.9, y: 4, width: 5.6, height: 16, rx: 1.7, fill: 'currentColor', stroke: 'none' },
      },
    ],
  },
  trophy: {
    nodes: [
      { tag: 'path', attrs: { d: 'M8 4H16V10C16 12.76 14.21 15 12 15C9.79 15 8 12.76 8 10V4Z' } },
      { tag: 'path', attrs: { d: 'M8 6H5C4.45 6 4 6.45 4 7V8.5C4 10.16 5.34 11.5 7 11.5H8' } },
      { tag: 'path', attrs: { d: 'M16 6H19C19.55 6 20 6.45 20 7V8.5C20 10.16 18.66 11.5 17 11.5H16' } },
      { tag: 'line', attrs: { x1: 12, y1: 15, x2: 12, y2: 19 } },
      { tag: 'path', attrs: { d: 'M8.5 20H15.5' } },
    ],
  },
  volumeOn: {
    nodes: [
      { tag: 'polygon', attrs: { points: '11 5 6 9 2.5 9 2.5 15 6 15 11 19 11 5', fill: 'currentColor', stroke: 'none' } },
      { tag: 'path', attrs: { d: 'M15.2 8.8C16.6 10.2 16.6 13.8 15.2 15.2' } },
      { tag: 'path', attrs: { d: 'M18.4 6C21.2 9.1 21.2 14.9 18.4 18' } },
    ],
  },
  volumeOff: {
    nodes: [
      { tag: 'polygon', attrs: { points: '11 5 6 9 2.5 9 2.5 15 6 15 11 19 11 5', fill: 'currentColor', stroke: 'none' } },
      { tag: 'line', attrs: { x1: 16, y1: 9.5, x2: 21, y2: 14.5 } },
      { tag: 'line', attrs: { x1: 21, y1: 9.5, x2: 16, y2: 14.5 } },
    ],
  },
  musicNote: {
    nodes: [
      { tag: 'path', attrs: { d: 'M9 17.5V6.5L19 4.5V15.5' } },
      { tag: 'circle', attrs: { cx: 6.5, cy: 17.5, r: 2.5 } },
      { tag: 'circle', attrs: { cx: 16.5, cy: 15.5, r: 2.5 } },
    ],
  },
  ghost: {
    nodes: [
      {
        tag: 'rect',
        attrs: {
          x: 4.5,
          y: 4.5,
          width: 15,
          height: 15,
          rx: 3.5,
          'stroke-dasharray': '3.5 2.5',
        },
      },
      {
        tag: 'rect',
        attrs: {
          x: 9,
          y: 9,
          width: 6,
          height: 6,
          rx: 1.5,
          'stroke-width': 1.6,
        },
      },
    ],
  },
  close: {
    nodes: [
      { tag: 'line', attrs: { x1: 6.5, y1: 6.5, x2: 17.5, y2: 17.5 } },
      { tag: 'line', attrs: { x1: 17.5, y1: 6.5, x2: 6.5, y2: 17.5 } },
    ],
  },
  chevronLeft: {
    nodes: [{ tag: 'polyline', attrs: { points: '14.5 5.5 8 12 14.5 18.5' } }],
  },
  chevronRight: {
    nodes: [{ tag: 'polyline', attrs: { points: '9.5 5.5 16 12 9.5 18.5' } }],
  },
  chevronDown: {
    nodes: [{ tag: 'polyline', attrs: { points: '6 9.5 12 15.5 18 9.5' } }],
  },
  star: {
    nodes: [
      {
        tag: 'polygon',
        attrs: {
          points: '12 3.5 14.6 8.8 20.4 9.6 16.2 13.7 17.2 19.5 12 16.8 6.8 19.5 7.8 13.7 3.6 9.6 9.4 8.8 12 3.5',
          fill: 'currentColor',
          stroke: 'none',
        },
      },
    ],
  },
  exitDoor: {
    nodes: [
      { tag: 'path', attrs: { d: 'M10 4H17C18.1 4 19 4.9 19 6V18C19 19.1 18.1 20 17 20H10' } },
      { tag: 'polyline', attrs: { points: '7.5 8.5 3.5 12 7.5 15.5' } },
      { tag: 'line', attrs: { x1: 3.5, y1: 12, x2: 14, y2: 12 } },
    ],
  },
};

/**
 * Creates a crisp accessible SVG icon element (`aria-hidden="true"`).
 */
export function createIcon(name: IconName, options: IconOptions = {}): SVGSVGElement {
  const size = options.size ?? 18;
  const spec = ICON_SPECS[name];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', options.className ? `ui-icon ${options.className}` : 'ui-icon');
  svg.setAttribute('data-icon', name);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', spec.viewBox ?? '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  for (const nodeSpec of spec.nodes) {
    const child = document.createElementNS(SVG_NS, nodeSpec.tag);
    for (const [k, v] of Object.entries(nodeSpec.attrs)) {
      child.setAttribute(k, String(v));
    }
    svg.appendChild(child);
  }

  return svg;
}
