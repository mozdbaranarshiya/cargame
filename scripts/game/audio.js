/** Gesture-unlocked, locally synthesized driving sounds: no network or audio assets. */
export class GameAudio {
  constructor(onMute = () => {}) {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
    this.onMute = onMute;
    this.active = false;
    this.lastHorn = -Infinity;
  }

  init() {
    if (this.ctx) {
      this.ctx.resume().catch(() => {});
      return;
    }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    this.ctx = new Context();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    this.master.connect(compressor);
    compressor.connect(this.ctx.destination);
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 650;
    filter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engine = [1, 0.503].map((ratio, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = i ? 'triangle' : 'sawtooth';
      osc.frequency.value = 45 * ratio;
      osc.connect(filter);
      osc.start();
      return osc;
    });
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const brakeFilter = this.ctx.createBiquadFilter();
    brakeFilter.type = 'bandpass';
    brakeFilter.frequency.value = 1700;
    this.skidGain = this.ctx.createGain();
    this.skidGain.gain.value = 0;
    noise.connect(brakeFilter);
    brakeFilter.connect(this.skidGain);
    this.skidGain.connect(this.master);
    noise.start();
  }

  update(speed, throttle, brake, handbrake, active = true) {
    this.active = active;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const v = Math.abs(speed);
    // Gear shifts keep engine pitch in a believable range even in the 500 km/h car.
    const gearSpeed = (v * 3.6) % 65;
    const pitch = 44 + gearSpeed * 1.6 + (throttle ? 20 : 0);
    this.engine[0].frequency.setTargetAtTime(pitch, now, 0.09);
    this.engine[1].frequency.setTargetAtTime(pitch * 0.503, now, 0.1);
    this.engineGain.gain.setTargetAtTime(active ? 0.065 + Math.min(v / 55, 1) * 0.10 + (throttle ? 0.05 : 0) : 0, now, 0.06);
    this.skidGain.gain.setTargetAtTime(active && v > 5 && (handbrake || brake) ? Math.min(0.17, v * 0.004) : 0, now, 0.05);
  }

  tone(frequency, duration = 0.2, volume = 0.18, type = 'sine', delay = 0, end = frequency) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }

  coin() { this.tone(620, 0.24, 0.24, 'sine', 0, 1300); }
  levelUp() { [440, 660, 880].forEach((f, i) => this.tone(f, 0.24, 0.2, 'triangle', i * 0.09)); }
  crash() { this.tone(100, 0.23, 0.3, 'triangle', 0, 28); }
  refuel() { this.tone(340, 0.14, 0.12, 'triangle', 0, 480); }
  indicator() { this.tone(800, 0.05, 0.06, 'triangle', 0, 350); }
  horn() {
    this.init();
    if (!this.ctx || this.ctx.currentTime - this.lastHorn < 0.25) return;
    this.lastHorn = this.ctx.currentTime;
    this.tone(350, 0.6, 0.25, 'sawtooth');
    this.tone(440, 0.6, 0.19, 'triangle');
  }
  setVolume(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    this.volume = Math.max(0, Math.min(1, n));
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.04);
  }
  toggle() {
    this.init();
    this.muted = !this.muted;
    this.setVolume(this.volume);
    this.onMute(this.muted);
    return this.muted;
  }
}
