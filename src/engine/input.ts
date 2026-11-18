import { TetrisGame } from './game';

export interface InputActions {
  moveLeft(): boolean;
  moveRight(): boolean;
  softDrop(): boolean;
  rotateCW(): boolean;
  slam(): number | void;
  hold(): boolean;
  togglePause(): void;
  canAcceptGameInput?(): boolean;
  canTogglePause?(): boolean;
}

export interface InputControllerOptions {
  /** Playfield / gesture surface element for pointer drag, tap, swipe, and right-click. */
  target?: HTMLElement | null;
  /** Optional Hold box element supporting multitouch tap without cancelling active drags. */
  holdElement?: HTMLElement | null;
  /** Target for keyboard listeners (defaults to window when available). */
  keyboardTarget?: Window | Document | HTMLElement | null;
  /** Game instance or custom action callbacks. */
  actions: TetrisGame | InputActions;
  /** Optional pause callback override when passing a TetrisGame instance. */
  onTogglePause?: () => void;
  /** Pixel width of 1 board column for horizontal drag steering (default 32). */
  cellWidthPx?: number;
  /** Delayed Auto Shift in ms for A/D keys (default 150). */
  dasMs?: number;
  /** Auto Repeat Rate in ms for A/D keys (default 45). */
  arrMs?: number;
  /** Auto Repeat Rate in ms while holding S for soft drop (default 45). */
  softDropArrMs?: number;
  /** Multiplier of cellWidthPx per downward soft-drop drag step (default 0.85). */
  softDropStepRatio?: number;
  /** Maximum movement radius in px to qualify as a tap-to-rotate (default 12). */
  tapMaxDistancePx?: number;
  /** Maximum press duration in ms to qualify as a tap-to-rotate (default 300). */
  tapMaxDurationMs?: number;
  /** Minimum downward distance in px for quick swipe-down slam (default 56). */
  swipeDownThresholdPx?: number;
  /** Minimum downward velocity in px/ms for quick swipe-down slam (default 0.8). */
  swipeDownMinVelocityPxPerMs?: number;
  /** Minimum dy / |dx| ratio so diagonal drags do not misfire slam (default 1.5). */
  swipeDownDominanceRatio?: number;
  /** Maximum total gesture duration in ms to qualify as a quick swipe slam (default 260). */
  swipeDownMaxDurationMs?: number;
  /** CSS selector of elements on surface that should not start playfield gestures. */
  ignoreSelector?: string;
  /** Optional clock provider for deterministic testing. */
  now?: () => number;
}

interface PointerSample {
  x: number;
  y: number;
  t: number;
}

interface PointerTrack {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startTimeMs: number;
  lastDownMoveTimeMs: number;
  dragAccumX: number;
  dragAccumY: number;
  hasDraggedHorizontally: boolean;
  hasDraggedVertically: boolean;
  hasSlammed: boolean;
  maxDistanceSq: number;
  recentSamples: PointerSample[];
}

const DEFAULT_IGNORE_SELECTOR =
  'button, input, textarea, select, a, [data-no-gesture], [data-hold-trigger], [data-pause-trigger]';

const SWIPE_WINDOW_MS = 140;
const SWIPE_TAIL_WINDOW_MS = 70;
const SWIPE_MAX_RELEASE_PAUSE_MS = 55;
const SWIPE_TAIL_MIN_VELOCITY_RATIO = 0.65;
const RIGHT_CLICK_DEDUPE_MS = 50;

export function createGameInputActions(
  game: TetrisGame,
  onTogglePause?: () => void
): InputActions {
  return {
    moveLeft: () => game.moveLeft(),
    moveRight: () => game.moveRight(),
    softDrop: () => game.softDrop(),
    rotateCW: () => game.rotateCW(),
    slam: () => game.slam(),
    hold: () => game.hold(),
    togglePause: () => {
      if (onTogglePause) {
        onTogglePause();
      } else {
        game.togglePause();
      }
    },
    canAcceptGameInput: () => game.getSnapshot().status === 'playing',
    canTogglePause: () => {
      const status = game.getSnapshot().status;
      return status === 'playing' || status === 'paused';
    },
  };
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === 'undefined') {
    return false;
  }
  const el = target as Partial<HTMLElement>;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  return Boolean(el.isContentEditable);
}

function isLeftKey(e: KeyboardEvent): boolean {
  return e.code === 'KeyA' || (typeof e.key === 'string' && e.key.toLowerCase() === 'a');
}

function isRightKey(e: KeyboardEvent): boolean {
  return e.code === 'KeyD' || (typeof e.key === 'string' && e.key.toLowerCase() === 'd');
}

function isRotateKey(e: KeyboardEvent): boolean {
  return e.code === 'KeyW' || (typeof e.key === 'string' && e.key.toLowerCase() === 'w');
}

function isSoftDropKey(e: KeyboardEvent): boolean {
  return e.code === 'KeyS' || (typeof e.key === 'string' && e.key.toLowerCase() === 's');
}

function isSlamKey(e: KeyboardEvent): boolean {
  return e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';
}

function isHoldKey(e: KeyboardEvent): boolean {
  return e.code === 'KeyE' || (typeof e.key === 'string' && e.key.toLowerCase() === 'e');
}

function isPauseKey(e: KeyboardEvent): boolean {
  return (
    e.code === 'Escape' ||
    e.key === 'Escape' ||
    e.code === 'KeyP' ||
    (typeof e.key === 'string' && e.key.toLowerCase() === 'p')
  );
}

function matchesIgnoreSelector(target: EventTarget | null, selector: string): boolean {
  if (!target || !selector) {
    return false;
  }
  const el = target as { closest?: (s: string) => Element | null };
  if (typeof el.closest === 'function') {
    return el.closest(selector) !== null;
  }
  return false;
}

export class InputController {
  private actions: InputActions;
  private surfaceEl: HTMLElement | null = null;
  private holdEl: HTMLElement | null = null;
  private keyboardTarget: Window | Document | HTMLElement | null = null;
  private globalMoveTarget: Window | null = null;

  private cellWidthPx: number;
  private dasMs: number;
  private arrMs: number;
  private softDropArrMs: number;
  private softDropStepRatio: number;
  private tapMaxDistancePx: number;
  private tapMaxDurationMs: number;
  private swipeDownThresholdPx: number;
  private swipeDownMinVelocityPxPerMs: number;
  private swipeDownDominanceRatio: number;
  private swipeDownMaxDurationMs: number;
  private ignoreSelector: string;
  private now: () => number;

  private leftHeld = false;
  private rightHeld = false;
  private activeDir: 'left' | 'right' | null = null;
  private dasTimerMs = 0;
  private arrTimerMs = 0;
  private softDropHeld = false;
  private softDropTimerMs = 0;

  private activePointers = new Map<number, PointerTrack>();
  private processedPointerEvents = new WeakSet<Event>();
  private lastRightPointerDownAt = -Infinity;
  private destroyed = false;

  constructor(options: InputControllerOptions) {
    this.actions =
      options.actions instanceof TetrisGame
        ? createGameInputActions(options.actions, options.onTogglePause)
        : options.actions;

    this.cellWidthPx = Math.max(8, options.cellWidthPx ?? 32);
    this.dasMs = Math.max(0, options.dasMs ?? 150);
    this.arrMs = Math.max(1, options.arrMs ?? 45);
    this.softDropArrMs = Math.max(1, options.softDropArrMs ?? 45);
    this.softDropStepRatio = Math.max(0.25, options.softDropStepRatio ?? 0.85);
    this.tapMaxDistancePx = Math.max(1, options.tapMaxDistancePx ?? 12);
    this.tapMaxDurationMs = Math.max(1, options.tapMaxDurationMs ?? 300);
    this.swipeDownThresholdPx = Math.max(10, options.swipeDownThresholdPx ?? 56);
    this.swipeDownMinVelocityPxPerMs = Math.max(0, options.swipeDownMinVelocityPxPerMs ?? 0.8);
    this.swipeDownDominanceRatio = Math.max(0.5, options.swipeDownDominanceRatio ?? 1.5);
    this.swipeDownMaxDurationMs = Math.max(50, options.swipeDownMaxDurationMs ?? 260);
    this.ignoreSelector = options.ignoreSelector ?? DEFAULT_IGNORE_SELECTOR;
    this.now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));

    const defaultWin = typeof window !== 'undefined' ? window : null;
    this.keyboardTarget =
      options.keyboardTarget !== undefined ? options.keyboardTarget : defaultWin;
    this.globalMoveTarget = defaultWin;

    this.attachKeyboard();
    if (options.target) {
      this.attachSurface(options.target);
    }
    if (options.holdElement) {
      this.bindHoldElement(options.holdElement);
    }
  }

  public setCellWidth(cellWidthPx: number): void {
    if (Number.isFinite(cellWidthPx) && cellWidthPx > 0) {
      this.cellWidthPx = Math.max(8, cellWidthPx);
    }
  }

  public getCellWidth(): number {
    return this.cellWidthPx;
  }

  public getActivePointerCount(): number {
    return this.activePointers.size;
  }

  public attachSurface(element: HTMLElement): void {
    this.detachSurface();
    this.surfaceEl = element;
    element.addEventListener('pointerdown', this.handleSurfacePointerDown as EventListener);
    element.addEventListener('pointermove', this.handlePointerMove as EventListener);
    element.addEventListener('pointerup', this.handlePointerUp as EventListener);
    element.addEventListener('pointercancel', this.handlePointerCancel as EventListener);
    element.addEventListener('contextmenu', this.handleContextMenu as EventListener);

    if (this.globalMoveTarget) {
      this.globalMoveTarget.addEventListener('pointermove', this.handlePointerMove as EventListener);
      this.globalMoveTarget.addEventListener('pointerup', this.handlePointerUp as EventListener);
      this.globalMoveTarget.addEventListener('pointercancel', this.handlePointerCancel as EventListener);
    }
  }

  public detachSurface(): void {
    if (this.surfaceEl) {
      this.surfaceEl.removeEventListener('pointerdown', this.handleSurfacePointerDown as EventListener);
      this.surfaceEl.removeEventListener('pointermove', this.handlePointerMove as EventListener);
      this.surfaceEl.removeEventListener('pointerup', this.handlePointerUp as EventListener);
      this.surfaceEl.removeEventListener('pointercancel', this.handlePointerCancel as EventListener);
      this.surfaceEl.removeEventListener('contextmenu', this.handleContextMenu as EventListener);
      this.surfaceEl = null;
    }
    if (this.globalMoveTarget) {
      this.globalMoveTarget.removeEventListener('pointermove', this.handlePointerMove as EventListener);
      this.globalMoveTarget.removeEventListener('pointerup', this.handlePointerUp as EventListener);
      this.globalMoveTarget.removeEventListener('pointercancel', this.handlePointerCancel as EventListener);
    }
    this.activePointers.clear();
  }

  public bindHoldElement(element: HTMLElement): void {
    this.unbindHoldElement();
    this.holdEl = element;
    element.addEventListener('pointerdown', this.handleHoldPointerDown as EventListener);
  }

  public unbindHoldElement(): void {
    if (this.holdEl) {
      this.holdEl.removeEventListener('pointerdown', this.handleHoldPointerDown as EventListener);
      this.holdEl = null;
    }
  }

  /**
   * Triggers Hold directly (e.g. from a Hold button UI handler) without disturbing
   * any active multitouch drag pointers on the playfield.
   */
  public triggerHold(): boolean {
    if (this.destroyed || !this.canAcceptGameInput()) {
      return false;
    }
    return this.actions.hold();
  }

  /**
   * Advances keyboard DAS/ARR and held soft-drop auto-repeat timers by `dtMs`.
   */
  public update(dtMs: number): void {
    if (this.destroyed || !Number.isFinite(dtMs) || dtMs <= 0) {
      return;
    }
    if (!this.canAcceptGameInput()) {
      if (
        this.activeDir !== null ||
        this.leftHeld ||
        this.rightHeld ||
        this.softDropHeld
      ) {
        this.clearKeyboardState();
      }
      return;
    }

    if (this.activeDir !== null) {
      if (this.dasTimerMs < this.dasMs) {
        this.dasTimerMs += dtMs;
        if (this.dasTimerMs >= this.dasMs) {
          const overflow = this.dasTimerMs - this.dasMs;
          this.dasTimerMs = this.dasMs;
          this.fireDirectionalMove(this.activeDir);
          this.arrTimerMs = overflow;
        }
      } else {
        this.arrTimerMs += dtMs;
      }

      if (this.dasTimerMs >= this.dasMs) {
        while (this.arrTimerMs >= this.arrMs) {
          this.arrTimerMs -= this.arrMs;
          this.fireDirectionalMove(this.activeDir);
        }
      }
    }

    if (this.softDropHeld) {
      this.softDropTimerMs += dtMs;
      while (this.softDropTimerMs >= this.softDropArrMs) {
        this.softDropTimerMs -= this.softDropArrMs;
        this.actions.softDrop();
      }
    }
  }

  public clearActiveInputs(): void {
    this.clearKeyboardState();
    this.activePointers.clear();
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.detachSurface();
    this.unbindHoldElement();
    this.detachKeyboard();
    this.clearActiveInputs();
  }

  private clearKeyboardState(): void {
    this.leftHeld = false;
    this.rightHeld = false;
    this.activeDir = null;
    this.dasTimerMs = 0;
    this.arrTimerMs = 0;
    this.softDropHeld = false;
    this.softDropTimerMs = 0;
  }

  private attachKeyboard(): void {
    if (!this.keyboardTarget) {
      return;
    }
    this.keyboardTarget.addEventListener('keydown', this.handleKeyDown as EventListener);
    this.keyboardTarget.addEventListener('keyup', this.handleKeyUp as EventListener);
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', this.handleWindowBlur);
    }
  }

  private detachKeyboard(): void {
    if (this.keyboardTarget) {
      this.keyboardTarget.removeEventListener('keydown', this.handleKeyDown as EventListener);
      this.keyboardTarget.removeEventListener('keyup', this.handleKeyUp as EventListener);
      this.keyboardTarget = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', this.handleWindowBlur);
    }
  }

  private canAcceptGameInput(): boolean {
    return this.actions.canAcceptGameInput ? this.actions.canAcceptGameInput() : true;
  }

  private canTogglePause(): boolean {
    return this.actions.canTogglePause ? this.actions.canTogglePause() : true;
  }

  private fireDirectionalMove(dir: 'left' | 'right'): void {
    if (dir === 'left') {
      this.actions.moveLeft();
    } else {
      this.actions.moveRight();
    }
  }

  private handleWindowBlur = (): void => {
    this.clearActiveInputs();
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (this.destroyed || e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    if (isEditableElement(e.target)) {
      return;
    }

    if (isPauseKey(e)) {
      if (!e.repeat && this.canTogglePause()) {
        e.preventDefault?.();
        this.clearActiveInputs();
        this.actions.togglePause();
      }
      return;
    }

    if (!this.canAcceptGameInput()) {
      return;
    }

    if (isLeftKey(e)) {
      e.preventDefault?.();
      if (!e.repeat && !this.leftHeld) {
        this.leftHeld = true;
        this.activeDir = 'left';
        this.dasTimerMs = 0;
        this.arrTimerMs = 0;
        this.actions.moveLeft();
      }
      return;
    }

    if (isRightKey(e)) {
      e.preventDefault?.();
      if (!e.repeat && !this.rightHeld) {
        this.rightHeld = true;
        this.activeDir = 'right';
        this.dasTimerMs = 0;
        this.arrTimerMs = 0;
        this.actions.moveRight();
      }
      return;
    }

    if (isRotateKey(e)) {
      e.preventDefault?.();
      if (!e.repeat) {
        this.actions.rotateCW();
      }
      return;
    }

    if (isSoftDropKey(e)) {
      e.preventDefault?.();
      if (!e.repeat && !this.softDropHeld) {
        this.softDropHeld = true;
        this.softDropTimerMs = 0;
        this.actions.softDrop();
      }
      return;
    }

    if (isSlamKey(e)) {
      e.preventDefault?.();
      if (!e.repeat) {
        this.actions.slam();
      }
      return;
    }

    if (isHoldKey(e)) {
      e.preventDefault?.();
      if (!e.repeat) {
        this.actions.hold();
      }
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (this.destroyed) {
      return;
    }

    if (isLeftKey(e)) {
      this.leftHeld = false;
      if (this.activeDir === 'left') {
        if (this.rightHeld) {
          this.activeDir = 'right';
          this.dasTimerMs = 0;
          this.arrTimerMs = 0;
        } else {
          this.activeDir = null;
          this.dasTimerMs = 0;
          this.arrTimerMs = 0;
        }
      }
      return;
    }

    if (isRightKey(e)) {
      this.rightHeld = false;
      if (this.activeDir === 'right') {
        if (this.leftHeld) {
          this.activeDir = 'left';
          this.dasTimerMs = 0;
          this.arrTimerMs = 0;
        } else {
          this.activeDir = null;
          this.dasTimerMs = 0;
          this.arrTimerMs = 0;
        }
      }
      return;
    }

    if (isSoftDropKey(e)) {
      this.softDropHeld = false;
      this.softDropTimerMs = 0;
    }
  };

  private handleHoldPointerDown = (e: PointerEvent): void => {
    if (this.destroyed) {
      return;
    }
    if (e.button !== undefined && e.button !== 0) {
      return;
    }
    e.stopPropagation?.();
    e.preventDefault?.();
    this.triggerHold();
  };

  private handleSurfacePointerDown = (e: PointerEvent): void => {
    if (this.destroyed || !this.canAcceptGameInput()) {
      return;
    }
    if (matchesIgnoreSelector(e.target, this.ignoreSelector)) {
      return;
    }

    if (e.button === 2) {
      e.preventDefault?.();
      this.lastRightPointerDownAt = this.now();
      this.actions.hold();
      return;
    }

    if (e.button !== undefined && e.button !== 0) {
      return;
    }

    e.preventDefault?.();
    const pointerId = e.pointerId ?? 0;
    const x = e.clientX ?? 0;
    const y = e.clientY ?? 0;
    const t = this.now();

    this.activePointers.set(pointerId, {
      pointerId,
      startX: x,
      startY: y,
      lastX: x,
      lastY: y,
      startTimeMs: t,
      lastDownMoveTimeMs: -Infinity,
      dragAccumX: 0,
      dragAccumY: 0,
      hasDraggedHorizontally: false,
      hasDraggedVertically: false,
      hasSlammed: false,
      maxDistanceSq: 0,
      recentSamples: [{ x, y, t }],
    });
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (this.destroyed || this.processedPointerEvents.has(e)) {
      return;
    }
    this.processedPointerEvents.add(e);

    const pointerId = e.pointerId ?? 0;
    const track = this.activePointers.get(pointerId);
    if (!track) {
      return;
    }
    if (!this.canAcceptGameInput()) {
      return;
    }

    const x = e.clientX ?? track.lastX;
    const y = e.clientY ?? track.lastY;
    const t = this.now();

    const dx = x - track.lastX;
    const dy = y - track.lastY;
    track.lastX = x;
    track.lastY = y;

    const totalDx = x - track.startX;
    const totalDy = y - track.startY;
    const distSq = totalDx * totalDx + totalDy * totalDy;
    if (distSq > track.maxDistanceSq) {
      track.maxDistanceSq = distSq;
    }

    track.recentSamples.push({ x, y, t });
    while (track.recentSamples.length > 2 && t - track.recentSamples[0].t > SWIPE_WINDOW_MS * 2) {
      track.recentSamples.shift();
    }

    if (dy > 1) {
      track.lastDownMoveTimeMs = t;
    }

    const gestureElapsedMs = t - track.startTimeMs;
    const flickOrigin = this.sampleAtTime(track, t - SWIPE_WINDOW_MS);
    const windowDy = y - flickOrigin.y;
    const windowDx = x - flickOrigin.x;
    const dt = Math.max(1, t - flickOrigin.t);
    const velocityY = windowDy / dt;

    // Hold off soft-drop briefly only during an early fast vertical flick; once held longer
    // or slowed down, flush accumulated downward drag into smooth row-by-row soft drops.
    const isEarlyQuickFlick =
      !track.hasDraggedHorizontally &&
      !track.hasDraggedVertically &&
      gestureElapsedMs <= SWIPE_WINDOW_MS &&
      windowDy > 0 &&
      velocityY >= this.swipeDownMinVelocityPxPerMs &&
      windowDy > Math.abs(windowDx) * this.swipeDownDominanceRatio;

    track.dragAccumX += dx;
    while (track.dragAccumX >= this.cellWidthPx) {
      track.dragAccumX -= this.cellWidthPx;
      track.hasDraggedHorizontally = true;
      if (Math.abs(windowDx) > Math.max(0, windowDy) * 2) {
        track.dragAccumY = 0;
      }
      const moved = this.actions.moveRight();
      if (!moved) {
        track.dragAccumX = 0;
        break;
      }
    }
    while (track.dragAccumX <= -this.cellWidthPx) {
      track.dragAccumX += this.cellWidthPx;
      track.hasDraggedHorizontally = true;
      if (Math.abs(windowDx) > Math.max(0, windowDy) * 2) {
        track.dragAccumY = 0;
      }
      const moved = this.actions.moveLeft();
      if (!moved) {
        track.dragAccumX = 0;
        break;
      }
    }

    if (dy < 0) {
      track.dragAccumY = Math.max(0, track.dragAccumY + dy);
    } else if (dy > 0 && Math.abs(dx) <= dy * 2) {
      track.dragAccumY += dy;
    }

    if (!isEarlyQuickFlick) {
      const verticalStepPx = Math.max(8, this.cellWidthPx * this.softDropStepRatio);
      while (track.dragAccumY >= verticalStepPx) {
        track.dragAccumY -= verticalStepPx;
        track.hasDraggedVertically = true;
        const dropped = this.actions.softDrop();
        if (!dropped) {
          track.dragAccumY = 0;
          break;
        }
      }
    }
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (this.destroyed || this.processedPointerEvents.has(e)) {
      return;
    }
    this.processedPointerEvents.add(e);

    const pointerId = e.pointerId ?? 0;
    const track = this.activePointers.get(pointerId);
    if (!track) {
      return;
    }
    this.activePointers.delete(pointerId);

    if (!this.canAcceptGameInput()) {
      return;
    }

    const x = e.clientX ?? track.lastX;
    const y = e.clientY ?? track.lastY;
    const t = this.now();
    const totalDx = x - track.startX;
    const totalDy = y - track.startY;
    const distSq = totalDx * totalDx + totalDy * totalDy;
    if (distSq > track.maxDistanceSq) {
      track.maxDistanceSq = distSq;
    }

    if (y - track.lastY > 1) {
      track.lastDownMoveTimeMs = t;
    }
    track.recentSamples.push({ x, y, t });

    if (this.isQuickSwipeDown(track, x, y, t)) {
      track.hasSlammed = true;
      this.actions.slam();
      return;
    }

    const tapRadiusSq = this.tapMaxDistancePx * this.tapMaxDistancePx;
    const durationMs = t - track.startTimeMs;
    if (
      !track.hasSlammed &&
      !track.hasDraggedHorizontally &&
      !track.hasDraggedVertically &&
      track.maxDistanceSq <= tapRadiusSq &&
      durationMs <= this.tapMaxDurationMs
    ) {
      this.actions.rotateCW();
    }
  };

  private sampleAtTime(track: PointerTrack, targetT: number): PointerSample {
    const samples = track.recentSamples;
    if (samples.length === 0) {
      return { x: track.startX, y: track.startY, t: track.startTimeMs };
    }
    if (targetT <= samples[0].t) {
      return samples[0];
    }
    const last = samples[samples.length - 1];
    if (targetT >= last.t) {
      return last;
    }
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      if (targetT <= b.t) {
        const span = b.t - a.t;
        if (span <= 0) return b;
        const alpha = (targetT - a.t) / span;
        return {
          x: a.x + (b.x - a.x) * alpha,
          y: a.y + (b.y - a.y) * alpha,
          t: targetT,
        };
      }
    }
    return last;
  }

  private isQuickSwipeDown(track: PointerTrack, x: number, y: number, t: number): boolean {
    if (track.hasSlammed || track.hasDraggedHorizontally) {
      return false;
    }

    const durationMs = t - track.startTimeMs;
    if (durationMs > this.swipeDownMaxDurationMs) {
      return false;
    }

    // Must not pause/stop before lifting finger
    if (track.lastDownMoveTimeMs === -Infinity || t - track.lastDownMoveTimeMs > SWIPE_MAX_RELEASE_PAUSE_MS) {
      return false;
    }

    const totalDx = x - track.startX;
    const totalDy = y - track.startY;
    if (totalDy < this.swipeDownThresholdPx || totalDy <= Math.abs(totalDx) * this.swipeDownDominanceRatio) {
      return false;
    }

    const windowStart = this.sampleAtTime(track, Math.max(track.startTimeMs, t - SWIPE_WINDOW_MS));
    const windowDy = y - windowStart.y;
    const windowDx = x - windowStart.x;
    const windowDt = Math.max(1, t - windowStart.t);
    const windowVelocity = windowDy / windowDt;

    if (
      windowDy < this.swipeDownThresholdPx ||
      windowVelocity < this.swipeDownMinVelocityPxPerMs ||
      windowDy <= Math.abs(windowDx) * this.swipeDownDominanceRatio
    ) {
      return false;
    }

    // Must still be moving quickly right up to release (not decelerating before letting go)
    const tailStart = this.sampleAtTime(track, Math.max(track.startTimeMs, t - SWIPE_TAIL_WINDOW_MS));
    const tailDy = y - tailStart.y;
    const tailDt = Math.max(1, t - tailStart.t);
    const tailVelocity = tailDy / tailDt;
    const minTailVelocity = this.swipeDownMinVelocityPxPerMs * SWIPE_TAIL_MIN_VELOCITY_RATIO;

    return tailVelocity >= minTailVelocity;
  }

  private handlePointerCancel = (e: PointerEvent): void => {
    if (this.destroyed || this.processedPointerEvents.has(e)) {
      return;
    }
    this.processedPointerEvents.add(e);

    const pointerId = e.pointerId ?? 0;
    this.activePointers.delete(pointerId);
  };

  private handleContextMenu = (e: MouseEvent): void => {
    if (this.destroyed) {
      return;
    }
    e.preventDefault?.();
    if (!this.canAcceptGameInput()) {
      return;
    }
    if (matchesIgnoreSelector(e.target, this.ignoreSelector)) {
      return;
    }
    if (this.now() - this.lastRightPointerDownAt > RIGHT_CLICK_DEDUPE_MS) {
      this.actions.hold();
    }
  };
}
