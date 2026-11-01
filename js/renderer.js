/* Canvas 2D renderer: camera, parallax sky, deterministic terrain, entities,
   particles and cockpit screen effects. All scenery is generated in code. */
'use strict';

import { TAU, clamp, damp, hashInt, noise1, fbm1, RNG, wrap } from './utils.js';
import {
  drawSpacecraft,
  drawStation,
  drawItem,
  drawDrone,
  drawSentry,
  drawProjectile,
  drawDebris,
  drawLandmark,
  drawBoulder,
  drawCaveCrystal,
  drawStalagmite,
  glow,
  roundRect
} from './art.js';

const STAR_COUNT = 180;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.cssW = 1;
    this.cssH = 1;
    this.portrait = false;
    this.quality = 'auto';
    this.adaptiveLow = false;
    this.time = 0;
    this.cam = { x: 0, y: 0, w: 1000, h: 650, scale: 1, shakeX: 0, shakeY: 0 };
    this.stars = [];
    this._initStars();
    this.resize();
  }

  _initStars() {
    const rng = new RNG(0x51a7b33);
    for (let i = 0; i < STAR_COUNT; i++) {
      this.stars.push({
        x: rng.next(),
        y: rng.next(),
        r: rng.range(0.25, 1.55),
        a: rng.range(0.24, 0.92),
        phase: rng.range(0, TAU),
        speed: rng.range(0.4, 1.7),
        warm: rng.next() < 0.13
      });
    }
  }

  setQuality(q) {
    this.quality = q;
    this.resize();
  }

  setAdaptiveLow(v) {
    if (this.adaptiveLow === v) return;
    this.adaptiveLow = v;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cw = Math.max(1, rect.width || window.innerWidth || 1);
    const ch = Math.max(1, rect.height || window.innerHeight || 1);
    this.cssW = cw;
    this.cssH = ch;
    this.portrait = ch > cw * 1.08;
    let maxDpr = 2;
    if (this.quality === 'low' || this.adaptiveLow) maxDpr = 1.25;
    this.dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const bw = Math.round(cw * this.dpr);
    const bh = Math.round(ch * this.dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    const viewW = this.portrait
      ? clamp(cw * 1.65, 590, 780)
      : clamp(cw * 0.96, 880, 1280);
    const scale = cw / viewW;
    this.cam.w = viewW;
    this.cam.h = ch / scale;
    this.cam.scale = scale;
    this.ctx.imageSmoothingEnabled = true;
  }

  worldToScreen(x, y, withShake = true) {
    const sx = (x - this.cam.x) * this.cam.scale + (withShake ? this.cam.shakeX : 0);
    const sy = (y - this.cam.y) * this.cam.scale + (withShake ? this.cam.shakeY : 0);
    return [sx, sy];
  }

  updateCamera(game, dt, snap = false) {
    const cam = this.cam;
    const player = game.player;
    let tx = cam.x;
    let ty = cam.y;
    let lambda = 5.2;

    if (game.state === 'menu') {
      tx = 280 + ((game.elapsed * 11) % 2600);
      ty = 590 - cam.h * 0.6;
      lambda = 1.2;
    } else if (game.state === 'station' || game.state === 'settings') {
      const station = game.station || game.pendingStation;
      if (station) {
        tx = station.x - cam.w * 0.5;
        ty = station.y - cam.h * 0.56;
        lambda = 3.2;
      }
    } else if (game.state === 'crashing' || game.state === 'gameover' || game.state === 'paused') {
      if (game.crashCamera && player) {
        tx = game.crashCamera.x - cam.w * 0.5;
        ty = game.crashCamera.y - cam.h * 0.5;
      }
      lambda = 2.5;
    } else if (player) {
      tx = player.x - cam.w * (this.portrait ? 0.34 : 0.33);
      ty = player.y - cam.h * (this.portrait ? 0.48 : 0.47);
      tx += clamp(player.vx * 0.12, 0, 28);
      lambda = 5.8;
    }

    if (snap) {
      cam.x = tx;
      cam.y = ty;
    } else {
      cam.x = damp(cam.x, tx, lambda, dt);
      cam.y = damp(cam.y, ty, lambda * 0.9, dt);
    }

    if (game.state === 'menu') {
      // Keep the cinematic backdrop inside generated terrain.
      if (game.world) game.world.ensureAhead(cam.x + cam.w * 1.2, 3000);
    }

    const shakeAmp = game.shakeAmp || 0;
    if (shakeAmp > 0.1 && !game.reducedShake) {
      cam.shakeX = (Math.random() * 2 - 1) * shakeAmp;
      cam.shakeY = (Math.random() * 2 - 1) * shakeAmp * 0.7;
    } else {
      cam.shakeX = 0;
      cam.shakeY = 0;
    }
  }

  snapCamera(game) {
    this.updateCamera(game, 1, true);
  }

  _screen() {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  _world() {
    const { ctx, cam } = this;
    const s = cam.scale * this.dpr;
    ctx.setTransform(
      s,
      0,
      0,
      s,
      (cam.shakeX - cam.x * cam.scale) * this.dpr,
      (cam.shakeY - cam.y * cam.scale) * this.dpr
    );
  }

  render(game) {
    this.time = game.elapsed;
    const { ctx } = this;
    this._screen();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.drawSky(game);
    this.drawStars(game);
    this.drawEarth(game);
    this.drawParallax(game);

    this._world();
    this.drawTerrain(game);
    this.drawLandmarks(game);
    this.drawStations(game);
    this.drawBoulders(game);
    this.drawCaveDetails(game);
    this.drawItems(game);
    this.drawEnemies(game);
    this.drawProjectiles(game);
    this.drawFallingDebris(game);
    this.drawPlayer(game);
    if (game.state === 'menu') this.drawMenuCraft(game);

    this._screen();
    game.particles.draw(ctx, this.cam, this.cam.scale);
    this.drawMist(game);
    this.drawScreenEffects(game);
  }

  /* ---------------------------------------------------------------- SKY */

  drawSky(game) {
    const { ctx } = this;
    const w = this.cssW;
    const h = this.cssH;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#03040b');
    g.addColorStop(0.38, '#090a18');
    g.addColorStop(0.72, '#171224');
    g.addColorStop(1, '#2a1e2c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Faint nebula fields.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const n1 = ctx.createRadialGradient(w * 0.18, h * 0.3, 0, w * 0.18, h * 0.3, w * 0.5);
    n1.addColorStop(0, 'rgba(58,42,92,0.23)');
    n1.addColorStop(0.6, 'rgba(31,34,74,0.08)');
    n1.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = n1;
    ctx.fillRect(0, 0, w, h);
    const n2 = ctx.createRadialGradient(w * 0.82, h * 0.18, 0, w * 0.82, h * 0.18, w * 0.38);
    n2.addColorStop(0, 'rgba(33,79,103,0.12)');
    n2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = n2;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  drawStars(game) {
    const { ctx } = this;
    const w = this.cssW;
    const h = this.cssH;
    const t = this.time;
    const drift = this.cam.x * 0.02;
    for (const star of this.stars) {
      const sx = wrap(star.x * w - drift, 0, w);
      const sy = star.y * h * 0.8;
      const tw = 0.7 + 0.3 * Math.sin(t * star.speed + star.phase);
      ctx.globalAlpha = star.a * tw;
      ctx.fillStyle = star.warm ? '#ffd9b0' : '#dcecff';
      const r = star.r * (this.dpr > 1.5 ? 1.15 : 1);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, TAU);
      ctx.fill();
      if (star.r > 1.15) {
        ctx.globalAlpha *= 0.3;
        ctx.fillRect(sx - r * 3, sy - 0.4, r * 6, 0.8);
      }
    }
    ctx.globalAlpha = 1;

    // Shooting star, rare.
    const cycle = t % 18;
    if (cycle < 1.2) {
      const k = cycle / 1.2;
      const sx = w * (0.16 + k * 0.35);
      const sy = h * (0.14 + k * 0.09);
      ctx.strokeStyle = `rgba(214,240,255,${(1 - k) * 0.55})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - 55 * (1 - k * 0.6), sy - 22 * (1 - k * 0.6));
      ctx.stroke();
    }
  }

  drawEarth(game) {
    const { ctx } = this;
    const w = this.cssW;
    const h = this.cssH;
    const horizonY = this._horizonScreenY();
    const r = clamp(Math.min(w, h) * 0.065, 30, 76);
    const x = w * 0.77 - Math.sin(this.time * 0.012) * 8;
    const y = Math.max(r + 28, horizonY * 0.25);
    if (y - r > h) return;
    ctx.save();
    // Halo.
    ctx.globalCompositeOperation = 'screen';
    const halo = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.5);
    halo.addColorStop(0, 'rgba(115,180,255,0.2)');
    halo.addColorStop(1, 'rgba(115,180,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.5, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.clip();
    const ocean = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
    ocean.addColorStop(0, '#6da7d7');
    ocean.addColorStop(0.45, '#2f679b');
    ocean.addColorStop(1, '#122d54');
    ctx.fillStyle = ocean;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    // Cloud bands.
    ctx.fillStyle = 'rgba(232,245,250,0.5)';
    for (let i = 0; i < 4; i++) {
      const cy = y - r * 0.45 + i * r * 0.3;
      ctx.beginPath();
      ctx.ellipse(x - r * 0.1 + Math.sin(i * 2.1) * r * 0.3, cy, r * (0.6 + i * 0.08), r * 0.07, -0.2, 0, TAU);
      ctx.fill();
    }
    // Land shapes.
    ctx.fillStyle = 'rgba(101,143,104,0.65)';
    ctx.beginPath();
    ctx.moveTo(x - r, y + r * 0.1);
    ctx.bezierCurveTo(x - r * 0.7, y + r * 0.55, x - r * 0.4, y + r * 0.2, x - r * 0.2, y + r * 0.45);
    ctx.bezierCurveTo(x - r * 0.05, y + r * 0.2, x - r * 0.1, y - r * 0.1, x + r * 0.1, y - r * 0.2);
    ctx.lineTo(x + r * 0.35, y + r * 0.05);
    ctx.lineTo(x + r * 0.1, y + r * 0.3);
    ctx.lineTo(x - r * 0.15, y + r * 0.5);
    ctx.lineTo(x - r, y + r * 0.8);
    ctx.closePath();
    ctx.fill();
    // Night terminator.
    const shade = ctx.createLinearGradient(x + r * 0.15, y, x + r, y);
    shade.addColorStop(0, 'rgba(2,6,18,0)');
    shade.addColorStop(0.65, 'rgba(2,6,18,0.5)');
    shade.addColorStop(1, 'rgba(2,6,18,0.92)');
    ctx.fillStyle = shade;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
    // Rim light.
    ctx.strokeStyle = 'rgba(165,220,255,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, r - 0.5, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  _horizonScreenY() {
    return (612 - this.cam.y) * this.cam.scale + this.cam.shakeY;
  }

  drawParallax(game) {
    const { ctx } = this;
    const w = this.cssW;
    const h = this.cssH;
    const horizon = clamp(this._horizonScreenY(), -h, h * 1.2);
    const t = this.time;
    ctx.save();
    // Atmospheric glow at horizon.
    const haze = ctx.createLinearGradient(0, horizon - h * 0.35, 0, horizon + 40);
    haze.addColorStop(0, 'rgba(72,57,91,0)');
    haze.addColorStop(0.72, 'rgba(103,79,112,0.08)');
    haze.addColorStop(1, 'rgba(145,112,134,0.14)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, Math.max(0, horizon - h * 0.35), w, h * 0.35 + 40);
    ctx.restore();

    const layers = [
      { factor: 0.06, amp: 145, base: 22, color: '#15131d', seed: 771, freq: 0.0022, step: 30 },
      { factor: 0.14, amp: 100, base: 30, color: '#201b27', seed: 991, freq: 0.0033, step: 24 },
      { factor: 0.27, amp: 72, base: 40, color: '#2b2430', seed: 1331, freq: 0.0051, step: 20 }
    ];
    for (const layer of layers) {
      ctx.beginPath();
      ctx.moveTo(-20, h + 10);
      for (let sx = -20; sx <= w + 30; sx += layer.step) {
        const worldX = sx / this.cam.scale + this.cam.x * layer.factor;
        const n = fbm1(layer.seed, worldX * layer.freq, 3);
        const craters = Math.max(0, noise1(layer.seed + 70, worldX * layer.freq * 3.1) - 0.55);
        const ridge = horizon - layer.base - (0.45 + n * 0.5) * layer.amp * this.cam.scale;
        ctx.lineTo(sx + this.cam.shakeX * layer.factor, ridge);
      }
      ctx.lineTo(w + 30, h + 10);
      ctx.closePath();
      ctx.fillStyle = layer.color;
      ctx.fill();
      // Light rim on the peaks.
      ctx.strokeStyle = layer === layers[2] ? 'rgba(174,154,176,0.16)' : 'rgba(132,120,158,0.09)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Slow drifting foreground haze bands.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 2; i++) {
      const bx = ((t * (3 + i * 2) + i * 380) % (w + 500)) - 250;
      const by = horizon - 40 - i * 45;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, w * 0.45);
      g.addColorStop(0, i === 0 ? 'rgba(137,112,149,0.055)' : 'rgba(96,132,146,0.04)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------- TERRAIN */

  _visiblePads(world) {
    const cam = this.cam;
    return world.stations.filter(
      (s) => s && s.x > cam.x - 500 && s.x < cam.x + cam.w + 500
    );
  }

  drawTerrain(game) {
    const { ctx, cam } = this;
    const world = game.world;
    if (!world) return;
    const from = cam.x - 160;
    const to = cam.x + cam.w + 160;
    world.ensureAhead(to, 1200);

    for (const sector of world.sectors) {
      if (sector.endX < from || sector.startX > to) continue;
      this.drawSectorGround(game, sector, from, to);
    }
    for (const sector of world.sectors) {
      if (sector.endX < from || sector.startX > to) continue;
      this.drawSectorCeiling(game, sector, from, to);
    }
  }

  _groundPoints(sector, from, to) {
    const pts = [];
    const start = Math.max(sector.startX, from);
    const end = Math.min(sector.endX, to);
    if (end <= start) return pts;
    const step = 10;
    for (let x = start; x <= end + step; x += step) {
      const xx = Math.min(end, x);
      const idx = clamp((xx - sector.startX) / sector.step, 0, sector.ground.length - 1);
      const i = Math.floor(idx);
      const j = Math.min(sector.ground.length - 1, i + 1);
      const y = sector.ground[i] + (sector.ground[j] - sector.ground[i]) * (idx - i);
      pts.push([xx, y]);
    }
    return pts;
  }

  drawSectorGround(game, sector, from, to) {
    const { ctx, cam } = this;
    const pts = this._groundPoints(sector, from, to);
    if (!pts.length) return;
    const bottom = cam.y + cam.h + 250;
    const path = new Path2D();
    path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
    path.lineTo(pts[pts.length - 1][0], bottom);
    path.lineTo(pts[0][0], bottom);
    path.closePath();

    const tint = (sector.index * 7) % 3;
    const grad = ctx.createLinearGradient(0, cam.y + cam.h * 0.25, 0, bottom);
    if (tint === 0) {
      grad.addColorStop(0, '#c8c1b2');
      grad.addColorStop(0.18, '#9b9489');
      grad.addColorStop(0.55, '#696460');
      grad.addColorStop(1, '#25242a');
    } else if (tint === 1) {
      grad.addColorStop(0, '#c3beb3');
      grad.addColorStop(0.2, '#918c85');
      grad.addColorStop(0.58, '#615e5d');
      grad.addColorStop(1, '#222227');
    } else {
      grad.addColorStop(0, '#cec6b7');
      grad.addColorStop(0.2, '#a19a8c');
      grad.addColorStop(0.6, '#6a635e');
      grad.addColorStop(1, '#27252a');
    }
    ctx.fillStyle = grad;
    ctx.fill(path);

    // Bright regolith lip and shadowed underside.
    ctx.save();
    ctx.strokeStyle = 'rgba(242,235,218,0.72)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
    ctx.strokeStyle = 'rgba(38,34,35,0.5)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y + 4) : ctx.lineTo(x, y + 4)));
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.clip(path);
    // Strata.
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = `rgba(35,31,34,${0.15 - k * 0.03})`;
      ctx.lineWidth = 2 + k;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < pts.length; i += 2) {
        const [x, y] = pts[i];
        const yy = y + 38 + k * 48 + Math.sin(x * 0.014 + k * 2 + sector.index) * 8;
        if (!started) {
          ctx.moveTo(x, yy);
          started = true;
        } else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    // Crater shading.
    for (const crater of sector.craters) {
      if (crater.x < from - crater.rx || crater.x > to + crater.rx) continue;
      const gy = this._sampleGround(sector, crater.x);
      ctx.fillStyle = 'rgba(27,24,27,0.25)';
      ctx.beginPath();
      ctx.ellipse(crater.x, gy + crater.ry * 0.35, crater.rx * 0.96, crater.ry, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(228,220,203,0.22)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(crater.x, gy + crater.ry * 0.25, crater.rx * 0.98, crater.ry, 0, Math.PI, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(20,18,20,0.16)';
      ctx.beginPath();
      ctx.ellipse(crater.x + crater.rx * 0.3, gy + crater.ry * 0.65, crater.rx * 0.55, crater.ry * 0.5, 0, 0, TAU);
      ctx.fill();
    }
    // Regolith pebbles.
    for (const p of sector.pebbles) {
      if (p.x < from - 10 || p.x > to + 10) continue;
      ctx.globalAlpha = p.a;
      ctx.fillStyle = p.shade === 0 ? '#3f3b3b' : p.shade === 1 ? '#d4ccbb' : '#77716a';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 1.5, p.r, p.r * 0.55, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Fine dust bands.
    ctx.fillStyle = 'rgba(218,210,194,0.06)';
    for (let i = 0; i < pts.length - 1; i += 3) {
      const [x, y] = pts[i];
      ctx.beginPath();
      ctx.ellipse(x, y + 5, 24 + (i % 5) * 5, 2, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // Ground glow near stations.
    for (const station of this._visibleStationsNear(game, sector)) {
      const g = ctx.createRadialGradient(station.x, station.y, 0, station.x, station.y, 230);
      g.addColorStop(0, 'rgba(102,235,225,0.12)');
      g.addColorStop(1, 'rgba(102,235,225,0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.fillRect(station.x - 230, station.y - 230, 460, 460);
      ctx.restore();
    }
  }

  _visibleStationsNear(game, sector) {
    return game.world.stations.filter(
      (s) => s && s.index > 0 && s.sector === sector.index
    );
  }

  _sampleGround(sector, x) {
    const t = clamp((x - sector.startX) / sector.step, 0, sector.ground.length - 1);
    const i = Math.floor(t);
    const j = Math.min(sector.ground.length - 1, i + 1);
    return sector.ground[i] + (sector.ground[j] - sector.ground[i]) * (t - i);
  }

  drawSectorCeiling(game, sector, from, to) {
    const { ctx, cam } = this;
    const start = Math.max(sector.startX, from);
    const end = Math.min(sector.endX, to);
    if (end <= start) return;

    const pts = [];
    const step = 12;
    for (let x = start; x <= end + step; x += step) {
      const xx = Math.min(end, x);
      const t = clamp((xx - sector.startX) / sector.step, 0, sector.ceiling.length - 1);
      const i = Math.floor(t);
      const j = Math.min(sector.ceiling.length - 1, i + 1);
      const y = sector.ceiling[i] + (sector.ceiling[j] - sector.ceiling[i]) * (t - i);
      const gy = sector.ground[Math.min(i, sector.ground.length - 1)];
      pts.push({ x: xx, y, active: gy - y < 1100 && y < cam.y + cam.h + 120 });
    }

    // Draw only the runs where the cave ceiling is actually present.
    let runStart = -1;
    const flush = (upTo) => {
      if (runStart < 0) return;
      this._drawCeilingRun(sector, pts, runStart, upTo);
      runStart = -1;
    };
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].active && runStart < 0) runStart = i;
      if (!pts[i].active && runStart >= 0) flush(i);
    }
    flush(pts.length - 1);

    // Cave crystal clusters on the ceiling.
    for (const cave of sector.caveRanges) {
      const cs = Math.max(cave.start + 80, start);
      const ce = Math.min(cave.end - 50, end);
      if (ce <= cs) continue;
      for (let x = Math.floor(cs / 220) * 220; x < ce; x += 220) {
        if (x < cs) continue;
        const h = hashInt(sector.seed, Math.floor(x / 13));
        if (h < 0.4) continue;
        const idx = clamp(Math.round((x - sector.startX) / sector.step), 0, sector.ceiling.length - 1);
        const y = sector.ceiling[idx];
        if (y < cam.y - 40 || y > cam.y + cam.h + 40) continue;
        if (this.quality !== 'low' && !this.adaptiveLow) {
          ctx.save();
          ctx.translate(x, y - 2);
          ctx.scale(1, -1);
          drawCaveCrystal(ctx, 0, 0, 3.5 + h * 5, this.time, Math.floor(x) % 4 === 0 ? 1 : 0);
          ctx.restore();
        }
      }
    }
  }

  _drawCeilingRun(sector, pts, fromIndex, toIndex) {
    const { ctx, cam } = this;
    const lo = Math.max(0, fromIndex - 2);
    const hi = Math.min(pts.length - 1, toIndex + 2);
    if (hi <= lo) return;
    // Ensure visible top edges exist beyond the active run.
    const runPts = [];
    for (let i = lo; i <= hi; i++) {
      runPts.push([pts[i].x, Math.max(pts[i].y, cam.y - 30)]);
    }
    if (runPts.length < 2) return;
    const top = cam.y - 120;
    const path = new Path2D();
    path.moveTo(runPts[0][0], top);
    for (const [x, y] of runPts) path.lineTo(x, y);
    path.lineTo(runPts[runPts.length - 1][0], top);
    path.closePath();

    const grad = ctx.createLinearGradient(0, cam.y - 20, 0, cam.y + cam.h);
    grad.addColorStop(0, '#0c0a11');
    grad.addColorStop(0.36, '#211c26');
    grad.addColorStop(0.72, '#453c48');
    grad.addColorStop(1, '#211d27');
    ctx.fillStyle = grad;
    ctx.fill(path);

    ctx.save();
    ctx.clip(path);
    for (let k = 0; k < 4; k++) {
      ctx.strokeStyle = `rgba(7,6,10,${0.28 - k * 0.04})`;
      ctx.lineWidth = 3 + k * 2;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < runPts.length; i += 3) {
        const [x, y] = runPts[i];
        const yy = y - 18 - k * 30 + Math.sin(x * 0.009 + k * 1.8 + sector.index) * 10;
        if (!started) {
          ctx.moveTo(x, yy);
          started = true;
        } else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    const refl = ctx.createLinearGradient(0, cam.y + cam.h * 0.55, 0, cam.y + cam.h);
    refl.addColorStop(0, 'rgba(155,132,120,0)');
    refl.addColorStop(1, 'rgba(155,132,120,0.08)');
    ctx.fillStyle = refl;
    ctx.fillRect(cam.x, cam.y, cam.w, cam.h);
    ctx.restore();

    // Jagged rim highlight.
    ctx.strokeStyle = 'rgba(212,196,207,0.36)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    runPts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
  }

  drawCaveDetails(game) {
    const { ctx, cam } = this;
    const world = game.world;
    const t = this.time;
    for (const sector of world.sectors) {
      if (sector.endX < cam.x - 200 || sector.startX > cam.x + cam.w + 200) continue;
      // Stalagmites.
      if (sector.stalagmites) {
        for (const sg of sector.stalagmites) {
          if (sg.x < cam.x - 80 || sg.x > cam.x + cam.w + 80) continue;
          drawStalagmite(ctx, sg, t);
        }
      }
      // Floor crystals and cave dust motes.
      for (const cave of sector.caveRanges) {
        for (let x = cave.start + 130; x < cave.end - 40; x += 310) {
          if (x < cam.x - 60 || x > cam.x + cam.w + 60) continue;
          const gy = this._sampleGround(sector, x);
          const h = hashInt(sector.seed + 5, Math.floor(x / 17));
          if (h < 0.35) continue;
          drawCaveCrystal(ctx, x, gy - 1, 3 + h * 6, t, 1);
          if (h > 0.7) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            const p = 0.5 + 0.5 * Math.sin(t * 1.3 + x);
            ctx.fillStyle = `rgba(237,196,255,${0.18 + p * 0.12})`;
            ctx.beginPath();
            ctx.arc(x + 14, gy - 36 - Math.sin(t * 0.7 + x) * 8, 1.3, 0, TAU);
            ctx.fill();
            ctx.restore();
          }
        }
      }
    }
  }

  drawStations(game) {
    const { ctx, cam } = this;
    const t = this.time;
    const pads = this._visiblePads(game.world);
    for (const station of pads) {
      if (!station) continue;
      const player = game.player;
      const near = player ? Math.abs(player.x - station.x) < 760 : false;
      drawStation(ctx, station, t, { playerNear: near });
    }
  }

  drawLandmarks(game) {
    const { ctx, cam } = this;
    for (const sector of game.world.sectors) {
      if (sector.endX < cam.x - 400 || sector.startX > cam.x + cam.w + 400) continue;
      if (sector.landmark) {
        if (sector.landmark.x < cam.x - 220 || sector.landmark.x > cam.x + cam.w + 220) continue;
        drawLandmark(ctx, sector.landmark, this.time);
      }
    }
  }

  drawBoulders(game) {
    const { ctx, cam } = this;
    for (const sector of game.world.sectors) {
      if (sector.endX < cam.x - 150 || sector.startX > cam.x + cam.w + 150) continue;
      for (const boulder of sector.boulders) {
        if (boulder.x < cam.x - 100 || boulder.x > cam.x + cam.w + 100) continue;
        drawBoulder(ctx, boulder, this.time);
      }
    }
  }

  drawItems(game) {
    const { ctx, cam } = this;
    for (const sector of game.world.sectors) {
      if (sector.endX < cam.x - 150 || sector.startX > cam.x + cam.w + 150) continue;
      for (const item of sector.items) {
        if (item.x < cam.x - 60 || item.x > cam.x + cam.w + 60) continue;
        if (game.isCollected(item.id)) continue;
        drawItem(ctx, item, this.time);
      }
    }
  }

  drawEnemies(game) {
    const { ctx, cam } = this;
    const player = game.player;
    for (const sector of game.world.sectors) {
      if (sector.endX < cam.x - 200 || sector.startX > cam.x + cam.w + 200) continue;
      for (const drone of sector.drones) {
        if (drone.x < cam.x - 80 || drone.x > cam.x + cam.w + 80) continue;
        drawDrone(ctx, drone, this.time, player);
      }
      for (const sentry of sector.sentries) {
        if (sentry.x < cam.x - 80 || sentry.x > cam.x + cam.w + 80) continue;
        drawSentry(ctx, sentry, this.time, player);
      }
    }
  }

  drawProjectiles(game) {
    for (const orb of game.projectiles) drawProjectile(this.ctx, orb, this.time);
  }

  drawFallingDebris(game) {
    for (const debris of game.debris) drawDebris(this.ctx, debris, this.time);
  }

  drawPlayer(game) {
    const { ctx } = this;
    const player = game.player;
    if (!player || !player.alive) return;
    const t = this.time;

    // Contact shadow on the regolith.
    const groundY = game.world.groundAt(player.x);
    const altitude = groundY - player.y;
    if (altitude > -20 && altitude < 900) {
      const alpha = clamp(1 - altitude / 900, 0.06, 0.3);
      const spread = clamp(42 + altitude * 0.06, 32, 88);
      ctx.save();
      const g = ctx.createRadialGradient(player.x, groundY - 2, 0, player.x, groundY - 2, spread);
      g.addColorStop(0, `rgba(8,7,10,${alpha})`);
      g.addColorStop(1, 'rgba(8,7,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(player.x, groundY - 1, spread, spread * 0.22, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    drawSpacecraft(ctx, player.x, player.y, {
      time: t,
      thrusting: player.thrusting,
      tilt: player.tilt,
      engineHeat: player.engineHeat,
      upgrades: player.upgrades,
      healthRatio: player.healthRatio,
      shieldRatio: player.shieldRatio,
      invuln: player.invuln,
      shieldFlash: player.shieldFlash
    });
  }

  drawMenuCraft(game) {
    const { ctx } = this;
    const x = this.cam.x + this.cam.w * 0.72;
    const gy = game.world.groundAt(x);
    if (!Number.isFinite(gy)) return;
    const y = gy - 144 + Math.sin(this.time * 1.4) * 5;
    // Thin light beam from the lander's windows.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(x, y - 18, x + 340, y + 100);
    g.addColorStop(0, 'rgba(141,240,255,0.08)');
    g.addColorStop(1, 'rgba(141,240,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x + 8, y - 20);
    ctx.lineTo(x + 380, y + 130);
    ctx.lineTo(x + 320, y + 190);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    drawSpacecraft(ctx, x, y, {
      time: this.time,
      thrusting: false,
      tilt: Math.sin(this.time * 0.6) * 0.025,
      engineHeat: 0.06,
      upgrades: { engine: 1, shield: 1, hull: 1, fuel: 1 },
      healthRatio: 1,
      shieldRatio: 0.8,
      invuln: 0,
      shieldFlash: 0
    });
  }

  drawMist(game) {
    const { ctx } = this;
    const h = this.cssH;
    const w = this.cssW;
    const horizon = this._horizonScreenY();
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 3; i++) {
      const x = ((this.time * (5 + i * 3) + i * 370) % (w + 600)) - 300;
      const y = horizon + 16 + i * 14;
      const g = ctx.createRadialGradient(x, y, 0, x, y, w * 0.35);
      g.addColorStop(0, 'rgba(174,169,195,0.045)');
      g.addColorStop(1, 'rgba(174,169,195,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y - h * 0.18, w, h * 0.3);
    }
    ctx.restore();
  }

  drawScreenEffects(game) {
    const { ctx } = this;
    const w = this.cssW;
    const h = this.cssH;

    // Cave darkness around the lander.
    if (game.player && (game.state === 'playing' || game.state === 'landing' || game.state === 'paused')) {
      const ceiling = game.world.ceilingAt(game.player.x);
      const ground = game.world.groundAt(game.player.x);
      if (ground - ceiling < 950) {
        const [sx, sy] = this.worldToScreen(game.player.x, game.player.y);
        const radius = Math.max(w, h) * 0.52;
        const dark = ctx.createRadialGradient(sx, sy, radius * 0.12, sx, sy, radius);
        dark.addColorStop(0, 'rgba(4,4,10,0)');
        dark.addColorStop(0.55, 'rgba(4,4,10,0.08)');
        dark.addColorStop(0.82, 'rgba(3,3,8,0.34)');
        dark.addColorStop(1, 'rgba(2,2,6,0.62)');
        ctx.fillStyle = dark;
        ctx.fillRect(0, 0, w, h);
        // A soft headlamp pool.
        const lamp = ctx.createRadialGradient(sx, sy, 0, sx, sy, 190);
        lamp.addColorStop(0, 'rgba(160,241,255,0.055)');
        lamp.addColorStop(1, 'rgba(160,241,255,0)');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = lamp;
        ctx.fillRect(sx - 200, sy - 200, 400, 400);
        ctx.restore();
      }
    }

    // Global vignette.
    const v = ctx.createRadialGradient(w * 0.5, h * 0.48, Math.min(w, h) * 0.28, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.72, 'rgba(0,0,0,0.1)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);

    if (game.player) {
      const p = game.player;
      // Shield hit flash.
      if (p.shieldFlash > 0.02) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = `rgba(104,240,255,${p.shieldFlash * 0.1})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
      // Damage flash.
      if (p.damageFlash > 0.02) {
        const a = p.damageFlash * 0.28;
        const d = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.72);
        d.addColorStop(0, 'rgba(255,48,28,0)');
        d.addColorStop(0.7, `rgba(255,48,28,${a * 0.45})`);
        d.addColorStop(1, `rgba(255,26,10,${a})`);
        ctx.fillStyle = d;
        ctx.fillRect(0, 0, w, h);
      }
      // Critical health warning.
      if (p.healthRatio < 0.3 && game.state !== 'gameover' && game.state !== 'crashing') {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 5.5);
        const a = (0.06 + pulse * 0.09) * (1 - p.healthRatio / 0.3);
        const d = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
        d.addColorStop(0, 'rgba(255,28,20,0)');
        d.addColorStop(1, `rgba(255,28,20,${a + 0.08})`);
        ctx.fillStyle = d;
        ctx.fillRect(0, 0, w, h);
      }
    }

    // Crash flash / fade.
    if (game.state === 'crashing') {
      const k = clamp(game.crashTimer / 2.6, 0, 1);
      if (k < 0.22) {
        ctx.fillStyle = `rgba(255,219,177,${(1 - k / 0.22) * 0.5})`;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.fillStyle = `rgba(17,4,8,${clamp((k - 0.5) * 0.35, 0, 0.35)})`;
      ctx.fillRect(0, 0, w, h);
    }

    // Menu dim + cinematic letterbox.
    if (game.state === 'menu') {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, 'rgba(3,5,10,0.88)');
      g.addColorStop(0.56, 'rgba(3,5,10,0.55)');
      g.addColorStop(1, 'rgba(3,5,10,0.12)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, w, Math.max(0, h * 0.045));
      ctx.fillRect(0, h - Math.max(0, h * 0.045), w, Math.max(0, h * 0.045));
    }
  }
}
