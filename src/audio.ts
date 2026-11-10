/**
 * Morph's sound design. Everything is synthesized on the fly with the
 * Web Audio API — no audio files, no network, no sound until a gesture.
 */

type BrowserAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export class AudioEngine {
  muted = false;

  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  constructor() {
    try {
      this.muted = localStorage.getItem("morph-muted") === "1";
    } catch {
      this.muted = false;
    }
  }

  /** Create or resume the context. Safe to call often. */
  unlock(): void {
    if (!this.context) {
      const BrowserWindow = window as BrowserAudioWindow;
      const Ctor = window.AudioContext ?? BrowserWindow.webkitAudioContext;
      if (!Ctor) return;

      const context = new Ctor();
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 18;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      const master = context.createGain();
      master.gain.value = this.muted ? 0 : 1;
      master.connect(compressor);
      compressor.connect(context.destination);

      this.context = context;
      this.master = master;
    }

    if (this.context.state === "suspended") {
      void this.context.resume().catch(() => {
        /* The next gesture can try again. */
      });
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem("morph-muted", muted ? "1" : "0");
    } catch {
      /* Private browsing can deny storage. Sound still works. */
    }

    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, 0.025);
    }
  }

  /** A short papery burst: the card being pulled apart. */
  shred(): void {
    if (!this.ready()) return;
    const context = this.context!;
    const master = this.master!;
    const now = context.currentTime;
    const duration = 0.72;

    const source = context.createBufferSource();
    source.buffer = this.getNoise(context);

    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 0.65;
    band.frequency.setValueAtTime(3200, now);
    band.frequency.exponentialRampToValueAtTime(460, now + duration);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(band);
    band.connect(gain);
    gain.connect(master);
    source.start(now);
    source.stop(now + duration + 0.05);

    const low = context.createOscillator();
    low.type = "triangle";
    low.frequency.setValueAtTime(132, now);
    low.frequency.exponentialRampToValueAtTime(58, now + 0.34);

    const lowGain = context.createGain();
    lowGain.gain.setValueAtTime(0.0001, now);
    lowGain.gain.exponentialRampToValueAtTime(0.045, now + 0.02);
    lowGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);

    low.connect(lowGain);
    lowGain.connect(master);
    low.start(now);
    low.stop(now + 0.45);
  }

  /** A warm rising hum: the chamber holding a new shape. */
  forge(): void {
    if (!this.ready()) return;
    const context = this.context!;
    const master = this.master!;
    const now = context.currentTime;

    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(260, now);
    filter.frequency.exponentialRampToValueAtTime(780, now + 0.9);
    filter.Q.value = 1.1;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.04, now + 0.34);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

    const first = context.createOscillator();
    first.type = "sine";
    first.frequency.setValueAtTime(88, now);
    first.frequency.exponentialRampToValueAtTime(164, now + 1.05);

    const second = context.createOscillator();
    second.type = "triangle";
    second.frequency.setValueAtTime(176, now);
    second.frequency.exponentialRampToValueAtTime(328, now + 1.05);
    second.detune.value = 7;

    const secondGain = context.createGain();
    secondGain.gain.value = 0.32;

    first.connect(filter);
    second.connect(secondGain);
    secondGain.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    first.start(now);
    second.start(now);
    first.stop(now + 1.25);
    second.stop(now + 1.25);
  }

  /** The result drops out: a small, warm bell. */
  ding(): void {
    if (!this.ready()) return;
    const context = this.context!;
    const master = this.master!;
    const now = context.currentTime;

    const partials: Array<{ hz: number; gain: number; decay: number }> = [
      { hz: 1046.5, gain: 0.085, decay: 1.8 },
      { hz: 1568.0, gain: 0.038, decay: 1.4 },
      { hz: 2093.0, gain: 0.02, decay: 1.0 },
      { hz: 2637.0, gain: 0.009, decay: 0.7 },
    ];

    for (const [index, partial] of partials.entries()) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = partial.hz;
      oscillator.detune.value = index % 2 === 0 ? -3 : 4;

      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(partial.gain, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + partial.decay);

      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(now);
      oscillator.stop(now + partial.decay + 0.05);
    }

    const thump = context.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(118, now);
    thump.frequency.exponentialRampToValueAtTime(92, now + 0.24);
    const thumpGain = context.createGain();
    thumpGain.gain.setValueAtTime(0.0001, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.055, now + 0.012);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    thump.connect(thumpGain);
    thumpGain.connect(master);
    thump.start(now);
    thump.stop(now + 0.35);
  }

  /** Low, soft "not that one" cue. */
  error(): void {
    if (!this.ready()) return;
    const context = this.context!;
    const master = this.master!;
    const now = context.currentTime;

    for (const [index, hz] of [196, 164.8].entries()) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = hz;
      const gain = context.createGain();
      const start = now + index * 0.11;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.04, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(start);
      oscillator.stop(start + 0.36);
    }
  }

  private ready(): boolean {
    if (this.muted) return false;
    this.unlock();
    return Boolean(this.context && this.master);
  }

  private getNoise(context: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;

    const length = Math.floor(context.sampleRate * 1.1);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const envelope = 1 - i / length;
      data[i] = (Math.random() * 2 - 1) * envelope;
    }
    this.noise = buffer;
    return buffer;
  }
}
