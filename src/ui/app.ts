/**
 * Top-level Lumino Tetris UI shell & runtime coordinator.
 * Connects TetrisGame, InputController, BackgroundRenderer, BoardRenderer,
 * AudioManager, ApiClient, Menu, Gameplay HUD, Exited Screen, and Modals.
 */
import { AudioManager } from '../audio/index';
import { InputController, TetrisGame } from '../engine/index';
import type { GameSnapshot } from '../engine/types';
import { BackgroundRenderer, BoardRenderer, getThemeForLevel, rgbToHex } from '../render/index';
import { ApiClient } from './api';
import { h, rgbCss } from './dom';
import { ExitModal } from './exit-modal';
import { exitFullscreen, requestFullscreen } from './fullscreen';
import { GameOverModal } from './gameover-modal';
import { GameHud } from './hud';
import { LeaderboardModal } from './leaderboard-modal';
import { MainMenu } from './menu';
import { PauseModal } from './pause-modal';
import {
  clampLevel,
  loadProfile,
  loadSettings,
  saveProfile,
  updateSettings,
  type StoredProfile,
  type UiSettings,
} from './storage';

export interface AppOptions {
  container: HTMLElement;
  apiClient?: ApiClient;
  audioManager?: AudioManager;
  game?: TetrisGame;
  autoBackgroundStart?: boolean;
}

export class LuminoTetrisApp {
  public readonly root: HTMLElement;
  public readonly bgCanvas: HTMLCanvasElement;
  public readonly api: ApiClient;
  public readonly audio: AudioManager;
  public readonly game: TetrisGame;
  public readonly background: BackgroundRenderer;
  public readonly boardRenderer: BoardRenderer;
  public readonly input: InputController;
  public readonly menu: MainMenu;
  public readonly hud: GameHud;
  public readonly exitedScreen: HTMLElement;
  public readonly exitModal: ExitModal;
  public readonly pauseModal: PauseModal;
  public readonly gameoverModal: GameOverModal;
  public readonly leaderboardModal: LeaderboardModal;

  private profile: StoredProfile | null;
  private settings: UiSettings;
  private screen: 'menu' | 'playing' | 'exited' = 'menu';
  private gameLoopId: number | null = null;
  private lastTickMs = 0;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private unsubscribeAudio: (() => void) | null = null;
  private gameOverHandled = false;
  private destroyed = false;

  private readonly handleWindowResize = (): void => {
    if (!this.destroyed) {
      this.syncSizes();
    }
  };

  private readonly handleVisibilityChange = (): void => {
    if (this.destroyed || typeof document === 'undefined') return;
    if (document.hidden && this.screen === 'playing' && this.game.getSnapshot().status === 'playing') {
      this.pauseGame();
    }
  };

  constructor(options: AppOptions) {
    this.profile = loadProfile();
    this.settings = loadSettings();

    this.api = options.apiClient ?? new ApiClient();
    this.audio = options.audioManager ?? new AudioManager();
    this.game =
      options.game ??
      new TetrisGame({
        startLevel: this.settings.startLevel,
        ghostEnabled: this.settings.ghostEnabled,
        autoStart: false,
      });

    this.bgCanvas = h('canvas', { class: 'bg-canvas', 'aria-hidden': 'true' });

    this.hud = new GameHud({
      onPause: () => this.pauseGame(),
      onHoldTap: () => {
        this.input.triggerHold();
      },
      onDismissHint: () => {
        this.settings = updateSettings({ hintSeen: true });
      },
    });

    this.menu = new MainMenu({
      api: this.api,
      initialProfile: this.profile,
      initialLevel: this.settings.startLevel,
      initialGhost: this.settings.ghostEnabled,
      initialAudio: this.audio.getSettings(),
      callbacks: {
        onProfileChange: (profile) => {
          this.profile = profile;
        },
        onLevelChange: (level) => {
          const safe = clampLevel(level);
          this.settings = updateSettings({ startLevel: safe });
          this.background.setLevel(safe, false);
          this.applyThemeVars(safe);
        },
        onGhostChange: (enabled) => {
          this.setGhostEnabled(enabled);
        },
        onMusicVolume: (vol) => {
          this.audio.setMusicVolume(vol);
        },
        onSfxVolume: (vol) => {
          this.audio.setSfxVolume(vol);
        },
        onMusicMute: (muted) => {
          this.audio.setMusicMuted(muted);
        },
        onSfxMute: (muted) => {
          this.audio.setSfxMuted(muted);
        },
        onOpenLeaderboard: () => {
          void this.openLeaderboard();
        },
        onPlay: (level) => {
          this.startGame(level);
        },
        onRequestExit: () => {
          this.requestExit();
        },
        onUiClick: () => {
          this.audio.playSfx('uiClick');
        },
      },
    });

    this.exitModal = new ExitModal({
      onConfirmExit: () => this.confirmExit(),
      onCancel: () => {
        this.audio.playSfx('uiClick');
        this.exitModal.close();
      },
    });

    const returnToMenuBtn = h('button', {
      class: 'btn btn-ghost btn-sm exited-return-btn',
      type: 'button',
      'data-action': 'return-to-menu',
      text: 'Return to Menu',
    });
    returnToMenuBtn.addEventListener('click', () => {
      this.audio.playSfx('uiClick');
      this.returnFromExited();
    });

    this.exitedScreen = h(
      'div',
      { class: 'screen exited-screen', hidden: true },
      h(
        'section',
        { class: 'exited-card glass', 'aria-label': 'Game exited' },
        h('h1', { class: 'exited-title', text: 'Game Exited' }),
        h('p', { class: 'exited-sub', text: 'You can close this tab now.' }),
        returnToMenuBtn
      )
    );

    this.pauseModal = new PauseModal({
      onResume: () => this.resumeGame(),
      onGhostChange: (enabled) => {
        this.audio.playSfx('uiClick');
        this.setGhostEnabled(enabled);
      },
      onMusicChange: (on) => {
        this.audio.playSfx('uiClick');
        this.audio.setMusicMuted(!on);
      },
      onSfxChange: (on) => {
        this.audio.setSfxMuted(!on);
        if (on) this.audio.playSfx('uiClick');
      },
      onExit: () => {
        this.audio.playSfx('uiClick');
        this.exitToMenu();
      },
    });

    this.gameoverModal = new GameOverModal(this.api, {
      onPlayAgain: () => {
        this.audio.playSfx('uiClick');
        this.gameoverModal.close();
        this.startGame(this.menu.carousel.getLevel());
      },
      onOpenLeaderboard: () => {
        this.audio.playSfx('uiClick');
        void this.openLeaderboard();
      },
      onMainMenu: () => {
        this.audio.playSfx('uiClick');
        this.exitToMenu();
      },
      onScoreSubmitted: (res) => {
        if (!this.profile) return;
        const updated: StoredProfile = {
          ...this.profile,
          bestScore: Math.max(this.profile.bestScore, res.personalBest),
          gamesPlayed: this.profile.gamesPlayed + 1,
          offline: false,
        };
        this.profile = updated;
        saveProfile(updated);
        this.menu.setProfile(updated);
      },
    });

    this.leaderboardModal = new LeaderboardModal(
      this.api,
      () => this.profile?.username ?? null,
      () => this.profile?.bestScore ?? 0
    );

    this.root = h(
      'div',
      { class: 'app-root', 'data-screen': 'menu' },
      this.bgCanvas,
      this.menu.element,
      this.hud.element,
      this.exitedScreen,
      this.exitModal.modal.element,
      this.pauseModal.modal.element,
      this.gameoverModal.modal.element,
      this.leaderboardModal.element
    );
    options.container.replaceChildren(this.root);

    this.background = new BackgroundRenderer(this.bgCanvas, {
      initialLevel: this.settings.startLevel,
    });
    if (options.autoBackgroundStart !== false) {
      this.background.start();
    }
    this.applyThemeVars(this.settings.startLevel);

    this.boardRenderer = new BoardRenderer(this.hud.boardCanvas);

    this.input = new InputController({
      target: this.hud.element,
      holdElement: this.hud.holdButton,
      actions: this.game,
      cellWidthPx: this.boardRenderer.getCellSize(),
      onTogglePause: () => this.togglePause(),
    });

    this.unsubscribeAudio = this.audio.onChange((audioSettings) => {
      this.menu.syncAudio(audioSettings);
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.handleWindowResize, { passive: true });
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      document.addEventListener('fullscreenchange', this.handleWindowResize);
      document.addEventListener('webkitfullscreenchange', this.handleWindowResize);
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.destroyed && this.screen === 'playing') {
          this.syncBoardSize();
        }
      });
      this.resizeObserver.observe(this.hud.boardStage);
    }

    this.menu.setVisible(true);
    this.hud.setVisible(false);
    this.syncSizes();
  }

  public getScreen(): 'menu' | 'playing' | 'exited' {
    return this.screen;
  }

  public getProfile(): StoredProfile | null {
    return this.profile ? { ...this.profile } : null;
  }

  public getSettings(): UiSettings {
    return { ...this.settings };
  }

  public setGhostEnabled(enabled: boolean): void {
    const val = Boolean(enabled);
    this.settings = updateSettings({ ghostEnabled: val });
    this.game.setGhostEnabled(val);
    this.menu.setGhostEnabled(val);
    if (this.screen === 'playing') {
      this.boardRenderer.render(this.game.getSnapshot());
    }
  }

  public requestExit(): void {
    if (this.screen !== 'menu') return;
    this.exitModal.open();
  }

  public confirmExit(): void {
    this.exitModal.close();
    this.stopGameLoop();
    this.clearHintTimer();
    this.pauseModal.close();
    this.gameoverModal.close();
    this.leaderboardModal.close();

    this.audio.setPaused(false);
    this.audio.stopMusic();
    void exitFullscreen();

    try {
      if (typeof window !== 'undefined' && typeof window.close === 'function') {
        window.close();
      }
    } catch {
      // Browser blocked script-closing tab; fall through to calm exited screen.
    }

    this.screen = 'exited';
    this.root.setAttribute('data-screen', 'exited');
    this.menu.setVisible(false);
    this.hud.setVisible(false);
    this.exitedScreen.hidden = false;
    this.exitedScreen.classList.add('is-active');
  }

  public returnFromExited(): void {
    this.exitedScreen.hidden = true;
    this.exitedScreen.classList.remove('is-active');
    this.screen = 'menu';
    this.root.setAttribute('data-screen', 'menu');
    this.menu.setVisible(true);
    this.menu.setProfile(this.profile);
    this.syncSizes();
  }

  public startGame(level?: number): void {
    const startLevel = clampLevel(level ?? this.menu.carousel.getLevel());
    this.settings = updateSettings({ startLevel });
    this.menu.carousel.setLevel(startLevel, false);

    // Trigger fullscreen & audio unlock synchronously inside user click gesture
    void requestFullscreen(this.root);
    void this.audio.unlock();
    this.audio.setPaused(false);
    void this.audio.startMusic(startLevel);
    this.audio.playSfx('uiClick');

    this.exitModal.close();
    this.pauseModal.close();
    this.gameoverModal.close();
    this.leaderboardModal.close();
    this.exitedScreen.hidden = true;
    this.exitedScreen.classList.remove('is-active');

    this.screen = 'playing';
    this.root.setAttribute('data-screen', 'playing');
    this.gameOverHandled = false;

    this.game.setGhostEnabled(this.settings.ghostEnabled);
    this.game.start(startLevel);
    this.boardRenderer.resetEffects();
    this.input.clearActiveInputs();

    this.menu.setVisible(false);
    this.hud.setVisible(true);
    this.syncSizes();

    this.background.setLevel(startLevel, false);
    this.applyThemeVars(startLevel);

    const snap = this.game.getSnapshot();
    this.hud.update(snap, this.getPersonalBest());
    this.boardRenderer.render(snap);

    this.showInitialHint();
    this.startGameLoop();
  }

  public pauseGame(): void {
    if (this.screen !== 'playing' || this.game.getSnapshot().status !== 'playing') {
      return;
    }
    this.game.pause();
    this.input.clearActiveInputs();
    this.audio.playSfx('uiClick');
    this.audio.setPaused(true);

    const audioSettings = this.audio.getSettings();
    this.pauseModal.open({
      ghostEnabled: this.settings.ghostEnabled,
      musicOn: !audioSettings.musicMuted,
      sfxOn: !audioSettings.sfxMuted,
    });
  }

  public resumeGame(): void {
    if (this.screen !== 'playing' || this.game.getSnapshot().status !== 'paused') {
      return;
    }
    this.pauseModal.close();
    this.audio.playSfx('uiClick');
    this.audio.setPaused(false);
    this.game.resume();
    this.lastTickMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  public togglePause(): void {
    if (this.screen !== 'playing' || this.gameoverModal.isOpen() || this.leaderboardModal.isOpen()) {
      return;
    }
    const status = this.game.getSnapshot().status;
    if (status === 'playing') {
      this.pauseGame();
    } else if (status === 'paused') {
      this.resumeGame();
    }
  }

  public exitToMenu(): void {
    this.stopGameLoop();
    this.clearHintTimer();
    this.exitModal.close();
    this.pauseModal.close();
    this.gameoverModal.close();
    this.leaderboardModal.close();
    this.exitedScreen.hidden = true;
    this.exitedScreen.classList.remove('is-active');

    this.game.reset({ autoStart: false });
    this.input.clearActiveInputs();
    this.boardRenderer.resetEffects();
    this.audio.setPaused(false);
    this.audio.stopMusic();
    void exitFullscreen();

    this.screen = 'menu';
    this.root.setAttribute('data-screen', 'menu');
    this.hud.setVisible(false);
    this.menu.setVisible(true);
    this.menu.setProfile(this.profile);

    const menuLevel = this.menu.carousel.getLevel();
    this.background.setActiveColor(null);
    this.background.setLevel(menuLevel, false);
    this.applyThemeVars(menuLevel);
  }

  public openLeaderboard(): Promise<void> {
    return this.leaderboardModal.open();
  }

  /** Advances one simulation + VFX + audio + HUD frame cleanly (used by RAF and tests). */
  public tick(dtMs: number): void {
    if (this.destroyed || this.screen !== 'playing') {
      return;
    }
    const clampedDt = Math.min(50, Math.max(0, dtMs));
    const currentStatus = this.game.getSnapshot().status;

    if (currentStatus === 'playing') {
      this.input.update(clampedDt);
      this.game.step(clampedDt);
    }

    const events = this.game.consumeEvents();
    const snap = this.game.getSnapshot();

    if (events.length > 0) {
      this.boardRenderer.processEvents(events, snap, this.background);
      this.audio.handleGameEvents(events);
      for (const ev of events) {
        if (ev.type === 'levelUp') {
          this.applyThemeVars(ev.newLevel);
        }
      }
    }

    this.boardRenderer.update(clampedDt, snap, this.background);
    this.boardRenderer.render(snap);
    this.hud.update(snap, this.getPersonalBest());

    if (snap.status === 'gameover' && !this.gameOverHandled) {
      this.handleGameOver(snap);
    }
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopGameLoop();
    this.clearHintTimer();
    this.unsubscribeAudio?.();
    this.unsubscribeAudio = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.handleWindowResize);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      document.removeEventListener('fullscreenchange', this.handleWindowResize);
      document.removeEventListener('webkitfullscreenchange', this.handleWindowResize);
    }
    this.input.destroy();
    this.background.destroy();
    this.audio.destroy();
  }

  private handleGameOver(snap: GameSnapshot): void {
    this.gameOverHandled = true;
    this.input.clearActiveInputs();
    this.audio.setPaused(true);

    const previousBest = this.profile?.bestScore ?? 0;
    const username = this.profile?.username ?? 'player';
    const displayName = this.profile?.displayName ?? 'Player';

    if (this.profile && snap.score > this.profile.bestScore) {
      this.profile = { ...this.profile, bestScore: snap.score };
      saveProfile(this.profile);
      this.menu.setProfile(this.profile);
    }

    void this.gameoverModal.openAndSubmit({
      snapshot: snap,
      username,
      displayName,
      previousBest,
    });
  }

  private getPersonalBest(): number {
    return this.profile?.bestScore ?? 0;
  }

  private applyThemeVars(level: number): void {
    const theme = getThemeForLevel(level);
    this.root.style.setProperty('--theme-accent', rgbToHex(theme.accent));
    this.root.style.setProperty('--theme-accent-rgb', rgbCss(theme.accent));
    this.root.style.setProperty('--theme-glow-rgb', rgbCss(theme.boardGlow));
    this.root.style.setProperty('--theme-secondary-rgb', rgbCss(theme.gridSecondary));
  }

  private syncSizes(): void {
    this.background.resize();
    if (this.screen === 'playing') {
      this.syncBoardSize();
    }
  }

  private syncBoardSize(): void {
    const stage = this.hud.boardStage;
    const rect = stage.getBoundingClientRect?.();
    const w = stage.clientWidth || Math.round(rect?.width || 0);
    const hPx = stage.clientHeight || Math.round(rect?.height || 0);
    if (w > 0 && hPx > 0) {
      const boardRect = this.boardRenderer.resize(w, hPx);
      this.hud.setBoardMetrics({
        top: boardRect.y,
        bottom: Math.max(0, hPx - (boardRect.y + boardRect.height)),
        left: boardRect.x,
        right: Math.max(0, w - (boardRect.x + boardRect.width)),
      });
      this.input.setCellWidth(this.boardRenderer.getCellSize());
      this.boardRenderer.render(this.game.getSnapshot());
    }
    this.hud.redrawMiniCanvases(true);
  }

  private showInitialHint(): void {
    this.clearHintTimer();
    if (this.settings.hintSeen) {
      this.hud.setHintVisible(false);
      return;
    }
    this.hud.setHintVisible(true);
    this.hintTimer = setTimeout(() => {
      this.hud.setHintVisible(false);
      this.settings = updateSettings({ hintSeen: true });
    }, 7000);
  }

  private clearHintTimer(): void {
    if (this.hintTimer !== null) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
  }

  private startGameLoop(): void {
    this.stopGameLoop();
    if (typeof requestAnimationFrame === 'undefined') return;
    this.lastTickMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const frame = (now: number): void => {
      if (this.destroyed || this.screen !== 'playing') {
        this.gameLoopId = null;
        return;
      }
      const dt = Math.min(50, Math.max(0, now - this.lastTickMs));
      this.lastTickMs = now;
      this.tick(dt);
      this.gameLoopId = requestAnimationFrame(frame);
    };
    this.gameLoopId = requestAnimationFrame(frame);
  }

  private stopGameLoop(): void {
    if (this.gameLoopId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.gameLoopId);
      this.gameLoopId = null;
    }
  }
}
