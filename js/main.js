/* Application bootstrap: canvas size, animation loop, visibility handling and
   a small safety net that surfaces fatal errors without breaking the menu. */
'use strict';

import { Game } from './game.js';

let game = null;
let rafId = 0;
let lastTime = 0;
let stopped = false;
let resizeTimer = 0;
let errorShown = false;

const errorBanner = document.getElementById('error-banner');
const errorMessage = document.getElementById('error-message');
const boot = document.getElementById('boot');
const bootStatus = document.getElementById('boot-status');

function showError(error) {
  if (errorShown) return;
  errorShown = true;
  const detail =
    error && (error.message || error.reason?.message)
      ? error.message || error.reason.message
      : 'The guidance computer encountered an unexpected condition.';
  if (errorMessage) errorMessage.textContent = detail;
  if (errorBanner) errorBanner.classList.remove('hidden');
  if (bootStatus) bootStatus.textContent = 'GUIDANCE FAULT // SEE SYSTEM NOTICE';
  document.documentElement.dataset.gameError = 'true';
}

function hideBoot() {
  if (!boot) return;
  if (bootStatus) bootStatus.textContent = 'LUNAR GUIDANCE ONLINE';
  boot.classList.add('booted');
  window.setTimeout(() => {
    if (boot.parentNode) boot.parentNode.removeChild(boot);
  }, 900);
}

function resizeNow() {
  if (!game) return;
  game.renderer.resize();
  game.hud.resizeRadar();
}

function scheduleResize() {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(resizeNow, 120);
}

function loop(now) {
  if (stopped) return;
  const dt = lastTime ? (now - lastTime) / 1000 : 0;
  lastTime = now;
  try {
    game.tick(dt);
    document.documentElement.dataset.gameReady = 'true';
  } catch (error) {
    stopped = true;
    showError(error);
    return;
  }
  rafId = window.requestAnimationFrame(loop);
}

function bindEnvironment() {
  window.addEventListener('resize', scheduleResize);

  if (window.screen?.orientation?.addEventListener) {
    window.screen.orientation.addEventListener('change', scheduleResize);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (game?.state === 'playing' || game?.state === 'landing') {
        game.persistNow();
        game.autoPause();
      } else if (game) {
        game.persistNow();
      }
    }
  });

  window.addEventListener('pagehide', () => {
    if (game) game.persistNow();
  });

  window.addEventListener('error', (event) => {
    showError(event.error || new Error(event.message || 'A runtime error occurred.'));
  });

  window.addEventListener('unhandledrejection', (event) => {
    showError(event.reason || new Error('An asynchronous error occurred.'));
  });

  document.getElementById('btn-error-dismiss')?.addEventListener('click', () => {
    errorBanner?.classList.add('hidden');
  });
}

function bootGame() {
  bindEnvironment();

  try {
    const canvas = document.getElementById('game');
    if (!canvas) throw new Error('The game canvas is missing.');

    game = new Game(canvas);
    window.__MLE__ = {
      game,
      get state() {
        return game.state;
      },
      get save() {
        return game.save;
      },
      version: '1.0.0'
    };

    lastTime = performance.now();
    rafId = window.requestAnimationFrame(loop);
    window.setTimeout(hideBoot, 260);
  } catch (error) {
    showError(error);
    if (bootStatus) bootStatus.textContent = 'BOOT FAILURE // REFRESH TO RETRY';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootGame, { once: true });
} else {
  bootGame();
}

window.addEventListener('beforeunload', () => {
  stopped = true;
  if (rafId) window.cancelAnimationFrame(rafId);
});
