/* Menu, station services, pause, settings, crash and confirmation flows. */
'use strict';

import { formatNumber } from './utils.js';
import { UPGRADE_INFO } from './player.js';
import { UPGRADE_LIMITS, DEFAULT_SETTINGS } from './save.js';

const UPGRADE_KEYS = ['engine', 'shield', 'hull', 'fuel'];

function upgradeIcon(key) {
  if (key === 'engine') {
    return `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7h14l-2 8H11z"/><path d="M11 15v5h10v-5"/><path d="M12 20l-3 7M20 20l3 7M16 20v8"/><path d="M12 10h8M6 10l-2-3M26 10l2-3"/></svg>`;
  }
  if (key === 'shield') {
    return `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3l10 4v8c0 6-4 11-10 14C10 26 6 21 6 15V7z"/><path d="M16 8v13M10 14h12"/><path d="M11 6l5 3 5-3"/></svg>`;
  }
  if (key === 'hull') {
    return `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11l11-6 11 6-11 6z"/><path d="M5 16l11 6 11-6M5 21l11 6 11-6"/><path d="M9 9v6M23 9v6"/></svg>`;
  }
  return `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="6" width="12" height="20" rx="5"/><path d="M13 4h6M13 9h6M10 13h12M12 26v3M20 26v3"/><path d="M16 15v7"/></svg>`;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.el = {};
    [
      'screen-menu', 'screen-station', 'screen-pause', 'screen-settings', 'screen-help', 'screen-crash', 'screen-confirm',
      'btn-continue', 'btn-new', 'btn-help', 'btn-settings', 'menu-best', 'menu-salvage', 'menu-missions', 'menu-rescues',
      'menu-checkpoint', 'menu-checkpoint-sector', 'menu-save-status',
      'station-name', 'station-sector', 'station-kicker', 'station-score', 'station-salvage', 'station-best',
      'station-mission-body', 'station-next-objective', 'station-next-target', 'upgrade-grid', 'upgrade-credits',
      'btn-launch', 'btn-station-menu', 'btn-station-help', 'btn-resume', 'btn-pause-settings', 'btn-pause-help',
      'btn-restart-checkpoint', 'btn-pause-menu', 'pause-score', 'pause-distance', 'pause-checkpoint',
      'btn-settings-close', 'setting-music', 'setting-sfx', 'value-music', 'value-sfx', 'mute-music', 'mute-sfx',
      'setting-shake', 'setting-quality', 'btn-settings-defaults', 'btn-help-close', 'btn-help-done',
      'crash-score', 'crash-best', 'crash-distance', 'crash-salvage', 'crash-missions', 'crash-rescues', 'crash-copy',
      'btn-respawn', 'btn-crash-new', 'btn-crash-menu', 'confirm-kicker', 'confirm-title', 'confirm-message',
      'btn-confirm-cancel', 'btn-confirm-ok', 'station-shell'
    ].forEach((id) => {
      this.el[id] = document.getElementById(id);
    });
    this.currentPrimary = 'menu';
    this.auxStack = [];
    this.confirmResolver = null;
    this.stationData = null;
    this._bind();
    this.updateSettingsControls();
  }

  _bind() {
    const g = this.game;
    const stop = (e) => e.stopPropagation();
    document.getElementById('overlay').addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('button');
      if (btn && !btn.disabled) g.playClick();
    });
    const on = (id, fn) => {
      const node = document.getElementById(id);
      if (node) node.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      });
    };

    on('btn-continue', () => g.continueGame());
    on('btn-new', () => g.requestNewGame());
    on('btn-help', () => this.showHelp());
    on('btn-settings', () => this.showSettings('menu'));
    on('btn-station-menu', () => g.quitToMenu());
    on('btn-station-help', () => this.showHelp());
    on('btn-launch', () => g.launch());
    on('btn-resume', () => g.resume());
    on('btn-pause-settings', () => this.showSettings('pause'));
    on('btn-pause-help', () => this.showHelp());
    on('btn-restart-checkpoint', () => g.requestRestartCheckpoint());
    on('btn-pause-menu', () => g.quitToMenu());
    on('btn-settings-close', () => this.hideSettings());
    on('btn-help-close', () => this.hideHelp());
    on('btn-help-done', () => this.hideHelp());
    on('btn-respawn', () => g.respawnAtCheckpoint());
    on('btn-crash-new', () => g.requestNewGame());
    on('btn-crash-menu', () => g.quitToMenu());
    on('btn-confirm-cancel', () => this._resolveConfirm(false));
    on('btn-confirm-ok', () => this._resolveConfirm(true));
    on('btn-settings-defaults', () => {
      g.settings = { ...DEFAULT_SETTINGS };
      g.applySettings();
      this.updateSettingsControls();
      g.hud.toast('SETTINGS RESTORED TO DEFAULTS');
    });

    this.el['upgrade-grid'].addEventListener('click', (e) => {
      const card = e.target.closest('button[data-upgrade]');
      if (!card || card.disabled) return;
      const key = card.dataset.upgrade;
      const result = g.buyUpgrade(key);
      if (result === true) this.refreshStation();
    });

    const bindRange = (input, key, valueEl) => {
      if (!input) return;
      input.addEventListener('input', () => {
        g.settings[key] = Number(input.value) / 100;
        if (key === 'music') g.settings.musicMuted = false;
        if (key === 'sfx') g.settings.sfxMuted = false;
        g.applySettings();
        this.updateSettingsControls();
      });
      valueEl.addEventListener('input', (e) => e.stopPropagation());
    };
    bindRange(this.el['setting-music'], 'music', this.el['value-music']);
    bindRange(this.el['setting-sfx'], 'sfx', this.el['value-sfx']);

    on('mute-music', () => {
      g.settings.musicMuted = !g.settings.musicMuted;
      g.applySettings();
      this.updateSettingsControls();
    });
    on('mute-sfx', () => {
      g.settings.sfxMuted = !g.settings.sfxMuted;
      g.applySettings();
      this.updateSettingsControls();
    });
    this.el['setting-shake'].addEventListener('change', () => {
      g.settings.shake = this.el['setting-shake'].checked;
      g.applySettings();
    });
    this.el['setting-quality'].addEventListener('change', () => {
      g.settings.quality = this.el['setting-quality'].value;
      g.applySettings();
    });
    // Keep input gestures away from the canvas.
    for (const input of [this.el['setting-music'], this.el['setting-sfx']]) {
      input.addEventListener('pointerdown', stop);
      input.addEventListener('touchstart', stop, { passive: true });
    }
  }

  showScreen(name) {
    const screen = this.el[`screen-${name}`];
    if (!screen) return;
    screen.classList.remove('hidden');
    screen.scrollTop = 0;
  }

  hideScreen(name) {
    const screen = this.el[`screen-${name}`];
    if (screen) screen.classList.add('hidden');
  }

  hideAuxiliaries() {
    this.hideScreen('settings');
    this.hideScreen('help');
    this.hideScreen('confirm');
    this.auxStack = [];
    if (this.confirmResolver) {
      const r = this.confirmResolver;
      this.confirmResolver = null;
      r(false);
    }
  }

  hideAllScreens() {
    for (const name of ['menu', 'station', 'pause', 'settings', 'help', 'crash', 'confirm']) this.hideScreen(name);
    this.currentPrimary = null;
    this.auxStack = [];
    if (this.confirmResolver) {
      const r = this.confirmResolver;
      this.confirmResolver = null;
      r(false);
    }
  }

  _showPrimary(name) {
    this.hideScreen('menu');
    this.hideScreen('station');
    this.hideScreen('pause');
    this.hideScreen('crash');
    this.showScreen(name);
    this.currentPrimary = name;
  }

  showMenu(info) {
    this.hideAuxiliaries();
    this._showPrimary('menu');
    if (!info) return;
    const save = info.save;
    const hasSave = Boolean(save);
    this.el['btn-continue'].classList.toggle('hidden', !hasSave);
    this.el['btn-continue'].classList.toggle('btn-primary', hasSave);
    this.el['btn-new'].classList.toggle('btn-primary', !hasSave);
    this.el['menu-best'].textContent = formatNumber(save?.best || 0);
    this.el['menu-salvage'].textContent = formatNumber(save?.salvage || 0);
    this.el['menu-missions'].textContent = formatNumber(save?.stats?.missions || 0);
    this.el['menu-rescues'].textContent = formatNumber(save?.stats?.rescues || 0);
    if (hasSave) {
      this.el['menu-checkpoint'].textContent = save.checkpoint?.stationName || 'LAST OUTPOST';
      this.el['menu-checkpoint-sector'].textContent = `SECTOR ${String((save.checkpointIndex || 0) + 1).padStart(2, '0')} // ${formatNumber(save.stats?.missions || 0)} MISSIONS LOGGED`;
      this.el['btn-continue'].querySelector('small').textContent = `CHECKPOINT ${String((save.checkpointIndex || 0) + 1).padStart(2, '0')} // SCORE ${formatNumber(save.checkpoint?.score || 0)}`;
    } else {
      this.el['menu-checkpoint'].textContent = 'NO FLIGHT DATA';
      this.el['menu-checkpoint-sector'].textContent = 'Start a new expedition to establish a checkpoint';
    }
  }

  showStation(data) {
    this.hideAuxiliaries();
    this._showPrimary('station');
    this.stationData = data;
    this.refreshStation();
    if (this.el['station-shell']) this.el['station-shell'].scrollTop = 0;
  }

  refreshStation() {
    const data = this.game.getStationView();
    this.stationData = data;
    const station = data.station;
    this.el['station-name'].textContent = station?.name || 'Outpost';
    this.el['station-sector'].textContent = `SECTOR ${String((station?.index || 0) + 1).padStart(2, '0')}`;
    this.el['station-kicker'].textContent = (station?.kind || 'outpost').toUpperCase();
    this.el['station-score'].textContent = formatNumber(this.game.score);
    this.el['station-salvage'].textContent = formatNumber(this.game.save?.salvage || 0);
    this.el['station-best'].textContent = `BEST ${formatNumber(this.game.save?.best || 0)}`;
    this.el['upgrade-credits'].textContent = `${formatNumber(this.game.save?.salvage || 0)} SALVAGE AVAILABLE`;

    const body = this.el['station-mission-body'];
    const last = data.lastMission;
    if (last) {
      const statusClass = last.completedNow ? 'good' : last.alreadyComplete ? 'repeat' : 'failed';
      const statusText = last.completedNow
        ? '✓ MISSION COMPLETE'
        : last.alreadyComplete
          ? '✓ PREVIOUSLY LOGGED'
          : last.skipped
            ? 'ABANDONED EN ROUTE'
            : 'OBJECTIVE INCOMPLETE';
      const reward = last.completedNow
        ? `<div class="debrief-reward"><div><span>SCORE BONUS</span><b>+${formatNumber(last.rewardPoints)}</b></div><div><span>SALVAGE</span><b>+${formatNumber(last.rewardCredits)}</b></div></div>`
        : '';
      const progress = last.target
        ? `<div class="debrief-progress"><div class="debrief-progress-bar"><i style="width:${Math.round((last.progress / last.target) * 100)}%"></i></div><small>${last.progress} / ${last.target} ${last.short} recovered</small></div>`
        : '';
      body.innerHTML = `
        <span class="debrief-status ${statusClass}">${statusText}</span>
        <h3 class="debrief-title">${escapeHtml(last.title)}</h3>
        <p class="debrief-copy">${escapeHtml(last.copy)}</p>
        ${progress}
        ${reward}`;
    } else {
      body.innerHTML = `
        <span class="debrief-status">◈ CHECKPOINT SECURED</span>
        <h3 class="debrief-title">Welcome back to the surface.</h3>
        <p class="debrief-copy">Hull integrity restored. Guidance systems are aligned. Service your lander, review the next objective, and launch when ready.</p>`;
    }

    const next = data.nextMission;
    this.el['station-next-objective'].textContent = next?.objective || 'Continue the expedition';
    this.el['station-next-target'].textContent = next
      ? `Then reach ${next.stationName} // Sector ${String(next.sector + 1).padStart(2, '0')}`
      : 'Awaiting navigation data';
    this.el['btn-launch'].querySelector('.btn-copy small').textContent =
      data.resume ? 'CHECKPOINT RESTORED — READY TO FLY' : 'HOLD ONTO YOUR HELMET';

    this.renderUpgrades(data);
    this.updateSettingsControls();
  }

  renderUpgrades(data) {
    const grid = this.el['upgrade-grid'];
    const save = this.game.save || { upgrades: {}, salvage: 0 };
    const salvage = save.salvage || 0;
    grid.innerHTML = '';
    for (const key of UPGRADE_KEYS) {
      const info = UPGRADE_INFO[key];
      const level = save.upgrades?.[key] || 0;
      const max = UPGRADE_LIMITS[key] || 4;
      const maxed = level >= max;
      const cost = maxed ? 0 : info.costs[level] || 0;
      const affordable = !maxed && salvage >= cost;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `upgrade-card ${maxed ? 'maxed' : ''} ${!maxed && !affordable ? 'poor' : ''}`;
      card.dataset.upgrade = key;
      card.disabled = maxed || !affordable;
      card.setAttribute('aria-label', `${info.name}, level ${level} of ${max}. ${maxed ? 'Maximum level.' : `Cost ${cost} salvage.`}`);
      const pips = Array.from({ length: max }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('');
      card.innerHTML = `
        <div class="upgrade-top">
          <span class="upgrade-icon">${upgradeIcon(key)}</span>
          <span class="upgrade-pips">${pips}</span>
        </div>
        <h4>${info.name}</h4>
        <p>${info.desc}</p>
        <div class="upgrade-foot">
          <span class="upgrade-level">LVL ${level} / ${max}</span>
          <span class="upgrade-cost ${!maxed && !affordable ? 'unaffordable' : ''} ${maxed ? 'maxed' : ''}">${maxed ? 'SYSTEM MAXED' : `${formatNumber(cost)} SALVAGE`}</span>
        </div>`;
      grid.appendChild(card);
    }
  }

  showPause() {
    this.hideAuxiliaries();
    this._showPrimary('pause');
    this.el['pause-score'].textContent = formatNumber(this.game.score);
    this.el['pause-distance'].textContent = `${formatNumber(this.game.distance)} M`;
    this.el['pause-checkpoint'].textContent = String((this.game.checkpointIndex || 0) + 1).padStart(2, '0');
  }

  showCrash(info) {
    this.hideAuxiliaries();
    this._showPrimary('crash');
    this.el['crash-score'].textContent = formatNumber(info.score);
    this.el['crash-best'].textContent = formatNumber(info.best);
    this.el['crash-distance'].textContent = `${formatNumber(info.distance)} M`;
    this.el['crash-salvage'].textContent = formatNumber(info.salvage);
    this.el['crash-missions'].textContent = formatNumber(info.missions);
    this.el['crash-rescues'].textContent = formatNumber(info.rescues);
    this.el['crash-copy'].textContent = info.copy || 'The descent engine has gone dark. Emergency telemetry recovered at the last checkpoint.';
  }

  showSettings(returnTo = 'menu') {
    this.settingsReturn = returnTo;
    this.updateSettingsControls();
    this.showScreen('settings');
    this.auxStack.push('settings');
  }

  hideSettings() {
    this.hideScreen('settings');
    const i = this.auxStack.lastIndexOf('settings');
    if (i >= 0) this.auxStack.splice(i, 1);
  }

  showHelp() {
    this.showScreen('help');
    this.auxStack.push('help');
  }

  hideHelp() {
    this.hideScreen('help');
    const i = this.auxStack.lastIndexOf('help');
    if (i >= 0) this.auxStack.splice(i, 1);
  }

  updateSettingsControls() {
    const s = this.game.settings;
    if (!this.el['setting-music']) return;
    this.el['setting-music'].value = String(Math.round(s.music * 100));
    this.el['setting-sfx'].value = String(Math.round(s.sfx * 100));
    this.el['value-music'].textContent = `${Math.round(s.music * 100)}%`;
    this.el['value-sfx'].textContent = `${Math.round(s.sfx * 100)}%`;
    this.el['mute-music'].textContent = s.musicMuted ? 'MUTED' : 'MUTE';
    this.el['mute-music'].classList.toggle('active', s.musicMuted);
    this.el['mute-sfx'].textContent = s.sfxMuted ? 'MUTED' : 'MUTE';
    this.el['mute-sfx'].classList.toggle('active', s.sfxMuted);
    this.el['setting-shake'].checked = s.shake !== false;
    this.el['setting-quality'].value = s.quality || 'auto';
  }

  confirm({ kicker = 'CONFIRM COMMAND', title, message, confirmLabel = 'CONFIRM', danger = true }) {
    if (this.confirmResolver) {
      this._resolveConfirm(false);
    }
    this.el['confirm-kicker'].textContent = kicker;
    this.el['confirm-title'].textContent = title;
    this.el['confirm-message'].textContent = message;
    this.el['btn-confirm-ok'].textContent = confirmLabel;
    this.el['btn-confirm-ok'].classList.toggle('btn-danger', danger);
    this.showScreen('confirm');
    return new Promise((resolve) => {
      this.confirmResolver = resolve;
    });
  }

  _resolveConfirm(value) {
    this.hideScreen('confirm');
    if (!this.confirmResolver) return;
    const resolve = this.confirmResolver;
    this.confirmResolver = null;
    resolve(value);
  }

  /** Returns true when escape was consumed by an overlay. */
  handleEscape() {
    if (this.confirmResolver) {
      this._resolveConfirm(false);
      return true;
    }
    if (!this.el['screen-help'].classList.contains('hidden')) {
      this.hideHelp();
      return true;
    }
    if (!this.el['screen-settings'].classList.contains('hidden')) {
      this.hideSettings();
      return true;
    }
    return false;
  }

  toast(text, tone = '') {
    this.game.hud.toast(text, tone);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
