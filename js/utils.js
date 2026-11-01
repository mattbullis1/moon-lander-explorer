/* Moon Lander Explorer — small, dependency-free math/utility kit. */
'use strict';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/** Frame-rate independent exponential approach. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export const wrap = (v, min, max) => {
  const span = max - min;
  return ((((v - min) % span) + span) % span) + min;
};

export const dist2 = (x1, y1, x2, y2) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
};

export const formatNumber = (n) => {
  const v = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  return v.toLocaleString('en-US');
};

export const padNumber = (n, len) =>
  String(Math.max(0, Math.floor(n))).padStart(len, '0');

export function makeSeed() {
  try {
    if (window.crypto && window.crypto.getRandomValues) {
      const a = new Uint32Array(1);
      window.crypto.getRandomValues(a);
      return (a[0] % 2147483000) + 1;
    }
  } catch (err) {
    /* fall through */
  }
  return ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) % 2147483000 + 1;
}

/** Deterministic 32-bit string hash (FNV-1a). */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Integer lattice hash -> [0,1). */
export function hashInt(seed, i) {
  let h = (seed ^ Math.imul(i | 0, 374761393)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Seeded PRNG. */
export class RNG {
  constructor(seed) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }
  next() {
    let t = (this.state += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) {
    return a + (b - a) * this.next();
  }
  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }
  chance(p) {
    return this.next() < p;
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
}

/** Smooth 1-D value noise. */
export function noise1(seed, x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hashInt(seed, i), hashInt(seed, i + 1), u) * 2 - 1;
}

export function fbm1(seed, x, octaves = 3) {
  let total = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    total += noise1((seed + o * 7919) >>> 0, x * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return total / (norm || 1);
}

/** Rotate point around a pivot. */
export function rotatePoint(x, y, cx, cy, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

/**
 * Segment (x0,y0)-(x1,y1) vs axis-aligned-ish circle.
 * Returns true when the segment passes within radius of the circle.
 */
export function segmentCircle(x0, y0, x1, y1, cx, cy, radius) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((cx - x0) * dx + (cy - y0) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  const px = x0 + dx * t;
  const py = y0 + dy * t;
  return dist2(px, py, cx, cy) <= radius * radius;
}

export function arrayRemove(arr, item) {
  const i = arr.indexOf(item);
  if (i >= 0) {
    arr.splice(i, 1);
    return true;
  }
  return false;
}

export const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);
