/* Game controller and state machine.
   Fixed-step flight simulation, missions, hazards, checkpoints and persistence. */
'use strict';

import { clamp, dist2, easeInOutCubic, formatNumber, lerp, makeSeed, TAU } from './utils.js';
import { SaveManager, UPGRADE_LIMITS } from './save.js';
import { World } from './world.js';
import { BASE_SPEED, Player, UPGRADE_INFO } from './player.js';
import { Renderer } from './renderer.js';
import { HUD } from './hud.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { Particles } from './particles.js';

const FIXED_STEP = 1 / 60;
const MAX_STEPS = 6;
const LANDING_Y_OFFSET = 54;
const PICKUP_RADIUS = 50;

const PICKUP_REWARDS = {
  sample: { score: 18, salvage: 6, sound: 'sample', label: 'MINERAL SAMPLE' },
  astronaut: { score: 82, salvage: 18, sound: 'rescue', label: 'ASTRONAUT RESCUED' },
  equipment: { score: 30, salvage: 12, sound: 'salvage', label: 'SCIENCE CRATE' },
  discovery: { score: 120, salvage: 25, sound: 'discovery', label: 'DISCOVERY LOGGED' },
  salvage: { score: 10, salvage: 10, sound: 'salvage', label: 'SALVAGE RECOVERED' }
};

const PICKUP_COLORS = {
  sample: '#89f8ff',
  astronaut: '#ffc266',
  equipment: '#84d0ff',
  discovery: '#9bffe9',
  salvage: '#ffd073'
};

const MISSION_NOUNS = {
  sample: 'samples',
  rescue: 'astronauts',
  survey: 'site scans',
  recover: 'crates'
};

const CRASH_COPY = {
  terrain: 'The descent engine lost its argument with the regolith. Emergency telemetry recovered.',
  drone: 'An alien drone cut through the descent stage. Emergency telemetry recovered.',
  sentry: 'Sentry fire overwhelmed the lander. Emergency telemetry recovered.',
  debris: 'Falling debris tore open the descent stage. Emergency telemetry recovered.',
  boulder: 'The lander struck a boulder at flight speed. Emergency telemetry recovered.',
  stalagmite: 'A cave spire tore through the lower hull. Emergency telemetry recovered.',
  collision: 'The lower hull failed under hostile contact. Emergency telemetry recovered.'
};

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.saveManager = new SaveManager();
    this.settings = this.saveManager.loadSettings();
    this.save = this.saveManager.load();
    this.best = Math.max(0, this.save?.best || 0);

    this.world = new World(this.save?.seed || makeSeed());
    this.player = null;
    this.particles = new Particles();
    this.renderer = new Renderer(canvas);
    this.hud = new HUD(this);
    this.audio = new AudioEngine(this.settings);
    this.input = new Input(canvas);
    this.ui = new UI(this);

    this.state = 'menu';
    this.pausedFrom = null;
    this.elapsed = 0;
    this.simTime = 0;
    this.accumulator = 0;
    this.score = 0;
    this.distance = 0;
    this.checkpointIndex = Math.max(0, this.save?.checkpointIndex || 0);
    this.checkpointScore = 0;
    this.checkpointDistance = 0;
    this.distanceBase = 0;
    this.runStartX = 0;

    this.collected = new Set(this.save?.collected || []);
    this.completedMissions = new Set(this.save?.completedMissions || []);
    this.discoveries = new Set(this.save?.discoveries || []);
    this._missionAnnounced = new Set();

    this.projectiles = [];
    this.debris = [];
    this.station = null;
    this.landingStation = null;
    this.landingStart = null;
    this.landingTarget = null;
    this.landingTimer = 0;
    this.landingDuration = 1;
    this.landingDust = false;
    this.lastStationResult = null;
    this.stationResume = false;

    this.crashTimer = 0;
    this.crashCamera = null;
    this.crashReason = '';
    this.gameOverShown = false;
    this.shakeAmp = 0;
    this.reducedShake = !this.settings.shake;
    this.controlsHintSeen = false;
    this.alarmTimer = 0;
    this.droneSoundTimer = 0;
    this._hostileProximity = 0;
    this._warning = null;

    this._adaptiveLow = false;
    this._lowQualityTimer = 0;
    this._frameAverage = 16.7;
    this._qualityCooldown = 0;

    this._bindInput();
    this._bindGlobalGestures();
    this.applySettings(false);
    this.showMenu();
  }

  /* ------------------------------------------------------------- BOOTSTRAP */

  _bindInput() {
    this.input.enabledCheck = () => this.state === 'playing';
    this.input.anyGestureHandler = () => this.ensureAudio();
    this.input.pauseHandler = (code) => this._handlePauseKey(code);
    this.input.attach();
  }

  _bindGlobalGestures() {
    const gesture = () => this.ensureAudio();
    window.addEventListener('pointerdown', gesture, { passive: true });
    window.addEventListener('keydown', gesture, { passive: true });
    window.addEventListener('touchstart', gesture, { passive: true });
  }

  ensureAudio() {
    if (!this.audio.ready) {
      this.audio.init();
    } else {
      this.audio.resume();
    }
    if (this.audio.ready) this.audio.applySettings(this.settings);
  }

  applySettings(persist = true) {
    this.reducedShake = !this.settings.shake;
    this.renderer.setQuality(this.settings.quality);
    this.particles.quality = this.settings.quality;
    if (this.settings.quality !== 'auto') {
      this._adaptiveLow = false;
      this.renderer.setAdaptiveLow(false);
      this.particles.adaptiveLow = false;
    }
    this.audio.applySettings(this.settings);
    if (persist) this.saveManager.saveSettings(this.settings);
  }

  /* ---------------------------------------------------------------- GETTERS */

  get currentMission() {
    if (!this.world || this.state === 'menu') return null;
    return this.world.missionForCheckpoint(Math.max(0, this.checkpointIndex));
  }

  get nextPad() {
    if (this.state === 'landing' && this.landingStation) return this.landingStation;
    if (!this.world || !this.player) return null;
    const x = this.player.x;
    let best = null;
    for (const station of this.world.stations) {
      if (!station || station.index <= this.checkpointIndex) continue;
      // Keep a passed pad as the target while the lander is still inside its
      // capture footprint; once well beyond it, switch to the next outpost.
      if (station.x < x - station.captureHalf) continue;
      if (!best || station.x < best.x) best = station;
    }
    if (!best) {
      this.world.ensureAhead(x + 5000, 1200);
      for (const station of this.world.stations) {
        if (!station || station.index <= this.checkpointIndex) continue;
        if (!best || station.x < best.x) best = station;
      }
    }
    return best;
  }

  isCollected(id) {
    return this.collected.has(id);
  }

  getMissionProgress() {
    const mission = this.currentMission;
    if (!mission) return { count: 0, target: 1, ratio: 0 };
    let count = 0;
    for (const id of mission.itemIds) {
      if (this.collected.has(id)) count++;
    }
    count = Math.min(count, mission.target);
    return {
      count,
      target: mission.target,
      ratio: mission.target > 0 ? count / mission.target : 0
    };
  }

  currentTargetSpeed() {
    if (!this.player) return BASE_SPEED;
    let target = BASE_SPEED * (1 + Math.min(0.16, this.checkpointIndex * 0.012));
    const pad = this.nextPad;
    if (pad) {
      const dx = pad.x - this.player.x;
      if (dx > 0 && dx < 1120) {
        const t = clamp((dx - 185) / 820, 0, 1);
        const eased = t * t * (3 - 2 * t);
        target = lerp(46, target, eased);
      }
    }
    if (this.world && this.world.corridorAt(this.player.x) < 880) {
      target = Math.min(target, BASE_SPEED * 0.84);
    }
    return target;
  }

  getWarning() {
    if (this.state !== 'playing' && this.state !== 'landing') return this._warning;
    if (this.state === 'landing') return 'AUTO-GUIDANCE — TOUCHDOWN';
    const p = this.player;
    if (!p) return null;
    if (p.healthRatio <= 0.3) return 'HULL CRITICAL — FIND A LANDING PAD';
    if (this._hostileProximity > 0.58) return 'HOSTILE CONTACT — EVADE';
    const pad = this.nextPad;
    if (pad) {
      const dx = pad.x - p.x;
      if (dx > 0 && dx < 620 && p.y > pad.y - pad.captureHeight - 80) {
        return 'PAD APPROACH — AUTO-GUIDANCE READY';
      }
    }
    if (p.shieldRatio < 0.12) return 'SHIELD DEPLETED';
    if (this.world && this.world.corridorAt(p.x) < 900) return 'CAVE CORRIDOR — WATCH THE CEILING';
    return null;
  }

  /* ------------------------------------------------------------ MENU / RUN */

  showMenu() {
    this.state = 'menu';
    this.pausedFrom = null;
    this.player = null;
    this.station = null;
    this.landingStation = null;
    this.crashCamera = null;
    this.score = 0;
    this.hud.hide();
    this.input.clear();
    this.audio.setActive(false);
    this.projectiles.length = 0;
    this.debris.length = 0;
    this.particles.clear();
    this.ui.hideAllScreens();
    this.best = Math.max(this.best, this.save?.best || 0);
    this.ui.showMenu({ save: this.save });
    this.renderer.snapCamera(this);
  }

  async requestNewGame() {
    const hasProgress = Boolean(this.saveManager.hasSave() || this.save);
    if (hasProgress) {
      const ok = await this.ui.confirm({
        kicker: 'NEW EXPEDITION',
        title: 'Start a new mission?',
        message:
          'This erases the current route, salvage, upgrades and mission record. Your best score and audio settings are kept.',
        confirmLabel: 'START NEW',
        danger: true
      });
      if (!ok) return;
    }
    this.startNewGame();
  }

  startNewGame() {
    const previous = this.save;
    const carriedBest = Math.max(this.best, previous?.best || 0, Math.floor(this.score || 0));
    const previousRuns = previous?.stats?.runs || 0;

    this.saveManager.clearProgress();
    const fresh = this.saveManager.newRun();
    fresh.best = carriedBest;
    fresh.stats.runs = Math.max(1, previousRuns + 1);
    this.save = fresh;
    this.best = carriedBest;
    this.world = new World(fresh.seed);
    this.checkpointIndex = 0;
    this.checkpointScore = 0;
    this.checkpointDistance = 0;
    this.distanceBase = 0;
    this.runStartX = 0;
    this.score = 0;
    this.distance = 0;
    this.lastStationResult = null;
    this._missionAnnounced.clear();
    this._resetSets();
    this._createPlayer();
    this.controlsHintSeen = false;
    this.openStation(0, { resume: false, saveNow: true });
  }

  continueGame() {
    const loaded = this.saveManager.load();
    if (!loaded) {
      this.startNewGame();
      return;
    }
    this.save = loaded;
    this.best = Math.max(this.best, loaded.best || 0);
    this.world = new World(loaded.seed);
    this.checkpointIndex = clamp(Math.floor(loaded.checkpointIndex || 0), 0, 500);
    this.checkpointScore = Math.max(0, loaded.checkpoint?.score || 0);
    this.checkpointDistance = Math.max(0, loaded.checkpoint?.distance || 0);
    this.score = this.checkpointScore;
    this.distance = this.checkpointDistance;
    this.distanceBase = this.distance;
    this.lastStationResult = null;
    this._missionAnnounced.clear();
    this._resetSets();
    this._createPlayer();
    this.openStation(this.checkpointIndex, { resume: true, saveNow: false });
  }

  _resetSets() {
    this.collected = new Set(this.save?.collected || []);
    this.completedMissions = new Set(this.save?.completedMissions || []);
    this.discoveries = new Set(this.save?.discoveries || []);
  }

  _createPlayer() {
    const player = new Player();
    player.applyUpgrades(this.save?.upgrades || {});
    player.healFull();
    this.player = player;
    return player;
  }

  _handlePauseKey(code) {
    if (this.ui.handleEscape()) return true;
    if (this.state === 'playing' || this.state === 'landing') {
      this.togglePause();
      return true;
    }
    if (this.state === 'paused') {
      this.resume();
      return true;
    }
    return false;
  }

  togglePause() {
    if (this.state === 'playing' || this.state === 'landing') {
      this.pausedFrom = this.state;
      this.state = 'paused';
      this.input.clear();
      this.audio.setActive(false);
      this.ui.showPause();
    } else if (this.state === 'paused') {
      this.resume();
    }
  }

  autoPause() {
    if (this.state === 'playing' || this.state === 'landing') {
      this.togglePause();
    }
  }

  resume() {
    if (this.state !== 'paused') return;
    this.ui.hideAllScreens();
    this.state = this.pausedFrom || 'playing';
    this.pausedFrom = null;
    this.hud.show();
    this.input.clear();
    this.audio.setActive(true);
    this._frameAverage = 16.7;
  }

  quitToMenu() {
    if (this.save) this._syncSave(true);
    this.hud.hide();
    this.ui.hideAllScreens();
    this.input.clear();
    this.audio.setActive(false);
    this.state = 'menu';
    this.pausedFrom = null;
    this.player = null;
    this.station = null;
    this.landingStation = null;
    this.crashCamera = null;
    this.lastStationResult = null;
    this.projectiles.length = 0;
    this.debris.length = 0;
    this.particles.clear();
    this.best = Math.max(this.best, this.save?.best || 0);
    this.ui.showMenu({ save: this.save });
    this.renderer.snapCamera(this);
  }

  /* --------------------------------------------------------------- STATION */

  openStation(index, { resume = false, saveNow = false } = {}) {
    this.world.ensureThrough(Math.max(0, index));
    const station = this.world.getStation(index) || this.world.getStation(0);
    if (!station) return;
    this.checkpointIndex = station.index;
    this.station = station;
    this.stationResume = Boolean(resume);
    this.landingStation = null;
    this.crashCamera = null;
    this.crashTimer = 0;
    this.gameOverShown = false;
    this.pausedFrom = null;
    this.projectiles.length = 0;
    this.debris.length = 0;
    this.particles.clear();

    if (!this.player) this._createPlayer();
    this.player.applyUpgrades(this.save.upgrades || {});
    this.player.resetAt(station.x, station.y - LANDING_Y_OFFSET, this.save.upgrades);
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.landing = true;
    this.player.thrusting = false;
    this.player.invuln = 3;
    this.player.healFull();

    if (!Number.isFinite(this.score)) this.score = 0;
    if (!Number.isFinite(this.distance)) this.distance = 0;
    this.checkpointScore = this.score;
    this.checkpointDistance = this.distance;
    this.distanceBase = this.distance;
    this.runStartX = station.x;

    this.save.checkpointIndex = station.index;
    this.save.checkpoint = {
      stationName: station.name,
      sector: station.sector,
      x: station.x,
      y: station.y,
      score: this.score,
      distance: this.distance
    };
    this.save.score = this.score;
    this.save.stats.distance = Math.max(this.save.stats.distance || 0, this.distance);
    this.save.best = Math.max(this.save.best || 0, this.best, Math.floor(this.score));
    this.best = this.save.best;

    this.state = 'station';
    this.hud.hide();
    this.input.clear();
    this.audio.setActive(false);
    this.ui.hideAllScreens();
    this.ui.showStation(this.getStationView());
    this.world.ensureAhead(station.x + 7000, 2500);
    this.renderer.snapCamera(this);
    if (saveNow) this._syncSave(true);
  }

  getStationView() {
    const station = this.station || this.world?.getStation(this.checkpointIndex);
    let lastMission = null;
    if (station && station.index > 0) {
      const mission = this.world.getSector(station.index - 1).mission;
      if (mission) {
        const progress = this._countMission(mission);
        const saved = this.lastStationResult;
        const matches =
          saved &&
          saved.stationIndex === station.index &&
          saved.missionId === mission.id;
        const completedNow = Boolean(matches && saved.completedNow);
        const alreadyComplete = matches
          ? Boolean(saved.alreadyComplete)
          : this.completedMissions.has(mission.id);
        const skipped = !completedNow && !alreadyComplete;
        lastMission = {
          title: mission.title,
          progress,
          target: mission.target,
          short: MISSION_NOUNS[mission.type] || 'objectives',
          completedNow,
          alreadyComplete,
          skipped,
          rewardPoints: matches ? saved.rewardPoints || 0 : 0,
          rewardCredits: matches ? saved.rewardCredits || 0 : 0,
          copy: this._debriefCopy(mission, { completedNow, alreadyComplete, skipped })
        };
      }
    }

    const nextMission = station ? this.world.missionForCheckpoint(station.index) : null;
    return {
      station,
      lastMission,
      nextMission,
      resume: this.stationResume
    };
  }

  _debriefCopy(mission, status) {
    if (status.completedNow) {
      return `Outpost telemetry confirms the ${mission.title.toLowerCase()} objective. The salvage bonus has been transferred to your account.`;
    }
    if (status.alreadyComplete) {
      return 'This objective is already recorded in the expedition log. No duplicate mission bonus was issued.';
    }
    return `The landing pad was reached before the ${mission.title.toLowerCase()} objective was complete. No mission bonus was awarded.`;
  }

  buyUpgrade(key) {
    if (this.state !== 'station' || !this.save) return false;
    const info = UPGRADE_INFO[key];
    if (!info) return false;
    const max = UPGRADE_LIMITS[key] || 4;
    const level = this.save.upgrades?.[key] || 0;
    if (level >= max) return false;
    const cost = info.costs[level] || 0;
    if ((this.save.salvage || 0) < cost) {
      this.audio.play('deny');
      return false;
    }
    this.save.salvage = Math.floor((this.save.salvage || 0) - cost);
    this.save.upgrades[key] = level + 1;
    if (this.player) {
      this.player.applyUpgrades(this.save.upgrades);
      this.player.healFull();
    }
    this.save.best = Math.max(this.save.best || 0, this.best, Math.floor(this.score));
    this._syncSave(true);
    this.audio.play('click');
    this.hud.toast(`${info.name.toUpperCase()} // LEVEL ${level + 1}`, 'good');
    return true;
  }

  launch() {
    const station = this.station || this.world?.getStation(this.checkpointIndex);
    if (!station || !this.save) return;
    const cp = this.save.checkpoint || {};
    this.score = Math.max(0, cp.score ?? this.score);
    this.distance = Math.max(0, cp.distance ?? this.distance);
    this.checkpointScore = this.score;
    this.checkpointDistance = this.distance;
    this.distanceBase = this.distance;
    this.runStartX = station.x;

    if (!this.player) this._createPlayer();
    this.player.resetAt(station.x, station.y - 104, this.save.upgrades || {});
    this.player.invuln = 3;
    this.player.vx = BASE_SPEED * 0.52;
    this.player.vy = 0;

    this.state = 'playing';
    this.station = null;
    this.stationResume = false;
    this.landingStation = null;
    this.lastStationResult = null;
    this.crashCamera = null;
    this.crashTimer = 0;
    this.gameOverShown = false;
    this.alarmTimer = 1.2;
    this.shakeAmp = 0;
    this.projectiles.length = 0;
    this.debris.length = 0;
    this.particles.clear();
    this.input.clear();

    this.ui.hideAllScreens();
    this.hud.show();
    this.audio.setActive(true);
    this.audio.play('launch');
    this._syncSave(true);
    this.renderer.snapCamera(this);

    const mission = this.currentMission;
    if (mission) {
      this.hud.toast(`MISSION // ${mission.title}: ${mission.objective.toUpperCase()}`, 'good');
      this._maybeAnnounceMissionReady();
    }
  }

  /* ---------------------------------------------------------------- FLIGHT */

  tick(frameDt) {
    const dt = clamp(Number.isFinite(frameDt) ? frameDt : 0, 0, 0.1);
    this.elapsed += dt;

    if (this.state === 'playing' || this.state === 'landing' || this.state === 'crashing' || this.state === 'gameover') {
      this.accumulator = Math.min(this.accumulator + dt, 0.2);
      let steps = 0;
      while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS) {
        this._step(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
        steps++;
      }
      if (steps >= MAX_STEPS) this.accumulator = 0;
    } else {
      this.accumulator = 0;
    }

    this.renderer.updateCamera(this, dt);
    this.renderer.render(this);
    this.hud.update(dt);
    if (this.state === 'playing' || this.state === 'landing') {
      this.audio.update(dt, {
        thrusting: Boolean(this.player?.thrusting),
        speed: this.player?.vx || 0,
        alienProximity: this._hostileProximity,
        intensity: clamp((this.player?.healthRatio ?? 1) < 0.35 ? 0.9 : 0.45, 0, 1)
      });
    }
    this._measurePerformance(dt);
  }

  _step(dt) {
    this.simTime += dt;
    this.shakeAmp *= Math.exp(-9 * dt);
    if (this.shakeAmp < 0.03) this.shakeAmp = 0;

    if (this.state === 'playing') {
      this._updateFlight(dt);
      this.particles.update(dt);
    } else if (this.state === 'landing') {
      this._updateLanding(dt);
      this.particles.update(dt);
    } else if (this.state === 'crashing') {
      this.crashTimer += dt;
      this.particles.update(dt);
      if (this.crashTimer >= 2.6) this._showGameOver();
    } else if (this.state === 'gameover') {
      this.particles.update(dt);
    }
  }

  _updateFlight(dt) {
    const player = this.player;
    if (!player) return;
    const thrust = this.input.isThrustHeld();
    if (thrust) this.controlsHintSeen = true;

    player.update(dt, thrust, this.world, this);
    if (this.state !== 'playing') return;

    this._updateDistance(dt);
    this._updateHazards(dt);
    if (this.state !== 'playing') return;
    this._updateAlarm(dt);
    this._tryPadCapture();
  }

  _updateDistance(dt) {
    const player = this.player;
    if (!player || !this.save) return;
    const meters = this.distanceBase + Math.max(0, (player.x - this.runStartX) / 8);
    if (meters > this.distance) {
      this.score += (meters - this.distance) * 0.55;
      this.distance = meters;
      this.save.stats.distance = Math.max(this.save.stats.distance || 0, this.distance);
    }
    this.score += dt * 0.6;
    this.best = Math.max(this.best, Math.floor(this.score));
  }

  _updateAlarm(dt) {
    const player = this.player;
    if (!player || !player.alive) return;
    if (player.healthRatio <= 0.3) {
      this.alarmTimer -= dt;
      if (this.alarmTimer <= 0) {
        this.audio.play('alarm');
        this.alarmTimer = 2.15;
      }
    } else {
      this.alarmTimer = Math.max(this.alarmTimer, 0.8);
    }
  }

  _updateHazards(dt) {
    const player = this.player;
    if (!player || !this.world) return;
    this.world.ensureAhead(player.x + 6500, 1600);
    let proximity = 0;
    let nearSentry = false;
    this.droneSoundTimer = Math.max(0, this.droneSoundTimer - dt);

    for (const sector of this.world.sectors) {
      if (sector.endX < player.x - 320 || sector.startX > player.x + 1900) continue;

      // Pickups ----------------------------------------------------------
      for (const item of sector.items) {
        if (this.collected.has(item.id)) continue;
        const dx = item.x - player.x;
        const dy = (item.baseY ?? item.y) - player.y;
        if (dx * dx + dy * dy <= PICKUP_RADIUS * PICKUP_RADIUS) {
          this._collectItem(item);
        }
      }

      // Boulders ---------------------------------------------------------
      for (const boulder of sector.boulders) {
        if (Math.abs(boulder.x - player.x) > boulder.radius + 80) continue;
        const top = boulder.top ?? boulder.y - boulder.radius;
        const touching =
          player.x + player.halfW > boulder.x - boulder.radius * 0.78 &&
          player.x - player.halfW < boulder.x + boulder.radius * 0.78 &&
          player.y + player.halfH + 6 > top &&
          player.y - player.halfH < boulder.y + 8;
        if (touching) {
          this.particles.emitImpact(player.x, player.y + 14, 1.1);
          this._applyDamage(8 + boulder.radius * 0.22, 'boulder', player.x, player.y);
          player.vy = -Math.max(90, Math.abs(player.vy) * 0.35);
          player.vx = Math.max(28, player.vx * 0.55);
          player.x = boulder.x + (player.x < boulder.x ? -1 : 1) * (boulder.radius + player.halfW);
          if (this.state !== 'playing') return;
        }
      }

      // Stalagmites ------------------------------------------------------
      for (const spire of sector.stalagmites) {
        const tip = spire.y - spire.h;
        if (
          Math.abs(player.x - spire.x) < spire.w + player.halfW &&
          player.y + player.halfH + 4 > tip &&
          player.y - player.halfH < spire.y
        ) {
          this.particles.emitImpact(player.x, tip + 8, 0.8);
          this._applyDamage(7 + spire.h * 0.07, 'stalagmite', player.x, player.y);
          player.vy = -Math.max(75, player.vy * 0.2);
          player.x = spire.x + (player.x < spire.x ? -1 : 1) * (spire.w + player.halfW + 3);
          if (this.state !== 'playing') return;
        }
      }

      // Alien drones -----------------------------------------------------
      for (const drone of sector.drones) {
        drone.x =
          drone.baseX +
          Math.sin(this.simTime * drone.speed + drone.phase) * drone.ampX;
        drone.y =
          drone.baseY +
          Math.sin(this.simTime * drone.speed * 1.32 + drone.phase * 1.7) * drone.ampY;
        const gy = this.world.groundAt(drone.x);
        const cy = this.world.ceilingAt(drone.x);
        drone.y = clamp(drone.y, cy + 46, gy - 38);

        const d = Math.sqrt(dist2(drone.x, drone.y, player.x, player.y));
        if (d < 800) proximity = Math.max(proximity, 1 - d / 800);
        if (d < 540 && this.droneSoundTimer <= 0) {
          this.audio.play('drone');
          this.droneSoundTimer = 4.5;
        }
        if (d < drone.size + player.halfW - 3) {
          const hit = this._applyDamage(12 + this.checkpointIndex * 0.28, 'drone', drone.x, drone.y);
          if (hit.healthDamage > 0 || hit.shieldAbsorbed > 0) {
            player.vx *= 0.55;
            player.vy = -Math.max(70, player.vy * 0.3);
            player.x -= 24;
          }
          if (this.state !== 'playing') return;
        }
      }

      // Sentries ---------------------------------------------------------
      for (const sentry of sector.sentries) {
        const dx = sentry.x - player.x;
        if (Math.abs(dx) > 1350) continue;
        const d = Math.sqrt(dist2(sentry.x, sentry.y, player.x, player.y));
        if (d < 850) proximity = Math.max(proximity, 1 - d / 850);
        if (d < 1200) nearSentry = true;

        if (sentry.charge > 0) {
          sentry.charge -= dt;
          if (sentry.charge <= 0) {
            this._spawnSentryShot(sentry);
            this.audio.play('sentry');
            sentry.cooldown = 2.4 + Math.random() * 1.9;
          }
        } else {
          sentry.cooldown -= dt;
          if (sentry.cooldown <= 0 && d < 1050) {
            sentry.charge = 0.62;
          }
        }

        if (d < 42 && player.invuln <= 0) {
          this._applyDamage(9, 'sentry', sentry.x, sentry.y);
          player.vy = -100;
          if (this.state !== 'playing') return;
        }
      }

      // Falling debris emitters -----------------------------------------
      for (const drip of sector.drips) {
        if (Math.abs(drip.x - player.x) > 1000) continue;
        drip.cooldown -= dt;
        if (drip.cooldown <= 0) {
          drip.cooldown = 2.8 + Math.random() * 3.6;
          if (this.debris.length < 34) this._spawnFallingDebris(drip);
        }
      }
    }

    this._updateProjectiles(dt);
    if (this.state !== 'playing') return;
    this._updateDebris(dt);
    this._hostileProximity = proximity;
    if (nearSentry && this.droneSoundTimer <= 0 && proximity > 0.4) {
      this.droneSoundTimer = 3.8;
    }
  }

  _spawnSentryShot(sentry) {
    const player = this.player;
    if (!player) return;
    const dist = Math.max(1, Math.sqrt(dist2(sentry.x, sentry.y, player.x, player.y)));
    const travel = dist / 285;
    const tx = player.x + player.vx * travel * 0.34;
    const ty = player.y + player.vy * travel * 0.22;
    const ang = Math.atan2(ty - sentry.y, tx - sentry.x);
    const speed = 285;
    this.projectiles.push({
      x: sentry.x,
      y: sentry.y - (sentry.mounted === 'ceiling' ? 10 : 22),
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      life: 4.4,
      radius: 8,
      damage: 11 + Math.min(5, this.checkpointIndex * 0.16),
      phase: Math.random() * TAU
    });
    if (this.projectiles.length > 48) this.projectiles.shift();
  }

  _updateProjectiles(dt) {
    const player = this.player;
    if (!player) return;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const orb = this.projectiles[i];
      orb.x += orb.vx * dt;
      orb.y += orb.vy * dt;
      orb.life -= dt;
      if (orb.life <= 0) {
        this.projectiles.splice(i, 1);
        continue;
      }
      const gy = this.world.groundAt(orb.x);
      const cy = this.world.ceilingAt(orb.x);
      if (orb.y > gy - 2 || orb.y < cy + 2) {
        this.particles.emitImpact(orb.x, orb.y, 0.45);
        this.projectiles.splice(i, 1);
        continue;
      }
      if (Math.abs(orb.x - player.x) > 700) {
        this.projectiles.splice(i, 1);
        continue;
      }
      const rr = orb.radius + player.halfW - 2;
      if (dist2(orb.x, orb.y, player.x, player.y) < rr * rr) {
        this._applyDamage(orb.damage, 'sentry', orb.x, orb.y);
        this.projectiles.splice(i, 1);
        if (this.state !== 'playing') return;
      }
    }
  }

  _spawnFallingDebris(drip) {
    const pts = [];
    const sides = 5 + Math.floor(Math.random() * 3);
    const size = 7 + Math.random() * 8;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * TAU;
      const r = size * (0.62 + Math.random() * 0.48);
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    this.debris.push({
      x: drip.x + (Math.random() - 0.5) * 28,
      y: drip.y + 4,
      vx: (Math.random() - 0.5) * 24,
      vy: 18 + Math.random() * 34,
      rot: Math.random() * TAU,
      spin: (Math.random() - 0.5) * 5,
      size,
      pts,
      life: 8,
      damage: 9 + Math.min(4, this.checkpointIndex * 0.14)
    });
  }

  _updateDebris(dt) {
    const player = this.player;
    if (!player) return;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const rock = this.debris[i];
      rock.life -= dt;
      rock.vy += 420 * dt;
      rock.x += rock.vx * dt;
      rock.y += rock.vy * dt;
      rock.rot += rock.spin * dt;
      if (rock.life <= 0) {
        this.debris.splice(i, 1);
        continue;
      }
      if (Math.abs(rock.x - player.x) > 1000) {
        this.debris.splice(i, 1);
        continue;
      }
      const gy = this.world.groundAt(rock.x);
      if (rock.y >= gy - 4) {
        this.particles.emitDust(rock.x, gy - 2, 0.8, { power: 1 });
        this.debris.splice(i, 1);
        continue;
      }
      const rr = rock.size + player.halfW - 2;
      if (dist2(rock.x, rock.y, player.x, player.y) < rr * rr) {
        this.particles.emitImpact(rock.x, rock.y, 0.9);
        this._applyDamage(rock.damage, 'debris', rock.x, rock.y);
        this.debris.splice(i, 1);
        if (this.state !== 'playing') return;
      }
    }
  }

  _collectItem(item) {
    if (this.collected.has(item.id)) return;
    this.collected.add(item.id);
    const reward = PICKUP_REWARDS[item.type] || PICKUP_REWARDS.salvage;
    this.score += reward.score;
    if (this.save) {
      this.save.salvage = Math.floor((this.save.salvage || 0) + reward.salvage);
      if (!this.save.stats) this.save.stats = {};
      if (item.type === 'sample') this.save.stats.samples = (this.save.stats.samples || 0) + 1;
      if (item.type === 'astronaut') this.save.stats.rescues = (this.save.stats.rescues || 0) + 1;
      if (item.type === 'discovery') {
        this.save.stats.discoveries = (this.save.stats.discoveries || 0) + 1;
        this.discoveries.add(item.id);
      }
    }
    this.particles.emitPickup(item.x, item.baseY ?? item.y, PICKUP_COLORS[item.type] || '#9ef7ff');
    this.audio.play(reward.sound || 'pickup');
    this.best = Math.max(this.best, Math.floor(this.score));

    let label = reward.label;
    if (item.type === 'discovery' && item.label) label = `DISCOVERY // ${item.label.toUpperCase()}`;
    else if (item.type === 'astronaut' && item.label) label = `RESCUED // ${item.label.toUpperCase()}`;
    this.hud.toast(`${label}  +${formatNumber(reward.score)}`, 'good');
    this._maybeAnnounceMissionReady();
    this._syncSave(false);
  }

  _maybeAnnounceMissionReady() {
    const mission = this.currentMission;
    if (!mission) return;
    const progress = this.getMissionProgress();
    if (progress.count < progress.target) return;
    if (this._missionAnnounced.has(mission.id)) return;
    this._missionAnnounced.add(mission.id);
    this.audio.play('mission');
    this.hud.toast(
      `${mission.title} READY — REACH ${mission.stationName.toUpperCase()}`,
      'good'
    );
  }

  _countMission(mission) {
    if (!mission) return 0;
    let count = 0;
    for (const id of mission.itemIds) {
      if (this.collected.has(id)) count++;
    }
    return Math.min(count, mission.target);
  }

  _applyDamage(amount, source, x, y) {
    const player = this.player;
    if (!player || (this.state !== 'playing' && this.state !== 'landing')) {
      return { shieldAbsorbed: 0, healthDamage: 0, dead: false };
    }
    const result = player.takeDamage(amount, source);
    if (!result) return { shieldAbsorbed: 0, healthDamage: 0, dead: false };
    if (result.shieldAbsorbed <= 0 && result.healthDamage <= 0 && !result.dead) return result;

    const px = Number.isFinite(x) ? x : player.x;
    const py = Number.isFinite(y) ? y : player.y;
    if (result.shieldAbsorbed > 0) {
      this.particles.emitShieldHit(player.x, player.y);
      this.audio.play('shield');
    }
    if (result.healthDamage > 0) {
      this.particles.emitDamage(px, py);
      this.audio.play('damage');
      this.shake(clamp(3.5 + result.healthDamage * 0.34, 4, 13));
    }
    if (result.dead) {
      this._crash(source || 'collision');
    }
    return result;
  }

  shake(amount) {
    if (!Number.isFinite(amount)) return;
    if (this.reducedShake) amount *= 0.35;
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  onTerrainCollision(amount, impact) {
    if (this.state !== 'playing') return;
    const player = this.player;
    this.particles.emitImpact(player.x, player.y + 18, clamp(impact / 190, 0.5, 1.5));
    this._applyDamage(amount, 'terrain', player.x, player.y);
    this.shake(clamp(impact * 0.03, 1.5, 9));
  }

  onTerrainScrape() {
    if (this.state !== 'playing' || !this.player) return;
    this.particles.emitDust(this.player.x, this.world.groundAt(this.player.x), 0.35, { power: 0.6 });
    this.shake(0.6);
  }

  emitDamageSpark(x, y) {
    this.particles.emitDamage(x, y);
  }

  emitDamageSmoke(x, y) {
    this.particles.emitSmoke(x, y);
  }

  emitThrustParticles(player) {
    if (!player) return;
    const power = 0.7 + (player.engineHeat || 0) * 0.45;
    this.particles.emitThrust(
      player.x + (Math.random() - 0.5) * 9,
      player.y + 38,
      -player.vx * 0.08,
      player.vy,
      power
    );
  }

  /* --------------------------------------------------------------- LANDING */

  _tryPadCapture() {
    const player = this.player;
    if (!player || !player.alive) return;
    const pad = this.nextPad;
    if (!pad) return;
    const dx = Math.abs(player.x - pad.x);
    const ceiling = pad.y - pad.captureHeight;
    if (dx > pad.captureHalf || player.y < ceiling || player.y > pad.y - 10) return;
    this._beginLanding(pad);
  }

  _beginLanding(pad) {
    const player = this.player;
    if (!player) return;
    this.state = 'landing';
    this.landingStation = pad;
    this.landingStart = { x: player.x, y: player.y };
    this.landingTarget = { x: pad.x, y: pad.y - LANDING_Y_OFFSET };
    this.landingTimer = 0;
    this.landingDust = false;
    const dx = Math.abs(pad.x - player.x);
    const dy = Math.abs(this.landingTarget.y - player.y);
    this.landingDuration = clamp(0.8 + dx / 520 + dy / 540, 0.9, 2.15);
    player.landing = true;
    player.thrusting = false;
    player.vx = 0;
    player.vy = 0;
    this.projectiles.length = 0;
    this.debris.length = 0;
    this.input.clear();
    this.audio.play('pad');
    this.hud.toast(`AUTO-GUIDANCE // ${pad.name.toUpperCase()}`, 'good');
  }

  _updateLanding(dt) {
    const player = this.player;
    const station = this.landingStation;
    if (!player || !station) return;
    this.landingTimer += dt;
    const k = clamp(this.landingTimer / this.landingDuration, 0, 1);
    const eased = easeInOutCubic(k);
    const lift = Math.sin(k * Math.PI) * 9;
    player.x = lerp(this.landingStart.x, this.landingTarget.x, eased);
    player.y = lerp(this.landingStart.y, this.landingTarget.y, eased) - lift;
    player.vx = (this.landingTarget.x - this.landingStart.x) / this.landingDuration;
    player.vy = (this.landingTarget.y - this.landingStart.y) / this.landingDuration;
    player.time += dt;
    player.thrusting = k < 0.72;
    player.engineHeat += ((player.thrusting ? 0.75 : 0.1) - player.engineHeat) * Math.min(1, dt * 8);
    player.tilt += (Math.sin(k * Math.PI) * 0.03 - player.tilt) * Math.min(1, dt * 5);
    player.invuln = Math.max(player.invuln, 0.2);

    if (player.thrusting && Math.random() < 0.5) {
      this.emitThrustParticles(player);
    }
    if (!this.landingDust && k > 0.78) {
      this.landingDust = true;
      this.particles.emitLanding(station.x, station.y - 7);
      this.shake(1.2);
    }
    if (k >= 1) {
      this._completeLanding(station);
    }
  }

  _completeLanding(station) {
    if (this.state !== 'landing') return;
    this.audio.play('landing');
    this.particles.emitLanding(station.x, station.y - 7);
    this._finalizeMission(station);
    this.save.stats.distance = Math.max(this.save.stats.distance || 0, this.distance);
    this.save.best = Math.max(this.save.best || 0, this.best, Math.floor(this.score));
    this.best = this.save.best;
    this.openStation(station.index, { resume: false, saveNow: true });
  }

  _finalizeMission(station) {
    const mission = this.world.getSector(station.sector).mission;
    if (!mission) {
      this.lastStationResult = null;
      return;
    }
    const progress = this._countMission(mission);
    const alreadyComplete = this.completedMissions.has(mission.id);
    const completedNow = !alreadyComplete && progress >= mission.target;
    let rewardPoints = 0;
    let rewardCredits = 0;
    if (completedNow) {
      rewardPoints = mission.points;
      rewardCredits = mission.credits;
      this.completedMissions.add(mission.id);
      this.score += rewardPoints;
      this.save.salvage = Math.floor((this.save.salvage || 0) + rewardCredits);
      this.save.stats.missions = (this.save.stats.missions || 0) + 1;
      mission.completed = true;
      this.audio.play('mission');
      this.best = Math.max(this.best, Math.floor(this.score));
    }
    this.lastStationResult = {
      stationIndex: station.index,
      missionId: mission.id,
      progress,
      completedNow,
      alreadyComplete,
      rewardPoints,
      rewardCredits
    };
  }

  /* ---------------------------------------------------------- CRASH / RESPAWN */

  _crash(reason) {
    if (this.state === 'crashing' || this.state === 'gameover') return;
    this.state = 'crashing';
    this.pausedFrom = null;
    this.crashReason = reason || 'collision';
    this.crashTimer = 0;
    this.gameOverShown = false;
    this.player.alive = false;
    this.player.thrusting = false;
    this.crashCamera = { x: this.player.x, y: this.player.y };
    this.particles.emitExplosion(this.player.x, this.player.y, 1.35);
    this.projectiles.length = 0;
    this.debris.length = 0;
    this.shake(17);
    this.audio.play('explosion');
    this.audio.setActive(false);
    this.input.clear();
    this.best = Math.max(this.best, Math.floor(this.score));

    if (this.save) {
      this.save.best = Math.max(this.save.best || 0, this.best);
      this.save.stats.crashes = (this.save.stats.crashes || 0) + 1;
      this.save.stats.distance = Math.max(this.save.stats.distance || 0, this.distance);
      this._syncSave(true);
    }
  }

  _showGameOver() {
    if (this.state !== 'crashing' || this.gameOverShown) return;
    this.gameOverShown = true;
    this.state = 'gameover';
    this.hud.hide();
    this.ui.showCrash({
      score: Math.floor(this.score),
      best: Math.max(this.best, Math.floor(this.score)),
      distance: Math.floor(this.distance),
      salvage: Math.floor(this.save?.salvage || 0),
      missions: this.save?.stats?.missions || 0,
      rescues: this.save?.stats?.rescues || 0,
      copy: CRASH_COPY[this.crashReason] || CRASH_COPY.collision
    });
  }

  async requestRestartCheckpoint() {
    if (!this.save) return;
    const ok = await this.ui.confirm({
      kicker: 'CHECKPOINT RECALL',
      title: 'Return to the last checkpoint?',
      message:
        'Live distance and score since the checkpoint will be lost. Collected salvage, upgrades and mission discoveries are kept.',
      confirmLabel: 'RETURN',
      danger: true
    });
    if (!ok) return;
    this.respawnAtCheckpoint();
  }

  respawnAtCheckpoint() {
    if (!this.save) return;
    this.score = Math.max(0, this.save.checkpoint?.score || 0);
    this.distance = Math.max(0, this.save.checkpoint?.distance || 0);
    this.checkpointScore = this.score;
    this.checkpointDistance = this.distance;
    this.distanceBase = this.distance;
    this.lastStationResult = null;
    this.crashTimer = 0;
    this.crashCamera = null;
    this.crashReason = '';
    this.gameOverShown = false;
    this.stationResume = true;
    this.openStation(this.save.checkpointIndex || 0, { resume: true, saveNow: true });
  }

  /* --------------------------------------------------------------- SAVE */

  _syncSave(immediate = false) {
    if (!this.save) return;
    const save = this.save;
    save.checkpointIndex = Math.max(0, Math.floor(this.checkpointIndex || 0));
    if (!save.checkpoint) {
      save.checkpoint = {
        stationName: 'Tranquility Outpost',
        sector: 0,
        x: 180,
        y: 560,
        score: 0,
        distance: 0
      };
    }
    save.score = Math.max(0, save.checkpoint.score || 0);
    save.best = Math.max(save.best || 0, this.best || 0, Math.floor(this.score || 0));
    save.salvage = Math.max(0, Math.floor(save.salvage || 0));
    save.collected = [...this.collected];
    save.completedMissions = [...this.completedMissions];
    save.discoveries = [...this.discoveries];
    save.upgrades = { ...save.upgrades };
    if (save.stats) {
      save.stats.distance = Math.max(save.stats.distance || 0, this.distance || 0);
    }
    this.saveManager.save(save, { immediate });
  }

  persistNow() {
    this._syncSave(true);
    this.saveManager.flush();
  }

  /* --------------------------------------------------------------- AUDIO UI */

  playClick() {
    this.ensureAudio();
    this.audio.play('click');
  }

  /* --------------------------------------------------------- PERFORMANCE */

  _measurePerformance(dt) {
    if (dt <= 0) return;
    const ms = dt * 1000;
    this._frameAverage = this._frameAverage * 0.92 + ms * 0.08;
    if (this.settings.quality !== 'auto' || this._adaptiveLow) return;
    this._qualityCooldown = Math.max(0, this._qualityCooldown - dt);
    if (this._frameAverage > 27) {
      this._lowQualityTimer += dt;
    } else {
      this._lowQualityTimer = Math.max(0, this._lowQualityTimer - dt * 0.6);
    }
    if (this._lowQualityTimer > 2.6 && this._qualityCooldown <= 0) {
      this._adaptiveLow = true;
      this.renderer.setAdaptiveLow(true);
      this.particles.adaptiveLow = true;
      this._qualityCooldown = 10;
    }
  }
}
