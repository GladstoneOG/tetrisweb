/** Generic frosted-glass modal shell used by Pause, Game Over, Exit, and Leaderboard dialogs. */
import { h } from './dom';
import { createIcon, type IconName } from './icons';

export interface ModalOptions {
  id: string;
  title: string;
  /** Allows Escape / backdrop click to dismiss. */
  dismissible?: boolean;
  onDismiss?: () => void;
  className?: string;
}

export class Modal {
  public readonly element: HTMLElement;
  public readonly body: HTMLElement;
  public readonly titleEl: HTMLElement;
  private readonly options: ModalOptions;
  private openState = false;
  private previouslyFocused: Element | null = null;

  constructor(options: ModalOptions) {
    this.options = options;
    this.titleEl = h('h2', { class: 'modal-title', id: `${options.id}-title`, text: options.title });
    this.body = h('div', { class: 'modal-body' });
    const card = h(
      'div',
      { class: `modal-card glass ${options.className ?? ''}`.trim() },
      this.titleEl,
      this.body
    );
    this.element = h(
      'div',
      {
        class: 'modal-overlay',
        id: options.id,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': `${options.id}-title`,
        'aria-hidden': 'true',
        'data-no-gesture': true,
      },
      card
    );
    this.element.addEventListener('pointerdown', (e) => {
      if (e.target === this.element && this.options.dismissible) {
        e.preventDefault();
        this.options.onDismiss?.();
      }
    });
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.options.dismissible) {
        e.stopPropagation();
        this.options.onDismiss?.();
      }
    });
  }

  public isOpen(): boolean {
    return this.openState;
  }

  public open(): void {
    if (this.openState) return;
    this.openState = true;
    this.previouslyFocused = typeof document !== 'undefined' ? document.activeElement : null;
    this.element.classList.add('is-open');
    this.element.setAttribute('aria-hidden', 'false');
    const focusTarget = this.element.querySelector<HTMLElement>('[data-autofocus], button:not([disabled])');
    try {
      focusTarget?.focus({ preventScroll: true });
    } catch {
      // ignore
    }
  }

  public close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.element.classList.remove('is-open');
    this.element.setAttribute('aria-hidden', 'true');
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (active instanceof HTMLElement && this.element.contains(active)) {
      active.blur();
    }
    if (this.previouslyFocused instanceof HTMLElement && document.body.contains(this.previouslyFocused)) {
      try {
        this.previouslyFocused.focus({ preventScroll: true });
      } catch {
        // ignore
      }
    }
    this.previouslyFocused = null;
  }
}

/** Builds an accessible On/Off toggle switch row. */
export function createToggle(
  label: string,
  initial: boolean,
  onToggle: (value: boolean) => void,
  attrs: { name: string; icon?: IconName }
): { element: HTMLElement; set: (v: boolean) => void; button: HTMLButtonElement } {
  const state = h('span', { class: 'toggle-state' });
  const button = h(
    'button',
    {
      class: 'toggle',
      type: 'button',
      role: 'switch',
      'data-toggle': attrs.name,
      'aria-label': label,
    },
    h('span', { class: 'toggle-knob' })
  );
  const set = (v: boolean): void => {
    button.setAttribute('aria-checked', v ? 'true' : 'false');
    button.classList.toggle('is-on', v);
    state.textContent = v ? 'On' : 'Off';
  };
  set(initial);
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-checked') !== 'true';
    set(next);
    onToggle(next);
  });
  const element = h(
    'div',
    { class: 'toggle-row' },
    h(
      'span',
      { class: 'toggle-label' },
      attrs.icon ? h('span', { class: 'toggle-icon' }, createIcon(attrs.icon, { size: 16 })) : null,
      label
    ),
    h('span', { class: 'toggle-control' }, state, button)
  );
  return { element, set, button };
}

export function controlsLegend(compact = false): HTMLElement {
  const rows: Array<[string, string, string]> = [
    ['A / D', 'Drag', 'Move'],
    ['W', 'Tap', 'Rotate'],
    ['S', 'Drag Down', 'Soft Drop'],
    ['Space', 'Fast Swipe', 'Hard Drop'],
    ['E / Right-click', 'Tap Hold', 'Hold'],
    ['Esc / P', 'Pause', 'Pause'],
  ];
  const list = h('dl', { class: `controls-legend ${compact ? 'is-compact' : ''}`.trim() });
  for (const [keys, touch, action] of rows) {
    list.append(
      h(
        'div',
        { class: 'legend-row' },
        h('dt', { text: action }),
        h('dd', {}, h('kbd', { text: keys }), h('span', { class: 'legend-touch', text: touch }))
      )
    );
  }
  return list;
}
