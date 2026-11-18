/**
 * Small, defensive localStorage persistence layer for the UI shell.
 * Every access is wrapped so private-mode / disabled storage never breaks gameplay.
 */
import { MAX_START_LEVEL, MIN_START_LEVEL } from '../engine/types';

export const PROFILE_KEY = 'lumino-tetris-profile-v1';
export const SETTINGS_KEY = 'lumino-tetris-settings-v1';

export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 24;

export interface StoredProfile {
  /** Case-insensitive lookup key (lowercased, trimmed). */
  username: string;
  /** Original casing chosen by the player. */
  displayName: string;
  bestScore: number;
  gamesPlayed: number;
  /** True when the profile was created without reaching the API. */
  offline: boolean;
}

export interface UiSettings {
  ghostEnabled: boolean;
  startLevel: number;
  hintSeen: boolean;
}

export const DEFAULT_SETTINGS: UiSettings = {
  ghostEnabled: true,
  startLevel: 1,
  hintSeen: true,
};

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(key: string): T | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota / private mode: ignore silently.
  }
}

function safeInt(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

export function clampLevel(level: unknown): number {
  const n = typeof level === 'number' && Number.isFinite(level) ? Math.floor(level) : MIN_START_LEVEL;
  return Math.max(MIN_START_LEVEL, Math.min(MAX_START_LEVEL, n));
}

/** Mirrors the worker's username rules: trimmed, 2-24 chars, no control chars. */
export function validateUsername(
  raw: string
): { ok: true; username: string; displayName: string } | { ok: false; error: string } {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (trimmed.length < USERNAME_MIN_LENGTH) {
    return { ok: false, error: `Please use at least ${USERNAME_MIN_LENGTH} characters.` };
  }
  if (trimmed.length > USERNAME_MAX_LENGTH) {
    return { ok: false, error: `Please keep it under ${USERNAME_MAX_LENGTH + 1} characters.` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
    return { ok: false, error: 'That name has some invisible characters in it.' };
  }
  return { ok: true, username: trimmed.toLowerCase(), displayName: trimmed };
}

export function loadProfile(): StoredProfile | null {
  const parsed = readJson<Partial<StoredProfile>>(PROFILE_KEY);
  if (!parsed || typeof parsed.displayName !== 'string') return null;
  const check = validateUsername(parsed.displayName);
  if (!check.ok) return null;
  return {
    username: typeof parsed.username === 'string' && parsed.username ? parsed.username : check.username,
    displayName: check.displayName,
    bestScore: safeInt(parsed.bestScore),
    gamesPlayed: safeInt(parsed.gamesPlayed),
    offline: Boolean(parsed.offline),
  };
}

export function saveProfile(profile: StoredProfile): void {
  writeJson(PROFILE_KEY, profile);
}

export function clearProfile(): void {
  const storage = getStorage();
  try {
    storage?.removeItem(PROFILE_KEY);
  } catch {
    // ignore
  }
}

export function loadSettings(): UiSettings {
  const parsed = readJson<Partial<UiSettings>>(SETTINGS_KEY) ?? {};
  return {
    ghostEnabled: typeof parsed.ghostEnabled === 'boolean' ? parsed.ghostEnabled : DEFAULT_SETTINGS.ghostEnabled,
    startLevel: clampLevel(parsed.startLevel ?? DEFAULT_SETTINGS.startLevel),
    hintSeen: typeof parsed.hintSeen === 'boolean' ? parsed.hintSeen : DEFAULT_SETTINGS.hintSeen,
  };
}

export function saveSettings(settings: UiSettings): void {
  writeJson(SETTINGS_KEY, {
    ghostEnabled: Boolean(settings.ghostEnabled),
    startLevel: clampLevel(settings.startLevel),
    hintSeen: Boolean(settings.hintSeen),
  });
}

export function updateSettings(patch: Partial<UiSettings>): UiSettings {
  const next = { ...loadSettings(), ...patch };
  saveSettings(next);
  return loadSettings();
}
