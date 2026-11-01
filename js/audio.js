/* Fully procedural Web Audio: generative ambient score, engine layers and SFX.
   Nothing is fetched; all buffers are synthesized in the browser. */
'use strict';

import { clamp, lerp } from './utils.js';

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  constructor(settings) {
    this.ctx = null;
    this.ready = false;
    this.settings = settings;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.reverb = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.engineSource = null;
    this.engineOsc = null;
    this.engineOscGain = null;
    this.alienGain = null;
    this.alienFilter = null;
    this.musicTimer = 0;
    this.nextChord = 0;
    this.nextArp = 0;
    this.nextBass = 0;
    this.chordIndex = 0;
    this.arpIndex = 0;
    this.active = false;
    this.intensity = 0.4;
    this._engineTarget = 0;
    this._lastAlarm = 0;
    this._chords = [
      [50, 57, 62, 64, 69], // Dm9
      [46, 53, 57, 60, 65], // Bbmaj7
      [41, 48, 55, 60, 64], // Fmaj9
      [43, 50, 57, 62, 67]  // Gm9
    ];
    this._arpNotes = [74, 77, 81, 79, 72, 76, 84, 81, 69, 74, 77, 72];
  }

  get supported() {
    return typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext);
  }

  init() {
    if (!this.supported) return false;
    if (this.ready) {
      this.resume();
      return true;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      const ctx = this.ctx;

      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 18;
      comp.ratio.value = 5;
      comp.attack.value = 0.004;
      comp.release.value = 0.24;
      this.master.connect(comp);
      comp.connect(ctx.destination);

      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.42;
      this.musicBus.connect(this.master);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 0.72;
      this.sfxBus.connect(this.master);

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this._makeImpulse(2.6, 2.4);
      const reverbGain = ctx.createGain();
      reverbGain.gain.value = 0.32;
      this.reverb.connect(reverbGain);
      reverbGain.connect(this.master);

      this._noise = this._makeNoise(2.0);
      this._startEngine();
      this._startAlienHum();
      this._startMusic();
      this.ready = true;
      this.applySettings(this.settings);
      this.resume();
      return true;
    } catch (err) {
      this.ready = false;
      return false;
    }
  }

  resume() {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  suspend() {
    if (!this.ctx) return;
    if (this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
  }

  setActive(active) {
    this.active = active;
    if (!this.ready) return;
    if (active) {
      this.resume();
      this._setParam(this.engineGain.gain, 0.016, 0.25);
    } else {
      this._setParam(this.engineGain.gain, 0.0, 0.18);
    }
  }

  applySettings(settings) {
    this.settings = settings;
    if (!this.ready) return;
    const musicLevel = settings.musicMuted ? 0 : clamp(settings.music, 0, 1);
    const sfxLevel = settings.sfxMuted ? 0 : clamp(settings.sfx, 0, 1);
    this._setParam(this.musicBus.gain, 0.46 * musicLevel, 0.15);
    this._setParam(this.sfxBus.gain, 0.8 * sfxLevel, 0.1);
  }

  _setParam(param, value, time = 0.05) {
    if (!param || !this.ctx) return;
    try {
      param.setTargetAtTime(value, this.ctx.currentTime, Math.max(0.005, time));
    } catch (err) {
      /* ignore */
    }
  }

  _makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    return buffer;
  }

  _makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (0.4 + 0.6 * Math.sin(t * 60));
      }
    }
    return buffer;
  }

  _startEngine() {
    const ctx = this.ctx;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 380;
    this.engineFilter.Q.value = 1.2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.sfxBus);

    this.engineSource = ctx.createBufferSource();
    this.engineSource.buffer = this._noise;
    this.engineSource.loop = true;
    this.engineSource.connect(this.engineFilter);
    this.engineSource.start();

    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 48;
    this.engineOscGain = ctx.createGain();
    this.engineOscGain.gain.value = 0.12;
    const oscFilter = ctx.createBiquadFilter();
    oscFilter.type = 'lowpass';
    oscFilter.frequency.value = 150;
    this.engineOsc.connect(oscFilter);
    oscFilter.connect(this.engineOscGain);
    this.engineOscGain.connect(this.engineGain);
    this.engineOsc.start();
  }

  _startAlienHum() {
    const ctx = this.ctx;
    this.alienGain = ctx.createGain();
    this.alienGain.gain.value = 0;
    this.alienFilter = ctx.createBiquadFilter();
    this.alienFilter.type = 'bandpass';
    this.alienFilter.frequency.value = 220;
    this.alienFilter.Q.value = 3.5;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 58;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 87;
    const o2gain = ctx.createGain();
    o2gain.gain.value = 0.18;
    osc.connect(this.alienFilter);
    osc2.connect(o2gain);
    o2gain.connect(this.alienFilter);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.17;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 40;
    lfo.connect(lfoGain);
    lfoGain.connect(this.alienFilter.frequency);
    this.alienFilter.connect(this.alienGain);
    this.alienGain.connect(this.sfxBus);
    osc.start();
    osc2.start();
    lfo.start();
  }

  _startMusic() {
    const ctx = this.ctx;
    this.nextChord = ctx.currentTime + 0.8;
    this.nextArp = ctx.currentTime + 2.2;
    this.nextBass = ctx.currentTime + 1.0;
    this.musicTimer = window.setInterval(() => this._scheduleMusic(), 240);
  }

  _scheduleMusic() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const horizon = now + 2.6;
    try {
      while (this.nextChord < horizon) {
        this._playChord(this.nextChord, this._chords[this.chordIndex % this._chords.length], this.chordIndex);
        this.nextChord += 8;
        this.chordIndex++;
      }
      while (this.nextArp < horizon) {
        const node = this._arpNotes[this.arpIndex % this._arpNotes.length];
        this._playPluck(this.nextArp, midi(node), 0.028 + (this.intensity * 0.018), this.arpIndex % 3 === 0 ? 0.55 : 0.38);
        this.nextArp += 1.65 + (this.arpIndex % 4) * 0.16;
        this.arpIndex++;
      }
      while (this.nextBass < horizon) {
        const chord = this._chords[this.chordIndex % this._chords.length];
        this._playBass(this.nextBass, midi(chord[0] - 12), 0.045);
        this.nextBass += 8;
      }
    } catch (err) {
      /* a node can fail if the context is closing — harmless */
    }
  }

  _playChord(when, notes, index) {
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900 + (index % 2) * 320;
    filter.Q.value = 0.6;
    bus.connect(filter);
    filter.connect(this.musicBus);
    if (this.reverb) {
      const send = ctx.createGain();
      send.gain.value = 0.5;
      filter.connect(send);
      send.connect(this.reverb);
    }
    const atk = 2.6;
    const hold = 3.2;
    const rel = 5.0;
    bus.gain.setValueAtTime(0.0001, when);
    bus.gain.exponentialRampToValueAtTime(0.033, when + atk);
    bus.gain.setValueAtTime(0.033, when + atk + hold);
    bus.gain.exponentialRampToValueAtTime(0.0001, when + atk + hold + rel);
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = midi(notes[i]);
      osc.detune.value = (i - 2) * 3.5;
      const gain = ctx.createGain();
      gain.gain.value = i === 0 ? 0.8 : 0.48;
      osc.connect(gain);
      gain.connect(bus);
      osc.start(when);
      osc.stop(when + atk + hold + rel + 0.1);
    }
  }

  _playPluck(when, freq, gainValue, pan) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2.01;
    const gain = ctx.createGain();
    const dur = 1.8;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(gainValue, when + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2800, when);
    filter.frequency.exponentialRampToValueAtTime(700, when + dur);
    osc.connect(gain);
    const g2 = ctx.createGain();
    g2.gain.value = 0.16;
    osc2.connect(g2);
    g2.connect(gain);
    gain.connect(filter);
    filter.connect(this.musicBus);
    if (this.reverb) {
      const send = ctx.createGain();
      send.gain.value = 0.45;
      filter.connect(send);
      send.connect(this.reverb);
    }
    let panner = null;
    if (ctx.createStereoPanner) {
      panner = ctx.createStereoPanner();
      panner.pan.value = pan * 2 - 1;
      filter.disconnect();
      filter.connect(panner);
      panner.connect(this.musicBus);
      if (this.reverb) {
        const send = ctx.createGain();
        send.gain.value = 0.45;
        panner.connect(send);
        send.connect(this.reverb);
      }
    }
    osc.start(when);
    osc2.start(when);
    osc.stop(when + dur + 0.05);
    osc2.stop(when + dur + 0.05);
  }

  _playBass(when, freq, gainValue) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(gainValue, when + 0.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 6.5);
    osc.connect(gain);
    gain.connect(this.musicBus);
    osc.start(when);
    osc.stop(when + 6.6);
  }

  /** Called every frame while flying. */
  update(dt, state) {
    if (!this.ready) return;
    const thrusting = Boolean(state.thrusting) && this.active;
    const speed = state.speed || 0;
    const engineOn = this.active ? (thrusting ? 0.06 : 0.017) : 0;
    const filterHz = thrusting ? 1200 : 290 + clamp(speed, 0, 300) * 0.9;
    this._setParam(this.engineGain.gain, engineOn + clamp(speed / 700, 0, 1) * 0.006, 0.09);
    this._setParam(this.engineFilter.frequency, filterHz, 0.08);
    this._setParam(this.engineOsc.frequency, thrusting ? 62 : 46, 0.2);
    const alienProx = this.active ? clamp(state.alienProximity || 0, 0, 1) : 0;
    this._setParam(this.alienGain.gain, alienProx * 0.032, 0.2);
    this.intensity = clamp(0.3 + (state.intensity || 0) * 0.5, 0, 1);
  }

  play(name, opts = {}) {
    if (!this.ready || !this.ctx || this.ctx.state !== 'running') return;
    if (this.settings.sfxMuted) return;
    const t = this.ctx.currentTime + 0.01;
    try {
      switch (name) {
        case 'click':
          this._tone(t, 620, 0.05, 'square', 0.045, -80);
          break;
        case 'deny':
          this._tone(t, 140, 0.16, 'square', 0.06, -20);
          break;
        case 'pickup':
          this._bell(t, 660, 0.22, 0.08);
          this._bell(t + 0.08, 880, 0.26, 0.065);
          break;
        case 'sample':
          this._bell(t, 523.25, 0.36, 0.09);
          this._bell(t + 0.07, 783.99, 0.4, 0.07);
          this._bell(t + 0.15, 1046.5, 0.5, 0.055);
          break;
        case 'salvage':
          this._tone(t, 880, 0.1, 'triangle', 0.07, 220);
          this._tone(t + 0.05, 1320, 0.16, 'sine', 0.05, 120);
          break;
        case 'rescue':
          [392, 523.25, 659.25, 783.99].forEach((f, i) =>
            this._bell(t + i * 0.09, f, 0.55, 0.055)
          );
          break;
        case 'discovery':
          this._sweep(t, 220, 1200, 0.9, 0.035);
          [659.25, 987.77, 1318.5].forEach((f, i) => this._bell(t + 0.2 + i * 0.08, f, 1.2, 0.04));
          break;
        case 'damage':
          this._noiseBurst(t, 0.28, 900, 0.12, 400);
          this._tone(t, 130, 0.32, 'sawtooth', 0.09, -80);
          break;
        case 'explosion':
          this._noiseBurst(t, 1.1, 1400, 0.3, 55);
          this._tone(t, 60, 0.9, 'sine', 0.16, -30);
          this._noiseBurst(t + 0.18, 0.7, 350, 0.13, 850);
          break;
        case 'landing':
          this._noiseBurst(t, 0.35, 320, 0.18, 950);
          this._tone(t, 72, 0.5, 'sine', 0.11, -15);
          this._bell(t + 0.22, 392, 0.7, 0.05);
          this._bell(t + 0.38, 587.33, 0.9, 0.04);
          break;
        case 'launch':
          this._sweep(t, 80, 500, 0.8, 0.07);
          this._noiseBurst(t, 0.7, 650, 0.12, 80);
          break;
        case 'mission':
          [392, 493.88, 587.33, 783.99, 987.77].forEach((f, i) =>
            this._bell(t + i * 0.12, f, 1.4, 0.06)
          );
          break;
        case 'alarm':
          this._tone(t, 880, 0.12, 'square', 0.025, 0);
          this._tone(t + 0.17, 660, 0.16, 'square', 0.025, 0);
          break;
        case 'drone':
          this._tone(t, 300, 0.3, 'sawtooth', 0.03, -120);
          break;
        case 'sentry':
          this._tone(t, 220, 0.22, 'square', 0.035, 340);
          break;
        case 'shield':
          this._tone(t, 400, 0.25, 'sine', 0.03, 600);
          break;
        case 'pad':
          this._bell(t, 880, 0.4, 0.035);
          break;
        default:
          break;
      }
      if (opts.pan && this.ctx.createStereoPanner) {
        // No-op; spatialization is handled by small stereo sets above.
      }
    } catch (err) {
      /* audio graph errors must never break gameplay */
    }
  }

  /* ---------- low-level synth helpers ---------- */

  _tone(when, freq, dur, type, gainValue, slide = 0) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), when);
    if (slide) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), when + dur);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(gainValue, when + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(when);
    osc.stop(when + dur + 0.03);
  }

  _bell(when, freq, dur, gainValue) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = freq * 2.001;
    const g2 = ctx.createGain();
    g2.gain.value = 0.22;
    osc2.connect(g2);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(gainValue, when + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(gain);
    g2.connect(gain);
    gain.connect(this.sfxBus);
    if (this.reverb) {
      const send = ctx.createGain();
      send.gain.value = 0.3;
      gain.connect(send);
      send.connect(this.reverb);
    }
    osc.start(when);
    osc2.start(when);
    osc.stop(when + dur + 0.05);
    osc2.stop(when + dur + 0.05);
  }

  _noiseBurst(when, dur, freq, gainValue, endFreq) {
    if (!this._noise) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq, when);
    if (endFreq) filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), when + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(gainValue, when + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    src.start(when, Math.random());
    src.stop(when + dur + 0.05);
  }

  _sweep(when, from, to, dur, gainValue) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, when);
    osc.frequency.exponentialRampToValueAtTime(to, when + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(gainValue, when + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  dispose() {
    if (this.musicTimer) window.clearInterval(this.musicTimer);
    this.musicTimer = 0;
    try {
      if (this.ctx) this.ctx.close();
    } catch (err) {
      /* ignore */
    }
    this.ready = false;
    this.ctx = null;
  }
}
