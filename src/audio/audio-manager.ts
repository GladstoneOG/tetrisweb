/**
 * Adaptive Web Audio API engine with manifest loading, level-adaptive music
 * crossfading (1.5s-2.0s), zero-latency SFX playback with synth fallback,
 * gesture-unlock handling, and localStorage persistence.
 */
import type { GameEvent } from '../engine/types';
import { isSfxKey, playSynthSfx, type SfxKey } from './synth-fallback';

export interface MusicTrackManifestItem {
  id: string;
  title: string;
  minLevel: number;
  maxLevel: number;
  url: string;
  license?: string;
  author?: string;
}

export interface AudioManifest {
  music: MusicTrackManifestItem[];
  sfx: Partial<Record<SfxKey, string>> & Record<string, string | undefined>;
}

export interface AudioSettings {
  musicVolume: number;
  sfxVolume: number;
  musicMuted: boolean;
  sfxMuted: boolean;
}

export interface AudioManagerOptions {
  manifestUrl?: string;
  storageKey?: string;
  defaultCrossfadeSec?: number;
  autoUnlockOnWindowEvents?: boolean;
}

export type AudioChangeListener = (
  settings: AudioSettings,
  currentTrack: MusicTrackManifestItem | null
) => void;

interface ActiveMusicVoice {
  track: MusicTrackManifestItem;
  source: AudioBufferSourceNode;
  gain: GainNode;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_STORAGE_KEY = 'lumino-tetris-audio-settings-v1';
const DEFAULT_MANIFEST_URL = '/assets/manifest.json';

const DEFAULT_SETTINGS: AudioSettings = {
  musicVolume: 0.55,
  sfxVolume: 0.78,
  musicMuted: false,
  sfxMuted: false,
};

function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof globalThis === 'undefined') {
    return null;
  }
  const scope = globalThis as typeof globalThis & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export class AudioManager {
  private readonly manifestUrl: string;
  private readonly storageKey: string;
  private readonly defaultCrossfadeSec: number;

  private settings: AudioSettings;
  private ctx: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private musicMasterGain: GainNode | null = null;
  private musicDuckGain: GainNode | null = null;
  private sfxMasterGain: GainNode | null = null;

  private manifest: AudioManifest | null = null;
  private manifestPromise: Promise<AudioManifest | null> | null = null;

  private readonly decodedBuffers = new Map<string, AudioBuffer>();
  private readonly pendingDecodes = new Map<string, Promise<AudioBuffer | null>>();
  private readonly failedUrls = new Set<string>();
  private readonly lastSfxTimeMs = new Map<SfxKey, number>();

  private currentLevel = 1;
  private musicWanted = false;
  private musicPaused = false;
  private musicRequestToken = 0;
  private activeVoice: ActiveMusicVoice | null = null;
  private fadingVoices = new Set<ActiveMusicVoice>();
  private currentTrackMeta: MusicTrackManifestItem | null = null;

  private sfxPreloadStarted = false;
  private unlockListenersBound = false;
  private destroyed = false;
  private readonly listeners = new Set<AudioChangeListener>();

  constructor(options?: AudioManagerOptions) {
    this.manifestUrl = options?.manifestUrl ?? DEFAULT_MANIFEST_URL;
    this.storageKey = options?.storageKey ?? DEFAULT_STORAGE_KEY;
    this.defaultCrossfadeSec = Math.max(
      1.0,
      Math.min(3.0, options?.defaultCrossfadeSec ?? 1.75)
    );
    this.settings = this.loadSettings();

    if (options?.autoUnlockOnWindowEvents !== false) {
      this.bindWindowUnlockListeners();
    }
  }

  public getSettings(): AudioSettings {
    return { ...this.settings };
  }

  public getCurrentTrack(): MusicTrackManifestItem | null {
    return this.currentTrackMeta ? { ...this.currentTrackMeta } : null;
  }

  public onChange(listener: AudioChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setMusicVolume(volume: number): void {
    this.settings.musicVolume = clampVolume(volume);
    this.saveSettings();
    this.applyGainSettings();
    this.notifyListeners();
  }

  public setSfxVolume(volume: number): void {
    this.settings.sfxVolume = clampVolume(volume);
    this.saveSettings();
    this.applyGainSettings();
    this.notifyListeners();
  }

  public setMusicMuted(muted: boolean): void {
    this.settings.musicMuted = Boolean(muted);
    this.saveSettings();
    this.applyGainSettings();
    this.notifyListeners();
  }

  public setSfxMuted(muted: boolean): void {
    this.settings.sfxMuted = Boolean(muted);
    this.saveSettings();
    this.applyGainSettings();
    this.notifyListeners();
  }

  public toggleMusicMute(): boolean {
    this.setMusicMuted(!this.settings.musicMuted);
    return this.settings.musicMuted;
  }

  public toggleSfxMute(): boolean {
    this.setSfxMuted(!this.settings.sfxMuted);
    return this.settings.sfxMuted;
  }

  public async loadManifest(): Promise<AudioManifest | null> {
    if (this.manifest) {
      return this.manifest;
    }
    if (this.manifestPromise) {
      return this.manifestPromise;
    }
    if (typeof fetch !== 'function') {
      return null;
    }

    this.manifestPromise = (async () => {
      try {
        const res = await fetch(this.manifestUrl);
        if (!res.ok) {
          return null;
        }
        const parsed = (await res.json()) as Partial<AudioManifest> | null;
        if (!parsed || typeof parsed !== 'object') {
          return null;
        }
        const normalized: AudioManifest = {
          music: Array.isArray(parsed.music)
            ? parsed.music
                .filter(
                  (item): item is MusicTrackManifestItem =>
                    Boolean(item) &&
                    typeof item.id === 'string' &&
                    typeof item.url === 'string'
                )
                .map((item) => ({
                  id: item.id,
                  title: item.title || item.id,
                  minLevel: Number.isFinite(item.minLevel) ? item.minLevel : 1,
                  maxLevel: Number.isFinite(item.maxLevel)
                    ? item.maxLevel
                    : Number.POSITIVE_INFINITY,
                  url: item.url,
                  license: item.license,
                  author: item.author,
                }))
            : [],
          sfx: parsed.sfx && typeof parsed.sfx === 'object' ? parsed.sfx : {},
        };
        this.manifest = normalized;
        return normalized;
      } catch {
        return null;
      }
    })();

    return this.manifestPromise;
  }

  /**
   * Unlocks/initializes the Web Audio graph inside a user gesture handler,
   * begins preloading SFX buffers, and starts queued music if requested.
   */
  public async unlock(): Promise<void> {
    if (this.destroyed) return;

    const ctx = this.ensureContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Ignore resume errors when called outside gesture; next gesture will retry
      }
    }

    this.unbindWindowUnlockListeners();

    const manifest = await this.loadManifest();
    if (this.destroyed) return;

    if (manifest && !this.sfxPreloadStarted) {
      this.sfxPreloadStarted = true;
      void this.preloadSfx(manifest);
    }

    if (this.musicWanted) {
      await this.syncMusicToLevel(this.currentLevel, this.defaultCrossfadeSec);
    }
  }

  public async startMusic(level?: number): Promise<void> {
    if (this.destroyed) return;
    if (level !== undefined) {
      this.currentLevel = Math.max(1, Math.floor(level));
    }
    this.musicWanted = true;
    await this.unlock();
    if (this.destroyed || !this.musicWanted) return;
    await this.syncMusicToLevel(this.currentLevel, this.defaultCrossfadeSec);
  }

  public async setLevel(
    level: number,
    options?: { fadeDurationSec?: number }
  ): Promise<void> {
    if (this.destroyed) return;
    this.currentLevel = Math.max(1, Math.floor(level));
    if (!this.musicWanted) {
      return;
    }
    const fadeSec = options?.fadeDurationSec ?? this.defaultCrossfadeSec;
    await this.syncMusicToLevel(this.currentLevel, fadeSec);
  }

  public stopMusic(fadeDurationSec = 0.45): void {
    this.musicWanted = false;
    this.musicRequestToken += 1;
    if (this.activeVoice) {
      this.fadeOutAndDisposeVoice(this.activeVoice, fadeDurationSec);
      this.activeVoice = null;
    }
    if (this.currentTrackMeta !== null) {
      this.currentTrackMeta = null;
      this.notifyListeners();
    }
  }

  public setPaused(paused: boolean): void {
    this.musicPaused = Boolean(paused);
    const ctx = this.ctx;
    if (!ctx || !this.musicDuckGain) return;
    const target = this.musicPaused ? 0.28 : 1;
    this.musicDuckGain.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
  }

  public selectTrackForLevel(level: number): MusicTrackManifestItem | null {
    const tracks = this.manifest?.music;
    if (!tracks || tracks.length === 0) {
      return null;
    }

    const safeLevel = Math.max(1, Math.floor(level));
    const exact = tracks.find(
      (t) => safeLevel >= t.minLevel && safeLevel <= t.maxLevel
    );
    if (exact) return exact;

    const sorted = [...tracks].sort((a, b) => a.minLevel - b.minLevel);
    if (safeLevel < sorted[0].minLevel) {
      return sorted[0];
    }

    let best = sorted[0];
    for (const track of sorted) {
      if (track.minLevel <= safeLevel) {
        best = track;
      }
    }
    return best;
  }

  public playSfx(key: SfxKey): void {
    if (this.destroyed || this.settings.sfxMuted || this.settings.sfxVolume <= 0) {
      return;
    }

    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const minCooldown = key === 'move' ? 28 : key === 'rotate' ? 18 : 0;
    if (minCooldown > 0) {
      const prev = this.lastSfxTimeMs.get(key) ?? -Infinity;
      if (nowMs - prev < minCooldown) {
        return;
      }
    }
    this.lastSfxTimeMs.set(key, nowMs);

    const ctx = this.ensureContext();
    if (!ctx || !this.sfxMasterGain) {
      return;
    }

    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }

    const sfxUrl = this.manifest?.sfx?.[key];
    const buffer = sfxUrl ? this.decodedBuffers.get(sfxUrl) : undefined;

    if (buffer) {
      try {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(this.sfxMasterGain);
        src.start(0);
        return;
      } catch {
        // Fall through cleanly to Web Audio synth fallback
      }
    }

    try {
      playSynthSfx(ctx, this.sfxMasterGain, key);
    } catch {
      // Never throw from audio playback
    }
  }

  public handleGameEvents(events: readonly GameEvent[]): void {
    if (events.length === 0) return;

    const hasSlam = events.some((ev) => ev.type === 'slam');

    for (const ev of events) {
      switch (ev.type) {
        case 'move':
          if (!ev.softDrop) {
            this.playSfx('move');
          }
          break;
        case 'rotate':
          this.playSfx('rotate');
          break;
        case 'hold':
          this.playSfx('hold');
          break;
        case 'slam':
          this.playSfx('slam');
          break;
        case 'lock':
          if (!hasSlam) {
            this.playSfx('lock');
          }
          break;
        case 'lineClear':
          if (ev.count === 4) {
            this.playSfx('tetris');
          } else if (ev.count === 3) {
            this.playSfx('clear3');
          } else if (ev.count === 2) {
            this.playSfx('clear2');
          } else {
            this.playSfx('clear1');
          }
          break;
        case 'levelUp':
          this.playSfx('levelUp');
          void this.setLevel(ev.newLevel);
          break;
        case 'gameOver':
          this.playSfx('gameOver');
          break;
        default:
          break;
      }
    }
  }

  public destroy(): void {
    this.destroyed = true;
    this.musicRequestToken += 1;
    this.unbindWindowUnlockListeners();
    this.listeners.clear();

    if (this.activeVoice) {
      this.disposeVoiceImmediately(this.activeVoice);
      this.activeVoice = null;
    }
    for (const voice of this.fadingVoices) {
      this.disposeVoiceImmediately(voice);
    }
    this.fadingVoices.clear();

    if (this.ctx) {
      try {
        this.musicMasterGain?.disconnect();
        this.musicDuckGain?.disconnect();
        this.sfxMasterGain?.disconnect();
        this.compressor?.disconnect();
      } catch {
        // Ignore disconnect errors on teardown
      }
      void this.ctx.close().catch(() => {});
      this.ctx = null;
      this.compressor = null;
      this.musicMasterGain = null;
      this.musicDuckGain = null;
      this.sfxMasterGain = null;
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = getAudioContextConstructor();
    if (!Ctor) return null;

    try {
      const ctx = new Ctor();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-10, ctx.currentTime);
      compressor.knee.setValueAtTime(12, ctx.currentTime);
      compressor.ratio.setValueAtTime(4, ctx.currentTime);
      compressor.attack.setValueAtTime(0.005, ctx.currentTime);
      compressor.release.setValueAtTime(0.15, ctx.currentTime);
      compressor.connect(ctx.destination);

      const musicMaster = ctx.createGain();
      const musicDuck = ctx.createGain();
      const sfxMaster = ctx.createGain();

      musicDuck.gain.setValueAtTime(this.musicPaused ? 0.28 : 1, ctx.currentTime);

      musicMaster.connect(musicDuck);
      musicDuck.connect(compressor);
      sfxMaster.connect(compressor);

      this.ctx = ctx;
      this.compressor = compressor;
      this.musicMasterGain = musicMaster;
      this.musicDuckGain = musicDuck;
      this.sfxMasterGain = sfxMaster;

      this.applyGainSettings(true);
      return ctx;
    } catch {
      return null;
    }
  }

  private applyGainSettings(immediate = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;

    const targetMusic = this.settings.musicMuted ? 0 : this.settings.musicVolume;
    const targetSfx = this.settings.sfxMuted ? 0 : this.settings.sfxVolume;

    if (this.musicMasterGain) {
      if (immediate) {
        this.musicMasterGain.gain.setValueAtTime(targetMusic, now);
      } else {
        this.musicMasterGain.gain.setTargetAtTime(targetMusic, now, 0.03);
      }
    }

    if (this.sfxMasterGain) {
      if (immediate) {
        this.sfxMasterGain.gain.setValueAtTime(targetSfx, now);
      } else {
        this.sfxMasterGain.gain.setTargetAtTime(targetSfx, now, 0.02);
      }
    }
  }

  private async preloadSfx(manifest: AudioManifest): Promise<void> {
    const entries = Object.entries(manifest.sfx);
    await Promise.all(
      entries.map(async ([key, url]) => {
        if (!url || !isSfxKey(key)) return;
        await this.loadAudioBuffer(url);
      })
    );
  }

  private async loadAudioBuffer(url: string): Promise<AudioBuffer | null> {
    const cached = this.decodedBuffers.get(url);
    if (cached) return cached;
    if (this.failedUrls.has(url)) return null;

    const inflight = this.pendingDecodes.get(url);
    if (inflight) return inflight;

    const ctx = this.ctx;
    if (!ctx || typeof fetch !== 'function') return null;

    const promise = (async (): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          this.failedUrls.add(url);
          return null;
        }
        const raw = await res.arrayBuffer();
        if (this.destroyed || !this.ctx) return null;
        const decoded = await this.ctx.decodeAudioData(raw.slice(0));
        this.decodedBuffers.set(url, decoded);
        return decoded;
      } catch {
        this.failedUrls.add(url);
        return null;
      } finally {
        this.pendingDecodes.delete(url);
      }
    })();

    this.pendingDecodes.set(url, promise);
    return promise;
  }

  private async syncMusicToLevel(level: number, fadeSec: number): Promise<void> {
    const manifest = await this.loadManifest();
    if (this.destroyed || !this.musicWanted || !manifest) return;

    const targetTrack = this.selectTrackForLevel(level);
    if (!targetTrack) return;

    if (this.activeVoice && this.activeVoice.track.id === targetTrack.id) {
      return;
    }

    const token = ++this.musicRequestToken;
    const buffer = await this.loadAudioBuffer(targetTrack.url);
    if (
      this.destroyed ||
      !this.musicWanted ||
      token !== this.musicRequestToken ||
      !buffer
    ) {
      return;
    }

    const ctx = this.ctx;
    if (!ctx || !this.musicMasterGain) return;

    if (this.activeVoice && this.activeVoice.track.id === targetTrack.id) {
      return;
    }

    const now = ctx.currentTime;
    const safeFade = Math.max(0.1, fadeSec);
    const hadActiveVoice = Boolean(this.activeVoice);

    if (this.activeVoice) {
      this.fadeOutAndDisposeVoice(this.activeVoice, safeFade);
      this.activeVoice = null;
    }

    const fadeInSec = hadActiveVoice ? safeFade : Math.min(0.65, safeFade);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(1, now + fadeInSec);

    source.connect(gain);
    gain.connect(this.musicMasterGain);
    source.start(now);

    const newVoice: ActiveMusicVoice = {
      track: targetTrack,
      source,
      gain,
      cleanupTimer: null,
    };

    this.activeVoice = newVoice;
    this.currentTrackMeta = targetTrack;
    this.notifyListeners();

    // Gently prefetch the next level band's track for instant crossfading on level-up
    if (Number.isFinite(targetTrack.maxLevel)) {
      const nextTrack = this.selectTrackForLevel(targetTrack.maxLevel + 1);
      if (nextTrack && nextTrack.id !== targetTrack.id) {
        void this.loadAudioBuffer(nextTrack.url);
      }
    }
  }

  private fadeOutAndDisposeVoice(voice: ActiveMusicVoice, fadeSec: number): void {
    const ctx = this.ctx;
    if (!ctx) {
      this.disposeVoiceImmediately(voice);
      return;
    }

    const now = ctx.currentTime;
    const safeFade = Math.max(0.05, fadeSec);
    this.fadingVoices.add(voice);

    try {
      const currentVal = voice.gain.gain.value;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(currentVal, now);
      voice.gain.gain.linearRampToValueAtTime(0.0001, now + safeFade);
    } catch {
      // Ignore gain automation edge cases
    }

    if (voice.cleanupTimer !== null) {
      clearTimeout(voice.cleanupTimer);
    }
    voice.cleanupTimer = setTimeout(() => {
      this.fadingVoices.delete(voice);
      this.disposeVoiceImmediately(voice);
    }, Math.ceil((safeFade + 0.08) * 1000));
  }

  private disposeVoiceImmediately(voice: ActiveMusicVoice): void {
    if (voice.cleanupTimer !== null) {
      clearTimeout(voice.cleanupTimer);
      voice.cleanupTimer = null;
    }
    try {
      voice.source.stop();
    } catch {
      // Ignore if already stopped
    }
    try {
      voice.source.disconnect();
      voice.gain.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }

  private readonly handleWindowUnlock = (): void => {
    void this.unlock();
  };

  private bindWindowUnlockListeners(): void {
    if (this.unlockListenersBound || typeof window === 'undefined') {
      return;
    }
    this.unlockListenersBound = true;
    window.addEventListener('pointerdown', this.handleWindowUnlock, { passive: true });
    window.addEventListener('keydown', this.handleWindowUnlock, { passive: true });
  }

  private unbindWindowUnlockListeners(): void {
    if (!this.unlockListenersBound || typeof window === 'undefined') {
      return;
    }
    this.unlockListenersBound = false;
    window.removeEventListener('pointerdown', this.handleWindowUnlock);
    window.removeEventListener('keydown', this.handleWindowUnlock);
  }

  private loadSettings(): AudioSettings {
    if (typeof localStorage === 'undefined') {
      return { ...DEFAULT_SETTINGS };
    }
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw) as Partial<AudioSettings> | null;
      if (!parsed || typeof parsed !== 'object') {
        return { ...DEFAULT_SETTINGS };
      }
      return {
        musicVolume:
          typeof parsed.musicVolume === 'number'
            ? clampVolume(parsed.musicVolume)
            : DEFAULT_SETTINGS.musicVolume,
        sfxVolume:
          typeof parsed.sfxVolume === 'number'
            ? clampVolume(parsed.sfxVolume)
            : DEFAULT_SETTINGS.sfxVolume,
        musicMuted:
          typeof parsed.musicMuted === 'boolean'
            ? parsed.musicMuted
            : DEFAULT_SETTINGS.musicMuted,
        sfxMuted:
          typeof parsed.sfxMuted === 'boolean'
            ? parsed.sfxMuted
            : DEFAULT_SETTINGS.sfxMuted,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private saveSettings(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.settings));
    } catch {
      // Ignore quota / privacy mode storage errors
    }
  }

  private notifyListeners(): void {
    const snapshotSettings = this.getSettings();
    const track = this.getCurrentTrack();
    for (const listener of this.listeners) {
      try {
        listener(snapshotSettings, track);
      } catch {
        // Protect internal state from consumer callback errors
      }
    }
  }
}
