// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeaderboardResponse } from '../../src/shared/types';
import { ApiClient } from '../../src/ui/api';
import { LevelCarousel } from '../../src/ui/carousel';
import { ExitModal } from '../../src/ui/exit-modal';
import { exitFullscreen, requestFullscreen } from '../../src/ui/fullscreen';
import { createIcon, type IconName } from '../../src/ui/icons';
import { LeaderboardModal } from '../../src/ui/leaderboard-modal';
import { controlsLegend } from '../../src/ui/modal';
import {
  clearProfile,
  loadProfile,
  loadSettings,
  saveProfile,
  updateSettings,
  validateUsername,
} from '../../src/ui/storage';

function makePointerEvent(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  opts: { pointerId?: number; clientX?: number; clientY?: number; button?: number } = {}
): PointerEvent {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    button: opts.button ?? 0,
  });
  Object.defineProperty(ev, 'pointerId', { value: opts.pointerId ?? 1, configurable: true });
  return ev as unknown as PointerEvent;
}

describe('UI Storage & Validation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('validates and normalizes player usernames', () => {
    expect(validateUsername('A').ok).toBe(false);
    expect(validateUsername('   ').ok).toBe(false);
    expect(validateUsername('x'.repeat(25)).ok).toBe(false);

    const ok = validateUsername('  Star   Mom ');
    expect(ok).toEqual({ ok: true, username: 'star mom', displayName: 'Star Mom' });
  });

  it('persists profile and UI settings safely', () => {
    expect(loadProfile()).toBeNull();
    saveProfile({
      username: 'starmom',
      displayName: 'StarMom',
      bestScore: 14200,
      gamesPlayed: 3,
      offline: false,
    });
    expect(loadProfile()?.bestScore).toBe(14200);
    clearProfile();
    expect(loadProfile()).toBeNull();

    expect(loadSettings()).toEqual({ ghostEnabled: true, startLevel: 1, hintSeen: true });
    const next = updateSettings({ ghostEnabled: false, startLevel: 99 });
    expect(next).toEqual({ ghostEnabled: false, startLevel: 15, hintSeen: true });
    expect(loadSettings().ghostEnabled).toBe(false);
  });
});

describe('Fullscreen Helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses standard requestFullscreen and handles rejections safely', async () => {
    const el = document.createElement('div');
    const req = vi.fn(() => Promise.resolve());
    Object.defineProperty(el, 'requestFullscreen', { value: req, configurable: true });

    await expect(requestFullscreen(el)).resolves.toBe(true);
    expect(req).toHaveBeenCalledTimes(1);

    const deniedEl = document.createElement('div');
    Object.defineProperty(deniedEl, 'requestFullscreen', {
      value: () => Promise.reject(new Error('Not supported')),
      configurable: true,
    });
    await expect(requestFullscreen(deniedEl)).resolves.toBe(false);
  });

  it('falls back to webkitRequestFullscreen and exits cleanly', async () => {
    const el = document.createElement('div') as HTMLElement & { webkitRequestFullscreen?: () => void };
    const webkitReq = vi.fn();
    el.webkitRequestFullscreen = webkitReq;
    await expect(requestFullscreen(el)).resolves.toBe(true);
    expect(webkitReq).toHaveBeenCalledTimes(1);

    const exitSpy = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, 'fullscreenElement', { value: el, configurable: true });
    Object.defineProperty(document, 'exitFullscreen', { value: exitSpy, configurable: true });
    await expect(exitFullscreen()).resolves.toBe(true);
    expect(exitSpy).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  });
});

describe('LevelCarousel', () => {
  it('supports clicking, arrows, keyboard, swipe across levels 1..15 with level-only cards and SVG arrows', () => {
    const onChange = vi.fn();
    const carousel = new LevelCarousel({ initialLevel: 3, onChange });
    document.body.appendChild(carousel.element);

    expect(carousel.getLevel()).toBe(3);
    const cards = carousel.element.querySelectorAll('.level-card');
    expect(cards).toHaveLength(15);

    // Cards show LEVEL + number + 5-pip difficulty bar (no names, vibes, or s / row)
    expect(carousel.element.querySelector('.level-card-title')).toBeNull();
    expect(carousel.element.querySelector('.level-card-vibe')).toBeNull();
    expect(carousel.element.querySelector('.level-card-speed')).toBeNull();
    expect(cards[0].querySelectorAll('.speed-pips i')).toHaveLength(5);
    expect(cards[0].querySelectorAll('.speed-pips i.on')).toHaveLength(1);
    expect(cards[14].querySelectorAll('.speed-pips i.on')).toHaveLength(5);
    expect(cards[0].textContent).toBe('LEVEL1');
    expect(carousel.element.textContent).not.toContain('Stargazer');
    expect(carousel.element.textContent).not.toContain('s / row');

    // Arrow buttons use crisp SVG icons
    expect(carousel.element.querySelector('.carousel-prev svg[data-icon="chevronLeft"]')).not.toBeNull();
    expect(carousel.element.querySelector('.carousel-next svg[data-icon="chevronRight"]')).not.toBeNull();

    (carousel.element.querySelector('.carousel-next') as HTMLButtonElement).click();
    expect(carousel.getLevel()).toBe(4);
    expect(onChange).toHaveBeenLastCalledWith(4);

    const lvl10 = carousel.element.querySelector('[data-level="10"]') as HTMLButtonElement;
    lvl10.click();
    expect(carousel.getLevel()).toBe(10);

    const viewport = carousel.element.querySelector('.carousel-viewport') as HTMLElement;
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(carousel.getLevel()).toBe(9);

    // Swipe drag right->left should advance level
    viewport.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 1, clientX: 200, clientY: 20 }));
    viewport.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 60, clientY: 20 }));
    viewport.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: 60, clientY: 20 }));
    expect(carousel.getLevel()).toBeGreaterThan(9);

    carousel.element.remove();
  });
});

describe('SVG Icons, Controls Legend, ExitModal & Favicons', () => {
  it('renders crisp SVG icons for all icon names and updated controls legend', () => {
    const names: IconName[] = [
      'play',
      'pause',
      'trophy',
      'volumeOn',
      'volumeOff',
      'musicNote',
      'ghost',
      'close',
      'chevronLeft',
      'chevronRight',
      'chevronDown',
      'star',
      'exitDoor',
    ];
    for (const name of names) {
      const svg = createIcon(name, { size: 20 });
      expect(svg.tagName.toLowerCase()).toBe('svg');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.children.length).toBeGreaterThan(0);
    }

    const legend = controlsLegend();
    const rows = Array.from(legend.querySelectorAll('.legend-row')).map((row) => ({
      action: row.querySelector('dt')?.textContent,
      kbd: row.querySelector('kbd')?.textContent,
      touch: row.querySelector('.legend-touch')?.textContent,
    }));
    expect(rows).toEqual([
      { action: 'Move', kbd: 'A / D', touch: 'Drag' },
      { action: 'Rotate', kbd: 'W', touch: 'Tap' },
      { action: 'Soft Drop', kbd: 'S', touch: 'Drag Down' },
      { action: 'Hard Drop', kbd: 'Space', touch: 'Fast Swipe' },
      { action: 'Hold', kbd: 'E / Right-click', touch: 'Tap Hold' },
      { action: 'Pause', kbd: 'Esc / P', touch: 'Pause' },
    ]);
  });

  it('handles ExitModal Confirm Exit and No actions cleanly', () => {
    const onConfirmExit = vi.fn();
    const onCancel = vi.fn();
    const exitModal = new ExitModal({ onConfirmExit, onCancel });
    document.body.appendChild(exitModal.modal.element);

    expect(exitModal.isOpen()).toBe(false);
    exitModal.open();
    expect(exitModal.isOpen()).toBe(true);

    const confirmBtn = exitModal.modal.element.querySelector('[data-action="confirm-exit"]') as HTMLButtonElement;
    const noBtn = exitModal.modal.element.querySelector('[data-action="cancel-exit"]') as HTMLButtonElement;
    expect(confirmBtn.textContent).toContain('Confirm Exit');
    expect(noBtn.textContent).toBe('No');

    noBtn.click();
    expect(onCancel).toHaveBeenCalledTimes(1);

    confirmBtn.click();
    expect(onConfirmExit).toHaveBeenCalledTimes(1);

    exitModal.close();
    exitModal.modal.element.remove();
  });

  it('has zero emojis or icon glyphs in UI source files and includes valid favicons + TETRIS title', () => {
    const rootDir = path.resolve(__dirname, '../..');
    const uiDir = path.join(rootDir, 'src', 'ui');
    const files = [
      ...fs.readdirSync(uiDir).map((f) => path.join(uiDir, f)),
      path.join(rootDir, 'src', 'styles', 'main.css'),
      path.join(rootDir, 'index.html'),
    ];
    const forbiddenIcons = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}♪◌▶⏸✕‹›↔↓★▾▴]/u;
    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8');
      expect(forbiddenIcons.test(content), `Unexpected emoji/icon glyph in ${filePath}`).toBe(false);
    }

    const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    expect(indexHtml).toContain('<title>TETRIS</title>');
    expect(indexHtml).toContain('href="/favicon.ico"');
    expect(indexHtml).toContain('href="/favicon.svg"');

    const svgFavicon = fs.readFileSync(path.join(rootDir, 'public', 'favicon.svg'), 'utf8');
    expect(svgFavicon).toContain('<svg');

    const icoBuf = fs.readFileSync(path.join(rootDir, 'public', 'favicon.ico'));
    expect(icoBuf.length).toBeGreaterThan(100);
    // ICO header: reserved=0, type=1, count>=1
    expect(icoBuf.readUInt16LE(0)).toBe(0);
    expect(icoBuf.readUInt16LE(2)).toBe(1);
    expect(icoBuf.readUInt16LE(4)).toBeGreaterThanOrEqual(1);
  });
});

describe('LeaderboardModal', () => {
  it('fetches scores, switches tabs, uses SVG icons, and falls back gracefully on offline error', async () => {
    const payload: LeaderboardResponse = {
      scores: [
        {
          id: 1,
          username: 'alex',
          displayName: 'Alex',
          score: 32500,
          lines: 80,
          level: 9,
          startLevel: 3,
          durationMs: 240000,
          maxCombo: 4,
          tetrises: 5,
          createdAt: 1000,
        },
      ],
      topPlayers: [
        {
          username: 'alex',
          displayName: 'Alex',
          bestScore: 32500,
          gamesPlayed: 12,
          createdAt: 1000,
          lastSeenAt: 2000,
        },
      ],
      player: {
        username: 'alex',
        displayName: 'Alex',
        bestScore: 32500,
        gamesPlayed: 12,
        createdAt: 1000,
        lastSeenAt: 2000,
      },
      playerRank: 1,
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockRejectedValueOnce(new Error('Offline'));

    const api = new ApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    const modal = new LeaderboardModal(api, () => 'alex', () => 30000);
    document.body.appendChild(modal.element);

    expect(modal.element.querySelector('#leaderboard-title svg[data-icon="trophy"]')).not.toBeNull();
    expect(modal.element.querySelector('.modal-close svg[data-icon="close"]')).not.toBeNull();

    await modal.open();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/leaderboard?limit=50&username=alex',
      expect.objectContaining({ method: 'GET' })
    );
    expect(modal.element.textContent).toContain('32,500');
    expect(modal.element.textContent).toContain('Global rank #1');

    (modal.element.querySelector('[data-tab="players"]') as HTMLButtonElement).click();
    expect(modal.element.textContent).toContain('12');

    // Simulate offline error on refresh
    await modal.refresh();
    expect(modal.element.textContent).toContain('out of reach');
    expect(modal.element.querySelector('.lb-status.is-error button')).not.toBeNull();

    modal.close();
    modal.element.remove();
  });
});
