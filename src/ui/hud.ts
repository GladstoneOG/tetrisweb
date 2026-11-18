/** Responsive Gameplay HUD: top-left Pause, Hold box, Next queue, Board canvas, and tabular stats. */
import type { GameSnapshot } from '../engine/types';
import { drawMiniPiece } from '../render/index';
import { formatDuration, formatNumber, h, setText } from './dom';
import { createIcon } from './icons';

export interface HudCallbacks {
  onPause: () => void;
  onHoldTap?: () => void;
  onDismissHint?: () => void;
}

export interface HudBoardMetrics {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const DESKTOP_MEDIA = '(min-width: 768px) and (min-height: 560px) and (min-aspect-ratio: 1/1)';

export function isDesktopLayout(): boolean {
  if (typeof window === 'undefined') return true;
  if (typeof window.matchMedia === 'function') {
    const res = window.matchMedia(DESKTOP_MEDIA);
    if (res && typeof res.matches === 'boolean' && res.media !== 'not all') {
      // jsdom stubs matchMedia if mocked; verify non-empty media match or fallback when innerWidth is set
      return res.matches;
    }
  }
  return window.innerWidth >= 768 && window.innerHeight >= 560 && window.innerWidth >= window.innerHeight;
}

export class GameHud {
  public readonly element: HTMLElement;
  public readonly boardStage: HTMLElement;
  public readonly boardCanvas: HTMLCanvasElement;
  public readonly pauseButton: HTMLButtonElement;
  public readonly holdButton: HTMLButtonElement;

  private readonly holdCanvas: HTMLCanvasElement;
  private readonly nextCanvases: HTMLCanvasElement[] = [];
  private readonly nextSlots: HTMLElement[] = [];

  private readonly scoreVal: HTMLElement;
  private readonly highVal: HTMLElement;
  private readonly linesVal: HTMLElement;
  private readonly levelVal: HTMLElement;
  private readonly mobileLevelVal: HTMLElement;
  private readonly timeVal: HTMLElement;
  private readonly comboBadge: HTMLElement;
  private readonly b2bBadge: HTMLElement;
  private readonly hintBanner: HTMLElement;

  private lastSnapshot: GameSnapshot | null = null;
  private lastHoldKey = '';
  private lastNextKeys: string[] = ['', '', '', ''];
  private lastDesktopMode: boolean | null = null;
  private lastHoldPointerAt = -Infinity;

  constructor(callbacks: HudCallbacks) {
    this.pauseButton = h(
      'button',
      {
        class: 'pause-btn',
        type: 'button',
        'data-pause-trigger': true,
        'data-action': 'pause',
        'aria-label': 'Pause game (Esc or P)',
        title: 'Pause (Esc / P)',
      },
      createIcon('pause', { className: 'pause-icon', size: 28 }),
      h('span', { class: 'pause-label', text: 'Pause' })
    );
    this.pauseButton.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onPause();
    });

    // Hold box (left)
    this.holdCanvas = h('canvas', { class: 'mini-canvas', width: 72, height: 52, 'aria-hidden': 'true' });
    this.holdButton = h(
      'button',
      {
        class: 'hud-panel glass hold-box',
        type: 'button',
        tabindex: -1,
        'data-hold-trigger': true,
        'aria-label': 'Hold piece (E or Right-click)',
        title: 'Hold (E / Right-click)',
      },
      h('span', { class: 'panel-title', text: 'HOLD' }),
      h('span', { class: 'mini-frame' }, this.holdCanvas)
    );
    // Record pointerdown timestamp so real taps don't double-fire via click, while synthetic click() still works.
    this.holdButton.addEventListener(
      'pointerdown',
      () => {
        this.lastHoldPointerAt = performance.now();
      },
      { capture: true }
    );
    this.holdButton.addEventListener('click', () => {
      if (performance.now() - this.lastHoldPointerAt < 350) return;
      callbacks.onHoldTap?.();
    });

    this.comboBadge = h('div', { class: 'status-pill combo-pill', hidden: true });
    this.b2bBadge = h('div', { class: 'status-pill b2b-pill', text: 'BACK-TO-BACK', hidden: true });

    const desktopLegend = h(
      'div',
      { class: 'hud-desktop-legend glass-inset', 'aria-hidden': 'true' },
      h('div', { class: 'mini-legend-row' }, h('kbd', { text: 'A / D' }), h('span', { text: 'Move' })),
      h('div', { class: 'mini-legend-row' }, h('kbd', { text: 'W' }), h('span', { text: 'Rotate' })),
      h('div', { class: 'mini-legend-row' }, h('kbd', { text: 'S' }), h('span', { text: 'Soft Drop' })),
      h('div', { class: 'mini-legend-row' }, h('kbd', { text: 'Space' }), h('span', { text: 'Hard Drop' })),
      h('div', { class: 'mini-legend-row' }, h('kbd', { text: 'E / Right-click' }), h('span', { text: 'Hold' })),
      h('div', { class: 'mini-legend-row' }, h('kbd', { text: 'Esc / P' }), h('span', { text: 'Pause' }))
    );

    const leftRail = h(
      'aside',
      { class: 'hud-left' },
      this.holdButton,
      h('div', { class: 'hud-badges' }, this.comboBadge, this.b2bBadge),
      desktopLegend
    );

    // Center 10x20 board stage
    this.boardCanvas = h('canvas', {
      class: 'board-canvas',
      'aria-label': 'Tetris game board',
    });
    this.boardStage = h('div', { class: 'hud-board' }, this.boardCanvas);

    // Right rail: Next Queue (3 on mobile, 4 on desktop)
    const nextList = h('div', { class: 'next-list' });
    for (let i = 0; i < 4; i++) {
      const canvas = h('canvas', { class: 'mini-canvas', width: 72, height: 48, 'aria-hidden': 'true' });
      const slot = h('div', { class: `next-slot ${i === 0 ? 'is-primary' : ''} ${i === 3 ? 'is-desktop-only' : ''}`.trim() }, canvas);
      this.nextCanvases.push(canvas);
      this.nextSlots.push(slot);
      nextList.append(slot);
    }
    const nextPanel = h(
      'aside',
      { class: 'hud-right' },
      h('div', { class: 'hud-panel glass next-panel' }, h('span', { class: 'panel-title', text: 'NEXT' }), nextList)
    );

    // Stats (Score, High Score, Lines, plus Desktop Level & Time)
    this.scoreVal = h('span', { class: 'stat-value num', text: '0' });
    this.highVal = h('span', { class: 'stat-value num', text: '0' });
    this.linesVal = h('span', { class: 'stat-value num', text: '0' });
    this.levelVal = h('span', { class: 'stat-value num', text: '1' });
    this.mobileLevelVal = h('span', { class: 'hud-level-value num', text: '1' });
    this.timeVal = h('span', { class: 'stat-value num', text: '0:00' });

    const statsPanel = h(
      'section',
      { class: 'hud-stats glass', 'aria-label': 'Game statistics' },
      statItem('SCORE', this.scoreVal, 'stat-score'),
      statItem('HIGH', this.highVal, 'stat-high'),
      statItem('LINES', this.linesVal, 'stat-lines'),
      statItem('LEVEL', this.levelVal, 'stat-level is-desktop-stat'),
      statItem('TIME', this.timeVal, 'stat-time is-desktop-stat')
    );

    const levelIndicator = h(
      'div',
      { class: 'hud-level-wrap', 'aria-label': 'Current level' },
      h('span', { class: 'hud-level-label', text: 'LEVEL' }),
      this.mobileLevelVal
    );

    const hintClose = h(
      'button',
      {
        class: 'hint-dismiss',
        type: 'button',
        'data-no-gesture': true,
        'aria-label': 'Dismiss controls hint',
      },
      createIcon('close', { size: 14 })
    );
    hintClose.addEventListener('click', () => {
      this.setHintVisible(false);
      callbacks.onDismissHint?.();
    });

    this.hintBanner = h(
      'div',
      { class: 'hud-hint glass-inset', hidden: true },
      h('span', { text: 'Drag: Move • Tap: Rotate • Drag Down: Soft Drop • Fast Swipe: Hard Drop • Tap Hold' }),
      hintClose
    );

    const layout = h(
      'div',
      { class: 'hud-layout' },
      h('div', { class: 'hud-pause-wrap' }, this.pauseButton),
      statsPanel,
      levelIndicator,
      leftRail,
      this.boardStage,
      nextPanel,
      this.hintBanner
    );

    this.element = h('div', { class: 'screen hud-screen', hidden: true }, layout);
  }

  public setVisible(visible: boolean): void {
    this.element.classList.toggle('is-active', visible);
    this.element.hidden = !visible;
    if (visible) {
      this.redrawMiniCanvases(true);
    }
  }

  public setHintVisible(visible: boolean): void {
    this.hintBanner.hidden = !visible;
  }

  /** Syncs Hold and Next box alignment with the drawn 10x20 board rectangle. */
  public setBoardMetrics(metrics: HudBoardMetrics): void {
    this.element.style.setProperty('--board-top-offset', `${Math.max(0, Math.round(metrics.top))}px`);
    this.element.style.setProperty('--board-bottom-offset', `${Math.max(0, Math.round(metrics.bottom))}px`);
    this.element.style.setProperty('--board-left-offset', `${Math.max(0, Math.round(metrics.left))}px`);
    this.element.style.setProperty('--board-right-offset', `${Math.max(0, Math.round(metrics.right))}px`);
  }

  public update(snapshot: GameSnapshot, personalBest: number): void {
    this.lastSnapshot = snapshot;

    const high = Math.max(personalBest, snapshot.score);
    setText(this.scoreVal, formatNumber(snapshot.score));
    setText(this.highVal, formatNumber(high));
    setText(this.linesVal, formatNumber(snapshot.lines));
    setText(this.levelVal, String(snapshot.level));
    setText(this.mobileLevelVal, String(snapshot.level));
    setText(this.timeVal, formatDuration(snapshot.durationMs));

    const hasCombo = snapshot.combo >= 1;
    this.comboBadge.hidden = !hasCombo;
    if (hasCombo) {
      setText(this.comboBadge, `COMBO x${snapshot.combo}`);
    }
    this.b2bBadge.hidden = !snapshot.backToBack;

    this.holdButton.classList.toggle('is-locked', !snapshot.canHold && snapshot.holdPiece !== null);
    this.redrawMiniCanvases(false);
  }

  public redrawMiniCanvases(force = false): void {
    const snap = this.lastSnapshot;
    if (!snap) return;

    const desktop = isDesktopLayout();
    const layoutChanged = this.lastDesktopMode !== desktop;
    this.lastDesktopMode = desktop;
    const nextLimit = desktop ? 4 : 3;

    const holdKey = `${snap.holdPiece ?? 'none'}:${snap.canHold ? '1' : '0'}`;
    if (force || layoutChanged || holdKey !== this.lastHoldKey) {
      this.lastHoldKey = holdKey;
      drawMiniPiece(this.holdCanvas, snap.holdPiece, { dimmed: !snap.canHold, paddingRatio: 0.16 });
    }

    for (let i = 0; i < this.nextCanvases.length; i++) {
      const slot = this.nextSlots[i];
      const active = i < nextLimit;
      slot.classList.toggle('is-hidden-slot', !active);
      if (!active) continue;

      const piece = snap.nextQueue[i] ?? null;
      const key = piece ?? 'none';
      if (force || layoutChanged || key !== this.lastNextKeys[i]) {
        this.lastNextKeys[i] = key;
        drawMiniPiece(this.nextCanvases[i], piece, { paddingRatio: i === 0 ? 0.14 : 0.18 });
      }
    }
  }
}

function statItem(label: string, valueEl: HTMLElement, extraClass: string): HTMLElement {
  return h(
    'div',
    { class: `stat-box ${extraClass}`.trim() },
    h('span', { class: 'stat-label', text: label }),
    valueEl
  );
}
