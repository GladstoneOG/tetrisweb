// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from '../../src/audio/index';
import { TetrisGame } from '../../src/engine/index';
import { ApiClient } from '../../src/ui/api';
import { LuminoTetrisApp } from '../../src/ui/app';
import { loadProfile, loadSettings } from '../../src/ui/storage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

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

function mockMatchMedia(desktop: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: desktop,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe('LuminoTetrisApp Integration', () => {
  let mount: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;
  let app: LuminoTetrisApp;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    mockMatchMedia(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.startsWith('/api/login')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { username: string };
        return jsonResponse({
          player: {
            username: body.username.toLowerCase(),
            displayName: body.username,
            bestScore: 5400,
            gamesPlayed: 2,
            createdAt: 1000,
            lastSeenAt: 2000,
          },
        });
      }
      if (input.startsWith('/api/scores')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          username: string;
          score: number;
          lines: number;
          level: number;
          startLevel: number;
          durationMs: number;
          maxCombo: number;
          tetrises: number;
        };
        return jsonResponse(
          {
            entry: { id: 99, displayName: 'StarMom', createdAt: 3000, ...body },
            personalBest: Math.max(5400, body.score),
            isNewRecord: body.score > 5400,
            rank: 2,
          },
          201
        );
      }
      if (input.startsWith('/api/leaderboard')) {
        return jsonResponse({
          scores: [],
          topPlayers: [],
          player: null,
          playerRank: null,
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
  });

  afterEach(() => {
    app?.destroy();
    vi.restoreAllMocks();
  });

  function createApp(customGame?: TetrisGame): LuminoTetrisApp {
    const apiClient = new ApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    const audioManager = new AudioManager({ autoUnlockOnWindowEvents: false });
    return new LuminoTetrisApp({
      container: mount,
      apiClient,
      audioManager,
      game: customGame,
      autoBackgroundStart: false,
    });
  }

  it('shows decluttered TETRIS menu, first-time login, offline fallback, and no Local profile / Switch User', async () => {
    app = createApp();

    // Hero is ONLY TETRIS
    const hero = mount.querySelector('.menu-hero') as HTMLElement;
    expect(hero.querySelector('.brand-title')?.textContent).toBe('TETRIS');
    expect(hero.querySelector('.brand-pill')).toBeNull();
    expect(hero.querySelector('.brand-sub')).toBeNull();
    expect(hero.textContent?.trim()).toBe('TETRIS');

    const loginCard = mount.querySelector('.login-card') as HTMLElement;
    const menuPanel = mount.querySelector('.menu-panel') as HTMLElement;
    expect(loginCard.hidden).toBe(false);
    expect(menuPanel.hidden).toBe(true);

    // Rejects invalid 1-char username
    const input = mount.querySelector('#login-username') as HTMLInputElement;
    const form = mount.querySelector('.login-form') as HTMLFormElement;
    input.value = 'A';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect((mount.querySelector('.form-error') as HTMLElement).hidden).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    // Valid online login
    input.value = 'StarMom';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await vi.waitFor(() => expect(menuPanel.hidden).toBe(false));

    expect(loadProfile()).toMatchObject({
      username: 'starmom',
      displayName: 'StarMom',
      bestScore: 5400,
      offline: false,
    });
    expect(mount.querySelector('.player-name')?.textContent).toBe('StarMom');
    expect(mount.querySelector('.player-best')?.textContent).toBe('5,400');

    // No Local profile badge and no Switch User button
    expect(mount.querySelector('[data-action="switch-user"]')).toBeNull();
    expect(mount.querySelector('.player-offline')).toBeNull();
    expect(mount.textContent).not.toContain('Local profile');
    expect(mount.textContent).not.toContain('Switch User');

    // Verify offline login fallback on fresh app instance also shows no Local profile badge
    app.destroy();
    localStorage.clear();
    mount.innerHTML = '';
    fetchMock.mockRejectedValueOnce(new Error('Network down'));
    app = createApp();
    const offlineInput = mount.querySelector('#login-username') as HTMLInputElement;
    const offlineForm = mount.querySelector('.login-form') as HTMLFormElement;
    offlineInput.value = 'DadOffline';
    offlineForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await vi.waitFor(() => expect((mount.querySelector('.menu-panel') as HTMLElement).hidden).toBe(false));

    expect(loadProfile()).toMatchObject({
      username: 'dadoffline',
      displayName: 'DadOffline',
      offline: true,
    });
    expect(mount.querySelector('.player-name')?.textContent).toBe('DadOffline');
    expect(mount.textContent).not.toContain('Local profile');
  });

  it('handles top-left Exit Door button -> ExitModal Confirm Exit / No and peaceful exited screen', () => {
    localStorage.setItem(
      'lumino-tetris-profile-v1',
      JSON.stringify({ username: 'starmom', displayName: 'StarMom', bestScore: 2000, gamesPlayed: 1, offline: false })
    );
    app = createApp();

    const audioStopMusic = vi.spyOn(app.audio, 'stopMusic');
    const fsExit = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, 'exitFullscreen', { value: fsExit, configurable: true });
    Object.defineProperty(document, 'fullscreenElement', { value: app.root, configurable: true });
    const winClose = vi.spyOn(window, 'close').mockImplementation(() => {});

    const exitDoorBtn = mount.querySelector('.menu-exit-wrap [data-action="menu-exit"]') as HTMLButtonElement;
    expect(exitDoorBtn).not.toBeNull();
    expect(exitDoorBtn.querySelector('svg[data-icon="exitDoor"]')).not.toBeNull();

    // Open Exit confirmation modal -> click No
    exitDoorBtn.click();
    expect(app.exitModal.isOpen()).toBe(true);
    const noBtn = mount.querySelector('#exit-modal [data-action="cancel-exit"]') as HTMLButtonElement;
    noBtn.click();
    expect(app.exitModal.isOpen()).toBe(false);
    expect(app.getScreen()).toBe('menu');

    // Open again -> Confirm Exit
    exitDoorBtn.click();
    expect(app.exitModal.isOpen()).toBe(true);
    const confirmBtn = mount.querySelector('#exit-modal [data-action="confirm-exit"]') as HTMLButtonElement;
    confirmBtn.click();

    expect(app.exitModal.isOpen()).toBe(false);
    expect(audioStopMusic).toHaveBeenCalled();
    expect(fsExit).toHaveBeenCalled();
    expect(winClose).toHaveBeenCalledTimes(1);
    expect(app.getScreen()).toBe('exited');
    expect(app.exitedScreen.hidden).toBe(false);
    expect(app.exitedScreen.textContent).toContain('Game Exited');
    expect(app.exitedScreen.textContent).toContain('You can close this tab now.');

    // Return to Menu works cleanly
    (mount.querySelector('[data-action="return-to-menu"]') as HTMLButtonElement).click();
    expect(app.getScreen()).toBe('menu');
    expect(app.exitedScreen.hidden).toBe(true);
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  });

  it('wires carousel level -> background theme, ghost toggle, fullscreen Play, board metrics, and top-left pause', async () => {
    localStorage.setItem(
      'lumino-tetris-profile-v1',
      JSON.stringify({ username: 'starmom', displayName: 'StarMom', bestScore: 2000, gamesPlayed: 1, offline: false })
    );
    app = createApp();

    const bgSetLevel = vi.spyOn(app.background, 'setLevel');
    const audioUnlock = vi.spyOn(app.audio, 'unlock').mockResolvedValue();
    const audioStartMusic = vi.spyOn(app.audio, 'startMusic').mockResolvedValue();
    const audioSetPaused = vi.spyOn(app.audio, 'setPaused');
    const audioStopMusic = vi.spyOn(app.audio, 'stopMusic');

    const fsReq = vi.fn(() => Promise.resolve());
    Object.defineProperty(app.root, 'requestFullscreen', { value: fsReq, configurable: true });
    const fsExit = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, 'exitFullscreen', { value: fsExit, configurable: true });

    // Select level 7 in carousel
    (mount.querySelector('[data-level="7"]') as HTMLButtonElement).click();
    expect(bgSetLevel).toHaveBeenCalledWith(7, false);
    expect(loadSettings().startLevel).toBe(7);

    // Toggle ghost piece off on menu
    (mount.querySelector('[data-toggle="menu-ghost"]') as HTMLButtonElement).click();
    expect(loadSettings().ghostEnabled).toBe(false);
    expect(app.game.isGhostEnabled()).toBe(false);

    // Audio controls on menu sync with AudioManager and use SVG icons
    (mount.querySelector('[data-audio-mute="music"]') as HTMLButtonElement).click();
    expect(app.audio.getSettings().musicMuted).toBe(true);
    expect(mount.querySelector('[data-audio-mute="music"] svg[data-icon="volumeOff"]')).not.toBeNull();
    const sfxSlider = mount.querySelector('[data-audio-slider="sfx"]') as HTMLInputElement;
    sfxSlider.value = '40';
    sfxSlider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(app.audio.getSettings().sfxVolume).toBeCloseTo(0.4, 2);

    // Provide stage dimensions to verify board alignment CSS vars
    Object.defineProperty(app.hud.boardStage, 'clientWidth', { value: 260, configurable: true });
    Object.defineProperty(app.hud.boardStage, 'clientHeight', { value: 600, configurable: true });

    // Click Play
    (mount.querySelector('[data-action="play"]') as HTMLButtonElement).click();
    expect(app.getScreen()).toBe('playing');
    expect(fsReq).toHaveBeenCalledTimes(1);
    expect(audioUnlock).toHaveBeenCalledTimes(1);
    expect(audioStartMusic).toHaveBeenCalledWith(7);
    expect(app.game.getSnapshot().level).toBe(7);
    expect(app.game.getSnapshot().ghostEnabled).toBe(false);

    // Hold box has no clutter hint, bottom hint is hidden by default, and 3-piece top header is synced
    expect(mount.querySelector('.hold-box .panel-key-hint')).toBeNull();
    expect((mount.querySelector('.hud-hint') as HTMLElement).hidden).toBe(true);
    expect(mount.querySelector('.hud-pause-wrap')).not.toBeNull();
    expect(mount.querySelector('.hud-stats')).not.toBeNull();
    expect(mount.querySelector('.hud-level-wrap .hud-level-value')?.textContent).toBe('7');
    expect(app.hud.element.style.getPropertyValue('--board-top-offset')).toMatch(/^\d+px$/);
    expect(app.hud.element.style.getPropertyValue('--board-left-offset')).toMatch(/^\d+px$/);
    expect(app.hud.element.style.getPropertyValue('--board-right-offset')).toMatch(/^\d+px$/);

    // HUD desktop legend & hint reflect updated controls
    const desktopLegendText = mount.querySelector('.hud-desktop-legend')?.textContent ?? '';
    expect(desktopLegendText).toContain('Soft Drop');
    expect(desktopLegendText).toContain('Hard Drop');
    expect(desktopLegendText).toContain('Space');
    expect(mount.querySelector('.hud-hint')?.textContent).toContain('Drag Down: Soft Drop');
    expect(mount.querySelector('.hud-hint')?.textContent).toContain('Fast Swipe: Hard Drop');

    // Mobile portrait shows 3 next slots (4th hidden)
    app.hud.redrawMiniCanvases(true);
    expect(mount.querySelectorAll('.next-slot:not(.is-hidden-slot)')).toHaveLength(3);

    // Desktop landscape shows 4 next slots
    mockMatchMedia(true);
    app.hud.redrawMiniCanvases(true);
    expect(mount.querySelectorAll('.next-slot:not(.is-hidden-slot)')).toHaveLength(4);

    // Top-left pause button uses SVG icon and opens Pause Modal
    expect(mount.querySelector('.hud-pause-wrap [data-pause-trigger]')).toBe(app.hud.pauseButton);
    expect(app.hud.pauseButton.querySelector('svg[data-icon="pause"]')).not.toBeNull();
    app.hud.pauseButton.click();
    expect(app.game.getSnapshot().status).toBe('paused');
    expect(app.pauseModal.isOpen()).toBe(true);
    expect(audioSetPaused).toHaveBeenCalledWith(true);

    // Toggle Ghost Piece back ON & Music back ON inside Pause modal
    (mount.querySelector('[data-toggle="ghost"]') as HTMLButtonElement).click();
    expect(app.game.isGhostEnabled()).toBe(true);
    expect(loadSettings().ghostEnabled).toBe(true);
    (mount.querySelector('[data-toggle="music"]') as HTMLButtonElement).click();
    expect(app.audio.getSettings().musicMuted).toBe(false);
    expect(mount.querySelector('[data-audio-mute="music"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(mount.querySelector('[data-audio-mute="music"] svg[data-icon="musicNote"]')).not.toBeNull();

    // Resume via Pause modal
    (mount.querySelector('[data-action="resume"]') as HTMLButtonElement).click();
    expect(app.game.getSnapshot().status).toBe('playing');
    expect(app.pauseModal.isOpen()).toBe(false);
    expect(audioSetPaused).toHaveBeenLastCalledWith(false);

    // Keyboard P toggles pause -> Escape resumes
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true }));
    expect(app.pauseModal.isOpen()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
    expect(app.pauseModal.isOpen()).toBe(false);

    // Pause and Exit to Main Menu
    app.hud.pauseButton.click();
    Object.defineProperty(document, 'fullscreenElement', { value: app.root, configurable: true });
    (mount.querySelector('[data-action="exit"]') as HTMLButtonElement).click();
    expect(app.getScreen()).toBe('menu');
    expect(audioStopMusic).toHaveBeenCalled();
    expect(fsExit).toHaveBeenCalled();
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  });

  it('wires W rotate, S soft drop, Space slam, multitouch drag + Hold tap, and Game Over submission', async () => {
    localStorage.setItem(
      'lumino-tetris-profile-v1',
      JSON.stringify({ username: 'starmom', displayName: 'StarMom', bestScore: 100, gamesPlayed: 1, offline: false })
    );
    const customGame = new TetrisGame({
      autoStart: false,
      pieceSequence: ['T', 'I', 'O', 'L', 'J', 'S', 'Z'],
    });
    app = createApp(customGame);

    (mount.querySelector('[data-action="play"]') as HTMLButtonElement).click();
    const initialX = app.game.getSnapshot().activePiece!.x;

    // A moves left, D moves right, W rotates
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', bubbles: true }));
    expect(app.game.getSnapshot().activePiece!.x).toBe(initialX - 1);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd', bubbles: true }));
    expect(app.game.getSnapshot().activePiece!.x).toBe(initialX);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
    expect(app.game.getSnapshot().activePiece!.rotation).toBe(1);

    // S soft-drops 1 row (+1 point) without locking the active T-piece
    const yBeforeSoftDrop = app.game.getSnapshot().activePiece!.y;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', key: 's', bubbles: true }));
    expect(app.game.getSnapshot().activePiece!.type).toBe('T');
    expect(app.game.getSnapshot().activePiece!.y).toBe(yBeforeSoftDrop + 1);
    expect(app.game.getSnapshot().score).toBe(1);

    // Multitouch: finger 1 starts dragging on play stage while finger 2 taps Hold box
    const cellW = app.boardRenderer.getCellSize();
    app.hud.element.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 10, clientX: 100, clientY: 200 }));
    expect(app.input.getActivePointerCount()).toBe(1);
    app.hud.holdButton.dispatchEvent(makePointerEvent('pointerdown', { pointerId: 11, clientX: 20, clientY: 120 }));
    expect(app.game.getSnapshot().holdPiece).toBe('T');
    expect(app.game.getSnapshot().activePiece!.type).toBe('I');
    expect(app.input.getActivePointerCount()).toBe(1);

    // Finger 1 finishes horizontal drag right
    app.hud.element.dispatchEvent(
      makePointerEvent('pointermove', { pointerId: 10, clientX: 100 + cellW + 4, clientY: 200 })
    );
    app.hud.element.dispatchEvent(
      makePointerEvent('pointerup', { pointerId: 10, clientX: 100 + cellW + 4, clientY: 200 })
    );
    expect(app.game.getSnapshot().activePiece!.x).toBeGreaterThanOrEqual(4);

    // Space slams down immediately and updates tabular HUD score
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
    app.tick(16);
    expect(app.game.getSnapshot().score).toBeGreaterThan(10);
    expect(app.game.getSnapshot().activePiece!.type).toBe('O');
    expect(mount.querySelector('.stat-score .stat-value')?.textContent).not.toBe('0');

    // Trigger gameOver by filling board top rows & calling tick
    const filledBoard = Array.from({ length: 22 }, (_, r) =>
      Array.from({ length: 10 }, () => (r >= 1 ? ('I' as const) : null))
    );
    app.game.reset({ autoStart: false, initialBoard: filledBoard });
    app.game.start(1, { preserveBoard: true });
    app.tick(16);

    await vi.waitFor(() => {
      expect(app.gameoverModal.isOpen()).toBe(true);
      expect(mount.querySelector('.gameover-badge')?.textContent).toContain('Rank #2');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/scores',
      expect.objectContaining({ method: 'POST' })
    );
    expect(mount.querySelector('#gameover-modal [data-action="leaderboard"] svg[data-icon="trophy"]')).not.toBeNull();

    // Leaderboard from Game Over opens & closes cleanly
    (mount.querySelector('#gameover-modal [data-action="leaderboard"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(app.leaderboardModal.isOpen()).toBe(true));
    (mount.querySelector('#leaderboard-modal .modal-close') as HTMLButtonElement).click();
    expect(app.leaderboardModal.isOpen()).toBe(false);

    // Play Again resets and starts a fresh run
    (mount.querySelector('[data-action="play-again"]') as HTMLButtonElement).click();
    expect(app.gameoverModal.isOpen()).toBe(false);
    expect(app.game.getSnapshot().status).toBe('playing');

    // Trigger gameOver again and exit to Main Menu cleanly
    app.game.reset({ autoStart: false, initialBoard: filledBoard });
    app.game.start(1, { preserveBoard: true });
    app.tick(16);
    await vi.waitFor(() => expect(app.gameoverModal.isOpen()).toBe(true));
    (mount.querySelector('#gameover-modal [data-action="main-menu"]') as HTMLButtonElement).click();
    expect(app.gameoverModal.isOpen()).toBe(false);
    expect(app.getScreen()).toBe('menu');
  });
});
