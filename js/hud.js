/* Flight HUD + radar. DOM for crisp, accessible text; canvas for the scope. */
'use strict';

import { clamp, formatNumber, TAU } from './utils.js';

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('hud');
    this.el = {
      healthFill: document.getElementById('health-fill'),
      healthValue: document.getElementById('health-value'),
      shieldFill: document.getElementById('shield-fill'),
      shieldValue: document.getElementById('shield-value'),
      score: document.getElementById('score-value'),
      best: document.getElementById('best-value'),
      distance: document.getElementById('distance-value'),
      salvage: document.getElementById('salvage-value'),
      missionSector: document.getElementById('mission-sector'),
      missionName: document.getElementById('mission-name'),
      missionText: document.getElementById('mission-text'),
      missionProgress: document.getElementById('mission-progress-text'),
      missionTarget: document.getElementById('mission-target'),
      missionFill: document.getElementById('mission-progress-fill'),
      warning: document.getElementById('warning-banner'),
      warningText: document.getElementById('warning-text'),
      padName: document.getElementById('pad-name'),
      padDistance: document.getElementById('pad-distance'),
      padArrow: document.getElementById('pad-arrow'),
      radarRange: document.getElementById('radar-range'),
      radar: document.getElementById('radar'),
      toasts: document.getElementById('toasts'),
      hint: document.getElementById('control-hint'),
      vitalsHull: document.querySelector('.vital-hull'),
      vitalsShield: document.querySelector('.vital-shield'),
      pause: document.getElementById('btn-pause')
    };
    this.radarCtx = this.el.radar.getContext('2d');
    this.last = {};
    this.radarTimer = 0;
    this.radarDpr = 1;
    this.hintTimer = 0;
    this.el.pause.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      game.togglePause();
    });
    this.resizeRadar();
  }

  show() {
    this.root.classList.remove('hidden');
    this.el.hint.classList.remove('fade');
    this.hintTimer = 0;
  }

  hide() {
    this.root.classList.add('hidden');
  }

  resizeRadar() {
    const canvas = this.el.radar;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.radarDpr = dpr;
    const w = Math.max(140, rect.width || canvas.clientWidth || 240);
    const h = Math.max(55, rect.height || canvas.clientHeight || 92);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    this.radarW = w;
    this.radarH = h;
  }

  _set(key, el, text) {
    if (!el) return;
    if (this.last[key] === text) return;
    this.last[key] = text;
    el.textContent = text;
  }

  _setWidth(key, el, pct) {
    if (!el) return;
    const v = Math.round(pct * 10) / 10;
    if (this.last[key] === v) return;
    this.last[key] = v;
    el.style.width = `${v}%`;
  }

  update(dt) {
    const game = this.game;
    if (!game.player || this.root.classList.contains('hidden')) return;
    const p = game.player;

    const hp = clamp(p.healthRatio, 0, 1);
    const sh = clamp(p.shieldRatio, 0, 1);
    this._setWidth('hp', this.el.healthFill, hp * 100);
    this._setWidth('sh', this.el.shieldFill, sh * 100);
    this._set('hpv', this.el.healthValue, String(Math.ceil(hp * 100)));
    this._set('shv', this.el.shieldValue, String(Math.ceil(sh * 100)));
    this.el.vitalsHull.classList.toggle('critical', hp < 0.3);
    this.el.vitalsShield.classList.toggle('critical', sh < 0.12 && hp < 0.5);

    this._set('score', this.el.score, formatNumber(game.score));
    this._set('best', this.el.best, formatNumber(Math.max(game.save?.best || 0, game.score)));
    this._set('distance', this.el.distance, `${formatNumber(game.distance)} M`);
    this._set('salvage', this.el.salvage, formatNumber(game.save?.salvage || 0));

    const mission = game.currentMission;
    if (mission) {
      this._set('mSector', this.el.missionSector, String(mission.sector + 1).padStart(2, '0'));
      this._set('mName', this.el.missionName, mission.sectorName || 'LUNAR SURFACE');
      this._set('mText', this.el.missionText, mission.objective);
      const prog = game.getMissionProgress();
      this._set('mProg', this.el.missionProgress, `${Math.min(prog.count, prog.target)} / ${prog.target}`);
      const completed = prog.count >= prog.target;
      this._set('mTarget', this.el.missionTarget, completed ? 'OBJECTIVE READY — REACH PAD' : `REACH ${mission.stationName.toUpperCase()}`);
      if (this.last.mFill !== prog.ratio) {
        this.last.mFill = prog.ratio;
        this.el.missionFill.style.width = `${Math.round(prog.ratio * 100)}%`;
      }
    }

    const pad = game.nextPad;
    if (pad) {
      const meters = Math.max(0, (pad.x - p.x) / 8);
      this._set('padName', this.el.padName, `${pad.name.toUpperCase()}`);
      this._set('padDist', this.el.padDistance, `${formatNumber(meters)} M`);
      this._set('padArrow', this.el.padArrow, meters < 12 ? '◆' : '›');
      this._set('radarRange', this.el.radarRange, `${(meters / 1000).toFixed(2)} KM`);
    } else {
      this._set('padName', this.el.padName, 'NO CONTACT');
      this._set('padDist', this.el.padDistance, '—');
      this._set('radarRange', this.el.radarRange, '—');
    }

    const warning = game.getWarning();
    if (warning) {
      if (this.el.warning.classList.contains('hidden')) this.el.warning.classList.remove('hidden');
      this._set('warn', this.el.warningText, warning);
    } else if (!this.el.warning.classList.contains('hidden')) {
      this.el.warning.classList.add('hidden');
    }

    this.root.classList.toggle('critical', p.isCritical);

    this.hintTimer += dt;
    if (game.controlsHintSeen || this.hintTimer > 8) this.el.hint.classList.add('fade');

    this.radarTimer += dt;
    if (this.radarTimer > 0.07) {
      this.radarTimer = 0;
      this.drawRadar();
    }
  }

  drawRadar() {
    const game = this.game;
    const p = game.player;
    if (!p || !game.world) return;
    const canvas = this.el.radar;
    if (canvas.clientWidth > 0 && Math.abs(canvas.clientWidth - this.radarW) > 2) this.resizeRadar();
    const ctx = this.radarCtx;
    const dpr = this.radarDpr;
    const w = this.radarW;
    const h = this.radarH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const back = 900;
    const ahead = 2250;
    const span = back + ahead;
    const mapX = (x) => ((x - (p.x - back)) / span) * w;
    const centerY = p.y;
    const vertical = 560;
    const mapY = (y) => h * 0.5 + ((y - centerY) / vertical) * h * 0.5;

    // Grid.
    ctx.fillStyle = 'rgba(8, 24, 27, 0.48)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(112, 214, 203, 0.1)';
    ctx.lineWidth = 0.6;
    for (let i = 1; i < 6; i++) {
      const x = (i / 6) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let j = 1; j < 3; j++) {
      const y = (j / 3) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const startX = p.x - back;
    const endX = p.x + ahead;
    game.world.ensureAhead(endX, 200);

    // Ceiling band.
    ctx.fillStyle = 'rgba(92, 76, 98, 0.25)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    let started = false;
    for (let i = 0; i <= 70; i++) {
      const wx = startX + (i / 70) * span;
      const gy = game.world.groundAt(wx);
      const cy = game.world.ceilingAt(wx);
      const showCave = gy - cy < 700;
      const y = mapY(showCave ? cy : centerY - vertical);
      if (!started) {
        ctx.lineTo(0, y);
        started = true;
      } else ctx.lineTo((i / 70) * w, y);
    }
    ctx.lineTo(w, 0);
    ctx.closePath();
    ctx.fill();

    // Ground terrain. Clip to panel.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const wx = startX + (i / 80) * span;
      const gy = game.world.groundAt(wx);
      const x = (i / 80) * w;
      const y = mapY(gy);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(155, 148, 133, 0.28)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(193, 231, 219, 0.52)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const wx = startX + (i / 80) * span;
      const gy = game.world.groundAt(wx);
      const x = (i / 80) * w;
      const y = mapY(gy);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // Cave ceiling line where active.
    ctx.strokeStyle = 'rgba(164, 126, 173, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let drawing = false;
    for (let i = 0; i <= 70; i++) {
      const wx = startX + (i / 70) * span;
      const gy = game.world.groundAt(wx);
      const cy = game.world.ceilingAt(wx);
      const x = (i / 70) * w;
      if (gy - cy < 700) {
        const y = mapY(cy);
        if (!drawing) {
          ctx.moveTo(x, y);
          drawing = true;
        } else ctx.lineTo(x, y);
      } else {
        drawing = false;
      }
    }
    ctx.stroke();

    // Pickups.
    for (const sector of game.world.sectors) {
      if (sector.endX < startX - 200 || sector.startX > endX + 200) continue;
      for (const item of sector.items) {
        if (game.isCollected(item.id)) continue;
        if (item.x < startX || item.x > endX) continue;
        const x = mapX(item.x);
        const y = mapY(item.y);
        ctx.fillStyle = item.mission ? '#ffd47d' : item.type === 'astronaut' ? '#ffb36b' : '#76efe0';
        ctx.globalAlpha = item.mission ? 0.95 : 0.6;
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
      for (const drone of sector.drones) {
        if (drone.x < startX || drone.x > endX) continue;
        const x = clamp(mapX(drone.x), 2, w - 2);
        const y = clamp(mapY(drone.y), 2, h - 2);
        ctx.fillStyle = '#ff6b9f';
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, TAU);
        ctx.fill();
      }
      for (const sentry of sector.sentries) {
        if (sentry.x < startX || sentry.x > endX) continue;
        const x = clamp(mapX(sentry.x), 2, w - 2);
        const y = clamp(mapY(sentry.y), 2, h - 2);
        ctx.strokeStyle = '#ff856e';
        ctx.globalAlpha = 0.8;
        ctx.strokeRect(x - 1.4, y - 1.4, 2.8, 2.8);
      }
    }
    ctx.globalAlpha = 1;

    // Station/pad marker.
    const pad = game.nextPad;
    if (pad) {
      const rawX = mapX(pad.x);
      const x = clamp(rawX, 5, w - 5);
      const y = Math.max(8, mapY(pad.y - 40));
      const pulse = 0.5 + 0.5 * Math.sin(game.elapsed * 3);
      ctx.strokeStyle = `rgba(255, 196, 106, ${0.5 + pulse * 0.45})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x + 4, y);
      ctx.lineTo(x, y + 4);
      ctx.lineTo(x - 4, y);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = `rgba(255, 196, 106, ${0.2 + pulse * 0.3})`;
      ctx.fill();
      if (rawX > w - 5) {
        ctx.fillStyle = '#ffc46a';
        ctx.beginPath();
        ctx.moveTo(w - 2, h * 0.5 - 4);
        ctx.lineTo(w - 7, h * 0.5);
        ctx.lineTo(w - 2, h * 0.5 + 4);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Sweep.
    const sweep = ((game.elapsed * 0.32) % 1) * w;
    const sg = ctx.createLinearGradient(sweep - 20, 0, sweep, 0);
    sg.addColorStop(0, 'rgba(120, 247, 231, 0)');
    sg.addColorStop(1, 'rgba(120, 247, 231, 0.16)');
    ctx.fillStyle = sg;
    ctx.fillRect(Math.max(0, sweep - 20), 0, 20, h);
    ctx.strokeStyle = 'rgba(142, 253, 238, 0.35)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(sweep, 0);
    ctx.lineTo(sweep, h);
    ctx.stroke();

    // Player.
    const px = mapX(p.x);
    const py = mapY(p.y);
    ctx.save();
    ctx.translate(px, py);
    ctx.fillStyle = '#dbfff9';
    ctx.shadowColor = '#8af6e7';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, -4);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Edge fade.
    const edge = ctx.createLinearGradient(0, 0, w, 0);
    edge.addColorStop(0, 'rgba(5, 12, 15, 0.45)');
    edge.addColorStop(0.15, 'rgba(5, 12, 15, 0)');
    edge.addColorStop(0.85, 'rgba(5, 12, 15, 0)');
    edge.addColorStop(1, 'rgba(5, 12, 15, 0.35)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, w, h);
  }

  toast(text, tone = '') {
    const node = document.createElement('div');
    node.className = `toast ${tone}`.trim();
    node.textContent = text;
    const parent = this.el.toasts;
    parent.appendChild(node);
    while (parent.children.length > 4) parent.removeChild(parent.firstElementChild);
    window.setTimeout(() => {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 3700);
  }

  showHint() {
    this.el.hint.classList.remove('fade');
    this.hintTimer = 0;
  }
}
