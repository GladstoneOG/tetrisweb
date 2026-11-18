/** Main Menu view: top-left Exit Door trigger, first-time login, player banner, level carousel, settings, and Play CTA. */
import type { AudioSettings } from '../audio/index';
import type { ApiClient } from './api';
import { ApiError } from './api';
import { LevelCarousel } from './carousel';
import { formatNumber, h } from './dom';
import { createIcon, type IconName } from './icons';
import { controlsLegend, createToggle } from './modal';
import {
  saveProfile,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  validateUsername,
  type StoredProfile,
} from './storage';

export interface MenuCallbacks {
  onProfileChange: (profile: StoredProfile | null) => void;
  onLevelChange: (level: number) => void;
  onGhostChange: (enabled: boolean) => void;
  onMusicVolume: (volume: number) => void;
  onSfxVolume: (volume: number) => void;
  onMusicMute: (muted: boolean) => void;
  onSfxMute: (muted: boolean) => void;
  onOpenLeaderboard: () => void;
  onPlay: (level: number) => void;
  onRequestExit: () => void;
  onUiClick?: () => void;
}

export interface MenuOptions {
  api: ApiClient;
  initialProfile: StoredProfile | null;
  initialLevel: number;
  initialGhost: boolean;
  initialAudio: AudioSettings;
  callbacks: MenuCallbacks;
}

export class MainMenu {
  public readonly element: HTMLElement;
  public readonly carousel: LevelCarousel;
  public readonly exitButton: HTMLButtonElement;
  private readonly api: ApiClient;
  private readonly callbacks: MenuCallbacks;

  private readonly loginCard: HTMLElement;
  private readonly loginForm: HTMLFormElement;
  private readonly usernameInput: HTMLInputElement;
  private readonly loginErrorEl: HTMLElement;
  private readonly loginSubmitBtn: HTMLButtonElement;

  private readonly menuPanel: HTMLElement;
  private readonly playerNameEl: HTMLElement;
  private readonly playerBestEl: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly ghostToggle: ReturnType<typeof createToggle>;

  private readonly musicMuteBtn: HTMLButtonElement;
  private readonly musicSlider: HTMLInputElement;
  private readonly sfxMuteBtn: HTMLButtonElement;
  private readonly sfxSlider: HTMLInputElement;

  private profile: StoredProfile | null;
  private loggingIn = false;

  constructor(options: MenuOptions) {
    this.api = options.api;
    this.callbacks = options.callbacks;
    this.profile = options.initialProfile;

    // 0. Top-left Exit Door button
    this.exitButton = h(
      'button',
      {
        class: 'menu-exit-btn',
        type: 'button',
        'data-action': 'menu-exit',
        'aria-label': 'Exit game',
        title: 'Exit game',
      },
      createIcon('exitDoor', { className: 'exit-door-icon', size: 34, strokeWidth: 2.6 })
    );
    this.exitButton.addEventListener('click', () => {
      this.callbacks.onUiClick?.();
      this.callbacks.onRequestExit();
    });
    const exitWrap = h('div', { class: 'menu-exit-wrap' }, this.exitButton);

    // 1. Hero header
    const hero = h(
      'header',
      { class: 'menu-hero' },
      h('h1', { class: 'brand-title', text: 'TETRIS' }),
      h('p', { class: 'brand-by', text: 'by Johan' })
    );

    // 2. First-time parent-friendly login card
    this.usernameInput = h('input', {
      class: 'input-field',
      id: 'login-username',
      type: 'text',
      name: 'username',
      autocomplete: 'nickname',
      maxlength: USERNAME_MAX_LENGTH,
      minlength: USERNAME_MIN_LENGTH,
      placeholder: 'e.g. StarMom, Dad, Alex',
      'aria-label': 'Player name',
      required: true,
    });
    this.loginErrorEl = h('p', { class: 'form-error', role: 'alert', hidden: true });
    this.loginSubmitBtn = h('button', {
      class: 'btn btn-primary btn-lg',
      type: 'submit',
      'data-action': 'login-submit',
      text: 'Continue',
    });

    this.loginForm = h(
      'form',
      { class: 'login-form', novalidate: true },
      h(
        'label',
        { class: 'input-label', for: 'login-username' },
        'Choose your player name'
      ),
      h('div', { class: 'login-input-row' }, this.usernameInput, this.loginSubmitBtn),
      this.loginErrorEl,
      h('p', {
        class: 'login-hint',
        text: 'No password needed — saves your personal best and puts you on the leaderboard.',
      })
    );
    this.loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.handleLoginSubmit();
    });
    this.usernameInput.addEventListener('input', () => {
      this.loginErrorEl.hidden = true;
    });

    this.loginCard = h(
      'section',
      { class: 'login-card glass', 'aria-label': 'Player sign in' },
      h('h2', { class: 'card-heading', text: 'Welcome aboard!' }),
      this.loginForm
    );

    // 3. Logged-in main menu controls
    this.playerNameEl = h('span', { class: 'player-name' });
    this.playerBestEl = h('span', { class: 'player-best num' });

    const playerBar = h(
      'div',
      { class: 'player-bar glass-inset' },
      h(
        'div',
        { class: 'player-meta' },
        h('span', { class: 'player-greeting', text: 'Player' }),
        h('div', { class: 'player-name-row' }, this.playerNameEl)
      ),
      h(
        'div',
        { class: 'player-right' },
        h(
          'div',
          { class: 'player-best-wrap' },
          h('span', { class: 'player-greeting', text: 'Best' }),
          this.playerBestEl
        )
      )
    );

    this.carousel = new LevelCarousel({
      initialLevel: options.initialLevel,
      onChange: (level) => {
        this.callbacks.onUiClick?.();
        this.callbacks.onLevelChange(level);
      },
    });

    this.ghostToggle = createToggle(
      'Ghost Piece',
      options.initialGhost,
      (val) => {
        this.callbacks.onUiClick?.();
        this.callbacks.onGhostChange(val);
      },
      { name: 'menu-ghost', icon: 'ghost' }
    );

    const musicControl = this.buildVolumeRow(
      'Music',
      'musicNote',
      'music',
      options.initialAudio.musicVolume,
      options.initialAudio.musicMuted,
      (muted) => {
        this.callbacks.onUiClick?.();
        this.callbacks.onMusicMute(muted);
      },
      (vol) => this.callbacks.onMusicVolume(vol)
    );
    this.musicMuteBtn = musicControl.muteBtn;
    this.musicSlider = musicControl.slider;

    const sfxControl = this.buildVolumeRow(
      'SFX',
      'volumeOn',
      'sfx',
      options.initialAudio.sfxVolume,
      options.initialAudio.sfxMuted,
      (muted) => {
        this.callbacks.onUiClick?.();
        this.callbacks.onSfxMute(muted);
      },
      (vol) => this.callbacks.onSfxVolume(vol)
    );
    this.sfxMuteBtn = sfxControl.muteBtn;
    this.sfxSlider = sfxControl.slider;

    this.playBtn = h(
      'button',
      {
        class: 'btn btn-primary btn-play',
        type: 'button',
        'data-action': 'play',
      },
      h(
        'span',
        { class: 'play-btn-main' },
        createIcon('play', { size: 22 }),
        h('span', { text: 'Play' })
      )
    );
    this.playBtn.addEventListener('click', () => {
      this.callbacks.onPlay(this.carousel.getLevel());
    });

    const lbBtn = h(
      'button',
      {
        class: 'btn btn-secondary btn-leaderboard',
        type: 'button',
        'data-action': 'open-leaderboard',
      },
      createIcon('trophy', { size: 17 }),
      h('span', { text: 'Leaderboard' })
    );
    lbBtn.addEventListener('click', () => {
      this.callbacks.onUiClick?.();
      this.callbacks.onOpenLeaderboard();
    });

    const controlsDetails = h(
      'details',
      { class: 'legend-details menu-legend' },
      h(
        'summary',
        { class: 'legend-summary' },
        h('span', { text: 'Controls Guide' }),
        createIcon('chevronDown', { className: 'summary-chevron', size: 16 })
      ),
      controlsLegend(false)
    );

    this.menuPanel = h(
      'section',
      { class: 'menu-panel glass', 'aria-label': 'Game setup' },
      playerBar,
      h('div', { class: 'section-label', text: 'START LEVEL' }),
      this.carousel.element,
      h('div', { class: 'menu-cta-row' }, this.playBtn, lbBtn),
      h(
        'div',
        { class: 'menu-settings glass-inset' },
        this.ghostToggle.element,
        musicControl.row,
        sfxControl.row
      ),
      controlsDetails
    );

    this.element = h(
      'div',
      { class: 'screen menu-screen' },
      exitWrap,
      h('div', { class: 'menu-shell' }, hero, this.loginCard, this.menuPanel)
    );
    this.syncProfileUI();
  }

  public setVisible(visible: boolean): void {
    this.element.classList.toggle('is-active', visible);
    this.element.hidden = !visible;
    if (visible && !this.profile) {
      try {
        this.usernameInput.focus({ preventScroll: true });
      } catch {
        // ignore
      }
    }
  }

  public setProfile(profile: StoredProfile | null): void {
    this.profile = profile;
    this.syncProfileUI();
  }

  public setGhostEnabled(enabled: boolean): void {
    this.ghostToggle.set(enabled);
  }

  public syncAudio(settings: AudioSettings): void {
    const musicMuted = settings.musicMuted || settings.musicVolume === 0;
    this.musicMuteBtn.setAttribute('aria-pressed', settings.musicMuted ? 'true' : 'false');
    this.musicMuteBtn.classList.toggle('is-muted', musicMuted);
    this.musicMuteBtn.replaceChildren(createIcon(musicMuted ? 'volumeOff' : 'musicNote', { size: 17 }));
    this.musicSlider.value = String(Math.round((settings.musicMuted ? 0 : settings.musicVolume) * 100));

    const sfxMuted = settings.sfxMuted || settings.sfxVolume === 0;
    this.sfxMuteBtn.setAttribute('aria-pressed', settings.sfxMuted ? 'true' : 'false');
    this.sfxMuteBtn.classList.toggle('is-muted', sfxMuted);
    this.sfxMuteBtn.replaceChildren(createIcon(sfxMuted ? 'volumeOff' : 'volumeOn', { size: 17 }));
    this.sfxSlider.value = String(Math.round((settings.sfxMuted ? 0 : settings.sfxVolume) * 100));
  }

  private buildVolumeRow(
    label: string,
    icon: IconName,
    kind: 'music' | 'sfx',
    volume: number,
    muted: boolean,
    onMute: (muted: boolean) => void,
    onVolume: (vol: number) => void
  ): { row: HTMLElement; muteBtn: HTMLButtonElement; slider: HTMLInputElement } {
    const isMuted = muted || volume === 0;
    const muteBtn = h(
      'button',
      {
        class: `audio-mute-btn ${isMuted ? 'is-muted' : ''}`.trim(),
        type: 'button',
        'data-audio-mute': kind,
        'aria-label': `Toggle ${label} mute`,
        'aria-pressed': muted ? 'true' : 'false',
      },
      createIcon(isMuted ? 'volumeOff' : icon, { size: 17 })
    );
    const slider = h('input', {
      class: 'volume-slider',
      type: 'range',
      min: 0,
      max: 100,
      step: 1,
      value: Math.round((muted ? 0 : volume) * 100),
      'data-audio-slider': kind,
      'aria-label': `${label} volume`,
    });

    muteBtn.addEventListener('click', () => {
      const currentlyMuted = muteBtn.getAttribute('aria-pressed') === 'true';
      onMute(!currentlyMuted);
    });
    slider.addEventListener('input', () => {
      const next = Math.max(0, Math.min(1, Number(slider.value) / 100));
      if (next > 0 && muteBtn.getAttribute('aria-pressed') === 'true') {
        onMute(false);
      }
      onVolume(next);
    });

    const row = h(
      'div',
      { class: 'audio-row' },
      h('span', { class: 'audio-label', text: label }),
      muteBtn,
      slider
    );
    return { row, muteBtn, slider };
  }

  private syncProfileUI(): void {
    const hasProfile = Boolean(this.profile);
    this.loginCard.hidden = hasProfile;
    this.menuPanel.hidden = !hasProfile;

    if (this.profile) {
      this.playerNameEl.textContent = this.profile.displayName;
      this.playerBestEl.textContent = formatNumber(this.profile.bestScore);
    }
  }

  private async handleLoginSubmit(): Promise<void> {
    if (this.loggingIn) return;
    const check = validateUsername(this.usernameInput.value);
    if (!check.ok) {
      this.loginErrorEl.textContent = check.error;
      this.loginErrorEl.hidden = false;
      return;
    }

    this.loggingIn = true;
    this.loginSubmitBtn.disabled = true;
    this.loginSubmitBtn.textContent = 'Joining…';
    this.loginErrorEl.hidden = true;

    try {
      const res = await this.api.login(check.displayName);
      const nextProfile: StoredProfile = {
        username: res.player.username,
        displayName: res.player.displayName,
        bestScore: res.player.bestScore,
        gamesPlayed: res.player.gamesPlayed,
        offline: false,
      };
      this.completeLogin(nextProfile);
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        this.loginErrorEl.textContent = err.message;
        this.loginErrorEl.hidden = false;
      } else {
        // Offline / server unreachable: never block gameplay!
        const localProfile: StoredProfile = {
          username: check.username,
          displayName: check.displayName,
          bestScore: 0,
          gamesPlayed: 0,
          offline: true,
        };
        this.completeLogin(localProfile);
      }
    } finally {
      this.loggingIn = false;
      this.loginSubmitBtn.disabled = false;
      this.loginSubmitBtn.textContent = 'Continue';
    }
  }

  private completeLogin(profile: StoredProfile): void {
    this.callbacks.onUiClick?.();
    saveProfile(profile);
    this.profile = profile;
    this.syncProfileUI();
    this.callbacks.onProfileChange(profile);
  }
}
