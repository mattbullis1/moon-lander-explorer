/* Lightweight pooled-ish particle system (arrays + hard cap). */
'use strict';

import { TAU, clamp } from './utils.js';

const MAX_HIGH = 780;
const MAX_LOW = 340;

export class Particles {
  constructor() {
    this.list = [];
    this.quality = 'auto';
    this.adaptiveLow = false;
  }

  get cap() {
    if (this.quality === 'low' || this.adaptiveLow) return MAX_LOW;
    if (this.quality === 'high') return MAX_HIGH;
    return 560;
  }

  get density() {
    return this.quality === 'low' || this.adaptiveLow ? 0.55 : 1;
  }

  clear() {
    this.list.length = 0;
  }

  _add(p) {
    if (this.list.length >= this.cap) {
      this.list.shift();
    }
    this.list.push(p);
  }

  update(dt) {
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) {
        list.splice(i, 1);
        continue;
      }
      const drag = Math.exp(-(p.drag || 0) * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.vy += (p.gravity || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot = (p.rot || 0) + (p.spin || 0) * dt;
      if (p.type === 'dust' && p.floor != null && p.y > p.floor) {
        p.y = p.floor;
        p.vy *= -0.08;
        p.vx *= 0.7;
      }
    }
  }

  emitThrust(x, y, vx, vy, intensity = 1) {
    const n = Math.random() < 0.4 * this.density ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + (Math.random() - 0.5) * 0.55;
      const speed = (90 + Math.random() * 190) * intensity;
      this._add({
        type: 'exhaust',
        x: x + (Math.random() - 0.5) * 12,
        y: y + Math.random() * 4,
        vx: vx * 0.15 + Math.cos(a) * speed * 0.25 + (Math.random() - 0.5) * 30,
        vy: Math.sin(a) * speed + vy * 0.1,
        life: 0.22 + Math.random() * 0.3,
        maxLife: 0.52,
        size: 2 + Math.random() * 5,
        color: Math.random() < 0.55 ? '#9ef7ff' : Math.random() < 0.5 ? '#ffd27a' : '#ffffff',
        additive: true,
        drag: 1.2,
        gravity: 70
      });
    }
  }

  emitDust(x, y, amount = 1, opts = {}) {
    const count = Math.max(1, Math.round(amount * 4 * this.density));
    for (let i = 0; i < count; i++) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      this._add({
        type: 'dust',
        x: x + (Math.random() - 0.5) * 40,
        y: y - 2,
        vx: dir * (20 + Math.random() * 90) * (opts.power || 1),
        vy: -(10 + Math.random() * 55) * (opts.power || 1),
        life: 0.45 + Math.random() * 0.7,
        maxLife: 1.15,
        size: 4 + Math.random() * 9,
        color: opts.color || 'rgba(210,203,190,0.5)',
        gravity: 42,
        drag: 1.8,
        floor: opts.floor
      });
    }
  }

  emitImpact(x, y, strength = 1) {
    const count = Math.round((6 + strength * 8) * this.density);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const sp = 40 + Math.random() * 190 * strength;
      this._add({
        type: 'spark',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 35,
        life: 0.25 + Math.random() * 0.55,
        maxLife: 0.8,
        size: 1 + Math.random() * 2.2,
        color: Math.random() < 0.4 ? '#ffd57a' : Math.random() < 0.5 ? '#fff3c9' : '#8ff4ff',
        additive: true,
        gravity: 230,
        drag: 0.8
      });
    }
    this.emitDust(x, y, 0.8 * strength);
  }

  emitExplosion(x, y, scale = 1) {
    const sparks = Math.round(38 * scale * this.density);
    for (let i = 0; i < sparks; i++) {
      const a = Math.random() * TAU;
      const sp = (60 + Math.random() * 360) * scale;
      this._add({
        type: Math.random() < 0.45 ? 'debris' : 'spark',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 50,
        life: 0.4 + Math.random() * 1.1,
        maxLife: 1.5,
        size: 1.5 + Math.random() * 4 * scale,
        color: Math.random() < 0.5 ? '#ffb24a' : Math.random() < 0.5 ? '#ffe9b0' : '#ff6a3d',
        additive: true,
        gravity: 160,
        drag: 0.55,
        spin: (Math.random() - 0.5) * 12
      });
    }
    for (let i = 0; i < 9 * this.density; i++) {
      this._add({
        type: 'smoke',
        x: x + (Math.random() - 0.5) * 36,
        y: y + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 90,
        vy: -20 - Math.random() * 70,
        life: 1.1 + Math.random() * 1.2,
        maxLife: 2.3,
        size: 14 + Math.random() * 28,
        color: 'rgba(55,48,46,0.55)',
        gravity: -10,
        drag: 1.5
      });
    }
    this._ring(x, y, scale);
  }

  _ring(x, y, scale = 1) {
    this._add({
      type: 'shockwave',
      x,
      y,
      vx: 0,
      vy: 0,
      life: 0.55,
      maxLife: 0.55,
      size: 10 * scale,
      endSize: 120 * scale,
      color: 'rgba(255,210,140,0.7)',
      additive: true
    });
  }

  emitLanding(x, y) {
    this.emitDust(x, y, 2.4, { power: 1.8 });
    this._ring(x, y - 6, 0.7);
  }

  emitPickup(x, y, color = '#9ef7ff') {
    const count = Math.round(14 * this.density);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + Math.random() * 0.3;
      const sp = 30 + Math.random() * 110;
      this._add({
        type: 'spark',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.35 + Math.random() * 0.4,
        maxLife: 0.75,
        size: 1 + Math.random() * 2.4,
        color,
        additive: true,
        drag: 2.2,
        gravity: -30
      });
    }
  }

  emitDamage(x, y, color = '#ff8a5c') {
    for (let i = 0; i < Math.round(8 * this.density); i++) {
      const a = Math.random() * TAU;
      const sp = 50 + Math.random() * 120;
      this._add({
        type: 'spark',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.25 + Math.random() * 0.35,
        maxLife: 0.6,
        size: 1.4 + Math.random() * 2,
        color,
        additive: true,
        gravity: 120,
        drag: 1.4
      });
    }
  }

  emitShieldHit(x, y) {
    for (let i = 0; i < Math.round(16 * this.density); i++) {
      const a = Math.random() * TAU;
      this._add({
        type: 'hex',
        x: x + Math.cos(a) * 28,
        y: y + Math.sin(a) * 28,
        vx: Math.cos(a) * 80,
        vy: Math.sin(a) * 80,
        life: 0.3 + Math.random() * 0.5,
        maxLife: 0.8,
        size: 2 + Math.random() * 5,
        color: '#8ef4ff',
        additive: true,
        drag: 1.6
      });
    }
  }

  emitSmoke(x, y) {
    this._add({
      type: 'smoke',
      x: x + (Math.random() - 0.5) * 18,
      y: y - 8 + (Math.random() - 0.5) * 8,
      vx: -20 - Math.random() * 25,
      vy: -15 - Math.random() * 25,
      life: 0.6 + Math.random() * 0.8,
      maxLife: 1.4,
      size: 5 + Math.random() * 9,
      color: 'rgba(60,54,54,0.45)',
      gravity: -20,
      drag: 1.1
    });
  }

  emitTrailMote(x, y) {
    this._add({
      type: 'mote',
      x,
      y,
      vx: -20 - Math.random() * 25,
      vy: (Math.random() - 0.5) * 10,
      life: 0.35 + Math.random() * 0.3,
      maxLife: 0.65,
      size: 1 + Math.random() * 2,
      color: 'rgba(160,245,255,0.6)',
      additive: true,
      drag: 1.5
    });
  }

  draw(ctx, camera, scale) {
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      const sx = (p.x - camera.x) * scale;
      const sy = (p.y - camera.y) * scale;
      if (sx < -60 || sy < -60 || sx > camera.w * scale + 60 || sy > camera.h * scale + 60) continue;
      ctx.save();
      if (p.additive) ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * (p.alpha == null ? 1 : p.alpha);
      if (p.type === 'shockwave') {
        const t = 1 - alpha;
        const r = p.size + (p.endSize - p.size) * t;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, 4 * alpha) ;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(1, r * scale), 0, TAU);
        ctx.stroke();
      } else if (p.type === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, p.size * scale * 0.8);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - (p.vx * 0.018) * scale, sy - (p.vy * 0.018) * scale);
        ctx.stroke();
      } else if (p.type === 'hex') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.2;
        hexPath(ctx, sx, sy, p.size * scale, p.rot || 0);
        ctx.stroke();
      } else if (p.type === 'debris') {
        ctx.translate(sx, sy);
        ctx.rotate(p.rot || 0);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size * scale * 0.5, -p.size * scale * 0.3, p.size * scale, p.size * scale * 0.6);
      } else if (p.type === 'exhaust') {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, p.size * scale * 2.2);
        g.addColorStop(0, p.color);
        g.addColorStop(1, 'rgba(80,230,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, p.size * scale * 2.2, 0, TAU);
        ctx.fill();
      } else if (p.type === 'smoke' || p.type === 'dust') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(sx, sy, p.size * scale * (p.type === 'smoke' ? 1.1 : 1), 0, TAU);
        ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(0.5, p.size * scale), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

function hexPath(ctx, x, y, r, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rot + (i / 6) * TAU;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
