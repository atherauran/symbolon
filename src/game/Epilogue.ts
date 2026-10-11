import Phaser from 'phaser';
import { INK, StickFigure, text } from './art';
import type { AudioEngine } from './audio';
import { CHARACTERS, type CharacterId } from './types';

export interface EpilogueArgs {
  character: CharacterId;
  audio: AudioEngine;
  /** Called once the scene has faded out. */
  done: () => void;
}

const SCALE = 3.2;
/** The stage floor, and the figure's body centre standing on it. */
const FLOOR = 600;
const STAND = FLOOR - 31 * SCALE;
const WALK = { from: 230, to: 600, end: 2.4 };
/** The diploma falls from above into raised hands; the cap goes up when it lands. */
const CATCH = 3.6;
const TOSS = 4.5;
const END = 8.2;
const GRAVITY = 1500;
/** Mortarboard size: the head's radius. */
const CAP = 9 * SCALE;
const SYMBOLS = ['1', '+', '−', '×', '÷', '=', '√', '²', '𝑥', '°', '∿', '2', '0', 'π', '%', '<'];

const ease = (t: number) => t * t * (3 - 2 * t);
const span = (t: number, a: number, b: number) => Phaser.Math.Clamp((t - a) / (b - a), 0, 1);
const lerp = Phaser.Math.Linear;

interface Flying {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
}

/**
 * After 𝑥 = 1 the page lets the kid go: they walk onto a graduation stage in the cap from the prologue's shelf,
 * the worksheet comes down as a diploma, and the cap goes up with every symbol from the journey.
 */
export class Epilogue extends Phaser.Scene {
  private args!: EpilogueArgs;
  private g!: Phaser.GameObjects.Graphics;
  private figure!: StickFigure;
  private confetti: (Flying & { text: Phaser.GameObjects.Text })[] = [];
  private cap?: Flying & { angle: number; landed: boolean };
  private t = 0;
  private x = WALK.from;
  private finished = false;

  constructor() {
    super('Epilogue');
  }
  init(args: EpilogueArgs): void {
    this.args = args;
    this.t = 0;
    this.x = WALK.from;
    this.finished = false;
    this.cap = undefined;
    this.confetti = [];
    this.figure = new StickFigure();
  }
  create(): void {
    const camera = this.cameras.main.setBackgroundColor('#090b0d');
    camera.fadeIn(1400, 250, 251, 255);
    this.g = this.add.graphics();
    const color = this.character.hex;
    this.confetti = Array.from({ length: 34 }, (_, i) => ({
      text: text(this, 0, 0, SYMBOLS[i % SYMBOLS.length], 22 + (i % 3) * 6, i % 2 ? color : '#ebece8')
        .setDepth(3)
        .setAlpha(0),
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      spin: 0,
    }));
    this.input.on('pointerdown', () => this.skip());
    this.input.keyboard!.on('keydown', () => this.skip());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.removeAllListeners();
      this.input.keyboard?.removeAllListeners();
    });
  }
  private get character() {
    return CHARACTERS.find((c) => c.id === this.args.character) ?? CHARACTERS[0];
  }
  private skip(): void {
    if (this.t > 0.5) this.t = Math.max(this.t, END);
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.05),
      before = this.t;
    this.t += dt;
    const t = this.t,
      color = this.character.color;
    const x = lerp(WALK.from, WALK.to, Math.min(1, t / WALK.end) * (2 - Math.min(1, t / WALK.end)));
    const speed = (x - this.x) / dt;
    this.x = x;
    if (before < CATCH && t >= CATCH) this.args.audio.play('solve');
    if (before < TOSS && t >= TOSS) this.toss();
    if (t >= END && !this.finished) {
      this.finished = true;
      const camera = this.cameras.main;
      camera.fade(900, 9, 11, 13);
      camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => queueMicrotask(this.args.done));
    }

    const g = this.g.clear();
    this.stage(g, t);
    this.figure.update(dt, { speed: speed / SCALE, vy: 0, grounded: true, facing: 1, attack: 0 });
    // Hands come up to meet the diploma as it falls.
    const raise = ease(span(t, WALK.end - 0.1, WALK.end + 0.5));
    this.figure.draw(
      g,
      x,
      STAND,
      color,
      { held: t > WALK.end - 0.1, aim: lerp(Math.PI / 2 - 0.4, -0.35, raise), hurt: false },
      SCALE,
    );
    this.diploma(g, t, color);
    this.drawCap(g, dt, color);
    this.audience(g, t);
    for (const c of this.confetti) {
      if (!c.text.alpha) continue;
      c.vy += GRAVITY * 0.35 * dt;
      c.vx *= 1 - dt * 0.8;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.text.setPosition(c.x, c.y).setRotation(c.text.rotation + c.spin * dt);
      if (c.y > 760) c.text.setAlpha(0);
    }
  }

  private toss(): void {
    const { x, y } = this.figure.head;
    this.cap = { x, y: y - CAP - 8, vx: 140, vy: -1050, spin: 9, angle: 0, landed: false };
    this.args.audio.play('unlock');
    for (const c of this.confetti) {
      const theta = -Math.PI / 2 + (Math.random() - 0.5) * 2.2,
        speed = 420 + Math.random() * 560;
      Object.assign(c, {
        x: x + (Math.random() - 0.5) * 60,
        y: y - 30,
        vx: Math.cos(theta) * speed,
        vy: Math.sin(theta) * speed,
        spin: (Math.random() - 0.5) * 8,
      });
      c.text.setAlpha(1);
    }
  }

  /** Curtains, a spotlight on the boards, and a lectern. */
  private stage(g: Phaser.GameObjects.Graphics, t: number): void {
    const light = 0.6 + 0.4 * ease(span(t, 0.4, 1.6));
    g.fillStyle(0xffd678, 0.035 * light).fillPoints(
      [
        new Phaser.Geom.Point(560, 0),
        new Phaser.Geom.Point(720, 0),
        new Phaser.Geom.Point(860, FLOOR),
        new Phaser.Geom.Point(420, FLOOR),
      ],
      true,
    );
    for (let i = 4; i > 0; i--) g.fillStyle(0xffd678, 0.03 * light).fillEllipse(640, FLOOR, 160 + i * 70, 26 + i * 9);
    for (const side of [-1, 1]) {
      const edge = side < 0 ? 170 : 1110,
        outer = side < 0 ? 0 : 1280;
      g.fillStyle(0x161d36, 1).fillRect(Math.min(edge, outer), 0, Math.abs(edge - outer), FLOOR);
      g.lineStyle(2, 0x24305a, 1);
      for (let k = 1; k < 5; k++) {
        const fx = lerp(outer, edge, k / 5);
        g.lineBetween(fx, 40, fx + side * 6, FLOOR);
      }
    }
    g.fillStyle(0x161d36, 1).fillRect(0, 0, 1280, 44);
    g.lineStyle(2, 0x24305a, 1).lineBetween(0, 44, 1280, 44);
    // Boards and the stage's front edge.
    g.fillStyle(0x0b1020, 1).fillRect(0, FLOOR, 1280, 44);
    g.lineStyle(2, 0x6b7bb0, 0.9)
      .lineBetween(0, FLOOR, 1280, FLOOR)
      .lineBetween(0, FLOOR + 44, 1280, FLOOR + 44);
    // Lectern.
    g.fillStyle(0x0b1020, 1).fillPoints(
      [
        new Phaser.Geom.Point(900, 470),
        new Phaser.Geom.Point(1000, 470),
        new Phaser.Geom.Point(985, FLOOR),
        new Phaser.Geom.Point(915, FLOOR),
      ],
      true,
    );
    g.lineStyle(2, 0x6b7bb0, 0.9)
      .lineBetween(890, 462, 1010, 462)
      .lineBetween(900, 470, 915, FLOOR)
      .lineBetween(1000, 470, 985, FLOOR);
  }

  /** The worksheet from the first night floats down, rolls up, and is tied with the pen's colour. */
  private diploma(g: Phaser.GameObjects.Graphics, t: number, color: number): void {
    if (t < WALK.end) return;
    const k = ease(span(t, WALK.end, CATCH)),
      roll = ease(span(t, CATCH - 0.6, CATCH)),
      { x: hx, y: hy } = this.figure.reach;
    const x = lerp(WALK.to + 40, hx + 50, k) + Math.sin(t * 3) * 40 * (1 - k),
      y = lerp(-80, hy, k),
      w = lerp(96, 120, roll),
      h = lerp(120, 18, roll);
    g.fillStyle(0xe4e9f2, 1).fillRoundedRect(x - w / 2, y - h / 2, w, h, Math.min(9, h / 2));
    if (roll < 1) {
      g.lineStyle(1, 0x506eaa, 0.3 * (1 - roll));
      for (let r = 1; r < 4; r++)
        g.lineBetween(x - w / 2 + 10, y - h / 2 + (h * r) / 4, x + w / 2 - 10, y - h / 2 + (h * r) / 4);
    }
    if (roll > 0) {
      g.fillStyle(color, roll).fillRect(x - 6, y - h / 2 - 1, 12, h + 2);
      g.lineStyle(3, color, roll)
        .lineBetween(x, y + h / 2, x - 10, y + h / 2 + 18 * roll)
        .lineBetween(x, y + h / 2, x + 9, y + h / 2 + 16 * roll);
    }
  }

  /** The mortarboard sits on the head until the toss, then flies, spins and lands on the boards. */
  private drawCap(g: Phaser.GameObjects.Graphics, dt: number, color: number): void {
    const cap = this.cap;
    if (cap && !cap.landed) {
      cap.vy += GRAVITY * dt;
      cap.x += cap.vx * dt;
      cap.y += cap.vy * dt;
      cap.angle += cap.spin * dt;
      if (cap.vy > 0 && cap.y >= FLOOR - CAP * 0.55)
        Object.assign(cap, { y: FLOOR - CAP * 0.55, angle: 0.1, landed: true });
    }
    const { x, y, angle } = cap ?? { x: this.figure.head.x, y: this.figure.head.y - CAP - 8, angle: 0 };
    const at = (dx: number, dy: number) =>
      new Phaser.Geom.Point(
        x + dx * Math.cos(angle) - dy * Math.sin(angle),
        y + dx * Math.sin(angle) + dy * Math.cos(angle),
      );
    const r = CAP,
      board = [at(-r * 1.5, 0), at(0, -r * 0.32), at(r * 1.5, 0), at(0, r * 0.32)];
    g.fillStyle(0x1a2440, 1).fillPoints(
      [at(-r * 0.7, 0), at(r * 0.7, 0), at(r * 0.65, r * 0.55), at(-r * 0.65, r * 0.55)],
      true,
    );
    g.fillStyle(0x24305a, 1).fillPoints(board, true);
    g.lineStyle(2, INK, 0.5).strokePoints(board, true);
    g.lineStyle(3, color, 1).strokePoints([at(0, 0), at(r * 1.3, r * 0.1), at(r * 1.3, r * 0.85)]);
    g.fillStyle(color, 1).fillCircle(at(r * 1.3, r * 0.9).x, at(r * 1.3, r * 0.9).y, 4);
  }

  /** The front row: heads that jump when the cap goes up. */
  private audience(g: Phaser.GameObjects.Graphics, t: number): void {
    const cheer = span(t, TOSS, TOSS + 0.2) * (1 - span(t, TOSS + 1.6, TOSS + 2.6));
    for (let i = 0; i < 17; i++) {
      const x = 40 + i * 76 + (i % 2) * 14,
        y = 704 - Math.abs(Math.sin(t * 9 + i * 1.3)) * 16 * cheer;
      g.fillStyle(0x0d1224, 1)
        .fillCircle(x, y, 24)
        .fillEllipse(x, y + 52, 92, 66);
      g.lineStyle(2, 0x2a3558, 1).strokeCircle(x, y, 24);
    }
  }
}
