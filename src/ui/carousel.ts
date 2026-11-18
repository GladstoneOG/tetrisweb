/**
 * Swipeable / clickable / arrow-navigable Start Level carousel (Levels 1..15).
 */
import { MAX_START_LEVEL, MIN_START_LEVEL } from '../engine/types';
import { getThemeForLevel, rgbToHex } from '../render/themes';
import { h, rgbCss } from './dom';
import { createIcon } from './icons';
import { clampLevel } from './storage';

export interface LevelTier {
  level: number;
  themeName: string;
  accentHex: string;
  accentRgb: string;
}

export function getLevelTier(level: number): LevelTier {
  const safe = clampLevel(level);
  const theme = getThemeForLevel(safe);
  return {
    level: safe,
    themeName: theme.name,
    accentHex: rgbToHex(theme.accent),
    accentRgb: rgbCss(theme.accent),
  };
}

export interface LevelCarouselOptions {
  initialLevel?: number;
  onChange?: (level: number) => void;
}

export class LevelCarousel {
  public readonly element: HTMLElement;
  private readonly track: HTMLElement;
  private readonly cards: HTMLButtonElement[] = [];
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly onChange?: (level: number) => void;
  private level: number;

  private dragPointerId: number | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragDx = 0;
  private dragMoved = false;
  private suppressClickUntil = 0;

  constructor(options: LevelCarouselOptions = {}) {
    this.level = clampLevel(options.initialLevel ?? MIN_START_LEVEL);
    this.onChange = options.onChange;

    this.prevBtn = h(
      'button',
      {
        class: 'carousel-arrow carousel-prev',
        type: 'button',
        'aria-label': 'Previous level',
      },
      createIcon('chevronLeft', { size: 22 })
    );
    this.nextBtn = h(
      'button',
      {
        class: 'carousel-arrow carousel-next',
        type: 'button',
        'aria-label': 'Next level',
      },
      createIcon('chevronRight', { size: 22 })
    );

    this.track = h('div', { class: 'carousel-track', role: 'listbox', 'aria-label': 'Start level' });
    for (let lvl = MIN_START_LEVEL; lvl <= MAX_START_LEVEL; lvl++) {
      const card = this.buildCard(getLevelTier(lvl));
      this.cards.push(card);
      this.track.append(card);
    }

    const viewport = h('div', { class: 'carousel-viewport', tabindex: '0' }, this.track);
    this.element = h('div', { class: 'level-carousel' }, this.prevBtn, viewport, this.nextBtn);

    this.prevBtn.addEventListener('click', () => this.step(-1));
    this.nextBtn.addEventListener('click', () => this.step(1));
    viewport.addEventListener('keydown', this.handleKeyDown);
    viewport.addEventListener('pointerdown', this.handlePointerDown);
    viewport.addEventListener('pointermove', this.handlePointerMove);
    viewport.addEventListener('pointerup', this.handlePointerUp);
    viewport.addEventListener('pointercancel', this.handlePointerUp);
    viewport.addEventListener('wheel', this.handleWheel, { passive: false });

    this.applySelection(false);
  }

  public getLevel(): number {
    return this.level;
  }

  public setLevel(level: number, emit = true): void {
    const next = clampLevel(level);
    if (next === this.level) {
      this.applySelection(false);
      return;
    }
    this.level = next;
    this.applySelection(emit);
  }

  public step(delta: number): void {
    this.setLevel(this.level + delta);
  }

  private buildCard(tier: LevelTier): HTMLButtonElement {
    const card = h(
      'button',
      {
        class: 'level-card',
        type: 'button',
        role: 'option',
        'data-level': tier.level,
        'aria-label': `Level ${tier.level}`,
        style: `--card-accent: ${tier.accentHex}; --card-accent-rgb: ${tier.accentRgb};`,
      },
      h('span', { class: 'level-card-label', text: 'LEVEL' }),
      h('span', { class: 'level-card-num', text: String(tier.level) })
    );
    card.addEventListener('click', () => {
      if (performance.now() < this.suppressClickUntil) return;
      this.setLevel(tier.level);
    });
    return card;
  }

  private applySelection(emit: boolean): void {
    const idx = this.level - MIN_START_LEVEL;
    this.track.style.setProperty('--i', String(idx));
    this.track.style.setProperty('--drag', '0px');
    this.cards.forEach((card, i) => {
      const selected = i === idx;
      card.classList.toggle('is-selected', selected);
      card.classList.toggle('is-near', Math.abs(i - idx) === 1);
      card.setAttribute('aria-selected', selected ? 'true' : 'false');
      card.tabIndex = selected ? 0 : -1;
    });
    const tier = getLevelTier(this.level);
    this.element.style.setProperty('--carousel-accent', tier.accentHex);
    this.element.style.setProperty('--carousel-accent-rgb', tier.accentRgb);
    this.prevBtn.disabled = this.level <= MIN_START_LEVEL;
    this.nextBtn.disabled = this.level >= MAX_START_LEVEL;
    if (emit) this.onChange?.(this.level);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.step(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.step(1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      this.setLevel(MIN_START_LEVEL);
    } else if (e.key === 'End') {
      e.preventDefault();
      this.setLevel(MAX_START_LEVEL);
    }
  };

  private handleWheel = (e: WheelEvent): void => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
    if (Math.abs(delta) < 12) return;
    e.preventDefault();
    if (performance.now() < this.suppressClickUntil) return;
    this.suppressClickUntil = performance.now() + 220;
    this.step(delta > 0 ? 1 : -1);
  };

  private handlePointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.dragPointerId !== null) return;
    this.dragPointerId = e.pointerId;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragDx = 0;
    this.dragMoved = false;
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragPointerId) return;
    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;
    if (!this.dragMoved && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      this.dragMoved = true;
      this.track.classList.add('is-dragging');
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
    }
    if (this.dragMoved) {
      this.dragDx = dx;
      this.track.style.setProperty('--drag', `${dx}px`);
    }
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragPointerId) return;
    this.dragPointerId = null;
    this.track.classList.remove('is-dragging');
    if (!this.dragMoved) return;
    this.suppressClickUntil = performance.now() + 250;
    const card = this.cards[0];
    const cardW = (card?.getBoundingClientRect().width || 104) + 12;
    const steps = Math.round(-this.dragDx / cardW) || (Math.abs(this.dragDx) > 36 ? (this.dragDx < 0 ? 1 : -1) : 0);
    this.dragDx = 0;
    if (steps !== 0) {
      this.setLevel(this.level + steps);
    } else {
      this.applySelection(false);
    }
  };
}
