/* Arcade flight model, health/shield systems and upgrade math. */
'use strict';

import { clamp, damp } from './utils.js';

export const GRAVITY = 520;
export const BASE_THRUST = 1280;
export const BASE_SPEED = 182;
export const MAX_FALL = 390;
export const MAX_RISE = 340;

export const UPGRADE_INFO = {
  engine: {
    name: 'Engine Tuning',
    short: 'ENGINE',
    desc: 'Vector nozzles respond faster. +7% thrust and +4% climb rate per level.',
    costs: [35, 60, 95, 140]
  },
  shield: {
    name: 'Deflector Shield',
    short: 'SHIELD',
    desc: 'Ablative field absorbs damage. +24 field and quicker recharge per level.',
    costs: [40, 70, 105, 150]
  },
  hull: {
    name: 'Hull Plating',
    short: 'HULL',
    desc: 'Layered titanium composite. +22 maximum hull integrity per level.',
    costs: [30, 55, 85, 125]
  },
  fuel: {
    name: 'Auxiliary Tanks',
    short: 'FUEL',
    desc: 'Cosmetic external fuel pods and trim lights. Fuel is always unlimited.',
    costs: [20, 35, 55, 80]
  }
};

export class Player {
  constructor() {
    this.x = 180;
    this.y = 450;
    this.vx = BASE_SPEED;
    this.vy = 0;
    this.halfW = 27;
    this.halfH = 26;
    this.health = 100;
    this.maxHealth = 100;
    this.shield = 80;
    this.shieldMax = 80;
    this.shieldResist = 0;
    this.shieldRegen = 1.5;
    this.invuln = 0;
    this.lastDamage = 99;
    this.thrusting = false;
    this.thrustPower = BASE_THRUST;
    this.upgrades = { engine: 0, shield: 0, hull: 0, fuel: 0 };
    this.tilt = 0;
    this.bob = 0;
    this.time = 0;
    this.landed = false;
    this.landing = false;
    this.targetSpeed = BASE_SPEED;
    this.alive = true;
    this.damageFlash = 0;
    this.shieldFlash = 0;
    this.engineHeat = 0;
    this.trailTimer = 0;
    this.smokeTimer = 0;
    this.impactCool = 0;
    this.vertical = 0;
  }

  applyUpgrades(upgrades) {
    this.upgrades = {
      engine: clamp(upgrades.engine | 0, 0, 4),
      shield: clamp(upgrades.shield | 0, 0, 4),
      hull: clamp(upgrades.hull | 0, 0, 4),
      fuel: clamp(upgrades.fuel | 0, 0, 4)
    };
    this.maxHealth = 100 + this.upgrades.hull * 22;
    this.shieldMax = 72 + this.upgrades.shield * 24;
    this.shieldResist = this.upgrades.shield * 0.04;
    this.shieldRegen = 1.5 + this.upgrades.shield * 0.55;
    this.thrustPower = BASE_THRUST * (1 + this.upgrades.engine * 0.07);
    this.maxRise = MAX_RISE * (1 + this.upgrades.engine * 0.04);
  }

  resetAt(x, y, upgrades) {
    if (upgrades) this.applyUpgrades(upgrades);
    this.x = x;
    this.y = y;
    this.vx = BASE_SPEED * 0.4;
    this.vy = 0;
    this.health = this.maxHealth;
    this.shield = this.shieldMax;
    this.invuln = 2.6;
    this.lastDamage = 99;
    this.landed = false;
    this.landing = false;
    this.alive = true;
    this.thrusting = false;
    this.tilt = 0;
    this.time = 0;
    this.damageFlash = 0;
    this.shieldFlash = 0;
    this.engineHeat = 0;
    this.impactCool = 0;
    this.trailTimer = 0;
    this.smokeTimer = 0;
  }

  get maxFall() {
    return MAX_FALL;
  }

  update(dt, thrust, world, game) {
    if (!this.alive) return;
    this.time += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 3.2);
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 2.4);
    this.impactCool = Math.max(0, this.impactCool - dt);
    this.lastDamage += dt;
    this.thrusting = Boolean(thrust) && !this.landing;

    const engineGain = this.thrusting ? 1 : 0;
    this.engineHeat = damp(this.engineHeat, engineGain, 9, dt);

    // Speed gently eases toward the game's requested speed (slower near pads).
    this.vx = damp(this.vx, game.currentTargetSpeed(), 2.2, dt);
    this.x += this.vx * dt;

    if (this.thrusting) {
      this.vy -= this.thrustPower * dt;
    } else {
      this.vy += GRAVITY * dt;
    }
    this.vy = clamp(this.vy, -this.maxRise, this.maxFall);
    this.y += this.vy * dt;

    // Terrain collision with a three-point sample under the lander.
    const offsets = [-22, 0, 22];
    let highestGround = -Infinity;
    let lowestCeiling = Infinity;
    for (const ox of offsets) {
      highestGround = Math.max(highestGround, world.groundAt(this.x + ox));
      lowestCeiling = Math.min(lowestCeiling, world.ceilingAt(this.x + ox));
    }
    let hitTerrain = false;
    let impact = 0;

    const top = this.y - this.halfH;
    const bottom = this.y + this.halfH + 4;

    if (bottom > highestGround) {
      // In caves, don't snap upward if the ceiling gap is too narrow.
      const ceilClearance = highestGround - lowestCeiling;
      if (ceilClearance > this.halfH * 2 + 6) {
        this.y = highestGround - this.halfH - 4;
        impact = Math.max(impact, Math.abs(this.vy));
        if (this.vy > 0) this.vy = -Math.max(72, this.vy * 0.24);
        hitTerrain = true;
      }
    }
    if (top < lowestCeiling) {
      this.y = lowestCeiling + this.halfH;
      impact = Math.max(impact, Math.abs(this.vy));
      if (this.vy < 0) this.vy = Math.max(56, -this.vy * 0.18);
      hitTerrain = true;
    }

    if (hitTerrain) {
      this.tilt += 0.13 * Math.sign(impact || 1);
      if (this.impactCool <= 0 && impact > 35) {
        const amount = clamp(7 + impact * 0.055, 8, 26);
        game.onTerrainCollision(amount, impact);
        this.impactCool = 0.5;
      } else if (impact < 35 && this.impactCool <= 0) {
        game.onTerrainScrape();
        this.impactCool = 0.5;
      }
    }

    // Shield regenerates after a quiet period.
    if (this.lastDamage > 3.4 && this.shield < this.shieldMax) {
      this.shield = Math.min(this.shieldMax, this.shield + this.shieldRegen * dt);
    }

    const lowHealth = this.health / this.maxHealth < 0.3;
    if (lowHealth && Math.random() < dt * 8) {
      game.emitDamageSpark(this.x, this.y);
    }
    if (this.health / this.maxHealth < 0.5) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.16 + Math.random() * 0.2;
        game.emitDamageSmoke(this.x, this.y);
      }
    }

    // Flame trail particles.
    if (this.thrusting) {
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trailTimer = 0.018;
        game.emitThrustParticles(this);
      }
    }

    const bobBase = this.thrusting ? 0.008 : 0.02;
    this.bob = Math.sin(this.time * 3.2) * bobBase;
    const targetTilt = clamp(this.vy / 900, -0.26, 0.28) + Math.sin(this.time * 2.2) * 0.012;
    this.tilt = damp(this.tilt, targetTilt, 7, dt);
    this.vertical = this.vy;
  }

  /** Returns {shieldAbsorbed, healthDamage, dead}. */
  takeDamage(amount, source = 'impact') {
    if (this.invuln > 0 || !this.alive) return { shieldAbsorbed: 0, healthDamage: 0, dead: false };
    let dmg = Math.max(0, amount) * (1 - this.shieldResist);
    let absorbed = 0;
    if (this.shield > 0) {
      absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
      if (absorbed > 0) this.shieldFlash = 1;
    }
    let healthDamage = 0;
    if (dmg > 0) {
      healthDamage = Math.min(this.health, dmg);
      this.health -= healthDamage;
    }
    this.lastDamage = 0;
    this.invuln = dmg > 0 ? 1.35 : 0.7;
    this.damageFlash = 1;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      return { shieldAbsorbed: absorbed, healthDamage, dead: true, source };
    }
    return { shieldAbsorbed: absorbed, healthDamage, dead: false, source };
  }

  healFull() {
    this.health = this.maxHealth;
    this.shield = this.shieldMax;
    this.lastDamage = 99;
    this.invuln = Math.max(this.invuln, 2.2);
    this.damageFlash = 0;
    this.shieldFlash = 0;
  }

  get healthRatio() {
    return clamp(this.health / this.maxHealth, 0, 1);
  }

  get shieldRatio() {
    return clamp(this.shield / this.shieldMax, 0, 1);
  }

  get isCritical() {
    return this.healthRatio <= 0.3;
  }
}
