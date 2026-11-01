/* Versioned local persistence. Progress and settings live in separate keys so
   New Game never wipes the player's audio/display preferences. */
'use strict';

import { clamp, makeSeed } from './utils.js';

export const SAVE_VERSION = 1;
const SAVE_KEY = 'moonLanderExplorer.progress.v1';
const SETTINGS_KEY = 'moonLanderExplorer.settings.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  music: 0.55,
  sfx: 0.72,
  musicMuted: false,
  sfxMuted: false,
  shake: true,
  quality: 'auto' // auto | high | low
});

const UPGRADE_MAX = Object.freeze({ engine: 4, shield: 4, hull: 4, fuel: 4 });

const copy = (obj) => JSON.parse(JSON.stringify(obj));

function safeStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (err) {
    return false;
  }
}

function safeStorageRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (err) {
    /* storage unavailable — non-fatal */
  }
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  const set = new Set();
  for (const v of value) {
    if (typeof v === 'string' && v.length <= 120) set.add(v);
    if (set.size >= 6000) break;
  }
  return [...set];
}

function finite(n, fallback = 0) {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

export function createRunData(seed = makeSeed()) {
  return {
    version: SAVE_VERSION,
    seed,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    checkpointIndex: 0,
    checkpoint: {
      stationName: 'Tranquility Outpost',
      sector: 0,
      x: 180,
      y: 560,
      score: 0,
      distance: 0
    },
    // Score at the most recent checkpoint. Live score is kept in memory.
    score: 0,
    best: 0,
    salvage: 0,
    upgrades: { engine: 0, shield: 0, hull: 0, fuel: 0 },
    collected: [],
    completedMissions: [],
    discoveries: [],
    stats: {
      missions: 0,
      rescues: 0,
      samples: 0,
      discoveries: 0,
      distance: 0,
      crashes: 0,
      runs: 1
    }
  };
}

function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.version !== SAVE_VERSION) return null;
  if (!Number.isFinite(raw.seed)) return null;

  const base = createRunData(raw.seed >>> 0 || 1);
  const out = Object.assign(base, raw);
  out.version = SAVE_VERSION;
  out.seed = raw.seed >>> 0 || 1;
  out.checkpointIndex = clamp(Math.floor(finite(raw.checkpointIndex, 0)), 0, 9999);
  out.score = Math.max(0, finite(raw.score, 0));
  out.best = Math.max(0, finite(raw.best, 0));
  out.salvage = Math.max(0, finite(raw.salvage, 0));
  out.collected = uniqueStrings(raw.collected);
  out.completedMissions = uniqueStrings(raw.completedMissions);
  out.discoveries = uniqueStrings(raw.discoveries);

  const cp = raw.checkpoint && typeof raw.checkpoint === 'object' ? raw.checkpoint : {};
  out.checkpoint = {
    stationName: typeof cp.stationName === 'string' ? cp.stationName.slice(0, 48) : 'Outpost',
    sector: clamp(Math.floor(finite(cp.sector, 0)), 0, 9999),
    x: clamp(finite(cp.x, 180), 0, 1e9),
    y: clamp(finite(cp.y, 560), -1e6, 1e6),
    score: Math.max(0, finite(cp.score, out.score)),
    distance: Math.max(0, finite(cp.distance, 0))
  };

  const upgrades = raw.upgrades && typeof raw.upgrades === 'object' ? raw.upgrades : {};
  out.upgrades = {
    engine: clamp(Math.floor(finite(upgrades.engine, 0)), 0, UPGRADE_MAX.engine),
    shield: clamp(Math.floor(finite(upgrades.shield, 0)), 0, UPGRADE_MAX.shield),
    hull: clamp(Math.floor(finite(upgrades.hull, 0)), 0, UPGRADE_MAX.hull),
    fuel: clamp(Math.floor(finite(upgrades.fuel, 0)), 0, UPGRADE_MAX.fuel)
  };

  const stats = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
  out.stats = {
    missions: Math.max(0, Math.floor(finite(stats.missions, 0))),
    rescues: Math.max(0, Math.floor(finite(stats.rescues, 0))),
    samples: Math.max(0, Math.floor(finite(stats.samples, 0))),
    discoveries: Math.max(0, Math.floor(finite(stats.discoveries, 0))),
    distance: Math.max(0, finite(stats.distance, 0)),
    crashes: Math.max(0, Math.floor(finite(stats.crashes, 0))),
    runs: Math.max(1, Math.floor(finite(stats.runs, 1)))
  };
  return out;
}

export function sanitizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  out.music = clamp(finite(raw.music, out.music), 0, 1);
  out.sfx = clamp(finite(raw.sfx, out.sfx), 0, 1);
  out.musicMuted = Boolean(raw.musicMuted);
  out.sfxMuted = Boolean(raw.sfxMuted);
  out.shake = raw.shake !== false;
  out.quality = ['auto', 'high', 'low'].includes(raw.quality) ? raw.quality : 'auto';
  return out;
}

export class SaveManager {
  constructor() {
    this.lastError = null;
    this._pending = null;
    this._timer = 0;
  }

  hasSave() {
    // Treat unreadable or version-mismatched data as no save so a corrupt
    // entry cannot enable a bogus Continue prompt or New Game warning.
    return Boolean(this.load());
  }

  load() {
    const text = safeStorageGet(SAVE_KEY);
    if (!text) return null;
    try {
      return sanitize(JSON.parse(text));
    } catch (err) {
      this.lastError = err;
      return null;
    }
  }

  save(data, { immediate = false } = {}) {
    if (!data) return false;
    data.version = SAVE_VERSION;
    data.updatedAt = Date.now();
    const text = JSON.stringify(data);
    if (immediate) {
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = 0;
      }
      const ok = safeStorageSet(SAVE_KEY, text);
      if (!ok) this.lastError = new Error('Local storage is unavailable or full.');
      return ok;
    }
    this._pending = text;
    if (!this._timer) {
      this._timer = setTimeout(() => {
        this._timer = 0;
        if (this._pending != null) {
          const ok = safeStorageSet(SAVE_KEY, this._pending);
          if (!ok) this.lastError = new Error('Local storage is unavailable or full.');
          this._pending = null;
        }
      }, 900);
    }
    return true;
  }

  flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = 0;
    }
    if (this._pending != null) {
      const ok = safeStorageSet(SAVE_KEY, this._pending);
      this._pending = null;
      return ok;
    }
    return true;
  }

  newRun(seed = makeSeed()) {
    return createRunData(seed);
  }

  clearProgress() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = 0;
    }
    this._pending = null;
    safeStorageRemove(SAVE_KEY);
  }

  loadSettings() {
    const text = safeStorageGet(SETTINGS_KEY);
    if (!text) return copy(DEFAULT_SETTINGS);
    try {
      return sanitizeSettings(JSON.parse(text));
    } catch (err) {
      return copy(DEFAULT_SETTINGS);
    }
  }

  saveSettings(settings) {
    return safeStorageSet(SETTINGS_KEY, JSON.stringify(sanitizeSettings(settings)));
  }

  wipeAll() {
    safeStorageRemove(SAVE_KEY);
    safeStorageRemove(SETTINGS_KEY);
  }
}

export const UPGRADE_LIMITS = UPGRADE_MAX;
