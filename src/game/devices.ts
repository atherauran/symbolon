import Phaser from 'phaser';
import { format } from '../math/evaluate';
import {
  GRID,
  GY,
  LIP,
  M,
  cellsAfter,
  chainEnergy,
  divisionsFor,
  gridPoint,
  imageDistance,
  imageOffset,
  leverLoads,
  netMoment,
  traceLight,
  vibration,
} from '../physics/model';
import { Formula, INK, MUTED, text } from './art';
import type { DeviceSpec, Load } from './types';

export const HAZARD = 0xefb7a4;
const LABEL = '#bcc6cc';
const END = 2300;
type Graphics = Phaser.GameObjects.Graphics;
type Spec<K extends DeviceSpec['kind']> = Extract<DeviceSpec, { kind: K }>;
const fmt = (n: number) => format({ num: n });
const rad = (degrees: number) => (degrees * Math.PI) / 180;
const approach = (value: number, target: number, step: number) =>
  Math.abs(target - value) <= step ? target : value + Math.sign(target - value) * step;

export interface Platform {
  rect: Phaser.GameObjects.Rectangle;
  body: Phaser.Physics.Arcade.StaticBody;
  width: number;
  height: number;
  baseX: number;
  baseY: number;
  motion?: 'lift';
  phase: number;
  amplitude: number;
  hidden?: boolean;
}
export interface Ramp {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface DeviceHost {
  scene: Phaser.Scene;
  accent: number;
  boss: boolean;
  core: { x: number; y: number };
  platform(x: number, y: number, width: number, height: number, hidden?: boolean): Platform;
  removePlatform(platform: Platform): void;
  movePlatform(platform: Platform, x: number, y: number): void;
  addRamp(ramp: Ramp): void;
  player(): { x: number; top: number; bottom: number };
  hurt(fromX: number): void;
  burst(x: number, y: number, color?: number, count?: number, force?: number): void;
  sound(name: 'solve' | 'wrong' | 'hit' | 'grab' | 'throw'): void;
  /** Throws the player upward with this vertical speed in px/s. */
  launch(vy: number): void;
  tone(frequency: number, duration: number, gain?: number): void;
  /** World time in seconds; it slows with focus like everything else in the world. */
  time(): number;
}

// ---------- Instruments ----------

/** A meter ruler. Horizontal rulers read left to right; vertical rulers read upward. */
function ruler(
  scene: Phaser.Scene,
  g: Graphics,
  x: number,
  y: number,
  length: number,
  options: { start?: number; vertical?: boolean; broken?: boolean } = {},
): void {
  const start = options.start ?? 0,
    [dx, dy] = options.vertical ? [0, -1] : [1, 0];
  g.lineStyle(1.5, INK, 0.6).lineBetween(x, y, x + dx * length * M, y + dy * length * M);
  for (let i = 0; i <= length * 2; i++) {
    const px = x + (dx * i * M) / 2,
      py = y + (dy * i * M) / 2,
      size = i % 2 ? 6 : 12;
    if (options.vertical) g.lineBetween(px, py, px + size, py);
    else g.lineBetween(px, py, px, py - size);
    if (i % 2 === 0)
      text(
        scene,
        options.vertical ? px + 26 : px,
        options.vertical ? py : py + 16,
        String(start + i / 2),
        14,
        LABEL,
      ).setDepth(3);
  }
  text(
    scene,
    x + dx * length * M + (options.vertical ? 26 : 22),
    y + dy * length * M + (options.vertical ? -22 : 16),
    'm',
    14,
    LABEL,
  ).setDepth(3);
  if (options.broken) {
    g.lineStyle(1.5, INK, 0.6).beginPath().moveTo(x, y);
    for (let i = 1; i <= 4; i++) g.lineTo(x - i * 5, y - (i % 2 ? 9 : 2));
    g.strokePath();
  }
}
/** A protractor centred at (x, y) covering math angles `from`..`to` (0° right, 90° up). */
function protractor(
  scene: Phaser.Scene,
  g: Graphics,
  x: number,
  y: number,
  radius: number,
  from: number,
  to: number,
  labels = 30,
): void {
  g.lineStyle(1, INK, 0.45).beginPath().arc(x, y, radius, -rad(to), -rad(from)).strokePath();
  for (let a = from; a <= to; a += 5) {
    const long = a % labels === 0 ? 10 : a % 10 === 0 ? 6 : 3;
    g.lineBetween(
      x + Math.cos(rad(a)) * radius,
      y - Math.sin(rad(a)) * radius,
      x + Math.cos(rad(a)) * (radius - long),
      y - Math.sin(rad(a)) * (radius - long),
    );
    if (a % labels === 0)
      text(
        scene,
        x + Math.cos(rad(a)) * (radius + 17),
        y - Math.sin(rad(a)) * (radius + 17),
        `${Math.abs(a)}°`,
        12,
        LABEL,
      ).setDepth(3);
  }
}
class Stopwatch {
  readout: Phaser.GameObjects.Text;
  constructor(
    scene: Phaser.Scene,
    public x: number,
    public y: number,
    caption = '',
  ) {
    this.readout = text(scene, x, y, '0.0 s', 18, '#e2e6e6').setDepth(4);
    if (caption) text(scene, x, y + 38, caption, 12, LABEL, false).setDepth(4);
  }
  draw(g: Graphics, t: number): void {
    g.lineStyle(1.5, INK, 0.55).strokeCircle(this.x, this.y, 30);
    g.lineStyle(2, INK, 0.8).lineBetween(this.x, this.y - 30, this.x, this.y - 36);
    const a = t * Math.PI * 2 - Math.PI / 2;
    g.lineStyle(1, INK, 0.35).lineBetween(this.x, this.y, this.x + Math.cos(a) * 24, this.y + Math.sin(a) * 24);
    this.readout.setText(`${t.toFixed(1)} s`);
  }
}
function spikes(g: Graphics, x1: number, x2: number, y: number, down = false): void {
  g.lineStyle(1.4, HAZARD, 0.8).beginPath().moveTo(x1, y);
  for (let x = x1; x < x2; x += 16) g.lineTo(x + 8, y + (down ? 12 : -12)).lineTo(Math.min(x2, x + 16), y);
  g.strokePath();
}

/** A tall door that slides up and out of the way once its device succeeds. */
class Door {
  platform: Platform;
  private y = GY - 360;
  constructor(
    private host: DeviceHost,
    public x: number,
  ) {
    this.platform = host.platform(x, this.y, 30, 720, true);
  }
  open(dt: number): void {
    this.y = Math.max(GY - 1100, this.y - 240 * dt);
    this.host.movePlatform(this.platform, this.x, this.y);
  }
  draw(g: Graphics): void {
    const top = this.platform.rect.y - 360;
    g.lineStyle(2, INK, 0.7).strokeRect(this.x - 15, top, 30, 720);
    for (let i = 0; i < 16; i++)
      g.lineStyle(1, INK, 0.2).lineBetween(this.x - 15, top + i * 45, this.x + 15, top + 30 + i * 45);
  }
}
/** Draws a cell: membrane, a faint fill, and a nucleus. */
function cell(g: Graphics, x: number, y: number, r: number, color: number, alpha = 1): void {
  g.fillStyle(color, 0.14 * alpha).fillCircle(x, y, r);
  g.lineStyle(1.6, color, 0.9 * alpha).strokeCircle(x, y, r);
  g.fillStyle(color, 0.7 * alpha).fillCircle(x + r * 0.15, y - r * 0.1, r * 0.28);
}
function heart(g: Graphics, x: number, y: number, size: number, color: number): void {
  g.fillStyle(color, 1)
    .fillCircle(x - size * 0.5, y - size * 0.2, size * 0.56)
    .fillCircle(x + size * 0.5, y - size * 0.2, size * 0.56)
    .fillTriangle(x - size * 1.04, y - size * 0.05, x + size * 1.04, y - size * 0.05, x, y + size * 1.1);
}
/** Beat envelope: 1 at each beat, fading quickly until the next. */
const beat = (t: number, frequency: number) => (frequency > 0 ? Math.exp(-((((t * frequency) % 1) + 1) % 1) * 6) : 0);

// ---------- Devices ----------

export abstract class Device {
  state: 'idle' | 'running' | 'success' = 'idle';
  goal = { x: END - 145, y: GY };
  protected t = 0;
  protected value = 0;
  protected success = false;
  protected statics: Graphics;
  constructor(protected host: DeviceHost) {
    this.statics = host.scene.add.graphics().setDepth(2);
  }
  get scene(): Phaser.Scene {
    return this.host.scene;
  }
  get busy(): boolean {
    return this.state === 'running';
  }
  get accent(): number {
    return this.host.accent;
  }
  abstract build(): void;
  run(value: number, success: boolean): void {
    this.value = value;
    this.success = success;
    this.t = 0;
    this.state = 'running';
  }
  abstract update(dt: number): void;
  abstract draw(g: Graphics): void;
  /** Returns a boss device to its idle state for the next counter. */
  reset(): void {
    this.state = 'idle';
    this.t = 0;
  }
  /** Where a boss counter launches from. */
  origin(): { x: number; y: number } {
    return { x: this.host.core.x, y: this.host.core.y + 120 };
  }
  protected ground(x1: number, x2: number, top = GY, depth = 20): Platform {
    return this.host.platform((x1 + x2) / 2, top + depth / 2, x2 - x1, depth);
  }
  protected label(x: number, y: number, value: string, size = 14, color = LABEL, math = true): Phaser.GameObjects.Text {
    return text(this.scene, x, y, value, size, color, math).setDepth(4);
  }
  protected win(): void {
    this.state = 'success';
    this.host.sound('solve');
  }
  protected lose(): void {
    this.state = 'idle';
    this.host.sound('wrong');
  }
}

/** A telescoping bridge that locks only into the far socket. */
class MeasureDevice extends Device {
  private length = 0;
  private angle = 0;
  private stage: 'grow' | 'jam' | 'tip' = 'grow';
  private locked = false;
  constructor(
    host: DeviceHost,
    private spec: Spec<'measure'>,
  ) {
    super(host);
  }
  private get far(): number {
    return LIP + this.spec.gap * M;
  }
  build(): void {
    this.ground(this.far, END, GY - 40, 160);
    this.goal = { x: END - 145, y: GY - 40 };
    ruler(this.scene, this.statics, LIP, GY + 40, this.spec.gap + 1, {
      start: this.spec.start,
      broken: this.spec.start > 0,
    });
    this.statics
      .lineStyle(1.2, INK, 0.5)
      .lineBetween(this.far, GY - 40, this.far, GY + 90)
      .strokeRect(this.far - 2, GY, 12, 12);
  }
  run(value: number, success: boolean): void {
    super.run(value, success);
    this.length = 0;
    this.angle = 0;
    this.stage = 'grow';
  }
  update(dt: number): void {
    if (this.state !== 'running') return;
    this.t += dt;
    if (this.stage === 'grow') {
      const target = Math.min(this.value, this.spec.gap);
      this.length = approach(this.length, target, 4 * dt);
      if (this.length === target) {
        this.t = 0;
        if (this.success) {
          this.locked = true;
          this.host.platform(LIP + (this.spec.gap * M) / 2, GY + 6, this.spec.gap * M, 12, true);
          this.host.burst(this.far, GY, this.accent, 20);
          this.win();
        } else this.stage = this.value > this.spec.gap ? 'jam' : 'tip';
      }
    } else if (this.stage === 'jam') {
      if (this.t > 0.6) this.length = approach(this.length, 0, 6 * dt);
      if (!this.length) this.lose();
    } else {
      this.angle = approach(this.angle, 80, 140 * dt);
      if (this.angle === 80) {
        this.length = 0;
        this.lose();
      }
    }
  }
  draw(g: Graphics): void {
    if (this.length <= 0) return;
    const shake = this.stage === 'jam' && this.t < 0.6 && this.state === 'running' ? Math.sin(this.t * 90) * 2 : 0;
    const alpha = 1 - this.angle / 90;
    g.lineStyle(8, this.accent, 0.75 * alpha).lineBetween(
      LIP + shake,
      GY + 5,
      LIP + shake + Math.cos(rad(this.angle)) * this.length * M,
      GY + 5 + Math.sin(rad(this.angle)) * this.length * M,
    );
    if (this.locked) g.lineStyle(1, INK, 0.8).lineBetween(LIP, GY, this.far, GY);
  }
}

/** A staircase of 1 m steps rising toward a ledge measured with a vertical ruler. */
class StairsDevice extends Device {
  private steps: Platform[] = [];
  constructor(
    host: DeviceHost,
    private spec: Spec<'stairs'>,
  ) {
    super(host);
  }
  private get ledgeX(): number {
    return LIP + 40 + (this.spec.height - 1) * 88 + 240;
  }
  build(): void {
    const top = GY - this.spec.height * M;
    this.goal = { x: END - 145, y: top };
    this.statics.lineStyle(1, MUTED, 0.5).lineBetween(LIP, GY, this.ledgeX - 40, GY);
    if (!this.spec.bricks) {
      this.ground(this.ledgeX, END, top, 60);
      ruler(this.scene, this.statics, this.ledgeX - 40, GY, this.spec.height + 1, { vertical: true });
      return;
    }
    // A solid wall of 1 m brick courses: count them to know its height.
    this.ground(this.ledgeX, END, top, GY - top + 20);
    const g = this.statics.lineStyle(1.2, INK, 0.4);
    for (let course = 0; course < this.spec.height; course++) {
      const y = GY - course * M;
      g.lineBetween(this.ledgeX, y, this.ledgeX + 280, y);
      for (let x = this.ledgeX + (course % 2 ? 60 : 0); x <= this.ledgeX + 280; x += 120) g.lineBetween(x, y, x, y - M);
    }
    g.lineBetween(this.ledgeX, GY, this.ledgeX, top);
  }
  run(value: number, success: boolean): void {
    super.run(value, success);
    this.steps.forEach((p) => this.host.removePlatform(p));
    const count = Phaser.Math.Clamp(Math.floor(value), 0, 8);
    this.steps = Array.from({ length: count }, (_, i) =>
      this.host.platform(LIP + 80 + i * 88, GY - (i + 1) * M + 6, 80, 12),
    );
    this.steps.forEach((p, i) => {
      p.rect.setAlpha(0);
      this.scene.tweens.add({ targets: p.rect, alpha: 1, duration: 400, delay: i * 90 });
    });
    if (success) this.win();
    else this.lose();
  }
  update(): void {}
  draw(): void {}
}

/** Uniform motion. A cart must meet a bar that is level only at one moment on the stopwatch. */
class CartDevice extends Device {
  private cart!: Platform;
  private bar?: Platform;
  private clock!: Stopwatch;
  private x = 0;
  private y = GY - 10;
  private vy = 0;
  private demo = 0;
  private fall = false;
  private arrived = false;
  private target = 0;
  private wait = 1.2;
  constructor(
    host: DeviceHost,
    private spec: Spec<'cart'>,
  ) {
    super(host);
  }
  private get reverse(): boolean {
    return Boolean(this.spec.reverse);
  }
  /** Cart centre at rest. */
  private get home(): number {
    return this.reverse ? LIP + M + this.spec.distance * M + 40 : LIP - 40;
  }
  private get pivot(): number {
    return this.reverse ? LIP : LIP + this.spec.distance * M + M;
  }
  /** Bar direction in math degrees: it swings through level at time T at 90° per second. */
  private barAngle(t: number): number {
    const swing = Phaser.Math.Clamp(90 * (t - (this.spec.time - 1)), 0, 180);
    return this.reverse ? 90 - swing : 90 + swing;
  }
  build(): void {
    const { distance } = this.spec;
    if (this.reverse) this.ground(LIP + 2 * M + distance * M, END);
    else this.ground(this.pivot, END);
    this.x = this.home;
    this.cart = this.host.platform(this.x, this.y, 80, 20, true);
    const trackStart = this.reverse ? LIP + M : LIP;
    this.statics
      .lineStyle(2, INK, 0.45)
      .lineBetween(trackStart, GY + 2, trackStart + distance * M + (this.reverse ? M : 0), GY + 2);
    for (let x = trackStart; x <= trackStart + distance * M; x += M)
      this.statics.lineStyle(1, MUTED, 0.6).lineBetween(x, GY + 2, x, GY + 80);
    ruler(this.scene, this.statics, trackStart, GY + 40, distance);
    this.statics.lineStyle(2, INK, 0.6).lineBetween(this.pivot, GY, this.pivot, GY + 90);
    this.clock = new Stopwatch(this.scene, this.reverse ? LIP + 40 : this.pivot - 40, GY - 210);
  }
  run(value: number, success: boolean): void {
    super.run(value, success);
    this.x = this.home;
    this.y = GY - 10;
    this.vy = 0;
    this.fall = false;
    this.arrived = false;
  }
  private dock(): number {
    return this.reverse ? LIP + M + 40 : this.pivot + M - 40;
  }
  update(dt: number): void {
    if (this.state === 'idle') {
      this.demo = (this.demo + dt) % (this.spec.time + 2.5);
      return;
    }
    if (this.state === 'success') {
      this.runShuttle(dt);
      return;
    }
    this.t += dt;
    const direction = this.reverse ? -1 : 1,
      v = this.value;
    if (this.fall) {
      this.vy += 1450 * dt;
      this.y += this.vy * dt;
      this.x += v * M * dt;
      if (this.y > 860) this.restart();
    } else if (this.arrived) {
      this.x = approach(this.x, this.dock(), Math.abs(v) * M * dt);
      if (this.x === this.dock()) {
        this.target = this.home;
        this.wait = 1.2;
        this.host.burst(this.pivot, GY, this.accent, 20);
        this.win();
      }
    } else {
      this.x = this.home + v * this.t * M;
      const travelled = ((this.x - this.home) * direction) / M;
      if (v * direction <= 0) {
        if (this.t > 2 || v === 0) this.restart();
      } else if (travelled >= this.spec.distance) {
        if (this.success) {
          this.x = this.home + direction * this.spec.distance * M;
          this.arrived = true;
          this.bar = this.host.platform(this.reverse ? LIP + 40 : this.pivot - 40, GY + 6, 80, 12, true);
        } else if (travelled >= this.spec.distance + 0.5) this.fall = true;
      }
    }
    this.host.movePlatform(this.cart, this.x, this.y);
  }
  private restart(): void {
    this.x = this.home;
    this.y = GY - 10;
    this.fall = false;
    this.demo = 0;
    this.host.movePlatform(this.cart, this.x, this.y);
    this.lose();
  }
  /** After a successful run the cart shuttles at its speed so you can ride it across. */
  private runShuttle(dt: number): void {
    if (this.wait > 0) {
      this.wait -= dt;
      return;
    }
    this.x = approach(this.x, this.target, Math.abs(this.value) * M * dt);
    if (this.x === this.target) {
      this.wait = 1.2;
      this.target = this.target === this.home ? this.dock() : this.home;
    }
    this.host.movePlatform(this.cart, this.x, this.y);
  }
  draw(g: Graphics): void {
    const level = this.arrived || this.state === 'success',
      time = this.state === 'idle' ? this.demo : level ? this.spec.time : this.t;
    const angle = level ? (this.reverse ? 0 : 180) : this.barAngle(time);
    g.lineStyle(6, level ? this.accent : INK, 0.85).lineBetween(
      this.pivot,
      GY + 4,
      this.pivot + Math.cos(rad(angle)) * M,
      GY + 4 - Math.sin(rad(angle)) * M,
    );
    g.fillStyle(INK, 1).fillCircle(this.pivot, GY + 4, 4);
    this.clock.draw(g, time);
    g.lineStyle(2, this.accent, 0.9).strokeRect(this.x - 40, this.y - 10, 80, 20);
    g.fillStyle(this.accent, 0.18).fillRect(this.x - 40, this.y - 10, 80, 20);
    g.lineStyle(2, INK, 0.8)
      .strokeCircle(this.x - 24, this.y + 10, 5)
      .strokeCircle(this.x + 24, this.y + 10, 5);
  }
}

/** A meeting problem: your cart and the charging 𝑥 must reach the trap at the same moment. */
class MeetDevice extends Device {
  private runner: Formula;
  private clock!: Stopwatch;
  private runnerX = 0;
  private charging = false;
  private chargeTime = 0;
  private cooldown = 2.5;
  private cartX = 0;
  private caught = false;
  constructor(
    host: DeviceHost,
    private spec: Spec<'meet'>,
  ) {
    super(host);
    this.runner = new Formula(host.scene, 0, GY - 28, '𝑥', 46, '#d6d9d7').setDepth(9).setVisible(false);
  }
  private get start(): number {
    return this.spec.trapX - this.spec.distance * M;
  }
  private get runnerStart(): number {
    return this.spec.trapX + this.spec.runnerDistance * M;
  }
  build(): void {
    ruler(this.scene, this.statics, this.start, GY + 40, this.spec.distance);
    ruler(this.scene, this.statics, this.spec.trapX, GY + 72, this.spec.runnerDistance);
    this.clock = new Stopwatch(this.scene, this.spec.trapX - 150, 330);
    this.cartX = this.start;
  }
  origin(): { x: number; y: number } {
    return { x: this.spec.trapX, y: GY - 40 };
  }
  run(value: number, success: boolean): void {
    super.run(value, success);
    this.cartX = this.start;
    this.charge();
    this.caught = false;
  }
  private charge(): void {
    this.charging = true;
    this.chargeTime = 0;
    this.runnerX = this.runnerStart;
    this.runner.setVisible(true);
  }
  reset(): void {
    super.reset();
    this.cartX = this.start;
    this.caught = false;
    this.charging = false;
    this.runner.setVisible(false);
    this.cooldown = 2.5;
  }
  update(dt: number): void {
    if (this.state === 'success') return;
    if (this.charging && !this.caught) {
      this.chargeTime += dt;
      this.runnerX = this.runnerStart - this.spec.runnerSpeed * this.chargeTime * M;
      const player = this.host.player();
      if (Math.abs(this.runnerX - player.x) < 30 && player.bottom > GY - 60) this.host.hurt(this.runnerX);
      if (this.runnerX < -60) {
        this.charging = false;
        this.runner.setVisible(false);
        this.cooldown = 3;
      }
    } else if (this.state === 'idle') {
      this.cooldown -= dt;
      if (this.cooldown <= 0) this.charge();
    }
    if (this.state !== 'running') return;
    this.t += dt;
    this.cartX = this.start + this.value * this.t * M;
    const meeting = this.spec.runnerDistance / this.spec.runnerSpeed;
    if (this.success && this.t >= meeting) {
      this.caught = true;
      this.runnerX = this.spec.trapX;
      this.cartX = this.spec.trapX;
      this.host.burst(this.spec.trapX, GY - 30, this.accent, 40, 200);
      this.win();
    } else if (!this.success && this.t > Math.max(meeting, this.spec.distance / this.value) + 1) {
      this.cartX = this.start;
      this.lose();
    }
  }
  draw(g: Graphics): void {
    this.runner.setPosition(this.runnerX, GY - 28);
    this.clock.draw(g, this.charging || this.caught ? this.chargeTime : 0);
    spikes(g, this.spec.trapX - 24, this.spec.trapX + 24, GY - 2);
    g.lineStyle(2, this.accent, 0.9).strokeRect(this.cartX - 40, GY - 22, 80, 20);
    g.lineStyle(2, INK, 0.8)
      .strokeCircle(this.cartX - 24, GY - 2, 5)
      .strokeCircle(this.cartX + 24, GY - 2, 5);
  }
}

interface LeverItem {
  load: Load;
  slot: number;
  text: Phaser.GameObjects.Text;
}
/** A lever (or equal-arm balance) that settles by the sign of its net moment, F₁L₁ − F₂L₂. */
class LeverDevice extends Device {
  private angle = 0;
  private items: LeverItem[] = [];
  private marks: Phaser.GameObjects.Text[] = [];
  private loads: Load[] = [];
  private hold = 0;
  private beam?: Platform;
  constructor(
    host: DeviceHost,
    private spec: Spec<'lever'>,
  ) {
    super(host);
  }
  private get pivot(): [number, number] {
    return [this.spec.pivotX ?? LIP + 20 + this.spec.arms[0] * M, this.spec.pivotY ?? GY];
  }
  private idleLoads(): Load[] {
    return this.spec.control === 'mass'
      ? this.spec.loads.map((l) => (l.label === '𝑥' ? { ...l, mass: 0 } : l))
      : this.spec.loads;
  }
  build(): void {
    const [px, py] = this.pivot,
      [a1, a2] = this.spec.arms;
    if (!this.host.boss) this.ground(px + a2 * M + 20, END);
    this.statics
      .lineStyle(1.5, INK, 0.6)
      .beginPath()
      .moveTo(px, py + 8)
      .lineTo(px - 16, py + 40)
      .lineTo(px + 16, py + 40)
      .closePath()
      .strokePath();
    this.statics.lineBetween(px, py + 40, px, this.host.boss ? GY : 760);
    for (let i = -a1; i <= a2; i++) if (i) this.marks.push(this.label(0, 0, String(Math.abs(i)), 12));
    this.loads = this.idleLoads();
    this.makeItems();
    this.angle = this.rest(this.loads);
  }
  private makeItems(): void {
    this.items.forEach((i) => i.text.destroy());
    this.items = [];
    const slots: Record<number, number> = {};
    for (const load of this.loads)
      for (let n = 0; n < (load.count ?? 1); n++) {
        const key = load.side * 100 + load.arm;
        slots[key] = (slots[key] ?? 0) + 1;
        this.items.push({
          load,
          slot: slots[key] - 1,
          text: this.label(0, 0, '', 14, load.label === 'you' ? '#1a1510' : '#e8ecec'),
        });
      }
  }
  private rest(loads: Load[]): number {
    const net = netMoment(loads);
    return Math.abs(net) < 1e-9 ? 0 : Math.sign(net) * 10;
  }
  run(value: number, success: boolean): void {
    super.run(value, success);
    this.loads = leverLoads(this.spec, value);
    this.makeItems();
    this.hold = 0;
    this.host.sound('grab');
  }
  reset(): void {
    super.reset();
    this.loads = this.idleLoads();
    this.makeItems();
  }
  origin(): { x: number; y: number } {
    const [px, py] = this.pivot;
    return { x: px + this.spec.arms[1] * M, y: py - 30 };
  }
  update(dt: number): void {
    const target = this.rest(this.loads);
    this.angle = approach(this.angle, target, 18 * dt);
    if (this.state !== 'running' || this.angle !== target) return;
    this.hold += dt;
    if (this.hold < 0.5) return;
    if (this.success) {
      const [px, py] = this.pivot,
        [a1, a2] = this.spec.arms;
      if (!this.host.boss) this.beam = this.host.platform(px + ((a2 - a1) * M) / 2, py + 6, (a1 + a2) * M, 12, true);
      this.host.burst(px, py, this.accent, 24);
      this.win();
    } else if (this.hold > 1.8) {
      this.loads = this.idleLoads();
      this.makeItems();
      this.lose();
    }
  }
  private at(distance: number): [number, number] {
    const [px, py] = this.pivot,
      a = rad(this.angle);
    return [px + Math.cos(a) * distance * M, py + Math.sin(a) * distance * M];
  }
  draw(g: Graphics): void {
    const [a1, a2] = this.spec.arms,
      [lx, ly] = this.at(-a1),
      [rx, ry] = this.at(a2),
      a = rad(this.angle);
    g.lineStyle(6, this.beam ? this.accent : INK, 0.85).lineBetween(lx, ly, rx, ry);
    g.fillStyle(INK, 1).fillCircle(...this.pivot, 4);
    let mark = 0;
    for (let i = -a1; i <= a2; i++) {
      if (!i) continue;
      const [x, y] = this.at(i);
      g.lineStyle(1, 0x0a0d10, 0.9).lineBetween(x, y - 3, x, y + 3);
      this.marks[mark++].setPosition(x + Math.sin(a) * 16, y - Math.cos(a) * 16);
    }
    if (this.spec.pans)
      for (const side of [-1, 1] as const) {
        const [x, y] = this.at(side * (side < 0 ? a1 : a2));
        g.lineStyle(1, INK, 0.6)
          .lineBetween(x, y, x - 80, y + 66)
          .lineBetween(x, y, x + 80, y + 66)
          .lineBetween(x - 92, y + 66, x + 92, y + 66);
      }
    for (const item of this.items) {
      const { load } = item,
        you = load.label === 'you';
      const [x, y] = this.at(load.side * load.arm);
      const size = 40,
        bx = this.spec.pans ? x + (item.slot - (this.slotsAt(load) - 1) / 2) * 44 : x,
        by = this.spec.pans ? y + 66 - size / 2 : y + 30 + size / 2 + item.slot * (size + 4);
      if (!this.spec.pans) g.lineStyle(1, INK, 0.6).lineBetween(x, y, x, by - size / 2);
      g.fillStyle(you ? this.accent : 0x1c2328, you ? 0.95 : 1).fillRect(bx - size / 2, by - size / 2, size, size);
      g.lineStyle(1.5, you ? this.accent : INK, 0.9).strokeRect(bx - size / 2, by - size / 2, size, size);
      const value =
        load.force !== undefined
          ? `${fmt(load.force)} N`
          : load.label === '𝑥' && !this.busy && this.state !== 'success'
            ? '𝑥'
            : `${fmt(load.mass ?? 0)} kg`;
      item.text.setText(value).setPosition(bx, by);
    }
  }
  private slotsAt(load: Load): number {
    return this.items.filter((i) => i.load.side === load.side && i.load.arm === load.arm).length;
  }
}

/** A drawbridge on a motorised hinge, turned clockwise by the rail's angle. */
class RotateDevice extends Device {
  private angle = 90;
  private hold = 0;
  constructor(
    host: DeviceHost,
    private spec: Spec<'rotate'>,
  ) {
    super(host);
  }
  build(): void {
    this.ground(LIP + this.spec.length * M, END);
    protractor(this.scene, this.statics, LIP, GY, 110, 0, 180);
  }
  run(value: number, success: boolean): void {
    super.run(value, success);
    this.hold = 0;
  }
  update(dt: number): void {
    if (this.state !== 'running') return;
    const target = 90 - this.value;
    this.angle = approach(this.angle, target, 70 * dt);
    if (this.angle !== target) return;
    this.hold += dt;
    if (this.success) {
      this.angle = 0;
      this.host.platform(LIP + (this.spec.length * M) / 2, GY + 6, this.spec.length * M, 12, true);
      this.win();
    } else if (this.hold > 1.2) {
      this.angle = 90;
      this.lose();
    }
  }
  draw(g: Graphics): void {
    g.lineStyle(8, this.state === 'success' ? this.accent : INK, 0.8).lineBetween(
      LIP,
      GY + 5,
      LIP + Math.cos(rad(this.angle)) * this.spec.length * M,
      GY + 5 - Math.sin(rad(this.angle)) * this.spec.length * M,
    );
    g.fillStyle(INK, 1).fillCircle(LIP, GY + 5, 5);
  }
}

/** Law of reflection. The beam is traced by the same function that judges the rail. */
class MirrorDevice extends Device {
  private current = 0;
  private lit = false;
  private bridge?: Platform;
  constructor(
    host: DeviceHost,
    private spec: Spec<'mirror'>,
  ) {
    super(host);
    this.current = spec.control === 'tilt' ? (spec.tilt ?? 0) : 0;
  }
  private get enemy(): boolean {
    return (
      this.host.boss && Math.hypot(this.spec.laser[0] - this.host.core.x, this.spec.laser[1] - this.host.core.y) < 120
    );
  }
  build(): void {
    const s = this.spec,
      g = this.statics;
    if (s.bridge && !this.host.boss) {
      if (s.bridge[0] > LIP) this.ground(LIP, s.bridge[0]);
      this.ground(s.bridge[1], END);
    }
    if (!this.enemy)
      g.lineStyle(1.5, INK, 0.7)
        .strokeRect(s.laser[0] - 22, s.laser[1] - 9, 22, 18)
        .lineBetween(s.laser[0], s.laser[1] + 9, s.laser[0], GY);
    if (s.control === 'tilt') protractor(this.scene, g, s.mirror[0], s.mirror[1], 62, 0, 180);
    else {
      protractor(this.scene, g, s.laser[0], s.laser[1], 70, -90, 0);
      ruler(this.scene, g, s.laser[0], GY, (GY - s.laser[1]) / M, { vertical: true });
      ruler(this.scene, g, s.laser[0], GY + 40, (s.mirror[0] - s.laser[0]) / M);
    }
    if (s.control === 'tilt' && !this.enemy && Math.abs(s.beam) > 0)
      protractor(this.scene, g, s.laser[0], s.laser[1], 48, 0, 90);
    if (!this.host.boss && Math.abs(s.sensor[0] - s.mirror[0]) > 30)
      g.lineStyle(1.5, INK, 0.5).lineBetween(s.sensor[0], s.sensor[1] + 18, s.sensor[0], GY + 60);
    if (s.floor === undefined && s.mirror[1] < GY - 20)
      g.lineStyle(1, INK, 0.45).lineBetween(s.mirror[0], s.mirror[1] + 6, s.mirror[0], GY + 60);
  }
  origin(): { x: number; y: number } {
    return { x: this.spec.mirror[0], y: this.spec.mirror[1] };
  }
  update(dt: number): void {
    if (this.state !== 'running') return;
    this.current = approach(this.current, this.value, 80 * dt);
    if (this.current !== this.value) return;
    this.lit = traceLight(this.spec, this.current, this.host.boss ? 40 : 18).hit;
    if (this.success) {
      if (this.spec.bridge && !this.host.boss)
        this.bridge = this.host.platform(
          (this.spec.bridge[0] + this.spec.bridge[1]) / 2,
          GY + 6,
          this.spec.bridge[1] - this.spec.bridge[0],
          12,
          true,
        );
      this.host.burst(this.spec.sensor[0], this.spec.sensor[1], this.accent, 30);
      this.win();
    } else this.lose();
  }
  reset(): void {
    super.reset();
    this.lit = false;
  }
  draw(g: Graphics): void {
    const s = this.spec,
      ray = traceLight(s, this.current, this.host.boss ? 40 : 18);
    const color = this.enemy ? HAZARD : this.accent;
    g.lineStyle(5, color, 0.15)
      .beginPath()
      .moveTo(...ray.points[0]);
    ray.points.slice(1).forEach((p) => g.lineTo(...p));
    g.strokePath();
    g.lineStyle(1.8, color, 0.95)
      .beginPath()
      .moveTo(...ray.points[0]);
    ray.points.slice(1).forEach((p) => g.lineTo(...p));
    g.strokePath();
    const tilt = s.control === 'tilt' ? this.current : (s.tilt ?? 0),
      dx = (Math.cos(rad(tilt)) * M) / 2,
      dy = (-Math.sin(rad(tilt)) * M) / 2;
    g.lineStyle(5, INK, 0.95).lineBetween(s.mirror[0] - dx, s.mirror[1] - dy, s.mirror[0] + dx, s.mirror[1] + dy);
    if (!this.host.boss) {
      g.lineStyle(2, this.lit || this.state === 'success' ? this.accent : INK, 0.9).strokeCircle(
        s.sensor[0],
        s.sensor[1],
        16,
      );
      if (this.lit || this.state === 'success') g.fillStyle(this.accent, 0.5).fillCircle(s.sensor[0], s.sensor[1], 12);
    }
    if (this.bridge)
      g.lineStyle(8, this.accent, 0.8).lineBetween(
        this.bridge.rect.x - this.bridge.width / 2,
        GY + 5,
        this.bridge.rect.x + this.bridge.width / 2,
        GY + 5,
      );
    if (s.control === 'aim') {
      const a = rad(-this.current);
      g.lineStyle(2, INK, 0.9).lineBetween(
        s.laser[0],
        s.laser[1],
        s.laser[0] + Math.cos(a) * 26,
        s.laser[1] - Math.sin(a) * 26,
      );
    }
  }
}

/** Pythagoras as areas: a telescoping plank from the hinge must lock into a socket. */
class SquaresDevice extends Device {
  private length = 0;
  private rise: number;
  private stage: 'lift' | 'grow' | 'jam' | 'tip' = 'grow';
  private tip = 0;
  private ledge!: Platform;
  constructor(
    host: DeviceHost,
    private spec: Spec<'squares'>,
  ) {
    super(host);
    this.rise = spec.rise ?? 1;
  }
  private get anchor(): [number, number] {
    return [LIP + this.spec.run * M, GY - this.rise * M];
  }
  private get distance(): number {
    return Math.hypot(this.spec.run, this.rise);
  }
  build(): void {
    const [ax, ay] = this.anchor;
    this.ledge = this.host.platform((ax + END) / 2, ay + 300, END - ax, 600);
    this.goal = { x: END - 145, y: ay };
    ruler(this.scene, this.statics, LIP, GY + 40, this.spec.run);
    ruler(this.scene, this.statics, ax + 12, GY, 6, { vertical: true });
    if (this.spec.plank) this.label(LIP + 150, GY - 150, `plank ${this.spec.plank} m`, 14, '#dfe4e5', false);
  }
  run(value: number, success: boolean): void {
    super.run(value, success);
    this.length = 0;
    this.tip = 0;
    this.stage = this.spec.plank ? 'lift' : 'grow';
  }
  update(dt: number): void {
    if (this.state !== 'running') return;
    this.t += dt;
    const side = Math.sqrt(this.value),
      plank = this.spec.plank ?? side;
    if (this.stage === 'lift') {
      this.rise = approach(this.rise, Math.min(side, 6), 1.5 * dt);
      const [ax, ay] = this.anchor;
      this.host.movePlatform(this.ledge, (ax + END) / 2, ay + 300);
      this.goal.y = ay;
      if (this.rise === Math.min(side, 6)) this.stage = 'grow';
      return;
    }
    if (this.stage === 'grow') {
      const target = Math.min(plank, this.distance);
      this.length = approach(this.length, target, 3 * dt);
      if (this.length !== target) return;
      this.t = 0;
      if (this.success) {
        const [ax, ay] = this.anchor;
        this.host.addRamp({ x1: LIP, y1: GY, x2: ax, y2: ay });
        this.host.burst(ax, ay, this.accent, 24);
        this.win();
      } else this.stage = plank > this.distance ? 'jam' : 'tip';
    } else if (this.stage === 'jam') {
      if (this.t > 0.6) this.length = approach(this.length, 0, 4 * dt);
      if (!this.length) this.lose();
    } else {
      this.tip = approach(this.tip, 1, 1.6 * dt);
      if (this.tip === 1) {
        this.length = 0;
        this.lose();
      }
    }
  }
  draw(g: Graphics): void {
    const [ax, ay] = this.anchor;
    g.lineStyle(1.2, INK, 0.5).strokeRect(ax - 2, ay - 1, 12, 10);
    if (this.length > 0) {
      const base = Math.atan2(GY - ay, ax - LIP),
        angle = base * (1 - this.tip) - 0.3 * this.tip;
      const shake = this.stage === 'jam' && this.t < 0.6 && this.busy ? Math.sin(this.t * 90) * 2 : 0;
      g.lineStyle(7, this.accent, 0.8 * (1 - this.tip * 0.8)).lineBetween(
        LIP + shake,
        GY,
        LIP + shake + Math.cos(angle) * this.length * M,
        GY - Math.sin(angle) * this.length * M,
      );
    }
    // Blueprint: squares drawn on the triangle's sides, one grid cell per square meter.
    const s = 18,
      bx = LIP + 130,
      by = 300,
      run = this.spec.run,
      rise = this.rise;
    const A: [number, number] = [bx, by],
      B: [number, number] = [bx + run * s, by],
      C: [number, number] = [bx + run * s, by - rise * s];
    g.lineStyle(1.5, INK, 0.7)
      .beginPath()
      .moveTo(...A)
      .lineTo(...B)
      .lineTo(...C)
      .closePath()
      .strokePath();
    this.square(g, A, B, run, INK, 0.4);
    this.square(g, B, C, this.spec.plank ? 0 : rise, INK, 0.4);
    const hyp = Math.hypot(run, rise);
    if (this.spec.plank) this.square(g, C, A, this.spec.plank, INK, 0.4, this.spec.plank / hyp);
    else this.square(g, C, A, 0, INK, 0.35);
    if (this.busy || this.state === 'success') {
      const side = Math.sqrt(this.value);
      if (this.spec.plank) this.square(g, B, C, 0, this.accent, 0.9, side / Math.max(rise, 1e-6));
      else this.square(g, C, A, 0, this.accent, 0.9, side / hyp);
    }
  }
  /** Draws the outward square on side p→q, scaled by `scale`, with `cells` grid lines per side. */
  private square(
    g: Graphics,
    p: [number, number],
    q: [number, number],
    cells: number,
    color: number,
    alpha: number,
    scale = 1,
  ): void {
    const dx = (q[0] - p[0]) * scale,
      dy = (q[1] - p[1]) * scale,
      nx = -dy,
      ny = dx;
    const r: [number, number] = [p[0] + dx, p[1] + dy],
      t: [number, number] = [p[0] + dx + nx, p[1] + dy + ny],
      u: [number, number] = [p[0] + nx, p[1] + ny];
    g.lineStyle(1.2, color, alpha)
      .beginPath()
      .moveTo(...p)
      .lineTo(...r)
      .lineTo(...t)
      .lineTo(...u)
      .closePath()
      .strokePath();
    for (let i = 1; i < cells; i++) {
      g.lineStyle(1, color, alpha * 0.5)
        .lineBetween(p[0] + (dx * i) / cells, p[1] + (dy * i) / cells, u[0] + (dx * i) / cells, u[1] + (dy * i) / cells)
        .lineBetween(
          p[0] + (nx * i) / cells,
          p[1] + (ny * i) / cells,
          r[0] + (nx * i) / cells,
          r[1] + (ny * i) / cells,
        );
    }
  }
}

/** Vibrating platforms: y = A·sin(2πft). Amplitude and frequency come straight from the rail. */
class WaveDevice extends Device {
  private near: Platform[] = [];
  private far: Platform[] = [];
  private clock!: Stopwatch;
  private counter!: Phaser.GameObjects.Text;
  private amplitude: number;
  private frequency: number;
  private offset = 0;
  constructor(
    host: DeviceHost,
    private spec: Spec<'wave'>,
  ) {
    super(host);
    this.amplitude = spec.mode === 'amplitude' ? 0.5 : 1;
    this.frequency = spec.mode === 'amplitude' ? spec.frequency : 0.5;
  }
  private get reference(): number {
    return this.spec.cycles! / this.spec.seconds!;
  }
  build(): void {
    const top = GY - this.spec.ledge * M,
      farX = LIP + 6 * M;
    this.ground(farX, END, top, 60);
    this.goal = { x: END - 145, y: top };
    ruler(this.scene, this.statics, farX + 12, GY, this.spec.ledge + 2, { vertical: true });
    this.statics.lineStyle(1, INK, 0.3);
    for (let x = LIP; x < farX; x += 16) this.statics.lineBetween(x, GY, x + 8, GY);
    if (this.spec.mode === 'amplitude') {
      spikes(this.statics, LIP, farX, GY - (this.spec.ledge + 1.3) * M, true);
      this.near = [0, 1, 2, 3].map((i) => this.host.platform(LIP + 60 + i * 120, GY + 6, 80, 12));
    } else {
      this.near = [0, 1].map((i) => this.host.platform(LIP + 60 + i * 120, GY + 6, 80, 12));
      this.far = [0, 1].map((i) => this.host.platform(LIP + 300 + i * 120, GY + 6, 80, 12));
      this.clock = new Stopwatch(this.scene, farX - 150, GY - 330);
      this.counter = this.label(farX - 40, GY - 330, '', 18, '#e2e6e6');
      this.label(farX - 40, GY - 292, 'vibrations', 12, LABEL, false);
    }
  }
  run(value: number, success: boolean): void {
    super.run(value, success);
    const t = this.host.time();
    if (this.spec.mode === 'amplitude') this.amplitude = value;
    else {
      this.offset = 2 * Math.PI * (this.reference - value) * t;
      this.frequency = value;
    }
    if (success) this.win();
    else this.lose();
  }
  update(): void {
    const t = this.host.time();
    for (const p of this.near)
      this.host.movePlatform(p, p.baseX, p.baseY - vibration(this.amplitude, this.frequency, t, this.offset) * M);
    for (const p of this.far) this.host.movePlatform(p, p.baseX, p.baseY - vibration(1, this.reference, t) * M);
    if (this.spec.mode === 'amplitude') {
      const player = this.host.player();
      if (player.x > LIP && player.x < LIP + 6 * M && player.top < GY - (this.spec.ledge + 1.3) * M + 10)
        this.host.hurt(player.x);
    }
  }
  draw(g: Graphics): void {
    for (const p of [...this.near, ...this.far]) {
      g.lineStyle(1, MUTED, 0.5).lineBetween(p.baseX, GY + 90, p.rect.x, p.rect.y);
      g.lineStyle(2, this.far.includes(p) ? INK : this.accent, 0.8).lineBetween(
        p.rect.x - 40,
        p.rect.y - 6,
        p.rect.x + 40,
        p.rect.y - 6,
      );
    }
    if (this.spec.mode === 'frequency') {
      // Count for `seconds`, then hold the result as long again. Whole cycles keep each window starting at rest.
      const shown = Math.min(this.host.time() % (2 * this.spec.seconds!), this.spec.seconds!);
      this.clock.draw(g, shown);
      this.counter.setText(String(Math.floor(shown * this.reference + 1e-6)));
    }
  }
}

/** An oscilloscope sound lock: amplitude is loudness, frequency is pitch. */
class ScopeDevice extends Device {
  private amplitude = 1;
  private frequency = 100;
  private shown = { amplitude: 1, frequency: 100 };
  private door?: Door;
  constructor(
    host: DeviceHost,
    private spec: Spec<'scope'>,
  ) {
    super(host);
    if (spec.mode === 'amplitude') this.frequency = this.shown.frequency = spec.frequency;
    else this.amplitude = this.shown.amplitude = spec.amplitude;
  }
  private get box(): [number, number, number, number] {
    return this.host.boss ? [260, 120, 400, 240] : [LIP + 40, 150, 400, 240];
  }
  build(): void {
    const [x, y, w, h] = this.box,
      g = this.statics;
    if (!this.host.boss) {
      this.ground(LIP, END);
      this.door = new Door(this.host, LIP + 560);
    }
    g.fillStyle(0x0b1013, 0.92).fillRect(x, y, w, h);
    g.lineStyle(1, INK, 0.12);
    for (let i = 1; i < 10; i++) g.lineBetween(x + (w * i) / 10, y, x + (w * i) / 10, y + h);
    for (let j = 1; j < 8; j++) g.lineBetween(x, y + (h * j) / 8, x + w, y + (h * j) / 8);
    g.lineStyle(1, INK, 0.35)
      .lineBetween(x, y + h / 2, x + w, y + h / 2)
      .strokeRect(x, y, w, h);
    this.label(x + w / 2, y + h + 20, '1 ms per column · 1 division per row', 12, LABEL, false);
  }
  origin(): { x: number; y: number } {
    const [x, y, w, h] = this.box;
    return { x: x + w / 2, y: y + h / 2 };
  }
  run(value: number, success: boolean): void {
    super.run(value, success);
    if (this.spec.mode === 'amplitude') this.amplitude = value;
    else this.frequency = value;
    this.host.tone(
      Phaser.Math.Clamp(this.frequency, 60, 2000),
      0.9,
      Phaser.Math.Clamp(this.amplitude * 0.05, 0.02, 0.3),
    );
  }
  reset(): void {
    super.reset();
  }
  update(dt: number): void {
    this.shown.amplitude = approach(this.shown.amplitude, this.amplitude, 6 * dt);
    this.shown.frequency = approach(this.shown.frequency, this.frequency, 900 * dt);
    if (this.state === 'success') this.door?.open(dt);
    if (this.state !== 'running' || this.shown.amplitude !== this.amplitude || this.shown.frequency !== this.frequency)
      return;
    if (this.success) this.win();
    else this.lose();
  }
  draw(g: Graphics): void {
    const [x, y, w, h] = this.box,
      div = h / 8;
    this.trace(g, x, y + h / 2, w, this.spec.amplitude * div, this.spec.frequency, INK, 0.55, true);
    this.trace(g, x, y + h / 2, w, this.shown.amplitude * div, this.shown.frequency, this.accent, 0.95, false);
    this.door?.draw(g);
  }
  /** Plots 10 ms of y = A·sin(2πft). */
  private trace(
    g: Graphics,
    x: number,
    mid: number,
    w: number,
    amplitude: number,
    frequency: number,
    color: number,
    alpha: number,
    dashed: boolean,
  ): void {
    const clipped = Math.min(amplitude, mid - this.box[1]);
    let previous: [number, number] | undefined;
    for (let px = 0; px <= w; px += 2) {
      const point: [number, number] = [x + px, mid - vibration(clipped, frequency, (px / w) * 0.01)];
      if (previous && (!dashed || Math.floor(px / 6) % 2 === 0))
        g.lineStyle(dashed ? 1.5 : 2, color, alpha).lineBetween(...previous, ...point);
      previous = point;
    }
  }
}

/** A travelling wave on a rope: its speed is fixed by the rope, the driver sets f, and λ = v/f. */
class RopeDevice extends Device {
  private stones: Platform[] = [];
  private clock!: Stopwatch;
  private pulse = 0;
  private started = 0;
  private frequency = 0;
  private driving = false;
  constructor(
    host: DeviceHost,
    private spec: Spec<'rope'>,
  ) {
    super(host);
  }
  private get speed(): number {
    return this.spec.distance / this.spec.seconds;
  }
  private readonly amplitude = 1.2;
  private get rest(): number {
    return GY + this.amplitude * M;
  }
  private get length(): number {
    return this.spec.spacing * 4 + 1;
  }
  build(): void {
    this.ground(LIP + this.length * M, END);
    for (let k = 0; k < 4; k++) {
      const x = LIP + (1 + k * this.spec.spacing) * M;
      this.stones.push(this.host.platform(x, this.rest + 6, 60, 12));
      this.statics.lineStyle(1, MUTED, 0.5).lineBetween(x, GY - 20, x, 760);
    }
    ruler(this.scene, this.statics, LIP, GY - 160, this.length - 1);
    this.clock = new Stopwatch(this.scene, LIP + this.length * M + 120, GY - 250);
  }
  /** Rope displacement above rest (m) at distance d along the rope. */
  private height(d: number, now: number): number {
    if (!this.driving) {
      const period = this.length / this.speed + 1.5,
        tau = this.pulse % period,
        front = this.speed * tau;
      return this.amplitude * Math.exp(-(((d - front) / 0.5) ** 2));
    }
    const elapsed = now - this.started;
    return d <= this.speed * elapsed ? vibration(this.amplitude, this.frequency, elapsed - d / this.speed) : 0;
  }
  run(value: number, success: boolean): void {
    super.run(value, success);
    this.frequency = value;
    this.started = this.host.time();
    this.driving = true;
    if (success) this.win();
    else this.lose();
  }
  update(dt: number): void {
    this.pulse += dt;
    const now = this.host.time();
    this.stones.forEach((p, k) =>
      this.host.movePlatform(p, p.baseX, this.rest + 6 - this.height(1 + k * this.spec.spacing, now) * M),
    );
  }
  draw(g: Graphics): void {
    const now = this.host.time();
    g.lineStyle(2, INK, 0.75).beginPath();
    for (let d = 0; d <= this.length; d += 0.1) {
      const x = LIP + d * M,
        y = this.rest - this.height(d, now) * M;
      if (!d) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();
    g.fillStyle(this.accent, 0.9).fillCircle(LIP, this.rest - this.height(0, now) * M, 6);
    const period = this.length / this.speed + 1.5;
    this.clock.draw(g, this.driving ? now - this.started : this.pulse % period);
    for (const p of this.stones)
      g.lineStyle(2, this.accent, 0.85).lineBetween(p.rect.x - 30, p.rect.y - 6, p.rect.x + 30, p.rect.y - 6);
  }
}

/** A straight-line shot y = kx + b on a coordinate grid. */
class LineDevice extends Device {
  private progress = 0;
  constructor(
    host: DeviceHost,
    private spec: Spec<'line'>,
  ) {
    super(host);
  }
  build(): void {
    const g = this.statics,
      { x: ox, y: oy, unit: u } = GRID;
    for (let x = -1; x <= 16; x++)
      g.lineStyle(1, INK, x ? 0.07 : 0.4).lineBetween(ox + x * u, oy + 2 * u, ox + x * u, oy - 8 * u);
    for (let y = -2; y <= 8; y++)
      g.lineStyle(1, INK, y ? 0.07 : 0.4).lineBetween(ox - u, oy - y * u, ox + 16 * u, oy - y * u);
    for (let x = 1; x <= 12; x++) this.label(ox + x * u, oy + 16, String(x), 12);
    for (let y = 1; y <= 7; y++) this.label(ox - 18, oy - y * u, String(y), 12);
    this.label(ox + 16 * u + 16, oy, '𝑥', 16);
    this.label(ox, oy - 8 * u - 16, '𝑦', 16);
  }
  private line(): [number, number] {
    return this.spec.control === 'k' ? [this.value, this.spec.b ?? 0] : [this.spec.k!, this.value];
  }
  origin(): { x: number; y: number } {
    const [x, y] = gridPoint(...this.spec.core);
    return { x, y: y + 40 };
  }
  run(value: number, success: boolean): void {
    super.run(value, success);
    this.progress = 0;
  }
  reset(): void {
    super.reset();
    this.progress = 0;
  }
  update(dt: number): void {
    if (this.state !== 'running') return;
    this.progress = approach(this.progress, 1, 1.2 * dt);
    if (this.success && this.progress * 12 >= this.spec.core[0]) this.win();
    else if (this.progress === 1) this.lose();
  }
  draw(g: Graphics): void {
    if (this.state === 'idle') return;
    const [k, b] = this.line(),
      end = Math.min(this.progress * 12, this.success ? this.spec.core[0] : 12);
    g.lineStyle(2, this.accent, 0.9).beginPath();
    for (let x = -1; x <= end; x += 0.05) {
      const [px, py] = gridPoint(x, k * x + b);
      if (x === -1) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.strokePath();
  }
}

/** A launch pad beside a tall wall: it throws you exactly as high as the rail says. Spikes hang over the pad above the ledge. */
class LaunchDevice extends Device {
  private armed = 0;
  private cooldown = 0;
  private readonly padX = LIP - 60;
  constructor(
    host: DeviceHost,
    private spec: Spec<'launch'>,
  ) {
    super(host);
  }
  private get top(): number {
    return GY - this.spec.height * M;
  }
  private get spikeY(): number {
    return GY - (this.spec.height + 1.6) * M;
  }
  build(): void {
    this.ground(LIP, END, this.top, GY - this.top + 20);
    this.goal = { x: END - 145, y: this.top };
    ruler(this.scene, this.statics, LIP + 10, GY, this.spec.height + 2, { vertical: true });
    spikes(this.statics, LIP - 120, LIP, this.spikeY, true);
    this.statics.lineStyle(1, INK, 0.45).lineBetween(LIP - 120, this.spikeY, LIP, this.spikeY);
  }
  run(value: number, success: boolean): void {
    super.run(value, success);
    this.armed = Math.min(value, this.spec.height + 3);
    if (success) this.win();
    else this.lose();
  }
  update(dt: number): void {
    this.cooldown -= dt;
    const player = this.host.player();
    if (
      this.armed > 0 &&
      this.cooldown <= 0 &&
      Math.abs(player.x - this.padX) < 34 &&
      Math.abs(player.bottom - GY) < 4
    ) {
      // Apex = armed meter (plus a body's clearance): v² = 2gh with the player's own gravity.
      this.host.launch(-Math.sqrt(2 * 1450 * (this.armed * M + 24)));
      this.host.burst(this.padX, GY, this.accent, 16);
      this.cooldown = 0.6;
    }
    if (player.top < this.spikeY + 12 && player.x > LIP - 120 && player.x < LIP) this.host.hurt(player.x + 40);
  }
  draw(g: Graphics): void {
    const lit = this.armed > 0;
    g.lineStyle(2, lit ? this.accent : INK, lit ? 0.9 : 0.5).strokeEllipse(this.padX, GY - 3, 70, 12);
    if (lit)
      g.lineBetween(this.padX, GY - 10, this.padX, GY - 56)
        .lineBetween(this.padX, GY - 56, this.padX - 10, GY - 44)
        .lineBetween(this.padX, GY - 56, this.padX + 10, GY - 44);
  }
}

/** Cell division: every division turns each cell into two, so n divisions make 2ⁿ cells. */
class DivisionDevice extends Device {
  private target = 0;
  private clockTime = 0;
  private end = 0;
  private stage: 'grow' | 'fall' | 'buckle' | 'fly' = 'grow';
  private drop = 0;
  private demo = 0;
  private clock?: Stopwatch;
  private popped = false;
  constructor(
    host: DeviceHost,
    private spec: Spec<'division'>,
  ) {
    super(host);
  }
  private get d(): number {
    return this.spec.size * M;
  }
  private get far(): number {
    return LIP + this.spec.cells * this.d;
  }
  /** Visual length of one division: the real period, or a brisk beat when there is no clock. */
  private get step(): number {
    return this.spec.period ?? 0.6;
  }
  private readonly dish = { x: LIP + 150, y: 280 };
  build(): void {
    if (this.host.boss) return;
    this.ground(this.far, END);
    for (let i = 0; i < this.spec.cells; i++)
      this.statics.lineStyle(1, INK, 0.3).strokeCircle(LIP + (i + 0.5) * this.d, GY + this.d / 2 - 2, this.d / 2 - 2);
    this.statics.lineStyle(1.2, INK, 0.5).lineBetween(this.far, GY, this.far, GY + 90);
    this.statics.lineStyle(1, INK, 0.4).strokeCircle(this.dish.x, this.dish.y, 62);
    if (this.spec.period) this.clock = new Stopwatch(this.scene, this.dish.x - 130, this.dish.y);
  }
  origin(): { x: number; y: number } {
    return { x: 650, y: 400 };
  }
  run(value: number, success: boolean): void {
    super.run(value, success);
    this.target = Math.min(divisionsFor(this.spec, value), 6);
    this.end = this.spec.period ? Math.min(value, 7 * this.spec.period) : this.target * this.step;
    this.clockTime = 0;
    this.stage = 'grow';
    this.drop = 0;
    this.popped = false;
  }
  reset(): void {
    super.reset();
    this.target = 0;
    this.clockTime = 0;
    this.popped = false;
  }
  /** Generation shown at time t and how far its split has progressed (0–1). */
  private generation(t: number, cap: number, step = this.step): [number, number] {
    const g = Math.min(cap, Math.floor(t / step + 1e-9));
    return [g, g ? Math.min(1, (t - g * step) / 0.35) : 1];
  }
  update(dt: number): void {
    this.demo += dt;
    if (this.state !== 'running') return;
    this.t += dt;
    if (this.stage === 'grow') {
      this.clockTime = Math.min(this.t, this.end);
      if (this.t < this.end + 0.6) return;
      const cells = cellsAfter(this.target);
      if (this.success) {
        this.stage = 'fly';
        this.t = 0;
        if (!this.host.boss) {
          this.host.platform((LIP + this.far) / 2, GY + 6, this.far - LIP, 12, true);
          this.host.burst(this.far, GY, this.accent, 24);
          this.win();
        }
      } else {
        this.stage = cells < this.spec.cells ? 'fall' : 'buckle';
        this.t = 0;
      }
    } else if (this.stage === 'fly') {
      if (this.host.boss && this.t > 0.6 && this.state === 'running') {
        this.popped = true;
        this.host.burst(this.host.core.x, this.host.core.y, this.accent, 40, 220);
        this.win();
      }
    } else if (this.stage === 'fall') {
      this.drop += dt * 900 * this.t;
      if (this.t > 1) this.fail();
    } else if (this.t > 0.9) {
      const [x, y] = this.host.boss ? [650, 400] : [(LIP + this.far) / 2, GY];
      this.host.burst(x, y, this.accent, 40, 200);
      this.fail();
    }
  }
  private fail(): void {
    this.target = 0;
    this.clockTime = 0;
    this.drop = 0;
    this.lose();
  }
  /** Position of cell j of 2^g in the gap: a packed row that stacks when it overflows. */
  private slot(j: number): [number, number] {
    const d = this.d,
      row = Math.floor(j / this.spec.cells),
      shake = this.stage === 'buckle' ? Math.sin(this.t * 50 + j) * 3 : 0;
    return [LIP + ((j % this.spec.cells) + 0.5) * d + shake, GY + d / 2 - 2 - row * (d - 4) + this.drop];
  }
  /** Binary split layout around (x, y): each generation splits along alternating axes. */
  private cluster(x: number, y: number, j: number, g: number, spread: number): [number, number] {
    let px = x,
      py = y;
    for (let k = 0; k < g; k++) {
      const side = (j >> (g - 1 - k)) & 1 ? 1 : -1,
        s = spread * 0.72 ** k;
      if (k % 2) py += side * s;
      else px += side * s;
    }
    return [px, py];
  }
  draw(g: Graphics): void {
    const running = this.state !== 'idle';
    const [gen, q] = running ? this.generation(this.stage === 'grow' ? this.t : this.end + 1, this.target) : [0, 1];
    if (this.host.boss) {
      this.drawBoss(g, gen, q);
      return;
    }
    // Culture dish: a demonstration while idle, the actual culture while it grows.
    const cycle = this.step * 4,
      tau = this.demo % cycle,
      [dg, dq] = running ? [Math.min(gen, 4), gen > 4 ? 1 : q] : this.generation(tau, 3);
    this.clock?.draw(g, running ? this.clockTime : tau);
    for (let j = 0; j < 2 ** dg; j++) {
      const [cx, cy] = this.cluster(this.dish.x, this.dish.y, j, dg, 26),
        [px, py] = this.cluster(this.dish.x, this.dish.y, j >> 1, dg - 1, 26);
      cell(g, px + (cx - px) * dq, py + (cy - py) * dq, 12 - dg * 1.5, INK, 0.8);
    }
    // The row in the gap.
    const r = this.d / 2 - 3;
    for (let j = 0; j < 2 ** gen; j++) {
      const [cx, cy] = this.slot(j),
        [px, py] = this.slot(j >> 1);
      cell(g, px + (cx - px) * q, py + (cy - py) * q, r, this.accent);
    }
  }
  private drawBoss(g: Graphics, gen: number, q: number): void {
    const { x: cx, y: cy } = this.host.core,
      ring = this.spec.cells;
    if (!this.popped)
      for (let i = 0; i < ring; i++) {
        const a = this.host.time() * 0.4 + (i / ring) * Math.PI * 2;
        cell(g, cx + 10 + Math.cos(a) * 178, cy + Math.sin(a) * 178, 11, HAZARD);
      }
    if (this.state === 'idle' || this.popped) {
      cell(g, 650, 400, 12, this.accent, 0.7);
      return;
    }
    const count = 2 ** gen,
      fly = this.stage === 'fly' ? Math.min(1, this.t / 0.6) : 0;
    for (let j = 0; j < count; j++) {
      const [x1, y1] = this.cluster(650, 400, j, gen, 70),
        [x0, y0] = this.cluster(650, 400, j >> 1, gen - 1, 70);
      let x = x0 + (x1 - x0) * q,
        y = y0 + (y1 - y0) * q;
      if (fly) {
        const a = this.host.time() * 0.4 + (j / ring) * Math.PI * 2;
        x += (cx + 10 + Math.cos(a) * 178 - x) * fly;
        y += (cy + Math.sin(a) * 178 - y) * fly;
      }
      cell(g, x, y, 10, this.accent);
    }
  }
}

/** A microscope whose eyepiece view is projected on the wall. `zoom` sets magnification; `center` moves the slide. */
class MicroscopeDevice extends Device {
  private door!: Door;
  private magnification = 10;
  private shift = 0;
  private hold = 0;
  private flash = 0;
  private readout?: Phaser.GameObjects.Text;
  private readonly view = { x: LIP + 380, y: 270, r: 130 };
  private readonly scope = LIP + 120;
  constructor(
    host: DeviceHost,
    private spec: Spec<'microscope'>,
  ) {
    super(host);
  }
  build(): void {
    this.ground(LIP, END);
    this.door = new Door(this.host, LIP + 720);
    const g = this.statics,
      x = this.scope,
      { x: vx, y: vy, r } = this.view;
    g.lineStyle(2, INK, 0.7).strokeRect(x - 50, GY - 12, 100, 12);
    g.lineStyle(3, INK, 0.7)
      .lineBetween(x + 30, GY - 12, x + 30, GY - 120)
      .lineBetween(x + 30, GY - 120, x + 8, GY - 175);
    g.lineStyle(2.5, INK, 0.8).lineBetween(x - 45, GY - 70, x + 32, GY - 70);
    g.lineStyle(7, INK, 0.75).lineBetween(x - 4, GY - 88, x + 12, GY - 185);
    g.lineStyle(4, INK, 0.75).lineBetween(x - 6, GY - 88, x - 6, GY - 76);
    g.lineStyle(9, INK, 0.75).lineBetween(x + 12, GY - 185, x + 16, GY - 210);
    this.label(x - 58, GY - 212, 'eyepiece', 12, LABEL, false);
    this.label(x - 64, GY - 90, 'objective', 12, LABEL, false);
    for (let i = 0; i < 12; i++) {
      const t = i / 12;
      g.lineStyle(1, INK, 0.18).lineBetween(
        x + 16 + (vx - r - x - 16) * t,
        GY - 210 + (vy - GY + 210) * t,
        x + 16 + (vx - r - x - 16) * (t + 0.04),
        GY - 210 + (vy - GY + 210) * (t + 0.04),
      );
    }
    if (this.spec.mode === 'zoom') {
      this.label(x - 110, GY - 70, `cell ${fmt(this.spec.specimen)} mm`, 12, LABEL, false);
      // An image scale in millimeters, starting at the left side of the lock.
      const left = vx - this.spec.gate * 10;
      for (let mm = -2; mm <= this.spec.gate + 2; mm++) {
        const px = left + mm * 20;
        g.lineStyle(1, INK, 0.45).lineBetween(px, vy + 78, px, vy + (mm >= 0 && mm <= this.spec.gate ? 90 : 84));
        if (mm >= 0 && mm <= this.spec.gate) this.label(px, vy + 102, String(mm), 12);
      }
      this.label(left + (this.spec.gate + 1) * 20, vy + 102, 'mm', 12);
      this.readout = this.label(vx, vy + r + 22, '', 14, '#e2e6e6');
    } else {
      g.lineStyle(1, INK, 0.25)
        .lineBetween(vx - r, vy, vx + r, vy)
        .lineBetween(vx, vy - r, vx, vy + r);
      this.label(x - 5, GY - 50, 'slide  + →', 12, LABEL, false);
    }
  }
  update(dt: number): void {
    this.flash = Math.max(0, this.flash - dt);
    if (this.state === 'success') {
      this.door.open(dt);
      return;
    }
    if (this.spec.mode === 'zoom') {
      if (this.state !== 'running') return;
      const target = Math.log(Phaser.Math.Clamp(this.value, 0.5, 1e4)),
        current = approach(Math.log(this.magnification), target, 2.2 * dt);
      this.magnification = Math.exp(current);
      if (current !== target) return;
    } else {
      if (this.state !== 'running') {
        this.shift = approach(this.shift, 0, 4 * dt);
        return;
      }
      const target = Phaser.Math.Clamp(this.value, -12, 12);
      this.shift = approach(this.shift, target, 3 * dt);
      if (this.shift !== target) return;
    }
    this.hold += dt;
    if (this.hold < 0.6) return;
    this.hold = 0;
    if (this.success) {
      this.host.burst(this.view.x, this.view.y, this.accent, 30);
      this.win();
    } else {
      this.flash = 1;
      this.lose();
    }
  }
  draw(g: Graphics): void {
    this.door.draw(g);
    const { x: vx, y: vy, r } = this.view,
      ok = this.state === 'success';
    g.fillStyle(0x0b1013, 0.95).fillCircle(vx, vy, r);
    g.lineStyle(1.5, INK, 0.5).strokeCircle(vx, vy, r);
    if (this.spec.mode === 'zoom') {
      const length = Math.min(2 * r - 12, this.spec.specimen * this.magnification * 20),
        height = Math.min(r, length * 0.42);
      g.fillStyle(this.accent, 0.16).fillEllipse(vx, vy, length, height);
      g.lineStyle(2, this.accent, 0.9).strokeEllipse(vx, vy, length, height);
      g.fillStyle(this.accent, 0.6).fillCircle(vx + length * 0.1, vy, Math.max(1.5, height * 0.18));
      const half = this.spec.gate * 10,
        color = ok ? this.accent : this.flash > 0 ? HAZARD : INK;
      for (const side of [-1, 1])
        g.lineStyle(2, color, 0.9)
          .lineBetween(vx + side * half, vy - 44, vx + side * half, vy + 44)
          .lineBetween(vx + side * half, vy - 44, vx + side * (half + 8), vy - 44)
          .lineBetween(vx + side * half, vy + 44, vx + side * (half + 8), vy + 44);
      this.readout?.setText(`${fmt(+this.magnification.toFixed(1))}×`);
      return;
    }
    // Centre mode: the slide's millimeter scale and the cell, both seen upside down.
    const image = imageOffset(this.spec.offset, this.shift),
      unit = 30;
    for (let k = -12; k <= 12; k++) {
      const px = vx + (image - k) * unit;
      if (Math.abs(px - vx) > r - 8) continue;
      g.lineStyle(1, INK, 0.4).lineBetween(px, vy + 70, px, vy + (k % 5 ? 80 : 92));
    }
    if (Math.abs(image) * unit < r - 20) {
      const cx = vx + image * unit;
      g.fillStyle(this.accent, 0.16).fillEllipse(cx, vy, 44, 26);
      g.lineStyle(2, this.accent, 0.9).strokeEllipse(cx, vy, 44, 26);
      g.fillStyle(this.accent, 0.6).fillCircle(cx - 4, vy + 2, 4);
    }
    g.lineStyle(1.5, ok ? this.accent : this.flash > 0 ? HAZARD : INK, 0.8).strokeCircle(vx, vy, 30);
    const sx = this.scope - 6 + this.shift * 5;
    g.lineStyle(3, this.accent, 0.8).lineBetween(sx - 34, GY - 74, sx + 34, GY - 74);
  }
}

/** Grass → rabbits → foxes. The foxes' energy powers a lift, one meter per kilojoule. */
class FoodChainDevice extends Device {
  private lift!: Platform;
  private height = 0;
  private sunlight: number;
  private revert = 0;
  private hold = 0;
  private tiers: Phaser.GameObjects.Text[] = [];
  private readonly shaft = LIP + 65;
  constructor(
    host: DeviceHost,
    private spec: Spec<'foodchain'>,
  ) {
    super(host);
    this.sunlight = spec.demo;
  }
  private get top(): number {
    return GY - this.spec.ledge * M;
  }
  private get spikeY(): number {
    return GY - (this.spec.ledge + 2.3) * M;
  }
  private get fox(): number {
    return chainEnergy(this.sunlight, this.spec.ratio, 2);
  }
  build(): void {
    const ledgeX = LIP + 130;
    this.ground(ledgeX, END, this.top, GY - this.top + 20);
    this.goal = { x: END - 145, y: this.top };
    ruler(this.scene, this.statics, ledgeX + 10, GY, this.spec.ledge + 2, { vertical: true });
    spikes(this.statics, LIP, ledgeX, this.spikeY, true);
    this.statics.lineStyle(1, INK, 0.45).lineBetween(LIP, this.spikeY, ledgeX, this.spikeY);
    this.height = this.liftTarget;
    this.lift = this.host.platform(this.shaft, GY + 6 - this.height * M, 110, 12);
    // The energy pyramid.
    const g = this.statics,
      cx = LIP + 560,
      names = ['grass', 'rabbits', 'foxes'];
    names.forEach((_, level) => {
      const w = 360 - level * 110,
        y = 190 - level * 58;
      g.lineStyle(1.2, INK, 0.5).strokeRect(cx - w / 2, y - 24, w, 48);
      this.tiers.push(this.label(cx, y, '', 14, '#e2e6e6', false));
    });
    g.lineStyle(1.5, INK, 0.6).strokeCircle(cx - 260, 90, 16);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      g.lineBetween(
        cx - 260 + Math.cos(a) * 22,
        90 + Math.sin(a) * 22,
        cx - 260 + Math.cos(a) * 30,
        90 + Math.sin(a) * 30,
      );
    }
    g.lineStyle(1, INK, 0.3).lineBetween(cx - 236, 106, cx - 150, 170);
    this.label(cx - 260, 134, 'sunlight', 12, LABEL, false);
    this.label(this.shaft, GY + 34, 'fox lift', 12, LABEL, false);
  }
  private get liftTarget(): number {
    return Phaser.Math.Clamp(this.fox, 0, this.spec.ledge + 2.1);
  }
  run(value: number, success: boolean): void {
    super.run(value, success);
    this.sunlight = value;
    this.hold = 0;
  }
  update(dt: number): void {
    const target = this.liftTarget;
    this.height = approach(this.height, target, 1.5 * dt);
    this.host.movePlatform(this.lift, this.shaft, GY + 6 - this.height * M);
    const player = this.host.player();
    if (player.top < this.spikeY + 12 && player.x > LIP && player.x < LIP + 130) this.host.hurt(player.x - 60);
    if (this.revert > 0) {
      this.revert -= dt;
      if (this.revert <= 0) this.sunlight = this.spec.demo;
    }
    if (this.state !== 'running' || this.height !== target) return;
    this.hold += dt;
    if (this.hold < 0.4) return;
    if (this.success) {
      this.host.burst(this.shaft, this.lift.rect.y, this.accent, 24);
      this.win();
    } else {
      this.revert = 2;
      this.lose();
    }
  }
  draw(g: Graphics): void {
    [0, 1, 2].forEach((level) =>
      this.tiers[level].setText(
        `${['grass', 'rabbits', 'foxes'][level]}  ${fmt(chainEnergy(this.sunlight, this.spec.ratio, level))} kJ`,
      ),
    );
    g.lineStyle(3, this.accent, 0.85).lineBetween(
      this.shaft - 55,
      this.lift.rect.y - 6,
      this.shaft + 55,
      this.lift.rect.y - 6,
    );
    g.lineStyle(1, MUTED, 0.6).lineBetween(this.shaft, this.lift.rect.y, this.shaft, GY + 20);
  }
}

/** A heart and a pacemaker. The valve opens when both beat in step. */
class PulseDevice extends Device {
  private door!: Door;
  private clock!: Stopwatch;
  private counter!: Phaser.GameObjects.Text;
  private pace = 0;
  private started = 0;
  private readonly heartAt = { x: LIP + 250, y: 290 };
  private readonly pacer = { x: LIP + 480, y: 290 };
  constructor(
    host: DeviceHost,
    private spec: Spec<'pulse'>,
  ) {
    super(host);
  }
  private get rate(): number {
    return this.spec.bpm / 60;
  }
  build(): void {
    this.ground(LIP, END);
    this.door = new Door(this.host, LIP + 700);
    this.clock = new Stopwatch(this.scene, LIP + 60, this.heartAt.y);
    this.counter = this.label(this.heartAt.x, this.heartAt.y + 92, '', 18, '#e2e6e6');
    this.label(this.heartAt.x, this.heartAt.y + 120, 'heartbeats', 12, LABEL, false);
    this.label(this.pacer.x, this.pacer.y + 92, 'pacemaker', 12, LABEL, false);
  }
  run(value: number, success: boolean): void {
    super.run(value, success);
    this.pace = value / 60;
    this.started = this.host.time();
  }
  update(dt: number): void {
    if (this.state === 'success') {
      this.door.open(dt);
      return;
    }
    if (this.state !== 'running') return;
    this.t += dt;
    if (this.t < 3) return;
    if (this.success) {
      this.host.burst(this.pacer.x, this.pacer.y, this.accent, 24);
      this.win();
    } else {
      this.pace = 0;
      this.lose();
    }
  }
  draw(g: Graphics): void {
    this.door.draw(g);
    const now = this.host.time(),
      window = this.spec.window;
    // Count for one window, then hold the count as long again.
    const shown = Math.min(now % (2 * window), window);
    this.clock.draw(g, shown);
    this.counter.setText(String(Math.floor(shown * this.rate + 1e-6)));
    const pulse = beat(now, this.rate);
    const shade = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(0x5a3434),
      Phaser.Display.Color.ValueToColor(0xe07a78),
      1,
      pulse,
    );
    heart(
      g,
      this.heartAt.x,
      this.heartAt.y,
      34 * (1 + pulse * 0.18),
      Phaser.Display.Color.GetColor(shade.r, shade.g, shade.b),
    );
    const inStep = this.state === 'success',
      paced = inStep ? pulse : beat(now - this.started, this.pace);
    g.lineStyle(2, this.accent, 0.8).strokeRect(this.pacer.x - 34, this.pacer.y - 34, 68, 68);
    g.fillStyle(this.accent, 0.12 + paced * 0.7).fillCircle(this.pacer.x, this.pacer.y, 14 + paced * 8);
  }
}

/** A convex lens on an optical bench. Rays follow the thin-lens law; the lock reads the image on the screen. */
class LensDevice extends Device {
  private door!: Door;
  private u: number;
  private screen: number;
  private hold = 0;
  private readonly axis = GY - 130;
  private readonly h = 0.5;
  constructor(
    host: DeviceHost,
    private spec: Spec<'lens'>,
  ) {
    super(host);
    this.u = spec.mode === 'same' ? 5 : 3;
    this.screen = spec.mode === 'same' ? 2 * spec.focal : spec.track!;
  }
  private get lens(): number {
    return LIP + (this.spec.mode === 'same' ? 5 : 4) * M;
  }
  build(): void {
    this.ground(LIP, END);
    this.door = new Door(this.host, END - 260);
    const g = this.statics,
      x = this.lens,
      f = this.spec.focal;
    g.lineStyle(1, INK, 0.25);
    for (let px = x - 7 * M; px < x + 11 * M; px += 16) g.lineBetween(px, this.axis, px + 8, this.axis);
    for (let d = -6; d <= 10; d++) {
      const px = x + d * M;
      g.lineStyle(1, INK, 0.5).lineBetween(px, GY + 30, px, GY + 42);
      this.label(px, GY + 56, String(Math.abs(d)), 12);
    }
    this.label(x + 10.5 * M, GY + 56, 'm', 12);
    g.lineStyle(2, INK, 0.85).strokeEllipse(x, this.axis, 18, 170);
    g.lineStyle(1.5, INK, 0.5).lineBetween(x, this.axis + 85, x, GY);
    // Sunlight from the right focuses one focal length to the left.
    for (const dy of [-60, -30, 30, 60]) {
      g.lineStyle(1, INK, 0.28)
        .lineBetween(x + 1.4 * M, this.axis + dy, x, this.axis + dy)
        .lineBetween(x, this.axis + dy, x - f * M, this.axis);
    }
    g.fillStyle(INK, 0.9).fillCircle(x - f * M, this.axis, 4);
    this.label(x + 1.4 * M + 36, this.axis - 60, 'sunlight', 12, LABEL, false);
    if (this.spec.mode === 'enlarge')
      g.lineStyle(1.5, INK, 0.4).lineBetween(x + M, this.axis + 125, x + this.spec.track! * M, this.axis + 125);
  }
  run(value: number, success: boolean): void {
    super.run(value, success);
    this.hold = 0;
  }
  private get image(): number | undefined {
    return this.u > this.spec.focal + 1e-9 ? imageDistance(this.u, this.spec.focal) : undefined;
  }
  update(dt: number): void {
    if (this.state === 'success') {
      this.door.open(dt);
      return;
    }
    if (this.state !== 'running') return;
    const target = Phaser.Math.Clamp(this.value, 0.2, 7.5);
    this.u = approach(this.u, target, 2 * dt);
    if (this.u !== target) return;
    if (this.spec.mode === 'enlarge') {
      const v = this.image,
        goal = v === undefined ? this.screen : Math.min(v, this.spec.track!);
      this.screen = approach(this.screen, goal, 4 * dt);
      if (this.screen !== goal) return;
    }
    this.hold += dt;
    if (this.hold < 0.6) return;
    if (this.success) {
      this.host.burst(this.lens + this.screen * M, this.axis, this.accent, 30);
      this.win();
    } else this.lose();
  }
  draw(g: Graphics): void {
    this.door.draw(g);
    const x = this.lens,
      f = this.spec.focal,
      a = this.axis,
      top = a - this.h * M;
    const ox = x - this.u * M,
      sx = x + this.screen * M;
    // Object: an upright arrow on a stand.
    g.lineStyle(1.5, INK, 0.45).lineBetween(ox, a, ox, GY);
    g.lineStyle(3, this.accent, 0.95)
      .lineBetween(ox, a, ox, top)
      .lineBetween(ox, top, ox - 7, top + 10)
      .lineBetween(ox, top, ox + 7, top + 10);
    // Screen.
    g.lineStyle(4, INK, 0.7).lineBetween(sx, a - 120, sx, a + 120);
    g.lineStyle(1.5, INK, 0.45).lineBetween(sx, a + 120, sx, GY);
    if (this.spec.mode === 'enlarge')
      g.lineStyle(2, INK, 0.8).lineBetween(sx - 10, a + this.h * M, sx + 10, a + this.h * M);
    // Two principal rays from the arrow's tip, drawn to the screen.
    const slope1 = (this.h * M) / (f * M),
      yParallel = top + slope1 * (sx - x);
    const yChief = a + (this.h * M * (sx - x)) / (x - ox);
    g.lineStyle(1.2, this.accent, 0.55)
      .lineBetween(ox, top, x, top)
      .lineBetween(x, top, sx, yParallel)
      .lineBetween(ox, top, sx, yChief);
    const v = this.image;
    if (v === undefined) return;
    const size = (this.h * M * v) / this.u,
      sharp = Math.abs(v - this.screen) < 0.02;
    if (sharp) {
      const tip = a + size;
      g.lineStyle(3, this.accent, 0.95)
        .lineBetween(sx - 6, a, sx - 6, tip)
        .lineBetween(sx - 6, tip, sx - 13, tip - 10)
        .lineBetween(sx - 6, tip, sx + 1, tip - 10);
    } else {
      const blur = (85 * Math.abs(this.screen - v)) / v,
        low = Math.min(a, yChief) - blur,
        high = Math.max(a, yChief) + blur;
      g.fillStyle(this.accent, 0.16).fillRect(
        sx - 10,
        Math.max(a - 120, low),
        8,
        Math.min(a + 120, high) - Math.max(a - 120, low),
      );
    }
  }
}

export function createDevice(host: DeviceHost, spec: DeviceSpec): Device {
  switch (spec.kind) {
    case 'measure':
      return new MeasureDevice(host, spec);
    case 'stairs':
      return new StairsDevice(host, spec);
    case 'cart':
      return new CartDevice(host, spec);
    case 'meet':
      return new MeetDevice(host, spec);
    case 'lever':
      return new LeverDevice(host, spec);
    case 'rotate':
      return new RotateDevice(host, spec);
    case 'mirror':
      return new MirrorDevice(host, spec);
    case 'squares':
      return new SquaresDevice(host, spec);
    case 'wave':
      return new WaveDevice(host, spec);
    case 'scope':
      return new ScopeDevice(host, spec);
    case 'rope':
      return new RopeDevice(host, spec);
    case 'line':
      return new LineDevice(host, spec);
    case 'launch':
      return new LaunchDevice(host, spec);
    case 'division':
      return new DivisionDevice(host, spec);
    case 'microscope':
      return new MicroscopeDevice(host, spec);
    case 'foodchain':
      return new FoodChainDevice(host, spec);
    case 'pulse':
      return new PulseDevice(host, spec);
    case 'lens':
      return new LensDevice(host, spec);
  }
}
