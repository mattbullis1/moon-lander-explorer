/* Procedural vector art for craft, stations, pickups, aliens and landmarks.
   All shapes are drawn at runtime; there are no bitmap assets. */
'use strict';

import { TAU, clamp, hashString, noise1, RNG } from './utils.js';

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export function hexPath(ctx, x, y, r, rot = 0) {
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

function poly(ctx, pts) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
    else ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.closePath();
}

function glow(ctx, x, y, radius, color, alpha = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();
}

function text(ctx, str, x, y, size, color, align = 'center', weight = '600') {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

/* ------------------------------------------------------------------ CRAFT */

export function drawSpacecraft(ctx, x, y, o) {
  const t = o.time || 0;
  const thrust = o.thrusting;
  const eng = o.upgrades?.engine || 0;
  const shieldLv = o.upgrades?.shield || 0;
  const hullLv = o.upgrades?.hull || 0;
  const fuelLv = o.upgrades?.fuel || 0;
  const tilt = o.tilt || 0;
  const bob = Math.sin(t * 2.4) * (thrust ? 1.2 : 2.0);

  // Engine light pooling below the lander.
  if (thrust) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 0, 56, 70, 'rgba(112,239,255,0.28)');
    ctx.restore();
  }

  ctx.save();
  ctx.translate(x, y + bob);
  ctx.rotate(tilt);

  const outline = '#191722';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // ---------------- descent stage ----------------
  const descent = [
    [-28, -6], [-20, -15], [20, -15], [29, -5], [27, 20],
    [14, 27], [-16, 27], [-28, 16]
  ];
  const gold = ctx.createLinearGradient(-28, -12, 24, 28);
  gold.addColorStop(0, '#f1da98');
  gold.addColorStop(0.38, '#cba85e');
  gold.addColorStop(0.72, '#9d7b3f');
  gold.addColorStop(1, '#e0c27e');
  poly(ctx, descent);
  ctx.fillStyle = gold;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // Foil panel seams + rivets.
  ctx.save();
  poly(ctx, descent);
  ctx.clip();
  ctx.strokeStyle = 'rgba(62,46,24,0.42)';
  ctx.lineWidth = 1;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 10 - 14, -16);
    ctx.lineTo(i * 10 + 2, 29);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-30, 8);
  ctx.lineTo(30, 8);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,247,208,0.6)';
  for (const [px, py] of [[-20, 0], [-8, 20], [11, -7], [20, 14], [3, 2]]) {
    ctx.beginPath();
    ctx.arc(px, py, 1.1, 0, TAU);
    ctx.fill();
  }
  // Upgrade hull plating.
  if (hullLv > 0) {
    for (let i = 0; i < hullLv; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(92,118,130,0.5)' : 'rgba(226,232,224,0.45)';
      roundRect(ctx, -24 + i * 11, -12 + i * 4, 9, 5, 1.5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,28,34,0.55)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
  }
  ctx.restore();

  // Auxiliary fuel pods (cosmetic upgrade).
  if (fuelLv > 0) {
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < Math.min(2, fuelLv); i++) {
        const px = side * (31 + i * 5);
        const py = 1 + i * 5;
        ctx.fillStyle = '#7b8791';
        roundRect(ctx, px - 3.5, py, 7, 15 + i * 2, 3);
        ctx.fill();
        ctx.strokeStyle = outline;
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.fillStyle = '#f4c45e';
        ctx.fillRect(px - 3, py + 3, 6, 3);
        ctx.fillStyle = 'rgba(160,244,255,0.85)';
        ctx.fillRect(px - 1, py + 13 + i * 2, 2, 2);
      }
    }
  }

  // Engine nozzle.
  const nozzleH = 12 + eng * 2.2;
  ctx.fillStyle = '#3a3d47';
  poly(ctx, [[-11, 23], [11, 23], [16, 23 + nozzleH], [-16, 23 + nozzleH]]);
  ctx.fill();
  ctx.strokeStyle = '#16151c';
  ctx.lineWidth = 1.7;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(210,214,225,0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-13, 25 + nozzleH * 0.55);
  ctx.lineTo(13, 25 + nozzleH * 0.55);
  ctx.stroke();
  if (eng > 0) {
    for (let i = 0; i < eng; i++) {
      ctx.fillStyle = '#8b939f';
      ctx.fillRect(-20 - i * 2, 18, 4, 5);
      ctx.fillRect(16 + i * 2, 18, 4, 5);
    }
  }

  // Flame.
  if (thrust || o.engineHeat > 0.05) {
    const power = Math.max(0.28, o.engineHeat || 0);
    const flick = 0.82 + Math.sin(t * 48) * 0.12 + Math.sin(t * 73) * 0.08;
    const len = (27 + eng * 3) * power * flick;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const flame = ctx.createLinearGradient(0, 24, 0, 30 + len);
    flame.addColorStop(0, 'rgba(255,255,240,0.95)');
    flame.addColorStop(0.28, 'rgba(142,248,255,0.9)');
    flame.addColorStop(0.65, 'rgba(255,171,74,0.55)');
    flame.addColorStop(1, 'rgba(255,90,50,0)');
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.moveTo(-9, 24);
    ctx.quadraticCurveTo(-5 - 7 * power, 31 + len * 0.5, 0, 31 + len);
    ctx.quadraticCurveTo(6 + 6 * power, 31 + len * 0.5, 9, 24);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(-3.5, 25);
    ctx.quadraticCurveTo(-1, 33 + len * 0.4, 0, 36 + len * 0.7);
    ctx.quadraticCurveTo(2, 33 + len * 0.4, 3.5, 25);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ---------------- ascent stage ----------------
  const ascent = [
    [-18, 2], [-20, -11], [-12, -25], [0, -29], [12, -24], [19, -9], [17, 4]
  ];
  const bodyGrad = ctx.createLinearGradient(-20, -30, 20, 5);
  bodyGrad.addColorStop(0, '#fffdf2');
  bodyGrad.addColorStop(0.55, '#d8d3c4');
  bodyGrad.addColorStop(1, '#a49e90');
  poly(ctx, ascent);
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // Top cap foil.
  ctx.save();
  poly(ctx, ascent);
  ctx.clip();
  ctx.fillStyle = 'rgba(197,176,126,0.8)';
  ctx.fillRect(-21, -31, 43, 9);
  ctx.strokeStyle = 'rgba(40,37,32,0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-21, -22);
  ctx.lineTo(21, -22);
  ctx.stroke();

  // Windows with a tiny pilot silhouette.
  const winGrad = ctx.createLinearGradient(-10, -17, 6, -5);
  winGrad.addColorStop(0, '#101a25');
  winGrad.addColorStop(0.6, '#0b2733');
  winGrad.addColorStop(1, '#2c6c7a');
  ctx.fillStyle = winGrad;
  poly(ctx, [[-12, -17], [-2, -18], [-1, -7], [-10, -6]]);
  ctx.fill();
  ctx.strokeStyle = '#11151c';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  poly(ctx, [[2, -17], [11, -15], [10, -6], [2, -6]]);
  ctx.fillStyle = winGrad;
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(163,245,255,0.4)';
  ctx.beginPath();
  ctx.moveTo(-10, -16);
  ctx.lineTo(-5, -16.5);
  ctx.lineTo(-7, -9);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e4dfd1';
  ctx.beginPath();
  ctx.arc(-4.5, -9.5, 2.8, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#2c4f5f';
  ctx.beginPath();
  ctx.arc(-4.5, -9.7, 1.5, 0, TAU);
  ctx.fill();

  // Hatch & panels.
  ctx.strokeStyle = 'rgba(58,52,46,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(11, -3, 5.5, 8);
  ctx.fillStyle = 'rgba(38,35,31,0.24)';
  ctx.fillRect(12, -2, 3.5, 6);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(-17, -2, 2, 4);
  ctx.fillStyle = '#b08d4b';
  ctx.fillRect(-19, 1, 36, 2);

  // Hull upgrade detail: ribs and sensor pods.
  if (hullLv) {
    ctx.strokeStyle = 'rgba(58,72,78,0.55)';
    ctx.lineWidth = 1.1;
    for (let i = 0; i < hullLv; i++) {
      ctx.beginPath();
      ctx.moveTo(-14 + i * 7, -25);
      ctx.lineTo(-12 + i * 6, -18);
      ctx.stroke();
    }
  }

  // Antenna dish.
  ctx.strokeStyle = '#353943';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-10, -25);
  ctx.lineTo(-17, -36);
  ctx.lineTo(-22, -39);
  ctx.stroke();
  ctx.save();
  ctx.translate(-23, -39);
  ctx.rotate(-0.65 + Math.sin(t * 1.7) * 0.04);
  ctx.fillStyle = '#d7d9dd';
  ctx.beginPath();
  ctx.ellipse(0, 0, 6.5, 3.2, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#32333a';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(4, -3);
  ctx.stroke();
  ctx.restore();

  // Whip antenna + beacon.
  ctx.strokeStyle = 'rgba(43,46,54,0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(8, -25);
  ctx.lineTo(11, -41);
  ctx.stroke();
  const blink = 0.5 + 0.5 * Math.sin(t * 4 + 1);
  ctx.fillStyle = `rgba(255,97,88,${0.35 + blink * 0.65})`;
  ctx.beginPath();
  ctx.arc(11, -42, 1.6, 0, TAU);
  ctx.fill();

  // RCS quad ports.
  ctx.fillStyle = '#5d5f68';
  ctx.fillRect(-23, -8, 4, 4);
  ctx.fillRect(19, -7, 4, 4);
  ctx.fillStyle = '#25242b';
  ctx.beginPath();
  ctx.arc(-21, -6, 1.3, 0, TAU);
  ctx.arc(21, -5, 1.3, 0, TAU);
  ctx.fill();

  // Landing legs (near legs bright, far legs dark).
  const feet = [[-38, 39], [37, 38]];
  ctx.strokeStyle = '#4d4c52';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-20, 22);
  ctx.lineTo(-32, 34);
  ctx.lineTo(-40, 34);
  ctx.stroke();
  ctx.strokeStyle = '#6d6a66';
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(20, 22);
  ctx.lineTo(32, 34);
  ctx.lineTo(38, 34);
  ctx.stroke();
  for (const [fx, fy] of feet) {
    ctx.fillStyle = '#aca79a';
    ctx.beginPath();
    ctx.ellipse(fx, fy, 10, 3.8, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.ellipse(fx - 1, fy - 1.2, 6, 1.2, 0, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(226,222,207,0.5)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-27, 17);
  ctx.lineTo(-31, 27);
  ctx.moveTo(26, 17);
  ctx.lineTo(31, 27);
  ctx.stroke();

  // Small ladder.
  ctx.strokeStyle = 'rgba(240,226,182,0.65)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    ctx.moveTo(-15 + i * 1.4, 9 + i * 4.2);
    ctx.lineTo(-11 + i * 1.2, 9 + i * 4.2);
  }
  ctx.stroke();

  // Damage & soot.
  if (o.healthRatio != null && o.healthRatio < 0.7) {
    const severity = 1 - o.healthRatio / 0.7;
    ctx.fillStyle = `rgba(32,28,27,${0.14 + severity * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(-13, 7, 9 + severity * 6, 5 + severity * 3, 0.5, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(13, -13, 6, 4, -0.4, 0, TAU);
    ctx.fill();
    if (severity > 0.35) {
      ctx.strokeStyle = 'rgba(25,20,18,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(4, -11);
      ctx.lineTo(8, -5);
      ctx.lineTo(5, -1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-18, 2);
      ctx.lineTo(-14, 8);
      ctx.stroke();
    }
  }

  // Cupola / shield emitters.
  if (shieldLv > 0) {
    ctx.strokeStyle = 'rgba(126,241,255,0.65)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < shieldLv; i++) {
      const a = -0.6 + i * 0.5;
      const px = Math.cos(a) * 24;
      const py = Math.sin(a) * 19 + 2;
      ctx.beginPath();
      ctx.moveTo(px, py - 2);
      ctx.lineTo(px, py + 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(157,247,255,0.9)';
      ctx.beginPath();
      ctx.arc(px, py, 1.4, 0, TAU);
      ctx.fill();
    }
  }

  ctx.restore();

  // Shield bubble (screen/world overlay).
  if (o.invuln > 0 || o.shieldRatio > 0.05) {
    const bubbleAlpha =
      (o.invuln > 0 ? 0.22 + Math.sin(t * 18) * 0.06 : 0.06 + (o.shieldRatio || 0) * 0.1) *
      (o.shieldFlash ? 1.9 : 1);
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.rotate(tilt);
    ctx.globalCompositeOperation = 'lighter';
    const bubbleGrad = ctx.createRadialGradient(0, 0, 20, 0, 0, 51);
    bubbleGrad.addColorStop(0, 'rgba(86,229,255,0)');
    bubbleGrad.addColorStop(0.82, `rgba(85,225,255,${bubbleAlpha * 0.5})`);
    bubbleGrad.addColorStop(1, `rgba(120,245,255,${bubbleAlpha})`);
    ctx.fillStyle = bubbleGrad;
    ctx.beginPath();
    ctx.ellipse(0, 2, 48, 50, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(150,248,255,${bubbleAlpha * 0.85})`;
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * TAU + t * 0.18;
      const a1 = a0 + TAU / 8 - 0.1;
      ctx.beginPath();
      ctx.arc(0, 2, 49, a0, a1);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* ---------------------------------------------------------------- STATION */

export function drawStation(ctx, station, time, opts = {}) {
  const x = station.x;
  const y = station.y;
  const kind = station.kind || 'outpost';
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.1 + (station.index || 0));
  const near = opts.playerNear || false;

  ctx.save();

  // Approach marker cone.
  if (near) {
    const g = ctx.createLinearGradient(x, y - 320, x, y);
    g.addColorStop(0, 'rgba(93,244,231,0)');
    g.addColorStop(1, 'rgba(93,244,231,0.12)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 34, y - 330);
    ctx.lineTo(x + 34, y - 330);
    ctx.lineTo(x + 118, y);
    ctx.lineTo(x - 118, y);
    ctx.closePath();
    ctx.fill();
  }

  // Background habitats and equipment.
  drawStationStructures(ctx, station, time, kind);

  // Pad base: layered metal deck.
  ctx.fillStyle = 'rgba(10,12,17,0.55)';
  ctx.beginPath();
  ctx.ellipse(x, y - 2, 150, 18, 0, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.translate(x, y - 8);
  ctx.fillStyle = '#333a43';
  roundRect(ctx, -132, -12, 264, 14, 4);
  ctx.fill();
  ctx.strokeStyle = '#101319';
  ctx.lineWidth = 2;
  ctx.stroke();
  const deckGrad = ctx.createLinearGradient(0, -12, 0, 2);
  deckGrad.addColorStop(0, '#8c9397');
  deckGrad.addColorStop(0.22, '#636b70');
  deckGrad.addColorStop(1, '#353b42');
  ctx.fillStyle = deckGrad;
  roundRect(ctx, -127, -14, 254, 12, 3);
  ctx.fill();
  // Hazard stripes.
  ctx.save();
  ctx.beginPath();
  ctx.rect(-118, -10, 236, 5);
  ctx.clip();
  for (let i = -120; i < 130; i += 22) {
    ctx.fillStyle = i % 44 === 0 ? '#e7b85a' : '#272b31';
    ctx.beginPath();
    ctx.moveTo(i, -5);
    ctx.lineTo(i + 10, -5);
    ctx.lineTo(i + 4, -10);
    ctx.lineTo(i - 6, -10);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // Light strips.
  const cyan = kind === 'relay' ? '#ffb457' : kind === 'research' ? '#83f7df' : '#74e8ff';
  ctx.fillStyle = cyan;
  ctx.shadowColor = cyan;
  ctx.shadowBlur = 12;
  for (const lx of [-118, -80, 80, 118]) {
    ctx.globalAlpha = 0.45 + pulse * 0.5;
    roundRect(ctx, lx - 7, -12, 14, 2.5, 1.2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;

  // Landing target: concentric rings + H.
  ctx.strokeStyle = 'rgba(190,237,236,0.62)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(0, -7, 58, 14, 0, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(112,233,226,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, -7, 82, 19, 0, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(215,245,240,0.8)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-14, -15);
  ctx.lineTo(-14, -2);
  ctx.moveTo(14, -15);
  ctx.lineTo(14, -2);
  ctx.moveTo(-14, -8.5);
  ctx.lineTo(14, -8.5);
  ctx.stroke();

  // Station number.
  ctx.fillStyle = 'rgba(215,246,242,0.78)';
  text(ctx, `PAD ${String(station.index ?? 1).padStart(2, '0')}`, 0, -25, 10, 'rgba(198,250,243,0.88)', 'center', '700');
  ctx.restore();

  // Holo pylons at pad edges.
  for (const side of [-1, 1]) {
    const px = x + side * 122;
    ctx.fillStyle = '#272e36';
    roundRect(ctx, px - 4, y - 32, 8, 26, 3);
    ctx.fill();
    ctx.strokeStyle = '#11161b';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = cyan;
    ctx.shadowColor = cyan;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(px, y - 34, 2.2 + pulse * 1.2, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(120,240,235,${0.18 + pulse * 0.15})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px, y - 35);
    ctx.lineTo(px, y - 160);
    ctx.stroke();
  }

  // Beacon / holo board.
  ctx.save();
  ctx.globalAlpha = 0.75 + pulse * 0.2;
  const bx = x;
  const by = y - 152 - Math.sin(time * 1.4) * 4;
  ctx.fillStyle = 'rgba(7,20,25,0.72)';
  roundRect(ctx, bx - 79, by - 13, 158, 26, 4);
  ctx.fill();
  ctx.strokeStyle = `rgba(112,233,226,${0.35 + pulse * 0.3})`;
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, station.name.toUpperCase(), bx, by - 4, 8.5, 'rgba(197,253,246,0.94)', 'center', '700');
  text(ctx, 'CHECKPOINT // CONTACT LIGHT', bx, by + 6, 6.2, 'rgba(143,226,219,0.65)', 'center', '500');
  ctx.restore();

  // Vertical beacon beam.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const beam = ctx.createLinearGradient(x, y - 28, x, y - 300);
  beam.addColorStop(0, `rgba(112,242,231,${0.18 + pulse * 0.1})`);
  beam.addColorStop(1, 'rgba(112,242,231,0)');
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(x - 16, y - 14);
  ctx.lineTo(x + 16, y - 14);
  ctx.lineTo(x + 38, y - 300);
  ctx.lineTo(x - 38, y - 300);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

function drawStationStructures(ctx, station, time, kind) {
  const x = station.x;
  const y = station.y;
  const dark = '#222b33';
  const mid = '#3c4a52';
  const light = '#7c8d92';
  const warm = '#ffbd5a';
  const pulse = 0.5 + 0.5 * Math.sin(time * 3.2 + station.index);

  // Main hab dome to the left of the pad.
  const hx = x - 210;
  const hy = y - 2;
  ctx.fillStyle = 'rgba(10,12,16,0.28)';
  ctx.beginPath();
  ctx.ellipse(hx, hy + 2, 76, 13, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#4a555b';
  ctx.beginPath();
  ctx.arc(hx, hy, 54, Math.PI, TAU);
  ctx.lineTo(hx + 54, hy);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#151b20';
  ctx.lineWidth = 2;
  ctx.stroke();
  const domeGrad = ctx.createLinearGradient(hx - 45, hy - 48, hx + 35, hy);
  domeGrad.addColorStop(0, '#c0c7c3');
  domeGrad.addColorStop(0.5, '#8c9796');
  domeGrad.addColorStop(1, '#5d686c');
  ctx.fillStyle = domeGrad;
  ctx.beginPath();
  ctx.arc(hx, hy, 48, Math.PI, TAU);
  ctx.lineTo(hx + 48, hy);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#161b20';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  // Panels on dome.
  ctx.strokeStyle = 'rgba(34,45,50,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(hx, hy, 34, Math.PI * 1.08, Math.PI * 1.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(hx - 48, hy);
  ctx.lineTo(hx + 48, hy);
  ctx.stroke();
  // Lit windows.
  for (const wx of [-26, -5, 16]) {
    ctx.fillStyle = `rgba(255,197,99,${0.45 + pulse * 0.35})`;
    roundRect(ctx, hx + wx, hy - 25, 12, 7, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,25,28,0.7)';
    ctx.fillRect(hx + wx + 6, hy - 25, 1.2, 7);
  }
  // Side module.
  ctx.fillStyle = '#49555a';
  roundRect(ctx, hx + 34, hy - 25, 52, 24, 7);
  ctx.fill();
  ctx.strokeStyle = '#161c20';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = 'rgba(118,224,218,0.75)';
  ctx.fillRect(hx + 43, hy - 20, 11, 4);
  ctx.fillStyle = 'rgba(255,190,91,0.75)';
  ctx.fillRect(hx + 60, hy - 20, 6, 4);

  // Solar array behind the pad (right).
  const sx = x + 190;
  ctx.strokeStyle = '#4d565c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx, y);
  ctx.lineTo(sx + 4, y - 58);
  ctx.stroke();
  ctx.save();
  ctx.translate(sx + 4, y - 58);
  ctx.rotate(-0.2);
  const panelGrad = ctx.createLinearGradient(-48, -28, 48, 28);
  panelGrad.addColorStop(0, '#263f61');
  panelGrad.addColorStop(0.5, '#3f6582');
  panelGrad.addColorStop(1, '#1d2f49');
  ctx.fillStyle = panelGrad;
  roundRect(ctx, -48, -22, 96, 40, 3);
  ctx.fill();
  ctx.strokeStyle = '#a4b8c3';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(132,205,231,0.32)';
  ctx.lineWidth = 0.8;
  for (let i = -32; i <= 32; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, -20);
    ctx.lineTo(i, 16);
    ctx.stroke();
  }
  for (let j = -10; j <= 10; j += 10) {
    ctx.beginPath();
    ctx.moveTo(-46, j);
    ctx.lineTo(46, j);
    ctx.stroke();
  }
  ctx.restore();

  // Kind-specific signature prop.
  if (kind === 'relay' || kind === 'research') {
    const dx = x + 148;
    ctx.save();
    ctx.translate(dx, y - 84);
    ctx.rotate(-0.52);
    ctx.fillStyle = '#d5dad6';
    ctx.beginPath();
    ctx.ellipse(0, 0, 36, 11, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#2a3339';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = '#5b6c73';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(0, 12);
    ctx.moveTo(-22, -6);
    ctx.lineTo(-18, 7);
    ctx.moveTo(22, -6);
    ctx.lineTo(18, 7);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#474f55';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(dx - 20, y);
    ctx.lineTo(dx - 4, y - 55);
    ctx.lineTo(dx + 2, y - 72);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,104,92,${0.4 + pulse * 0.6})`;
    ctx.beginPath();
    ctx.arc(dx + 3, y - 96, 2.2, 0, TAU);
    ctx.fill();
  }
  if (kind === 'depot' || kind === 'start') {
    const crates = [
      [x - 285, -12, 24, 18],
      [x - 268, -27, 18, 15],
      [x + 250, -14, 26, 20],
      [x + 272, -30, 15, 13]
    ];
    for (const [cx, cy, cw, ch] of crates) {
      ctx.fillStyle = '#596364';
      roundRect(ctx, cx, y + cy, cw, ch, 2);
      ctx.fill();
      ctx.strokeStyle = '#20282b';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(238,179,87,0.65)';
      ctx.beginPath();
      ctx.moveTo(cx + 3, y + cy + ch * 0.45);
      ctx.lineTo(cx + cw - 3, y + cy + ch * 0.45);
      ctx.stroke();
    }
  }
  if (kind === 'start' || kind === 'outpost') {
    // Small landing guidance mast.
    const mx = x + 260;
    ctx.strokeStyle = '#4b5257';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx, y);
    ctx.lineTo(mx, y - 76);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,186,83,${0.5 + pulse * 0.5})`;
    ctx.beginPath();
    ctx.arc(mx, y - 78, 2.5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,186,83,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx - 12, y - 70);
    ctx.lineTo(mx, y - 76);
    ctx.lineTo(mx + 12, y - 70);
    ctx.stroke();
  }

  // Ground cabling + equipment.
  ctx.strokeStyle = 'rgba(24,28,32,0.55)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(hx + 40, y);
  ctx.bezierCurveTo(hx + 92, y - 3, x - 148, y - 2, x - 116, y - 4);
  ctx.stroke();
}

/* ------------------------------------------------------------------ ITEMS */

export function drawItem(ctx, item, time) {
  const bob = Math.sin(time * 2.2 + item.phase) * 5;
  const y = item.baseY + bob;
  const x = item.x;

  // Ground-to-item rescue beam.
  const beamColor =
    item.type === 'astronaut'
      ? 'rgba(255,198,102,'
      : item.type === 'discovery'
        ? 'rgba(153,255,234,'
        : item.type === 'equipment'
          ? 'rgba(132,208,255,'
          : item.type === 'sample'
            ? 'rgba(133,249,255,'
            : 'rgba(255,205,112,';
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gy = item.groundY != null ? item.groundY : y + 100;
  const beam = ctx.createLinearGradient(x, y - 18, x, gy);
  beam.addColorStop(0, beamColor + '0.32)');
  beam.addColorStop(0.7, beamColor + '0.04)');
  beam.addColorStop(1, beamColor + '0)');
  ctx.fillStyle = beam;
  ctx.fillRect(x - 7, y - 10, 14, Math.max(20, gy - y + 10));
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.8 + item.phase);
  glow(ctx, x, y, 30 + pulse * 6, beamColor + '0.3)');
  ctx.restore();

  ctx.save();
  ctx.translate(x, y);
  const alert = item.mission ? 1 : 0.55;
  ctx.globalAlpha = 0.92;

  if (item.type === 'sample') {
    drawSampleCrystal(ctx, time, item.phase);
  } else if (item.type === 'astronaut') {
    drawAstronaut(ctx, 0, 12, time, item.phase, 1);
    drawRescueBeacon(ctx, time);
  } else if (item.type === 'equipment') {
    drawCrate(ctx, time);
  } else if (item.type === 'discovery') {
    drawDiscovery(ctx, time, item.phase);
  } else {
    drawSalvage(ctx, time);
  }

  // Mission chevrons.
  if (alert > 0.8) {
    ctx.globalAlpha = 0.35 + 0.35 * pulse;
    ctx.strokeStyle = '#ffd98c';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 2; i++) {
      const cy = -38 - i * 8 - pulse * 3;
      ctx.beginPath();
      ctx.moveTo(-5, cy);
      ctx.lineTo(0, cy + 4);
      ctx.lineTo(5, cy);
      ctx.stroke();
    }
  }

  // Orbiting sparkle.
  const a = time * 1.6 + item.phase;
  ctx.fillStyle = 'rgba(255,245,206,0.8)';
  ctx.beginPath();
  ctx.arc(Math.cos(a) * 17, Math.sin(a) * 9 - 2, 1.3, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawSampleCrystal(ctx, time, phase) {
  ctx.rotate(Math.sin(time * 1.2 + phase) * 0.12);
  const cores = [
    ['#8ffaff', '#2c9baa', -9, 2, 1.0, -0.5],
    ['#b4fffa', '#2cbfc0', 4, -4, 1.25, 0.3],
    ['#6ee8ff', '#1f6b8e', 8, 5, 0.8, 0.7]
  ];
  for (const [c1, c2, cx, cy, s, rot] of cores) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.fillStyle = c1;
    ctx.beginPath();
    ctx.moveTo(0, -13 * s);
    ctx.lineTo(6 * s, -2 * s);
    ctx.lineTo(4 * s, 11 * s);
    ctx.lineTo(-4 * s, 11 * s);
    ctx.lineTo(-7 * s, -3 * s);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,87,100,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = c2;
    ctx.beginPath();
    ctx.moveTo(0, -13 * s);
    ctx.lineTo(1.6 * s, 10 * s);
    ctx.lineTo(-6 * s, -2 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(149,251,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 14, 14, 3.4, 0, 0, TAU);
  ctx.fill();
}

function drawAstronaut(ctx, x, y, time, phase, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  // Backpack.
  ctx.fillStyle = '#c9cdc9';
  roundRect(ctx, -7, -14, 13, 17, 3);
  ctx.fill();
  ctx.strokeStyle = '#343a3e';
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.fillStyle = '#707b80';
  ctx.fillRect(-5, -10, 9, 2);
  // Legs.
  ctx.strokeStyle = '#d9dbd4';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-4, 2);
  ctx.lineTo(-6, 10);
  ctx.moveTo(3, 2);
  ctx.lineTo(5, 10);
  ctx.stroke();
  ctx.strokeStyle = '#33383b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-8, 11);
  ctx.lineTo(-3, 11);
  ctx.moveTo(3, 11);
  ctx.lineTo(8, 11);
  ctx.stroke();
  // Torso.
  const suit = ctx.createLinearGradient(-8, -11, 8, 6);
  suit.addColorStop(0, '#ffffff');
  suit.addColorStop(0.6, '#d8d8cf');
  suit.addColorStop(1, '#9fa39f');
  ctx.fillStyle = suit;
  roundRect(ctx, -8, -13, 16, 17, 6);
  ctx.fill();
  ctx.strokeStyle = '#34383c';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = '#bd6d43';
  ctx.fillRect(-7, -2, 14, 2);
  // Waving arm.
  const wave = Math.sin(time * 3.4 + phase) * 0.2;
  ctx.save();
  ctx.translate(7, -9);
  ctx.rotate(-0.9 + wave);
  ctx.strokeStyle = '#e6e6de';
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -9);
  ctx.stroke();
  ctx.fillStyle = '#d7d8d1';
  ctx.beginPath();
  ctx.arc(0, -11, 3.1, 0, TAU);
  ctx.fill();
  ctx.restore();
  // Helmet.
  ctx.fillStyle = '#f2f1e8';
  ctx.beginPath();
  ctx.arc(1, -18, 8.2, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#33373a';
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.fillStyle = '#e0a53e';
  ctx.beginPath();
  ctx.ellipse(3.2, -18.2, 5.2, 4.5, -0.16, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,242,201,0.8)';
  ctx.beginPath();
  ctx.ellipse(1.7, -20, 2.1, 1.1, -0.5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#8b9497';
  ctx.beginPath();
  ctx.arc(-3.3, -12, 1.3, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawRescueBeacon(ctx, time) {
  const p = 0.5 + 0.5 * Math.sin(time * 4);
  ctx.strokeStyle = `rgba(255,196,96,${0.35 + p * 0.3})`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(14, 3);
  ctx.lineTo(14, -17);
  ctx.stroke();
  ctx.fillStyle = `rgba(255,111,82,${0.5 + p * 0.5})`;
  ctx.beginPath();
  ctx.arc(14, -19, 2.2, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = `rgba(255,175,98,${0.32 + p * 0.2})`;
  ctx.beginPath();
  ctx.ellipse(0, 12, 16, 4, 0, 0, TAU);
  ctx.stroke();
}

function drawCrate(ctx, time) {
  ctx.save();
  ctx.rotate(-0.06 + Math.sin(time * 1.3) * 0.03);
  ctx.fillStyle = '#6b7b7f';
  roundRect(ctx, -15, -12, 30, 25, 3);
  ctx.fill();
  ctx.strokeStyle = '#1f2b2e';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = '#33464a';
  ctx.fillRect(-12, -7, 24, 5);
  ctx.fillStyle = 'rgba(126,245,218,0.8)';
  ctx.fillRect(-9, 2, 13, 5);
  ctx.fillStyle = 'rgba(255,206,112,0.85)';
  ctx.fillRect(7, 2, 4, 5);
  ctx.strokeStyle = '#bcc6c1';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-8, -13);
  ctx.lineTo(-4, -21);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,213,120,0.9)';
  ctx.beginPath();
  ctx.arc(-4, -22, 1.5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,206,112,0.65)';
  ctx.font = '600 6px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SELENE', 0, -4);
  ctx.restore();
}

function drawDiscovery(ctx, time, phase) {
  const p = 0.5 + 0.5 * Math.sin(time * 2.3 + phase);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, 0, -4, 28, 'rgba(114,255,226,0.22)');
  ctx.restore();
  ctx.fillStyle = 'rgba(15,44,48,0.8)';
  ctx.beginPath();
  ctx.moveTo(0, -23);
  ctx.lineTo(14, -11);
  ctx.lineTo(8, 10);
  ctx.lineTo(-8, 10);
  ctx.lineTo(-14, -11);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(148,255,233,0.85)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.strokeStyle = `rgba(167,255,241,${0.42 + p * 0.3})`;
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(-6 + i * 5, -13);
    ctx.lineTo(-3 + i * 4, -6);
    ctx.lineTo(-7 + i * 5, 1);
    ctx.stroke();
  }
  ctx.strokeStyle = `rgba(113,245,228,${0.26 + p * 0.2})`;
  ctx.beginPath();
  ctx.ellipse(0, 2, 22, 6, 0, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 2, 30, 8, 0, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = `rgba(154,255,239,${0.4 + p * 0.4})`;
  ctx.beginPath();
  ctx.arc(0, -27, 1.6, 0, TAU);
  ctx.fill();
}

function drawSalvage(ctx, time) {
  ctx.save();
  ctx.rotate(Math.sin(time * 1.4) * 0.15);
  const g = ctx.createLinearGradient(-10, -12, 10, 12);
  g.addColorStop(0, '#ffe6a1');
  g.addColorStop(0.5, '#d9a74d');
  g.addColorStop(1, '#8e642c');
  ctx.fillStyle = g;
  roundRect(ctx, -11, -11, 22, 22, 4);
  ctx.fill();
  ctx.strokeStyle = '#3e2f1a';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(69,50,25,0.7)';
  ctx.beginPath();
  ctx.arc(0, 0, 5.5, 0, TAU);
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + time * 0.7;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
    ctx.lineTo(Math.cos(a) * 10, Math.sin(a) * 10);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,243,201,0.75)';
  ctx.beginPath();
  ctx.arc(-3, -4, 1.4, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/* --------------------------------------------------------------- CREATURES */

export function drawDrone(ctx, drone, time, player) {
  const x = drone.x;
  const y = drone.y + Math.sin(time * 1.9 + drone.phase) * 4;
  const tilt = Math.sin(time * 1.3 + drone.phase) * 0.12;
  const eyePulse = 0.55 + 0.45 * Math.sin(time * 5.2 + drone.eye);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  const s = (drone.size || 18) / 18;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, 0, 0, 34 * s, `rgba(255,64,164,${0.08 + eyePulse * 0.1})`);
  ctx.restore();

  // Tentacles.
  ctx.strokeStyle = '#4c2d54';
  ctx.lineWidth = 2.2 * s;
  ctx.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    const base = i * 7 * s;
    const sway = Math.sin(time * 3.2 + drone.phase + i) * 4;
    ctx.beginPath();
    ctx.moveTo(base, 8 * s);
    ctx.quadraticCurveTo(base + sway, 18 * s, base + sway * 0.6, 27 * s);
    ctx.stroke();
    ctx.fillStyle = '#b5438e';
    ctx.beginPath();
    ctx.arc(base + sway * 0.6, 27 * s, 1.4 * s, 0, TAU);
    ctx.fill();
  }

  // Armored shell.
  const shell = ctx.createRadialGradient(-5 * s, -7 * s, 2, 0, 0, 23 * s);
  shell.addColorStop(0, '#7b5a7b');
  shell.addColorStop(0.55, '#3e2948');
  shell.addColorStop(1, '#1a1224');
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.ellipse(0, 0, 20 * s, 15 * s, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#0e0915';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // Spines.
  ctx.fillStyle = '#2b1b35';
  for (let i = 0; i < 4; i++) {
    const a = -1.9 + i * 0.48;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 16 * s, Math.sin(a) * 11 * s);
    ctx.lineTo(Math.cos(a) * 26 * s, Math.sin(a) * 18 * s);
    ctx.lineTo(Math.cos(a + 0.25) * 18 * s, Math.sin(a + 0.25) * 12 * s);
    ctx.closePath();
    ctx.fill();
  }
  // Mechanical ring.
  ctx.strokeStyle = 'rgba(203,131,220,0.5)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(0, 1 * s, 24 * s, 7 * s, -0.18, 0, TAU);
  ctx.stroke();
  // Glowing eye.
  const eyeX = 6 * s;
  const eyeY = -1 * s;
  ctx.fillStyle = 'rgba(20,7,20,0.95)';
  ctx.beginPath();
  ctx.ellipse(eyeX, eyeY, 8.5 * s, 6.5 * s, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = `rgba(255,74,160,${0.5 + eyePulse * 0.5})`;
  ctx.shadowColor = '#ff4a9f';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.ellipse(eyeX, eyeY, 4.2 * s, 3.2 * s, 0, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffe7f4';
  ctx.beginPath();
  ctx.arc(eyeX + 1.3 * s, eyeY - 0.8 * s, 1.2 * s, 0, TAU);
  ctx.fill();
  if (player) {
    const ang = Math.atan2(player.y - y, player.x - x);
    ctx.fillStyle = 'rgba(20,7,20,0.8)';
    ctx.beginPath();
    ctx.ellipse(eyeX + Math.cos(ang) * 2.2, eyeY + Math.sin(ang) * 1.8, 1.3 * s, 1.3 * s, 0, 0, TAU);
    ctx.fill();
  }
  // Vent lights.
  ctx.fillStyle = 'rgba(156,246,255,0.72)';
  ctx.fillRect(-13 * s, 8 * s, 5 * s, 1.5 * s);
  ctx.fillRect(-4 * s, 10 * s, 4 * s, 1.3 * s);
  ctx.restore();
}

export function drawSentry(ctx, sentry, time, player) {
  const x = sentry.x;
  const y = sentry.y;
  const dir = sentry.mounted === 'ceiling' ? -1 : 1;
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.7 + sentry.phase);
  const charge = sentry.charge || 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, dir);
  // Footing.
  ctx.fillStyle = '#30313b';
  roundRect(ctx, -17, -4, 34, 8, 3);
  ctx.fill();
  ctx.strokeStyle = '#12131a';
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.fillStyle = '#545563';
  ctx.beginPath();
  ctx.moveTo(-12, -4);
  ctx.lineTo(-7, -22);
  ctx.lineTo(8, -22);
  ctx.lineTo(13, -4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#181820';
  ctx.stroke();
  // Spiked shell.
  const shell = ctx.createLinearGradient(-14, -32, 14, -6);
  shell.addColorStop(0, '#6b5060');
  shell.addColorStop(0.6, '#382a3d');
  shell.addColorStop(1, '#19151f');
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.ellipse(0, -23, 15, 11, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#0e0c12';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const a = -2.8 + i * 0.65;
    ctx.fillStyle = '#261d2c';
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 12, -23 + Math.sin(a) * 8);
    ctx.lineTo(Math.cos(a) * 22, -23 + Math.sin(a) * 17);
    ctx.lineTo(Math.cos(a + 0.24) * 13, -23 + Math.sin(a + 0.24) * 9);
    ctx.closePath();
    ctx.fill();
  }
  // Eye and charge.
  const eyeColor = charge > 0.05 ? `rgba(255,176,72,${0.5 + pulse * 0.5})` : `rgba(255,78,98,${0.45 + pulse * 0.4})`;
  ctx.fillStyle = eyeColor;
  ctx.shadowColor = charge > 0.05 ? '#ffb04a' : '#ff4e62';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(-2, -24, 4.5 + pulse * 1.2, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#1d0910';
  ctx.beginPath();
  ctx.arc(-1, -24, 1.7, 0, TAU);
  ctx.fill();
  // Barrel / emitter.
  ctx.fillStyle = '#62636c';
  roundRect(ctx, -4, -38, 9, 17, 2);
  ctx.fill();
  ctx.strokeStyle = '#15151b';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,181,82,0.7)';
  ctx.fillRect(-2.5, -38, 6, 2.4);
  if (charge > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 0.5, -40, 12 + charge * 16, 'rgba(255,139,79,0.45)');
    ctx.fillStyle = `rgba(255,227,174,${charge * 0.8})`;
    ctx.beginPath();
    ctx.arc(0.5, -41, 2 + charge * 4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  // Antenna.
  ctx.strokeStyle = '#4d4b55';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(9, -28);
  ctx.lineTo(15, -41);
  ctx.stroke();
  ctx.fillStyle = `rgba(255,104,94,${0.3 + pulse * 0.7})`;
  ctx.beginPath();
  ctx.arc(15, -42, 1.4, 0, TAU);
  ctx.fill();
  ctx.restore();

  // Aiming telegraph.
  if (charge > 0.35 && player) {
    ctx.save();
    ctx.globalAlpha = clamp((charge - 0.35) * 0.8, 0, 0.3);
    ctx.strokeStyle = '#ff9a5e';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(x, y - dir * 34);
    ctx.lineTo(player.x, player.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

export function drawProjectile(ctx, orb, time) {
  ctx.save();
  ctx.translate(orb.x, orb.y);
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, 0, 0, 20, 'rgba(255,82,163,0.5)');
  const g = ctx.createRadialGradient(-2, -2, 0, 0, 0, 8);
  g.addColorStop(0, '#fff5fb');
  g.addColorStop(0.4, '#ff9bc9');
  g.addColorStop(1, 'rgba(185,38,116,0.1)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,206,236,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, 0, 11, 5, time * 2.4, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

export function drawDebris(ctx, debris, time) {
  ctx.save();
  ctx.translate(debris.x, debris.y);
  ctx.rotate(debris.rot || time);
  const polyPts = debris.pts || [[-10, -7], [4, -11], [12, -2], [7, 9], [-5, 10], [-12, 2]];
  poly(ctx, polyPts);
  ctx.fillStyle = '#4b4644';
  ctx.fill();
  ctx.strokeStyle = '#1b191c';
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(219,205,183,0.32)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-6, -3);
  ctx.lineTo(5, 2);
  ctx.stroke();
  ctx.restore();
  // Warning ring.
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = '#ff8b64';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(debris.x, debris.y, 18, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/* --------------------------------------------------------------- LANDMARKS */

export function drawLandmark(ctx, landmark, time) {
  const { x, y, type } = landmark;
  ctx.save();
  if (type === 'wreck') drawWreck(ctx, x, y, time);
  else if (type === 'monolith') drawMonolith(ctx, x, y, time);
  else if (type === 'base') drawAbandonedBase(ctx, x, y, time);
  else if (type === 'relay') drawRelay(ctx, x, y, time);

  // Holographic location marker.
  ctx.globalAlpha = 0.42 + Math.sin(time * 1.7) * 0.08;
  ctx.fillStyle = 'rgba(8,25,27,0.5)';
  roundRect(ctx, x - 66, y - 208, 132, 17, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(112,235,225,0.35)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  text(ctx, landmark.name, x, y - 199, 7.6, 'rgba(174,247,239,0.9)', 'center', '700');
  ctx.restore();
}

function drawWreck(ctx, x, y, time) {
  ctx.save();
  ctx.translate(x, y);
  // Shadowed crater.
  ctx.fillStyle = 'rgba(20,18,20,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, -2, 108, 16, 0, 0, TAU);
  ctx.fill();
  // Broken descent stage.
  ctx.save();
  ctx.translate(-18, -38);
  ctx.rotate(-0.18);
  ctx.fillStyle = '#947c50';
  poly(ctx, [[-44, -18], [25, -24], [39, 10], [8, 27], [-36, 16]]);
  ctx.fill();
  ctx.strokeStyle = '#2a241d';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(48,35,22,0.65)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-28, -12);
  ctx.lineTo(0, 20);
  ctx.moveTo(15, -20);
  ctx.lineTo(26, 4);
  ctx.stroke();
  ctx.fillStyle = 'rgba(23,20,19,0.8)';
  ctx.beginPath();
  ctx.ellipse(12, 10, 16, 8, 0.4, 0, TAU);
  ctx.fill();
  // Torn foil panels.
  ctx.fillStyle = '#d7c28e';
  ctx.beginPath();
  ctx.moveTo(-39, 3);
  ctx.lineTo(-61, 22);
  ctx.lineTo(-45, 14);
  ctx.lineTo(-31, 23);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // Broken leg sticking up.
  ctx.strokeStyle = '#6f6a5e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(25, -24);
  ctx.lineTo(55, -58);
  ctx.lineTo(71, -56);
  ctx.stroke();
  ctx.fillStyle = '#817d70';
  ctx.beginPath();
  ctx.ellipse(73, -56, 9, 3.4, -0.15, 0, TAU);
  ctx.fill();
  // Solar panel carcass.
  ctx.save();
  ctx.translate(80, -20);
  ctx.rotate(0.22);
  ctx.fillStyle = '#263e55';
  ctx.fillRect(-30, -16, 58, 30);
  ctx.strokeStyle = '#7e9aa6';
  ctx.lineWidth = 1;
  ctx.strokeRect(-30, -16, 58, 30);
  ctx.strokeStyle = 'rgba(121,179,210,0.35)';
  for (let i = -20; i < 28; i += 12) {
    ctx.beginPath();
    ctx.moveTo(i, -16);
    ctx.lineTo(i + 8, 14);
    ctx.stroke();
  }
  ctx.restore();
  // Scattered debris.
  for (let i = 0; i < 7; i++) {
    const a = i * 1.7;
    const px = Math.cos(a) * (45 + (i % 3) * 18);
    const py = -3 + Math.sin(a) * 2;
    ctx.fillStyle = i % 2 ? '#5f584c' : '#a78e5b';
    ctx.beginPath();
    ctx.ellipse(px, py, 3 + (i % 3), 1.4 + (i % 2), a, 0, TAU);
    ctx.fill();
  }
  // Faint distress smoke.
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#d2b8a0';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(-30 + i * 10, -74 - i * 22 + Math.sin(time + i) * 4, 9 + i * 3, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawMonolith(ctx, x, y, time) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(12,9,16,0.5)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 62, 12, 0, 0, TAU);
  ctx.fill();
  const g = ctx.createLinearGradient(-28, -160, 30, 0);
  g.addColorStop(0, '#1b1a22');
  g.addColorStop(0.5, '#0b0b11');
  g.addColorStop(1, '#23222b');
  ctx.fillStyle = g;
  poly(ctx, [[-29, 0], [-22, -154], [18, -161], [31, -8], [22, 0]]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,245,231,0.38)';
  ctx.lineWidth = 1;
  ctx.stroke();
  const p = 0.5 + 0.5 * Math.sin(time * 1.8);
  ctx.strokeStyle = `rgba(120,255,235,${0.3 + p * 0.45})`;
  ctx.lineWidth = 1.3;
  // Glyph column.
  for (let i = 0; i < 6; i++) {
    const gy = -28 - i * 20;
    ctx.beginPath();
    ctx.moveTo(-8, gy);
    ctx.lineTo(-2, gy - 6);
    ctx.lineTo(4, gy);
    ctx.lineTo(10, gy - 7);
    ctx.stroke();
  }
  ctx.fillStyle = `rgba(123,255,236,${0.08 + p * 0.08})`;
  ctx.beginPath();
  ctx.moveTo(-38, 0);
  ctx.lineTo(-14, -150);
  ctx.lineTo(-4, -150);
  ctx.lineTo(-22, 0);
  ctx.closePath();
  ctx.fill();
  // Floating shards.
  for (let i = 0; i < 4; i++) {
    const a = time * 0.4 + i * 1.8;
    ctx.fillStyle = 'rgba(87,226,207,0.45)';
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 44, -100 + Math.sin(a * 1.2) * 24, 1.4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawAbandonedBase(ctx, x, y, time) {
  ctx.save();
  ctx.translate(x, y);
  // Domes.
  for (const [dx, r, lit] of [[-55, 38, false], [18, 28, true], [64, 20, false]]) {
    ctx.fillStyle = 'rgba(20,20,24,0.4)';
    ctx.beginPath();
    ctx.ellipse(dx, 1, r + 15, 7, 0, 0, TAU);
    ctx.fill();
    const g = ctx.createLinearGradient(dx - r, -r, dx + r, 0);
    g.addColorStop(0, '#686e6c');
    g.addColorStop(0.5, '#474e4e');
    g.addColorStop(1, '#2a2e31');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(dx, 0, r, Math.PI, TAU);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#171b1d';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(20,24,25,0.5)';
    ctx.beginPath();
    ctx.moveTo(dx - r, 0);
    ctx.lineTo(dx + r, 0);
    ctx.stroke();
    ctx.fillStyle = lit
      ? `rgba(255,177,82,${0.22 + Math.sin(time * 2) * 0.08})`
      : 'rgba(52,74,76,0.4)';
    roundRect(ctx, dx - 7, -r * 0.55, 14, 7, 2);
    ctx.fill();
  }
  // Collapsed mast.
  ctx.strokeStyle = '#5f6564';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-105, 0);
  ctx.lineTo(-146, 24);
  ctx.lineTo(-161, 20);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(186,187,177,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-105, 0);
  ctx.lineTo(-110, -65);
  ctx.lineTo(-98, -80);
  ctx.stroke();
  // Tattered solar panels.
  ctx.save();
  ctx.translate(100, -30);
  ctx.rotate(-0.35);
  ctx.fillStyle = '#1f303c';
  ctx.fillRect(-26, -18, 44, 24);
  ctx.strokeStyle = '#475964';
  ctx.lineWidth = 1;
  ctx.strokeRect(-26, -18, 44, 24);
  ctx.strokeStyle = 'rgba(132,178,185,0.28)';
  for (let i = -16; i < 16; i += 11) {
    ctx.beginPath();
    ctx.moveTo(i, -18);
    ctx.lineTo(i + 6, 6);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

function drawRelay(ctx, x, y, time) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(12,14,18,0.45)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 86, 11, 0, 0, TAU);
  ctx.fill();
  // Lattice tower.
  ctx.strokeStyle = '#59636a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-28, 0);
  ctx.lineTo(-9, -112);
  ctx.moveTo(30, 0);
  ctx.lineTo(12, -112);
  for (let i = 0; i < 6; i++) {
    const t = i / 6;
    const yy = -i * 18;
    const w = 28 - t * 18;
    ctx.moveTo(-w, yy);
    ctx.lineTo(w + 2, yy - 18);
    ctx.moveTo(w, yy);
    ctx.lineTo(-w, yy - 18);
  }
  ctx.stroke();
  // Dish.
  ctx.save();
  ctx.translate(-2, -132);
  ctx.rotate(-0.75);
  const g = ctx.createLinearGradient(-42, -18, 42, 18);
  g.addColorStop(0, '#e8e6da');
  g.addColorStop(0.55, '#a4a9a5');
  g.addColorStop(1, '#5d666b');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, 45, 15, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#2b3237';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(60,72,79,0.55)';
  for (let i = -32; i <= 32; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, -13);
    ctx.lineTo(i, 13);
    ctx.stroke();
  }
  ctx.fillStyle = '#363f44';
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#758087';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(30, -26);
  ctx.stroke();
  ctx.restore();
  const p = 0.5 + 0.5 * Math.sin(time * 3.4);
  ctx.fillStyle = `rgba(255,89,77,${0.4 + p * 0.6})`;
  ctx.beginPath();
  ctx.arc(14, -151, 2.2, 0, TAU);
  ctx.fill();
  // Base equipment.
  ctx.fillStyle = '#405058';
  roundRect(ctx, 42, -20, 30, 18, 3);
  ctx.fill();
  ctx.fillStyle = 'rgba(129,239,221,0.6)';
  ctx.fillRect(48, -15, 9, 4);
  ctx.restore();
}

/* --------------------------------------------------------------- TERRAIN */

export function drawBoulder(ctx, boulder, time) {
  const cx = boulder.x;
  const cy = boulder.y - boulder.radius * 0.55;
  ctx.save();
  // Contact shadow.
  ctx.fillStyle = 'rgba(12,11,14,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx - boulder.radius * 0.15, boulder.y + 1, boulder.radius * 1.15, boulder.radius * 0.26, 0, 0, TAU);
  ctx.fill();
  ctx.translate(cx, cy);
  const g = ctx.createLinearGradient(-boulder.radius, -boulder.radius, boulder.radius, boulder.radius);
  g.addColorStop(0, boulder.shade > 0.5 ? '#a9a69e' : '#98968f');
  g.addColorStop(0.45, '#6f6c67');
  g.addColorStop(1, '#3d3a3a');
  poly(
    ctx,
    boulder.points.map((p) => [p.x, p.y])
  );
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#252329';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // Sunlit cap.
  ctx.save();
  poly(
    ctx,
    boulder.points.map((p) => [p.x, p.y])
  );
  ctx.clip();
  ctx.fillStyle = 'rgba(235,227,207,0.23)';
  ctx.beginPath();
  ctx.ellipse(-boulder.radius * 0.2, -boulder.radius * 0.5, boulder.radius * 0.6, boulder.radius * 0.28, -0.3, 0, TAU);
  ctx.fill();
  // Cracks.
  ctx.strokeStyle = 'rgba(35,31,31,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-boulder.radius * 0.6, -boulder.radius * 0.1);
  ctx.lineTo(-boulder.radius * 0.1, boulder.radius * 0.15);
  ctx.lineTo(boulder.radius * 0.2, boulder.radius * 0.45);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

export function drawCaveCrystal(ctx, x, y, size, time, hue = 0) {
  const p = 0.55 + 0.45 * Math.sin(time * 1.6 + x * 0.01);
  ctx.save();
  ctx.translate(x, y);
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, 0, 0, size * 2.6, hue === 0 ? `rgba(79,235,255,${0.12 + p * 0.1})` : `rgba(255,95,203,${0.1 + p * 0.08})`);
  ctx.restore();
  ctx.save();
  ctx.translate(x, y);
  const color = hue === 0 ? '#79f5ff' : '#f08cff';
  const dark = hue === 0 ? '#1f6579' : '#6b2b76';
  for (let i = 0; i < 3; i++) {
    const a = -0.5 + i * 0.45;
    ctx.save();
    ctx.rotate(a);
    const g = ctx.createLinearGradient(0, 0, 0, -size * (1 + i * 0.25));
    g.addColorStop(0, dark);
    g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-2.5, 0);
    ctx.lineTo(0, -size * (1 + i * 0.25));
    ctx.lineTo(2.5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(215,255,255,0.35)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

export function drawStalagmite(ctx, sg, time) {
  const { x, y, h, w } = sg;
  ctx.save();
  ctx.fillStyle = 'rgba(11,10,14,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y, w * 1.3, 3, 0, 0, TAU);
  ctx.fill();
  const g = ctx.createLinearGradient(x - w, y, x + w, y - h);
  g.addColorStop(0, '#4b464f');
  g.addColorStop(0.6, '#292530');
  g.addColorStop(1, '#6b636e');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.lineTo(x - w * 0.24, y - h * 0.72);
  ctx.lineTo(x, y - h);
  ctx.lineTo(x + w * 0.3, y - h * 0.65);
  ctx.lineTo(x + w, y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(198,184,204,0.28)';
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(20,17,23,0.5)';
  ctx.beginPath();
  ctx.moveTo(x - w * 0.3, y - 2);
  ctx.lineTo(x + w * 0.15, y - h * 0.55);
  ctx.stroke();
  ctx.restore();
}

export { poly, glow, text };
