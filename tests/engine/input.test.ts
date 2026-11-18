// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InputController,
  TetrisGame,
  type InputActions,
} from '../../src/engine/index';

function makePointerEvent(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  opts: {
    pointerId?: number;
    clientX?: number;
    clientY?: number;
    button?: number;
    bubbles?: boolean;
  } = {}
): PointerEvent {
  const ev = new MouseEvent(type, {
    bubbles: opts.bubbles ?? true,
    cancelable: true,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    button: opts.button ?? 0,
  });
  Object.defineProperty(ev, 'pointerId', {
    value: opts.pointerId ?? 1,
    configurable: true,
  });
  return ev as unknown as PointerEvent;
}

function createSpyActions() {
  return {
    moveLeft: vi.fn(() => true),
    moveRight: vi.fn(() => true),
    softDrop: vi.fn(() => true),
    rotateCW: vi.fn(() => true),
    slam: vi.fn(() => 10),
    hold: vi.fn(() => true),
    togglePause: vi.fn(),
    canAcceptGameInput: vi.fn(() => true),
    canTogglePause: vi.fn(() => true),
  } satisfies InputActions;
}

describe('InputController - Keyboard Bindings & DAS/ARR', () => {
  let surface: HTMLDivElement;
  let holdBtn: HTMLButtonElement;
  let actions: ReturnType<typeof createSpyActions>;
  let clockMs: number;
  let controller: InputController;

  beforeEach(() => {
    surface = document.createElement('div');
    holdBtn = document.createElement('button');
    holdBtn.setAttribute('data-hold-trigger', 'true');
    surface.appendChild(holdBtn);
    document.body.appendChild(surface);

    actions = createSpyActions();
    clockMs = 1000;
    controller = new InputController({
      target: surface,
      holdElement: holdBtn,
      actions,
      cellWidthPx: 32,
      dasMs: 150,
      arrMs: 45,
      now: () => clockMs,
    });
  });

  afterEach(() => {
    controller.destroy();
    surface.remove();
  });

  it('binds exact keys A/D (move), W (rotate CW), S (soft drop), Space (slam), E (hold), Escape/P (pause) and ignores Arrow keys', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', code: 'KeyD' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'S', code: 'KeyS' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP' }));

    expect(actions.moveLeft).toHaveBeenCalledTimes(1);
    expect(actions.moveRight).toHaveBeenCalledTimes(1);
    expect(actions.rotateCW).toHaveBeenCalledTimes(1);
    expect(actions.softDrop).toHaveBeenCalledTimes(1);
    expect(actions.slam).toHaveBeenCalledTimes(1);
    expect(actions.hold).toHaveBeenCalledTimes(1);
    expect(actions.togglePause).toHaveBeenCalledTimes(2);

    // Arrow keys MUST NOT trigger any game actions
    for (const arrow of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: arrow, code: arrow }));
    }
    expect(actions.moveLeft).toHaveBeenCalledTimes(1);
    expect(actions.moveRight).toHaveBeenCalledTimes(1);
    expect(actions.rotateCW).toHaveBeenCalledTimes(1);
    expect(actions.softDrop).toHaveBeenCalledTimes(1);
    expect(actions.slam).toHaveBeenCalledTimes(1);
  });

  it('ignores key repeat on W, Space, S, E, Escape, P', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', repeat: false }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', repeat: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', repeat: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', repeat: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE', repeat: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', repeat: true }));

    expect(actions.rotateCW).toHaveBeenCalledTimes(1);
    expect(actions.softDrop).toHaveBeenCalledTimes(0);
    expect(actions.slam).toHaveBeenCalledTimes(0);
    expect(actions.hold).toHaveBeenCalledTimes(0);
    expect(actions.togglePause).toHaveBeenCalledTimes(0);
  });

  it('soft-drops smoothly while S is held without slamming, and clears on keyup, blur, and clearActiveInputs', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS' }));
    expect(actions.softDrop).toHaveBeenCalledTimes(1);
    expect(actions.slam).not.toHaveBeenCalled();

    controller.update(44);
    expect(actions.softDrop).toHaveBeenCalledTimes(1);

    controller.update(1);
    expect(actions.softDrop).toHaveBeenCalledTimes(2);

    controller.update(90);
    expect(actions.softDrop).toHaveBeenCalledTimes(4);

    // Concurrent A + S hold runs both horizontal DAS/ARR and soft-drop repeat
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA' }));
    expect(actions.moveLeft).toHaveBeenCalledTimes(1);
    controller.update(150);
    expect(actions.moveLeft).toHaveBeenCalledTimes(2);
    expect(actions.softDrop).toHaveBeenCalledTimes(7); // +3 ticks (150 / 45 = 3, remainder 15)

    // Keyup S stops soft drop while A continues
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 's', code: 'KeyS' }));
    controller.update(90);
    expect(actions.softDrop).toHaveBeenCalledTimes(7);
    expect(actions.moveLeft).toHaveBeenCalledTimes(4);
    expect(actions.slam).not.toHaveBeenCalled();

    // Blur clears held S
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS' }));
    expect(actions.softDrop).toHaveBeenCalledTimes(8);
    window.dispatchEvent(new Event('blur'));
    controller.update(200);
    expect(actions.softDrop).toHaveBeenCalledTimes(8);

    // clearActiveInputs clears held S
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS' }));
    expect(actions.softDrop).toHaveBeenCalledTimes(9);
    controller.clearActiveInputs();
    controller.update(200);
    expect(actions.softDrop).toHaveBeenCalledTimes(9);
  });

  it('applies smooth DAS (150ms) and ARR (45ms) for held A/D keys and handles last-key-wins', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA' }));
    expect(actions.moveLeft).toHaveBeenCalledTimes(1);

    controller.update(149);
    expect(actions.moveLeft).toHaveBeenCalledTimes(1);

    // Hits 150ms -> 1st repeat
    controller.update(1);
    expect(actions.moveLeft).toHaveBeenCalledTimes(2);

    // +90ms -> 2 ARR ticks (45ms * 2)
    controller.update(90);
    expect(actions.moveLeft).toHaveBeenCalledTimes(4);

    // Roll into D while A still held -> switches to right immediately
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD' }));
    expect(actions.moveRight).toHaveBeenCalledTimes(1);
    controller.update(150);
    expect(actions.moveRight).toHaveBeenCalledTimes(2);

    // Release D while A is still held -> resumes left
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD' }));
    controller.update(150);
    expect(actions.moveLeft).toHaveBeenCalledTimes(5);

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA' }));
    controller.update(200);
    expect(actions.moveLeft).toHaveBeenCalledTimes(5);
  });

  it('ignores keyboard shortcuts while typing in an input element', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE', bubbles: true }));
    expect(actions.moveLeft).not.toHaveBeenCalled();
    expect(actions.rotateCW).not.toHaveBeenCalled();
    expect(actions.softDrop).not.toHaveBeenCalled();
    expect(actions.slam).not.toHaveBeenCalled();
    expect(actions.hold).not.toHaveBeenCalled();
    input.remove();
  });
});

describe('InputController - Mouse, Touch, and Multitouch Gestures', () => {
  let surface: HTMLDivElement;
  let holdBtn: HTMLButtonElement;
  let pauseBtn: HTMLButtonElement;
  let actions: ReturnType<typeof createSpyActions>;
  let clockMs: number;
  let controller: InputController;

  beforeEach(() => {
    surface = document.createElement('div');
    holdBtn = document.createElement('button');
    holdBtn.setAttribute('data-hold-trigger', 'true');
    pauseBtn = document.createElement('button');
    pauseBtn.setAttribute('data-pause-trigger', 'true');
    surface.appendChild(holdBtn);
    surface.appendChild(pauseBtn);
    document.body.appendChild(surface);

    actions = createSpyActions();
    clockMs = 5000;
    controller = new InputController({
      target: surface,
      holdElement: holdBtn,
      actions,
      cellWidthPx: 32,
      now: () => clockMs,
    });
  });

  afterEach(() => {
    controller.destroy();
    surface.remove();
  });

  it('steers horizontally column-by-column on drag and does not rotate on release', () => {
    surface.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 200 }));
    clockMs += 30;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 164, clientY: 202 }));
    expect(actions.moveRight).toHaveBeenCalledTimes(2); // +64px / 32px = 2 cols

    clockMs += 30;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 130, clientY: 202 }));
    expect(actions.moveLeft).toHaveBeenCalledTimes(1); // -34px -> 1 col left

    clockMs += 30;
    surface.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: 130, clientY: 202 }));
    expect(actions.rotateCW).not.toHaveBeenCalled();
  });

  it('rotates on quick tap (< 12px, < 300ms) and ignores taps starting on Pause/Hold buttons', () => {
    // Quick tap on play surface
    surface.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: 150, clientY: 250 }));
    clockMs += 80;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 155, clientY: 254 }));
    clockMs += 40;
    surface.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: 156, clientY: 254 }));
    expect(actions.rotateCW).toHaveBeenCalledTimes(1);

    // Long press (> 300ms) does not rotate
    surface.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 2, clientX: 150, clientY: 250 }));
    clockMs += 350;
    surface.dispatchEvent(makePointerEvent('pointerup', { pointerId: 2, clientX: 150, clientY: 250 }));
    expect(actions.rotateCW).toHaveBeenCalledTimes(1);

    // Tap starting on pause button does not rotate on surface
    pauseBtn.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 3, clientX: 10, clientY: 10 }));
    clockMs += 50;
    pauseBtn.dispatchEvent(makePointerEvent('pointerup', { pointerId: 3, clientX: 10, clientY: 10 }));
    expect(actions.rotateCW).toHaveBeenCalledTimes(1);
  });

  it('soft-drops row-by-row on controlled downward drag without slamming or tap-rotating', () => {
    // cellWidthPx = 32 -> vertical soft-drop step = 0.85 * 32 = 27.2px
    // Drag down slowly at ~0.35 px/ms (well below fast-swipe gate of 0.55 px/ms)
    surface.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: 120, clientY: 100 }));
    clockMs += 80;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 128 })); // +28px in 80ms = 0.35 px/ms
    expect(actions.softDrop).toHaveBeenCalledTimes(1);
    expect(actions.slam).not.toHaveBeenCalled();

    clockMs += 80;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 156 })); // +28px (accum 28.8)
    expect(actions.softDrop).toHaveBeenCalledTimes(2);
    expect(actions.slam).not.toHaveBeenCalled();

    clockMs += 80;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 184 })); // +28px (accum 29.6)
    expect(actions.softDrop).toHaveBeenCalledTimes(3);
    expect(actions.slam).not.toHaveBeenCalled();

    // Dragging back upward then releasing does NOT rotate CW or accumulate negative debt
    clockMs += 100;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 100 }));
    clockMs += 20;
    surface.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: 120, clientY: 100 }));
    expect(actions.rotateCW).not.toHaveBeenCalled();
    expect(actions.slam).not.toHaveBeenCalled();
  });

  it('ignores minor downward drift during horizontal drag and supports drag-down then tuck-sideways', () => {
    // Long horizontal drag with slight downward curve (dx=32, dy=6 per step) -> no accidental softDrop
    surface.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 2, clientX: 100, clientY: 200 }));
    for (let i = 1; i <= 5; i++) {
      clockMs += 40;
      surface.dispatchEvent(
        makePointerEvent('pointermove', { pointerId: 2, clientX: 100 + i * 32, clientY: 200 + i * 6 })
      );
    }
    expect(actions.moveRight).toHaveBeenCalledTimes(5);
    expect(actions.softDrop).not.toHaveBeenCalled();

    // Now drag downward slowly 30px, then tuck left 1 col
    clockMs += 90;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 2, clientX: 260, clientY: 260 }));
    expect(actions.softDrop).toHaveBeenCalledTimes(1);
    clockMs += 50;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 2, clientX: 228, clientY: 260 }));
    expect(actions.moveLeft).toHaveBeenCalledTimes(1);
    expect(actions.slam).not.toHaveBeenCalled();
    surface.dispatchEvent(makePointerEvent('pointerup', { pointerId: 2, clientX: 228, clientY: 260 }));
  });

  it('slams once per fast downward swipe without soft-dropping and ignores slow or diagonal downward movement', () => {
    // Fast downward swipe: 60px in 40ms (1.5 px/ms, passing through 30px mid-flick)
    surface.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 }));
    clockMs += 20;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 102, clientY: 130 }));
    clockMs += 20;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 104, clientY: 160 }));
    expect(actions.slam).toHaveBeenCalledTimes(1);
    expect(actions.softDrop).not.toHaveBeenCalled();

    // Further downward movement on the SAME swipe does NOT double-slam or soft-drop
    clockMs += 20;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 104, clientY: 220 }));
    surface.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: 104, clientY: 220 }));
    expect(actions.slam).toHaveBeenCalledTimes(1);
    expect(actions.softDrop).not.toHaveBeenCalled();
    expect(actions.rotateCW).not.toHaveBeenCalled();

    // Slow downward drift: 50px over 600ms -> soft-drops once, MUST NOT slam
    surface.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 2, clientX: 100, clientY: 100 }));
    clockMs += 600;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 2, clientX: 100, clientY: 150 }));
    surface.dispatchEvent(makePointerEvent('pointerup', { pointerId: 2, clientX: 100, clientY: 150 }));
    expect(actions.slam).toHaveBeenCalledTimes(1);
    expect(actions.softDrop).toHaveBeenCalledTimes(1);

    // Fast diagonal swipe (dx=45, dy=50 -> dy <= 45 * 1.35) MUST NOT slam
    surface.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 3, clientX: 100, clientY: 100 }));
    clockMs += 50;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 3, clientX: 145, clientY: 150 }));
    surface.dispatchEvent(makePointerEvent('pointerup', { pointerId: 3, clientX: 145, clientY: 150 }));
    expect(actions.slam).toHaveBeenCalledTimes(1);
  });

  it('holds on right-click and prevents contextmenu without triggering tap-rotate', () => {
    surface.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, button: 2, clientX: 120, clientY: 120 }));
    surface.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, button: 2, clientX: 120, clientY: 120 }));
    const ctxEv = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 });
    const notCancelled = surface.dispatchEvent(ctxEv);

    expect(notCancelled).toBe(false); // preventDefault called
    expect(ctxEv.defaultPrevented).toBe(true);
    expect(actions.hold).toHaveBeenCalledTimes(1);
    expect(actions.rotateCW).not.toHaveBeenCalled();
  });

  it('supports multitouch: simultaneous drag (pointer 1) + tap rotate (pointer 2) and hold (pointer 3)', () => {
    // Finger 1 starts dragging
    surface.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 300 }));
    clockMs += 20;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 132, clientY: 300 }));
    expect(actions.moveRight).toHaveBeenCalledTimes(1);
    expect(controller.getActivePointerCount()).toBe(1);

    // While Finger 1 is STILL DOWN, Finger 2 taps the play area to rotate!
    surface.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 2, clientX: 260, clientY: 320 }));
    expect(controller.getActivePointerCount()).toBe(2);
    clockMs += 60;
    surface.dispatchEvent(makePointerEvent('pointerup', { pointerId: 2, clientX: 262, clientY: 321 }));
    expect(actions.rotateCW).toHaveBeenCalledTimes(1);

    // Finger 1 is STILL active and can drag further!
    expect(controller.getActivePointerCount()).toBe(1);
    clockMs += 20;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 164, clientY: 300 }));
    expect(actions.moveRight).toHaveBeenCalledTimes(2);

    // While Finger 1 is STILL DOWN, Finger 3 taps the Hold box -> holds without cancelling Finger 1!
    holdBtn.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 3, clientX: 20, clientY: 20 }));
    holdBtn.dispatchEvent(makePointerEvent('pointerup', { pointerId: 3, clientX: 20, clientY: 20 }));
    expect(actions.hold).toHaveBeenCalledTimes(1);
    expect(actions.rotateCW).toHaveBeenCalledTimes(1); // Hold box tap did NOT leak to surface tap-rotate
    expect(controller.getActivePointerCount()).toBe(1);

    // Finger 1 continues dragging left cleanly!
    clockMs += 20;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 132, clientY: 300 }));
    expect(actions.moveLeft).toHaveBeenCalledTimes(1);

    // Also test explicit triggerHold() keeps Finger 1 active
    expect(controller.triggerHold()).toBe(true);
    expect(actions.hold).toHaveBeenCalledTimes(2);
    expect(controller.getActivePointerCount()).toBe(1);

    // While Finger 1 is STILL DOWN, Finger 4 swipes down to slam!
    surface.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 4, clientX: 250, clientY: 200 }));
    clockMs += 40;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 4, clientX: 250, clientY: 255 }));
    expect(actions.slam).toHaveBeenCalledTimes(1);
    surface.dispatchEvent(makePointerEvent('pointerup', { pointerId: 4, clientX: 250, clientY: 255 }));
    expect(controller.getActivePointerCount()).toBe(1);

    // Finger 1 slowly drags down to soft-drop while Finger 5 taps to rotate CW!
    clockMs += 90;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 132, clientY: 330 }));
    expect(actions.softDrop).toHaveBeenCalledTimes(1);
    surface.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 5, clientX: 270, clientY: 330 }));
    clockMs += 50;
    surface.dispatchEvent(makePointerEvent('pointerup', { pointerId: 5, clientX: 270, clientY: 330 }));
    expect(actions.rotateCW).toHaveBeenCalledTimes(2);

    surface.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: 132, clientY: 330 }));
    expect(controller.getActivePointerCount()).toBe(0);
    expect(actions.rotateCW).toHaveBeenCalledTimes(2);
  });

  it('clamps upward drag accumulation smoothly and blocks tap-rotate whenever vertical soft-drop engaged', () => {
    const smallCellActions = createSpyActions();
    let grounded = false;
    smallCellActions.softDrop.mockImplementation(() => !grounded);

    const smallCtrl = new InputController({
      target: surface,
      actions: smallCellActions,
      cellWidthPx: 12, // 0.85 * 12 = 10.2px <= tapMaxDistancePx (12px)
      now: () => clockMs,
    });

    // Drag up 50px first (does not create negative debt), then slow down 11px -> 1 softDrop!
    surface.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 21, clientX: 100, clientY: 200 }));
    clockMs += 100;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 21, clientX: 100, clientY: 150 }));
    clockMs += 60;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 21, clientX: 100, clientY: 161 }));
    expect(smallCellActions.softDrop).toHaveBeenCalledTimes(1);
    surface.dispatchEvent(makePointerEvent('pointerup', { pointerId: 21, clientX: 100, clientY: 161 }));
    expect(smallCellActions.rotateCW).not.toHaveBeenCalled();

    // When grounded (softDrop returns false), dragging 11px (< tapMaxDistancePx=12) STILL sets hasDraggedVertically
    grounded = true;
    surface.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 22, clientX: 100, clientY: 200 }));
    clockMs += 60;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 22, clientX: 100, clientY: 211 }));
    expect(smallCellActions.softDrop).toHaveBeenCalledTimes(2);
    clockMs += 20;
    surface.dispatchEvent(makePointerEvent('pointerup', { pointerId: 22, clientX: 100, clientY: 211 }));
    expect(smallCellActions.rotateCW).not.toHaveBeenCalled();

    smallCtrl.destroy();
  });

  it('recovers immediately when dragging past a wall and reversing, and handles pointercancel cleanly', () => {
    let col = 0;
    const boundedActions = createSpyActions();
    boundedActions.moveLeft.mockImplementation(() => {
      if (col <= -2) return false;
      col -= 1;
      return true;
    });
    boundedActions.moveRight.mockImplementation(() => {
      if (col >= 2) return false;
      col += 1;
      return true;
    });

    const bounded = new InputController({
      target: surface,
      actions: boundedActions,
      cellWidthPx: 32,
      now: () => clockMs,
    });

    // Drag 200px left into wall at col = -2, then reverse 32px right -> immediately moves right!
    surface.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 11, clientX: 300, clientY: 200 }));
    clockMs += 30;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 11, clientX: 100, clientY: 200 }));
    expect(col).toBe(-2);

    clockMs += 30;
    surface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 11, clientX: 132, clientY: 200 }));
    expect(col).toBe(-1);

    // pointercancel removes pointer without rotating
    surface.dispatchEvent(makePointerEvent('pointercancel', { pointerId: 11, clientX: 132, clientY: 200 }));
    expect(bounded.getActivePointerCount()).toBe(0);
    expect(boundedActions.rotateCW).not.toHaveBeenCalled();

    bounded.destroy();
  });

  it('integrates with TetrisGame for continuous bottom dragging during 1000ms lock delay', () => {
    const game = new TetrisGame({ pieceSequence: ['O', 'T'] });
    const realSurface = document.createElement('div');
    document.body.appendChild(realSurface);

    let t = 0;
    const realController = new InputController({
      target: realSurface,
      actions: game,
      cellWidthPx: 30,
      now: () => t,
    });

    // Drop O to bottom
    while (!game.getSnapshot().activePiece!.isGrounded) {
      game.step(900);
    }
    const startX = game.getSnapshot().activePiece!.x;

    // Drag right 2 cells after 600ms, then wait 600ms, then drag left 1 cell -> resets 1s lock timer!
    realSurface.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 10, clientX: 150, clientY: 400 }));
    game.step(600);
    t += 600;
    realSurface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 10, clientX: 210, clientY: 400 }));
    expect(game.getSnapshot().activePiece!.x).toBe(startX + 2);
    expect(game.getSnapshot().lockProgress).toBe(0);

    game.step(600);
    t += 600;
    expect(game.getSnapshot().activePiece!.type).toBe('O'); // still sliding!
    realSurface.dispatchEvent(makePointerEvent('pointermove', { pointerId: 10, clientX: 180, clientY: 400 }));
    expect(game.getSnapshot().activePiece!.x).toBe(startX + 1);
    expect(game.getSnapshot().lockProgress).toBe(0);

    // Now stop dragging for 1000ms -> locks!
    game.step(1000);
    expect(game.getSnapshot().activePiece!.type).toBe('T');

    // Keyboard S soft-drops row-by-row (+1 pt/row) without slamming; Space hard-drops & locks!
    const tStartY = game.getSnapshot().activePiece!.y;
    const scoreBeforeSoftDrop = game.getSnapshot().score;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS' }));
    realController.update(90); // +2 softDrop repeats => 3 total rows dropped
    expect(game.getSnapshot().activePiece!.type).toBe('T');
    expect(game.getSnapshot().activePiece!.y).toBe(tStartY + 3);
    expect(game.getSnapshot().score).toBe(scoreBeforeSoftDrop + 3);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 's', code: 'KeyS' }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space' }));
    expect(game.getSnapshot().activePiece!.type).not.toBe('T'); // slammed & locked!

    realController.destroy();
    realSurface.remove();
  });
});
