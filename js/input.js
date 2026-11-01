/* Unified keyboard / mouse / touch input. Thrust is a held action. */
'use strict';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.thrustPointers = new Set();
    this.keys = new Set();
    this.anyGestureHandler = null;
    this.pauseHandler = null;
    this.enabledCheck = () => false;
    this._bound = false;
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onContext = (e) => {
      if (this.enabledCheck()) e.preventDefault();
    };
    this._onVisibility = () => this._onBlur();
  }

  attach() {
    if (this._bound) return;
    this._bound = true;
    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('visibilitychange', this._onVisibility);
    this.canvas.addEventListener('pointerdown', this._onPointerDown, { passive: false });
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    this.canvas.addEventListener('contextmenu', this._onContext);
  }

  detach() {
    if (!this._bound) return;
    this._bound = false;
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('visibilitychange', this._onVisibility);
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    this.canvas.removeEventListener('contextmenu', this._onContext);
    this._onBlur();
  }

  _gesture() {
    if (this.anyGestureHandler) this.anyGestureHandler();
  }

  _isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  _onKeyDown(e) {
    this._gesture();
    if (this._isTypingTarget(e.target)) return;

    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (this.pauseHandler && !e.repeat) {
        const handled = this.pauseHandler(e.code);
        if (handled) {
          e.preventDefault();
          return;
        }
      }
    }

    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      if (!this.enabledCheck()) return;
      if (e.code === 'Space' || e.code === 'ArrowUp') e.preventDefault();
      this.keys.add(e.code);
    }
  }

  _onKeyUp(e) {
    this.keys.delete(e.code);
  }

  _onPointerDown(e) {
    this._gesture();
    if (!this.enabledCheck()) return;
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    this.thrustPointers.add(e.pointerId);
    if (this.canvas.setPointerCapture) {
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
    }
  }

  _onPointerUp(e) {
    this.thrustPointers.delete(e.pointerId);
  }

  _onBlur() {
    this.thrustPointers.clear();
    this.keys.clear();
  }

  isThrustHeld() {
    if (this.keys.has('Space') || this.keys.has('ArrowUp') || this.keys.has('KeyW')) return true;
    return this.thrustPointers.size > 0;
  }

  clear() {
    this._onBlur();
  }
}
