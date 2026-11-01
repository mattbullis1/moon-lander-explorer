/* Deterministic, endless lunar world generation.
   Every sector is derived from its index + run seed, so checkpoint respawns
   always rebuild identical terrain, stations, missions and hazards. */
'use strict';

import { RNG, clamp, smoothstep, hashString, noise1, lerp, formatNumber } from './utils.js';

export const SAMPLE_STEP = 8;

const STATION_NAMES = [
  'Mare Tranquillitatis Relay',
  'Fra Mauro Relay',
  'Hadley Field Station',
  'Serenity Depot',
  'Kepler Survey Post',
  'Shackleton Relais',
  'Malapert Anchorage',
  'Tsiolkovsky Yard',
  'Mare Nubium Base',
  'Copernicus Array',
  'Oceanus Station',
  'Ptolemaeus Outpost'
];

const SECTOR_NAMES = [
  'MARE TRANQUILLITATIS',
  'FRA MAURO HIGHLANDS',
  'HADLEY RILLE',
  'PALUS PUTREDINIS',
  'OCEANUS PROCELLARUM',
  'MARE IMBRIUM',
  'TAURUS-LITTROW',
  'SHACKLETON RIM',
  'MARE NUBIUM',
  'COPERNICUS BASIN',
  'MARE SERENITATIS',
  'SOUTH POLE-AITKEN'
];

const LANDMARK_NAMES = {
  wreck: 'APOLLO 18 WRECK',
  monolith: 'THE NEREID MONOLITH',
  base: 'ABANDONED SELENE BASE',
  relay: 'DEEP-SPACE RELAY 7'
};

const MISSION_META = {
  sample: {
    title: 'MINERAL SURVEY',
    points: 120,
    credits: 55,
    target: 3,
    objective: (n) => `Collect ${n} mineral samples`,
    short: (n) => `Samples ${n}`
  },
  rescue: {
    title: 'SEARCH & RESCUE',
    points: 190,
    credits: 80,
    target: 2,
    objective: (n) => `Rescue ${n} stranded astronaut${n === 1 ? '' : 's'}`,
    short: (n) => `Astronauts ${n}`
  },
  survey: {
    title: 'ANOMALY SURVEY',
    points: 210,
    credits: 85,
    target: 1,
    objective: () => 'Scan the lost research site',
    short: () => 'Site scan'
  },
  recover: {
    title: 'SALVAGE RECOVERY',
    points: 150,
    credits: 70,
    target: 2,
    objective: (n) => `Recover ${n} science crates`,
    short: (n) => `Crates ${n}`
  }
};

export class World {
  constructor(seed) {
    this.seed = (seed >>> 0) || 1;
    this.sectors = [];
    this.stations = [];
    this.generatedThrough = -1;
    this._ensureInitial();
  }

  _ensureInitial() {
    if (this.generatedThrough < 0) this.ensureThrough(0);
  }

  ensureThrough(index) {
    while (this.generatedThrough < index && this.generatedThrough < 500) {
      this._generateSector(this.generatedThrough + 1);
    }
    return this;
  }

  ensureAhead(x, distance = 9000) {
    this._ensureInitial();
    let guard = 0;
    while (this.sectors[this.sectors.length - 1].endX < x + distance && guard < 25) {
      this._generateSector(this.generatedThrough + 1);
      guard++;
    }
  }

  _generateSector(index) {
    const rngSeed = hashString(`mle:${this.seed}:sector:${index}`);
    const rng = new RNG(rngSeed);
    const isFirst = index === 0;
    const prev = isFirst ? null : this.sectors[index - 1];
    const startX = isFirst ? 0 : prev.endX;
    const difficulty = index;
    const length = Math.round(4250 + Math.min(index, 18) * 190 + rng.range(0, 360));
    const endX = startX + length;
    const stationX = endX - 760;
    const stationRng = new RNG(hashString(`mle:${this.seed}:station:${index + 1}`));
    const stationName =
      STATION_NAMES[(index + 1 + Math.floor(this.seed % STATION_NAMES.length)) % STATION_NAMES.length];
    const sectorName = SECTOR_NAMES[(index + Math.floor((this.seed >>> 3) % SECTOR_NAMES.length)) % SECTOR_NAMES.length];

    // ---- cave ranges -------------------------------------------------------
    const caveRanges = [];
    const caveStartMin = isFirst ? 1650 : 750;
    const caveStartMax = Math.max(caveStartMin + 200, stationX - 2100);
    const caveStart = clamp(startX + rng.range(caveStartMin, caveStartMax), startX + 700, stationX - 1900);
    const caveLen = rng.range(750, 1350);
    if (caveStart < stationX - 1700) {
      caveRanges.push({
        start: caveStart,
        end: Math.min(caveStart + caveLen, stationX - 1000),
        corridor: clamp(345 - Math.min(index, 12) * 6 + rng.range(-35, 35), 265, 365),
        phase: rng.range(0, Math.PI * 2)
      });
    }
    if (length > 5000 && rng.chance(0.55)) {
      const s2 = stationX - rng.range(1350, 1850);
      const e2 = s2 + rng.range(650, 900);
      if (s2 > startX + 1000 && e2 < stationX - 650 && (!caveRanges[0] || s2 > caveRanges[0].end + 500)) {
        caveRanges.push({
          start: s2,
          end: e2,
          corridor: clamp(338 - Math.min(index, 12) * 6 + rng.range(-35, 35), 260, 360),
          phase: rng.range(0, Math.PI * 2)
        });
      }
    }

    // ---- landmark ----------------------------------------------------------
    const landmarkTypes = { 2: 'wreck', 3: 'monolith', 5: 'base', 8: 'relay' };
    let landmark = null;
    if (landmarkTypes[index]) {
      const candidates = [0.46, 0.38, 0.55, 0.31].map((f) => startX + length * f);
      let lx = candidates[0];
      for (const c of candidates) {
        const inCave = caveRanges.some((r) => c > r.start - 260 && c < r.end + 260);
        if (!inCave) {
          lx = c;
          break;
        }
      }
      const type = landmarkTypes[index];
      landmark = {
        type,
        name: LANDMARK_NAMES[type],
        x: Math.round(lx),
        y: 0
      };
    }

    // ---- base ground spline ------------------------------------------------
    const points = [];
    const count = Math.ceil((length + 300) / 255);
    let py = isFirst ? 610 : prev.endGroundY;
    points.push({ x: 0, y: py });
    const pullY = 590 + stationRng.range(-22, 22);
    for (let k = 1; k <= count + 2; k++) {
      py += rng.range(-42, 42);
      py += (pullY - py) * 0.11;
      py = clamp(py, 505, 690);
      points.push({ x: k * 255, y: py });
    }
    const spline = (localX) => {
      const t = clamp(localX / 255, 0, points.length - 1.001);
      const i = Math.floor(t);
      const f = t - i;
      const s = f * f * (3 - 2 * f);
      return lerp(points[i].y, points[i + 1].y, s);
    };

    const stationBaseY = spline(stationX - startX);
    const padY = clamp(stationBaseY + stationRng.range(-22, 18), 520, 680);

    // ---- craters (visual + terrain depressions) ----------------------------
    const craters = [];
    const craterCount = rng.int(1, 3);
    for (let c = 0; c < craterCount; c++) {
      const cx = startX + rng.range(0.16, 0.82) * length;
      if (Math.abs(cx - stationX) < 700) continue;
      if (landmark && Math.abs(cx - landmark.x) < 300) continue;
      const rx = rng.range(70, 165);
      craters.push({
        x: Math.round(cx),
        rx: Math.round(rx),
        ry: Math.round(rx * rng.range(0.2, 0.33)),
        depth: rng.range(16, 52)
      });
    }

    // ---- station approach flats -------------------------------------------
    const n = Math.ceil(length / SAMPLE_STEP);
    const ground = new Float32Array(n + 1);
    const ceiling = new Float32Array(n + 1);
    const startPadX = 180;
    let startPadY = isFirst ? spline(startPadX) : 0;

    const microSeed = (rngSeed ^ 0x9e3779b9) >>> 0;
    for (let i = 0; i <= n; i++) {
      const x = startX + i * SAMPLE_STEP;
      const local = x - startX;
      let y = spline(local);
      for (const crater of craters) {
        const dx = (x - crater.x) / crater.rx;
        if (Math.abs(dx) < 2.6) {
          y += crater.depth * Math.exp(-dx * dx * 2.2) * 0.9;
        }
      }
      // Jagged micro detail, softened near landing zones.
      const micro = noise1(microSeed, x * 0.028) * 3.2 + noise1(microSeed + 17, x * 0.09) * 1.1;
      const stationBlend = 1 - smoothstep(Math.abs(x - stationX) / 420);
      let fade = (1 - stationBlend) * (1 - smoothstep(Math.max(0, 700 - local) / 700));
      if (isFirst) {
        const sb = 1 - smoothstep(Math.abs(x - startPadX) / 330);
        fade *= 1 - sb;
      }
      y += micro * fade;

      // Flatten station pad.
      const dw = Math.abs(x - stationX);
      const flat = 1 - smoothstep((dw - 205) / 300);
      y = lerp(y, padY, flat);

      // Flatten the starting outpost on the first sector.
      if (isFirst) {
        const ds = Math.abs(x - startPadX);
        const startFlat = 1 - smoothstep((ds - 190) / 280);
        if (x < 700) y = lerp(y, startPadY || y, startFlat);
      }

      ground[i] = y;
    }
    if (isFirst) startPadY = ground[Math.round(startPadX / SAMPLE_STEP)] || 610;

    // ---- stalactites -------------------------------------------------------
    const stalactites = [];
    for (const cave of caveRanges) {
      let sx = cave.start + rng.range(80, 180);
      while (sx < cave.end - 60) {
        const clearance = cave.corridor - 24;
        const depth = rng.range(12, Math.min(52, clearance - 208));
        if (depth > 8) {
          stalactites.push({
            x: sx,
            depth,
            w: rng.range(24, 60)
          });
        }
        sx += rng.range(110, 260);
      }
    }

    // ---- ceilings ----------------------------------------------------------
    for (let i = 0; i <= n; i++) {
      const x = startX + i * SAMPLE_STEP;
      let intensity = 0;
      let cave = null;
      for (const range of caveRanges) {
        const ramp = 190;
        if (x > range.start - ramp && x < range.end + ramp) {
          let k = 1;
          if (x < range.start) k = smoothstep((x - (range.start - ramp)) / ramp);
          else if (x > range.end) k = smoothstep(((range.end + ramp) - x) / ramp);
          if (k > intensity) {
            intensity = k;
            cave = range;
          }
        }
      }
      const gy = ground[i];
      if (intensity <= 0.001 || !cave) {
        ceiling[i] = gy - 1800;
        continue;
      }
      const local = x - cave.start;
      let corridor =
        cave.corridor +
        Math.sin(local / 180 + cave.phase) * 19 +
        noise1(microSeed + 41, x * 0.013) * 16;
      // Stalactites push the ceiling downward locally.
      for (const spike of stalactites) {
        const dx = Math.abs(x - spike.x);
        if (dx < spike.w) corridor -= spike.depth * (1 - dx / spike.w);
      }
      corridor = Math.max(208, corridor);
      const rawCeiling = gy - corridor;
      const openSky = gy - 1800;
      ceiling[i] = lerp(openSky, rawCeiling, intensity);
    }

    const endGroundY = ground[n];

    const sector = {
      index,
      seed: rngSeed,
      startX,
      endX,
      length,
      difficulty,
      name: sectorName,
      startGroundY: ground[0],
      endGroundY,
      step: SAMPLE_STEP,
      ground,
      ceiling,
      caveRanges,
      stalactites,
      craters,
      stationX,
      stationY: padY,
      stationName,
      sectorRng: rng,
      isFirst,
      startPadX: isFirst ? startPadX : null,
      startPadY: isFirst ? startPadY : null,
      items: [],
      boulders: [],
      pebbles: [],
      stalagmites: [],
      drones: [],
      sentries: [],
      drips: [],
      landmark,
      mission: null,
      station: null,
      startStation: null
    };

    if (landmark) landmark.y = this._sample(sector, ground, landmark.x);

    // ---- boulders ----------------------------------------------------------
    let bx = startX + rng.range(520, 760);
    const boulderSeed = (rngSeed + 99) >>> 0;
    while (bx < stationX - 430) {
      const brng = new RNG(hashString(`${this.seed}:rock:${index}:${Math.round(bx)}`));
      const gy = this._sample(sector, ground, bx);
      const cy = this._sample(sector, ceiling, bx);
      const activeCave = gy - cy < 1000;
      let radius = brng.range(16, 38 + Math.min(difficulty, 10) * 2.1);
      if (activeCave) {
        const maxR = Math.max(13, (cy - gy) * 0.3);
        radius = Math.min(radius, maxR);
      }
      if (gy - radius * 1.4 - (activeCave ? cy : -1e9) < 165) radius = 0;
      if (
        Math.abs(bx - stationX) < 520 ||
        (landmark && Math.abs(bx - landmark.x) < 220) ||
        (isFirst && Math.abs(bx - startPadX) < 500)
      ) {
        radius = 0;
      }
      if (radius > 12) {
        const rockRng = new RNG(hashString(`${this.seed}:rockshape:${index}:${Math.round(bx)}`));
        const pts = [];
        const sides = rockRng.int(7, 10);
        for (let s = 0; s < sides; s++) {
          const ang = (s / sides) * Math.PI * 2;
          const rad = radius * rockRng.range(0.68, 1.12);
          pts.push({
            x: Math.cos(ang) * rad,
            y: Math.sin(ang) * rad * brng.range(0.62, 0.82)
          });
        }
        sector.boulders.push({
          x: bx,
          y: gy,
          radius,
          top: gy - radius * 1.2,
          points: pts,
          shade: brng.range(0, 1)
        });
      }
      bx += brng.range(240, 520);
    }

    // ---- decorative pebbles ------------------------------------------------
    const pebbleCount = 62;
    for (let p = 0; p < pebbleCount; p++) {
      const px = startX + rng.range(0, length);
      if (Math.abs(px - stationX) < 300) continue;
      const gy = this._sample(sector, ground, px);
      sector.pebbles.push({
        x: px,
        y: gy,
        r: rng.range(1.2, 4.6),
        a: rng.range(0.15, 0.45),
        shade: rng.int(0, 2)
      });
    }

    // ---- stalagmites -------------------------------------------------------
    for (const cave of caveRanges) {
      let sx = cave.start + rng.range(100, 220);
      while (sx < cave.end - 120) {
        const gy = this._sample(sector, ground, sx);
        const cy = this._sample(sector, ceiling, sx);
        const h = rng.range(20, 48);
        const w = rng.range(8, 18);
        if (gy - h - cy > 185) {
          sector.stalagmites.push({ x: sx, y: gy, h, w });
        }
        sx += rng.range(210, 380);
      }
    }

    // ---- names / station ---------------------------------------------------
    const station = {
      index: index + 1,
      sector: index,
      name: stationName,
      x: Math.round(stationX),
      y: Math.round(padY),
      width: 244,
      kind: difficulty === 0 ? 'outpost' : difficulty % 3 === 1 ? 'research' : difficulty % 3 === 2 ? 'depot' : 'relay',
      style: stationRng.int(0, 2),
      sectorName,
      captureHalf: 178,
      captureHeight: 300
    };
    sector.station = station;
    this.stations[station.index] = station;
    this.sectors[index] = sector;
    this.generatedThrough = index;

    // First outpost sits before sector 1's terrain.
    if (isFirst) {
      const startStation = {
        index: 0,
        sector: 0,
        name: 'Tranquility Outpost',
        x: startPadX,
        y: Math.round(startPadY),
        width: 230,
        kind: 'start',
        style: 0,
        sectorName,
        captureHalf: 150,
        captureHeight: 250
      };
      sector.startStation = startStation;
      this.stations[0] = startStation;
    }

    // ---- landmark mission props -------------------------------------------
    const landmarkLootY = landmark
      ? Math.max(ceilingFor(sector, landmark.x) + 110, landmark.y - 130)
      : 0;
    const landmarkDiscovery = landmark
      ? {
          id: `d:${index}:landmark`,
          sector: index,
          type: 'discovery',
          x: landmark.x,
          y: landmarkLootY,
          baseY: landmarkLootY,
          groundY: landmark.y,
          mission: false,
          phase: rng.range(0, 6.28),
          landmark: true,
          label: landmark.name
        }
      : null;

    // ---- mission -----------------------------------------------------------
    let missionType = ['sample', 'rescue', 'survey', 'recover'][rng.int(0, 3)];
    if (missionType === 'survey' && !landmark) missionType = 'sample';
    if (isFirst) missionType = 'sample';
    const meta = MISSION_META[missionType];
    const target = missionType === 'rescue' && difficulty < 3 ? 1 : meta.target;
    const mission = {
      id: `m:${index}`,
      sector: index,
      type: missionType,
      title: meta.title,
      objective: meta.objective(target),
      short: meta.short(target),
      target,
      points: meta.points + Math.min(difficulty, 10) * 12,
      credits: meta.credits + Math.min(difficulty, 10) * 6,
      itemIds: [],
      stationName,
      sectorName,
      completed: false,
      landmarkName: landmark ? landmark.name : null
    };
    sector.mission = mission;

    // ---- mission + bonus pickups ------------------------------------------
    const usedPositions = [];
    const farFromRocks = (x, y) =>
      sector.boulders.every((b) => {
        const dx = x - b.x;
        const dy = y - (b.y - b.radius * 0.4);
        return dx * dx + dy * dy > (b.radius + 54) * (b.radius + 54);
      });
    const farFromItems = (x) => usedPositions.every((ux) => Math.abs(ux - x) > 105);

    const makeItem = (type, x, opts = {}) => {
      let gy = this._sample(sector, ground, x);
      let cy = this._sample(sector, ceiling, x);
      let y;
      if (opts.y != null) {
        y = opts.y;
      } else if (type === 'astronaut') {
        y = gy - 92;
      } else if (type === 'equipment') {
        y = gy - 84;
      } else {
        const low = Math.max(cy + 100, gy - 260);
        const high = gy - 64;
        y = clamp(gy - (100 + rng.next() * 120), low, high);
      }
      y = clamp(y, cy + 78, gy - 42);
      return {
        id: opts.id || `p:${index}:${type}:${sector.items.length}`,
        sector: index,
        type,
        x,
        y,
        baseY: y,
        groundY: gy,
        mission: Boolean(opts.mission),
        missionType: opts.mission ? missionType : null,
        phase: rng.range(0, Math.PI * 2),
        collected: false,
        landmark: Boolean(opts.landmark),
        label: opts.label || ''
      };
    };

    let missionItemCount = 0;
    for (let mi = 0; mi < target; mi++) {
      let px;
      let attempts = 0;
      do {
        const frac = target === 1 ? 0.5 : 0.24 + (0.56 * (mi + 0.5)) / target;
        px = startX + length * frac + rng.range(-120, 120);
        if (missionType === 'survey' && landmark) px = landmark.x + rng.range(-18, 18);
        attempts++;
      } while (
        attempts < 20 &&
        (px > stationX - 480 ||
          px < startX + 700 ||
          !farFromItems(px) ||
          !farFromRocks(px, this._sample(sector, ground, px) - 130))
      );
      px = clamp(px, startX + 620, stationX - 500);
      usedPositions.push(px);
      const itemType =
        missionType === 'sample'
          ? 'sample'
          : missionType === 'rescue'
            ? 'astronaut'
            : missionType === 'recover'
              ? 'equipment'
              : 'discovery';
      let item;
      if (missionType === 'survey' && landmark && landmarkDiscovery) {
        item = landmarkDiscovery;
        item.mission = true;
        item.missionType = 'survey';
        item.x = landmark.x + (mi - (target - 1) / 2) * 34;
        item.y = Math.max(this._sample(sector, ceiling, landmark.x) + 100, landmark.y - 128);
        item.baseY = item.y;
      } else {
        item = makeItem(itemType, Math.round(px), { mission: true });
      }
      item.id = missionType === 'survey' ? `m:${index}:site` : `m:${index}:${mi}:${itemType}`;
      item.mission = true;
      item.missionType = missionType;
      mission.itemIds.push(item.id);
      if (!sector.items.some((it) => it.id === item.id)) {
        sector.items.push(item);
        missionItemCount++;
      }
    }

    // Landmark discovery remains a bonus if it isn't the mission objective.
    if (landmarkDiscovery && !landmarkDiscovery.mission) {
      sector.items.push(landmarkDiscovery);
    }
    // Wreckage usually has a survivor; abandoned bases have spare crates.
    if (landmark && landmark.type === 'wreck') {
      const survivor = makeItem('astronaut', landmark.x + 92, {
        id: `d:${index}:wreck-survivor`,
        label: 'Apollo 18 survivor'
      });
      survivor.y = this._sample(sector, ground, survivor.x) - 92;
      survivor.baseY = survivor.y;
      sector.items.push(survivor);
    }
    if (landmark && landmark.type === 'base') {
      const crate = makeItem('equipment', landmark.x - 96, {
        id: `d:${index}:base-crate`,
        label: 'Selene base cache'
      });
      crate.y = this._sample(sector, ground, crate.x) - 84;
      crate.baseY = crate.y;
      sector.items.push(crate);
    }

    const bonusCount = 4 + Math.min(4, Math.floor(difficulty / 2)) + rng.int(0, 2);
    for (let bi = 0; bi < bonusCount; bi++) {
      let px = startX + rng.range(0.14, 0.86) * length;
      let attempts = 0;
      while (
        attempts < 30 &&
        (Math.abs(px - stationX) < 460 ||
          px < startX + 460 ||
          !farFromItems(px) ||
          !farFromRocks(px, this._sample(sector, ground, px) - 130))
      ) {
        px = startX + rng.range(0.14, 0.86) * length;
        attempts++;
      }
      usedPositions.push(px);
      const pick = rng.next();
      const type = pick < 0.46 ? 'salvage' : pick < 0.78 ? 'sample' : 'equipment';
      const item = makeItem(type, px, {
        id: `b:${index}:${type}:${bi}`
      });
      sector.items.push(item);
    }

    // ---- enemies -----------------------------------------------------------
    const droneCount = isFirst
      ? 1
      : clamp(1 + Math.floor(difficulty * 0.55) + rng.int(0, 2), 1, 6);
    for (let d = 0; d < droneCount; d++) {
      let dx = startX + rng.range(0.18, 0.88) * length;
      let attempts = 0;
      while (
        attempts < 20 &&
        (dx > stationX - 540 || dx < startX + 620 || Math.abs(dx - stationX) < 700)
      ) {
        dx = startX + rng.range(0.18, 0.88) * length;
        attempts++;
      }
      const gy = this._sample(sector, ground, dx);
      const cy = this._sample(sector, ceiling, dx);
      const minY = cy + 105;
      const maxY = gy - 95;
      const lowY = clamp(gy - rng.range(105, 270), cy + 95, gy - 80);
      sector.drones.push({
        id: `drone:${index}:${d}`,
        x: dx,
        baseX: dx,
        baseY: clamp(lowY, minY, Math.max(minY, maxY)),
        y: lowY,
        ampX: rng.range(28, 85),
        ampY: rng.range(16, 58),
        speed: rng.range(0.55, 1.1),
        phase: rng.range(0, 6.28),
        size: rng.range(15, 22),
        eye: rng.range(0, 6.28)
      });
    }

    const sentryCount = difficulty < 2 ? 0 : Math.min(3, 1 + Math.floor((difficulty - 1) / 2));
    for (let si = 0; si < sentryCount; si++) {
      let sx = startX + rng.range(0.25, 0.9) * length;
      let attempts = 0;
      while (
        attempts < 20 &&
        (sx > stationX - 500 ||
          sx < startX + 800 ||
          Math.abs(sx - stationX) < 680 ||
          (landmark && Math.abs(sx - landmark.x) < 280))
      ) {
        sx = startX + rng.range(0.25, 0.9) * length;
        attempts++;
      }
      const gy = this._sample(sector, ground, sx);
      const cy = this._sample(sector, ceiling, sx);
      const cave = gy - cy < 900;
      const ceilingMounted = cave && rng.chance(0.34);
      const overlappingRock = sector.boulders.some((b) => Math.abs(b.x - sx) < b.radius + 46);
      if (overlappingRock) continue;
      sector.sentries.push({
        id: `sentry:${index}:${si}`,
        x: sx,
        y: ceilingMounted ? cy + 18 : gy - 20,
        mounted: ceilingMounted ? 'ceiling' : 'ground',
        cooldown: rng.range(1.8, 3.8),
        charge: 0,
        phase: rng.range(0, 6.28),
        size: 20
      });
    }

    // ---- falling debris emitters ------------------------------------------
    for (const cave of caveRanges) {
      let dx = cave.start + rng.range(120, 240);
      while (dx < cave.end - 100) {
        const gy = this._sample(sector, ground, dx);
        const cy = this._sample(sector, ceiling, dx);
        if (gy - cy > 260) {
          sector.drips.push({
            id: `drip:${index}:${Math.round(dx)}`,
            x: dx,
            y: cy + 8,
            cooldown: rng.range(0, 5)
          });
        }
        dx += rng.range(210, 380);
      }
    }

    // ---- guarantee a viable corridor --------------------------------------
    for (let i = 0; i <= n; i++) {
      if (ground[i] - ceiling[i] < 212) ceiling[i] = ground[i] - 212;
    }

    // Ensure mission/bonus items are inside the navigable corridor.
    for (const item of sector.items) {
      const gy = this._sample(sector, ground, item.x);
      const cy = this._sample(sector, ceiling, item.x);
      item.baseY = clamp(item.baseY, cy + 82, gy - 44);
      item.y = item.baseY;
    }

    // Sanity pass for boulders near the station approach.
    sector.boulders = sector.boulders.filter((b) => Math.abs(b.x - stationX) > 460);
    return sector;
  }

  _sample(sector, arr, x) {
    if (!sector) return 0;
    const t = clamp((x - sector.startX) / sector.step, 0, arr.length - 1);
    const i = Math.floor(t);
    const j = Math.min(arr.length - 1, i + 1);
    return lerp(arr[i], arr[j], t - i);
  }

  groundAt(x) {
    const sector = this.sectorAt(x);
    return sector ? this._sample(sector, sector.ground, x) : 610;
  }

  ceilingAt(x) {
    const sector = this.sectorAt(x);
    return sector ? this._sample(sector, sector.ceiling, x) : -1000;
  }

  corridorAt(x) {
    return this.groundAt(x) - this.ceilingAt(x);
  }

  isCeilingActive(x) {
    return this.corridorAt(x) < 850;
  }

  sectorAt(x) {
    this._ensureInitial();
    for (let i = this.sectors.length - 1; i >= 0; i--) {
      const s = this.sectors[i];
      if (x >= s.startX && x <= s.endX) return s;
    }
    if (x < this.sectors[0].startX) return this.sectors[0];
    return null;
  }

  sectorIndexAt(x) {
    const s = this.sectorAt(x);
    return s ? s.index : this.generatedThrough;
  }

  ensureSectorForX(x, extra = 1) {
    const s = this.sectorAt(x);
    if (s) this.ensureThrough(Math.min(500, s.index + extra));
    else if (x > this.sectors[this.sectors.length - 1].endX) this.ensureAhead(x, 9000);
    return s;
  }

  getSector(index) {
    this.ensureThrough(index);
    return this.sectors[clamp(index, 0, this.sectors.length - 1)];
  }

  getStation(index) {
    const i = Math.max(0, Math.floor(index));
    if (i === 0) {
      this.ensureThrough(0);
      return this.stations[0];
    }
    this.ensureThrough(i - 1);
    return this.stations[i] || null;
  }

  checkpointSpawn(index) {
    const station = this.getStation(index);
    if (!station) {
      const s = this.getSector(0);
      return { x: 300, y: 480, station: this.stations[0], sector: s };
    }
    const sector = this.getSector(Math.max(0, station.index - 1));
    return {
      x: station.x,
      y: station.y - 104,
      station,
      sector
    };
  }

  missionForCheckpoint(index) {
    const sector = this.getSector(Math.max(0, index));
    return sector.mission;
  }

  nextPadAfter(x) {
    this._ensureInitial();
    let best = null;
    for (const station of this.stations) {
      if (!station || station.index === 0) continue;
      if (station.x > x + 12) {
        if (!best || station.x < best.x) best = station;
      }
    }
    return best;
  }

  padsNear(x, distance = 2400) {
    return this.stations.filter((s) => s && Math.abs(s.x - x) < distance);
  }

  sampleVisible(sector, fromX, toX) {
    return {
      from: Math.max(sector.startX, Math.floor(fromX / SAMPLE_STEP) * SAMPLE_STEP),
      to: Math.min(sector.endX, Math.ceil(toX / SAMPLE_STEP) * SAMPLE_STEP)
    };
  }

  getProgressLabel(item) {
    return item.type === 'sample'
      ? 'Mineral sample'
      : item.type === 'astronaut'
        ? 'Astronaut'
        : item.type === 'equipment'
          ? 'Science crate'
          : item.type === 'discovery'
            ? 'Research site'
            : 'Salvage';
  }

  describeDistance(meters) {
    return `${formatNumber(Math.max(0, Math.floor(meters)))} M`;
  }
}

function ceilingFor(sector, x) {
  const i = clamp(Math.round((x - sector.startX) / sector.step), 0, sector.ceiling.length - 1);
  return sector.ceiling[i];
}
