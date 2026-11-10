/**
 * The transmuter chamber — everything inside the ring is drawn with Canvas2D.
 *
 * Idle: concentric brass rings, faint glass, slow orbiting marks.
 * Ingest: card fragments become glyphs that spiral into the chamber.
 * Forge: the vortex tightens, the ring speeds up and warms.
 * Complete: an expanding pulse and sparks; the DOM result card drops in.
 */

const TAU = Math.PI * 2;

type Phase = "idle" | "ingest" | "forge" | "complete";

type Glyph = {
  r: number;
  targetR: number;
  a: number;
  spin: number;
  size: number;
  char: string;
  color: string;
  alpha: number;
  age: number;
  seed: number;
  mono: boolean;
};

type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
};

type Pulse = {
  r: number;
  speed: number;
  alpha: number;
  width: number;
};

type Ember = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
};

type Dust = {
  x: number;
  y: number;
  size: number;
  alpha: number;
  seed: number;
};

const GLYPH_CHARS = [
  "◇",
  "◆",
  "△",
  "▽",
  "∴",
  "†",
  "§",
  "¶",
  "×",
  "∆",
  "Ø",
  "/",
  "\\",
  "+",
  "·",
  "○",
  "□",
  "✶",
  "0",
  "1",
  "7",
];

const GLYPH_COLORS = ["#f4e6cb", "#ebbc80", "#d48b4f", "#f8d9a5", "#bc7945"];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

function getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Morph: Canvas 2D is unavailable.");
  return context;
}

export class Chamber {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;

  private width = 0;
  private height = 0;
  private cx = 0;
  private cy = 0;
  private radius = 0;

  private glyphs: Glyph[] = [];
  private sparks: Spark[] = [];
  private pulses: Pulse[] = [];
  private embers: Ember[] = [];
  private dust: Dust[] = [];

  private phase: Phase = "idle";
  private energy = 0;
  private targetEnergy = 0.12;
  private progress = 0;
  private targetProgress = 0;
  private spin = 0;
  private time = 0;
  private emberAccumulator = 0;

  private active = false;
  private reduced = false;
  private raf = 0;
  private previousFrame = 0;

  constructor(canvas: HTMLCanvasElement, reduced: boolean) {
    this.canvas = canvas;
    this.ctx = getContext(canvas);
    this.reduced = reduced;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  setReduced(reduced: boolean): void {
    this.reduced = reduced;
    if (reduced) {
      this.stop();
      this.glyphs = [];
      this.sparks = [];
      this.embers = [];
      this.pulses = [];
      this.progress = this.targetProgress;
      this.draw();
    } else if (this.active) {
      this.start();
    }
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) this.start();
    else this.stop();
  }

  setProgress(value: number, immediate = false): void {
    this.targetProgress = clamp(value, 0, 1);
    if (immediate || this.reduced) {
      this.progress = this.targetProgress;
      this.draw();
    }
  }

  /** The file card is above the chamber. Pull its fragments inward. */
  ingest(cardBounds: DOMRect): void {
    if (this.reduced) return;

    const box = this.canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;

    const scaleX = this.width / box.width;
    const scaleY = this.height / box.height;
    const left = (cardBounds.left - box.left) * scaleX;
    const top = (cardBounds.top - box.top) * scaleY;
    const width = cardBounds.width * scaleX;
    const height = cardBounds.height * scaleY;

    const count = clamp(Math.round((width * height) / 155), 70, 155);
    const fragments: Glyph[] = [];

    for (let index = 0; index < count; index += 1) {
      const x = left + Math.random() * width;
      const y = top + Math.random() * height;
      const dx = x - this.cx;
      const dy = y - this.cy;

      fragments.push({
        r: Math.max(28, Math.hypot(dx, dy)),
        targetR: randomBetween(28, this.radius * 0.46),
        a: Math.atan2(dy, dx),
        spin: (Math.random() < 0.5 ? -1 : 1) * randomBetween(0.35, 1.15),
        size: randomBetween(8, 17),
        char: pick(GLYPH_CHARS),
        color: pick(GLYPH_COLORS),
        alpha: randomBetween(0.3, 0.95),
        age: 0,
        seed: Math.random() * TAU,
        mono: Math.random() < 0.28,
      });
    }

    this.glyphs = fragments;
    this.phase = "ingest";
    this.targetEnergy = 0.72;
    this.targetProgress = 0.14;
  }

  /** The card is gone; tighten the vortex. */
  forge(): void {
    this.phase = "forge";
    this.targetEnergy = 1;
    if (this.reduced) {
      this.draw();
      return;
    }

    // A second wave of glyphs from the rim feeds the chamber.
    for (let index = 0; index < 18; index += 1) {
      const angle = Math.random() * TAU;
      this.glyphs.push({
        r: this.radius * randomBetween(0.86, 1.06),
        targetR: randomBetween(24, this.radius * 0.42),
        a: angle,
        spin: (Math.random() < 0.5 ? -1 : 1) * randomBetween(0.4, 1.2),
        size: randomBetween(7, 14),
        char: pick(GLYPH_CHARS),
        color: pick(GLYPH_COLORS),
        alpha: randomBetween(0.25, 0.7),
        age: 0,
        seed: Math.random() * TAU,
        mono: Math.random() < 0.3,
      });
    }
  }

  /** The output is ready. Ring pulse, sparks, then settle. */
  complete(): void {
    this.phase = "complete";
    this.targetEnergy = 0.3;
    this.targetProgress = 1;
    this.targetGlyphCollapse();

    if (this.reduced) {
      this.progress = 1;
      this.draw();
      return;
    }

    this.pulses.push(
      { r: this.radius * 0.18, speed: this.radius * 1.55, alpha: 0.55, width: 1.4 },
      { r: this.radius * 0.06, speed: this.radius * 1.05, alpha: 0.36, width: 0.9 },
    );

    for (let index = 0; index < 40; index += 1) {
      const angle = Math.random() * TAU;
      const speed = randomBetween(this.radius * 0.22, this.radius * 1.15);
      this.sparks.push({
        x: this.cx + Math.cos(angle) * randomBetween(4, this.radius * 0.2),
        y: this.cy + Math.sin(angle) * randomBetween(4, this.radius * 0.2),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: randomBetween(0.5, 1.35),
        maxLife: 1.35,
        size: randomBetween(0.6, 1.9),
        color: pick(["#f8e5c2", "#eebb7e", "#d68c4d", "#fff1d6"]),
      });
    }
  }

  reset(): void {
    this.glyphs = [];
    this.sparks = [];
    this.pulses = [];
    this.embers = [];
    this.phase = "idle";
    this.energy = 0;
    this.targetEnergy = 0.12;
    this.progress = 0;
    this.targetProgress = 0;
    this.emberAccumulator = 0;
    if (this.reduced) this.draw();
  }

  /** A small ring ping when a target format is chosen. */
  accent(): void {
    if (this.reduced) return;
    this.pulses.push({
      r: this.radius * 0.35,
      speed: this.radius * 0.85,
      alpha: 0.14,
      width: 0.7,
    });
  }

  private targetGlyphCollapse(): void {
    for (const glyph of this.glyphs) {
      glyph.targetR = randomBetween(2, 14);
      glyph.spin *= 1.4;
    }
  }

  private start(): void {
    if (this.raf !== 0 || !this.active || this.reduced) return;
    this.previousFrame = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private stop(): void {
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private loop = (now: number): void => {
    const dt = Math.min(0.05, Math.max(0, (now - this.previousFrame) / 1000));
    this.previousFrame = now;
    this.update(dt);
    this.draw();

    if (this.active && !this.reduced) {
      this.raf = requestAnimationFrame(this.loop);
    } else {
      this.raf = 0;
    }
  };

  private resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = bounds.width;
    this.height = bounds.height;
    this.canvas.width = Math.round(bounds.width * dpr);
    this.canvas.height = Math.round(bounds.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.cx = this.width / 2;
    this.cy = this.height / 2;
    this.radius = Math.min(this.width, this.height) * 0.362;

    this.dust = Array.from({ length: 34 }, () => {
      const angle = Math.random() * TAU;
      const distance = Math.sqrt(Math.random()) * this.radius * 1.14;
      return {
        x: this.cx + Math.cos(angle) * distance,
        y: this.cy + Math.sin(angle) * distance,
        size: randomBetween(0.35, 1.25),
        alpha: randomBetween(0.06, 0.28),
        seed: Math.random() * TAU,
      };
    });

    if (!this.active || this.reduced) this.draw();
  }

  private update(dt: number): void {
    this.time += dt;
    this.energy += (this.targetEnergy - this.energy) * Math.min(1, dt * 2.2);
    this.progress += (this.targetProgress - this.progress) * Math.min(1, dt * 4.4);
    this.spin += dt * (0.085 + this.energy * 1.45);

    for (const glyph of this.glyphs) {
      glyph.age += dt;
      glyph.a += glyph.spin * dt * (1 + this.energy * 0.35);
      const pull = this.phase === "complete" ? 4.8 : 1.25 + this.energy * 2.15;
      glyph.r += (glyph.targetR - glyph.r) * Math.min(1, dt * pull);
      if (this.phase === "complete") {
        glyph.alpha -= dt * 0.9;
      } else {
        glyph.alpha = Math.min(1, glyph.alpha + dt * 1.8);
      }
    }
    this.glyphs = this.glyphs.filter((glyph) => glyph.alpha > 0.015);

    for (const spark of this.sparks) {
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.vx *= 1 - dt * 1.4;
      spark.vy *= 1 - dt * 1.4;
      spark.life -= dt;
    }
    this.sparks = this.sparks.filter((spark) => spark.life > 0);

    for (const pulse of this.pulses) {
      pulse.r += pulse.speed * dt;
      pulse.alpha -= dt * 0.42;
    }
    this.pulses = this.pulses.filter((pulse) => pulse.alpha > 0.005);

    for (const ember of this.embers) {
      ember.x += ember.vx * dt;
      ember.y += ember.vy * dt;
      ember.vx *= 1 - dt * 0.35;
      ember.vy -= dt * 2.2;
      ember.life -= dt;
    }
    this.embers = this.embers.filter((ember) => ember.life > 0);

    this.emberAccumulator += dt * (this.phase === "idle" ? 2.4 : 1.1);
    while (this.emberAccumulator >= 1) {
      this.emberAccumulator -= 1;
      this.spawnEmber();
    }
  }

  private spawnEmber(): void {
    const angle = Math.random() * TAU;
    const distance = this.radius * randomBetween(0.42, 1.02);
    const life = randomBetween(1.6, 3.8);
    this.embers.push({
      x: this.cx + Math.cos(angle) * distance,
      y: this.cy + Math.sin(angle) * distance,
      vx: randomBetween(-3, 3),
      vy: randomBetween(-8, -2),
      life,
      maxLife: life,
      size: randomBetween(0.35, 1.15),
    });
  }

  private draw(): void {
    const ctx = this.ctx;
    if (this.width === 0 || this.height === 0) return;

    ctx.clearRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    this.drawAmbient();
    this.drawGlass();
    this.drawTicks();
    this.drawRings();
    this.drawCoreGlow();
    this.drawProgress();
    this.drawDust();
    this.drawEmbers();
    this.drawGlyphs();
    this.drawPulses();
    this.drawSparks();
  }

  private drawAmbient(): void {
    const ctx = this.ctx;
    const halo = ctx.createRadialGradient(
      this.cx,
      this.cy,
      this.radius * 0.05,
      this.cx,
      this.cy,
      this.radius * 1.62,
    );
    halo.addColorStop(0, `rgba(224, 146, 78, ${0.15 + this.energy * 0.1})`);
    halo.addColorStop(0.52, `rgba(121, 63, 29, ${0.06 + this.energy * 0.035})`);
    halo.addColorStop(1, "rgba(10, 6, 4, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawGlass(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.radius * 0.965, 0, TAU);

    const glass = ctx.createRadialGradient(
      this.cx - this.radius * 0.24,
      this.cy - this.radius * 0.3,
      this.radius * 0.03,
      this.cx,
      this.cy,
      this.radius,
    );
    glass.addColorStop(0, `rgba(255, 213, 157, ${0.09 + this.energy * 0.09})`);
    glass.addColorStop(0.38, "rgba(95, 53, 27, 0.08)");
    glass.addColorStop(0.78, "rgba(25, 14, 8, 0.34)");
    glass.addColorStop(1, "rgba(7, 4, 2, 0.56)");
    ctx.fillStyle = glass;
    ctx.fill();
    ctx.restore();
  }

  private drawTicks(): void {
    const ctx = this.ctx;
    const tickRadius = this.radius * 1.165;
    const count = 108;

    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.spin * 0.11);
    ctx.lineCap = "round";

    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * TAU;
      const long = index % 9 === 0;
      const length = long ? 7 : 3.5;
      const alpha = 0.055 + (long ? 0.13 : 0.045) + this.energy * 0.06;
      ctx.beginPath();
      ctx.strokeStyle = `rgba(231, 181, 124, ${alpha})`;
      ctx.lineWidth = long ? 0.9 : 0.55;
      ctx.moveTo(Math.cos(angle) * (tickRadius - length), Math.sin(angle) * (tickRadius - length));
      ctx.lineTo(Math.cos(angle) * tickRadius, Math.sin(angle) * tickRadius);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawRings(): void {
    const ctx = this.ctx;
    const r = this.radius;

    ctx.save();
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, r, 0, TAU);
    ctx.strokeStyle = "rgba(218, 158, 98, 0.24)";
    ctx.lineWidth = 0.8;
    ctx.stroke();

    const ringGradient = ctx.createLinearGradient(
      this.cx - r,
      this.cy - r,
      this.cx + r,
      this.cy + r,
    );
    ringGradient.addColorStop(0, "rgba(103, 57, 29, 0.6)");
    ringGradient.addColorStop(0.38, "rgba(237, 181, 120, 0.82)");
    ringGradient.addColorStop(0.62, "rgba(172, 104, 56, 0.55)");
    ringGradient.addColorStop(1, "rgba(61, 34, 18, 0.35)");
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, r, 0, TAU);
    ctx.strokeStyle = ringGradient;
    ctx.lineWidth = 1.25;
    ctx.stroke();

    ctx.save();
    ctx.shadowColor = "rgba(240, 177, 108, 0.65)";
    ctx.shadowBlur = 10 + this.energy * 18;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, r, this.spin * 0.55 + 0.2, this.spin * 0.55 + 1.9);
    ctx.strokeStyle = `rgba(247, 203, 148, ${0.28 + this.energy * 0.5})`;
    ctx.lineWidth = 1.6 + this.energy * 0.6;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(this.cx, this.cy, r, this.spin * 0.55 + 3.3, this.spin * 0.55 + 4.15);
    ctx.strokeStyle = `rgba(235, 176, 111, ${0.18 + this.energy * 0.32})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    // A fine inner ring, rotating the other way.
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([1.2, 7.5]);
    ctx.lineDashOffset = -this.spin * 11;
    ctx.arc(this.cx, this.cy, r * 0.835, 0, TAU);
    ctx.strokeStyle = "rgba(236, 196, 143, 0.19)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();

    // Faint inner aperture arcs.
    ctx.save();
    for (const [offset, length] of [
      [1.1, 0.7],
      [3.4, 0.55],
    ]) {
      ctx.beginPath();
      ctx.arc(
        this.cx,
        this.cy,
        r * 0.6,
        -this.spin * 0.28 + offset,
        -this.spin * 0.28 + offset + length,
      );
      ctx.strokeStyle = `rgba(235, 194, 140, ${0.06 + this.energy * 0.09})`;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    ctx.restore();

    // Specular gleam on the glass.
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, r * 0.958, -2.6, -1.9);
    ctx.strokeStyle = "rgba(255, 241, 216, 0.28)";
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, r * 0.958, -1.78, -1.58);
    ctx.strokeStyle = "rgba(255, 241, 216, 0.12)";
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.restore();

    // Three small orbital marks.
    for (let index = 0; index < 3; index += 1) {
      const angle = this.spin * 0.23 + (index / 3) * TAU + 0.4;
      const x = this.cx + Math.cos(angle) * r;
      const y = this.cy + Math.sin(angle) * r;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + Math.PI / 4);
      ctx.fillStyle = `rgba(248, 219, 181, ${0.38 + this.energy * 0.35})`;
      ctx.shadowColor = "rgba(241, 186, 119, 0.7)";
      ctx.shadowBlur = 7;
      ctx.fillRect(-1.6, -1.6, 3.2, 3.2);
      ctx.restore();
    }
  }

  private drawCoreGlow(): void {
    const ctx = this.ctx;
    const glow = ctx.createRadialGradient(
      this.cx,
      this.cy,
      0,
      this.cx,
      this.cy,
      this.radius * 0.7,
    );
    glow.addColorStop(0, `rgba(255, 207, 148, ${0.025 + this.energy * 0.1})`);
    glow.addColorStop(0.55, `rgba(213, 131, 66, ${0.015 + this.energy * 0.04})`);
    glow.addColorStop(1, "rgba(20, 10, 5, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.radius * 0.7, 0, TAU);
    ctx.fill();
  }

  private drawProgress(): void {
    if (this.progress < 0.002) return;
    const ctx = this.ctx;
    const radius = this.radius * 1.078;
    const start = -Math.PI / 2;
    const end = start + TAU * this.progress;

    ctx.save();
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, radius, 0, TAU);
    ctx.strokeStyle = "rgba(235, 183, 118, 0.1)";
    ctx.lineWidth = 0.7;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(this.cx, this.cy, radius, start, end);
    ctx.strokeStyle = "rgba(248, 203, 145, 0.78)";
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(239, 173, 101, 0.8)";
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.restore();

    const headX = this.cx + Math.cos(end) * radius;
    const headY = this.cy + Math.sin(end) * radius;
    ctx.save();
    ctx.beginPath();
    ctx.arc(headX, headY, 2.1, 0, TAU);
    ctx.fillStyle = "rgba(255, 231, 193, 0.95)";
    ctx.shadowColor = "rgba(255, 196, 128, 0.9)";
    ctx.shadowBlur = 9;
    ctx.fill();
    ctx.restore();
  }

  private drawDust(): void {
    const ctx = this.ctx;
    for (const speck of this.dust) {
      const twinkle = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.time * 0.55 + speck.seed));
      ctx.globalAlpha = speck.alpha * twinkle;
      ctx.fillStyle = "#f4ddba";
      ctx.beginPath();
      ctx.arc(speck.x, speck.y, speck.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawEmbers(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const ember of this.embers) {
      const alpha = clamp(ember.life / ember.maxLife, 0, 1) * 0.55;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#efb779";
      ctx.beginPath();
      ctx.arc(ember.x, ember.y, ember.size, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawGlyphs(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const glyph of this.glyphs) {
      const wobble = Math.sin(glyph.age * 3.1 + glyph.seed) * 3.2;
      const x = this.cx + Math.cos(glyph.a) * (glyph.r + wobble);
      const y = this.cy + Math.sin(glyph.a) * (glyph.r + wobble);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(glyph.a + Math.PI / 2 + Math.sin(glyph.seed) * 0.4);
      ctx.globalAlpha = clamp(glyph.alpha, 0, 1) * 0.88;
      ctx.fillStyle = glyph.color;
      ctx.font = glyph.mono
        ? `${glyph.size}px ui-monospace, "SFMono-Regular", Consolas, monospace`
        : `${glyph.size}px "Instrument Serif", "Iowan Old Style", Georgia, serif`;
      ctx.fillText(glyph.char, 0, 0);
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawPulses(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const pulse of this.pulses) {
      ctx.globalAlpha = clamp(pulse.alpha, 0, 1);
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, Math.max(1, pulse.r), 0, TAU);
      ctx.strokeStyle = "rgba(250, 209, 153, 0.9)";
      ctx.lineWidth = pulse.width;
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawSparks(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const spark of this.sparks) {
      const alpha = clamp(spark.life / spark.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = spark.color;
      ctx.lineWidth = spark.size;
      ctx.beginPath();
      ctx.moveTo(spark.x, spark.y);
      ctx.lineTo(spark.x - spark.vx * 0.022, spark.y - spark.vy * 0.022);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
