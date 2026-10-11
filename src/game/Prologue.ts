import Phaser from 'phaser';
import { INK, text } from './art';
import { CHARACTERS, type CharacterId } from './types';

export interface PrologueArgs {
  /** Called once the page has swallowed the kid, on full white. */
  done: (character: CharacterId) => void;
  cancel: () => void;
  reducedMotion: boolean;
}

const FALSEHOOD = 0xefb7a4;
const ROWS = ['1+1=', '2+3=', '4+2=', '3+5='];
/** The worksheet, lying on the desk: its four rows start here and step down and slightly right. */
const PAPER = { x: 508, y: 392, row: 33, slant: 7, advance: 28 };
/** Where the page pulls everything in. */
const SINK: [number, number] = [600, 445];
/** Pens lie side by side at the desk's front edge, tip toward the paper. */
const PEN = { x: 800, y: 505, gap: 50, length: 92, tilt: -1.15 };
/** Seated kid: the hip on the chair, the torso bent over the desk, both feet on the floor under it. */
const KID = {
  hip: [402, 443],
  foot: [486, 584],
  otherFoot: [524, 588],
  lean: 0.35,
  /** Where the hands rest on the desk until a pen is picked. */
  rest: [535, 450],
  other: [515, 458],
} as const;
/** Bone lengths, in pixels. */
const BODY = { head: 27, torso: 140, shoulder: 14, upperArm: 86, forearm: 82, thigh: 104, shin: 108 };

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Phaser.Math.Clamp(t, 0, 1);
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const lerp = Phaser.Math.Linear;
type Point = [number, number];
/** The middle joint of a two-bone limb from a to b; side picks which way it bends. Out of reach, the limb straightens. */
function joint([ax, ay]: Point, [bx, by]: Point, first: number, second: number, side: 1 | -1): Point {
  const d = Math.min(Math.hypot(bx - ax, by - ay) || 1, first + second),
    ux = (bx - ax) / d,
    uy = (by - ay) / d,
    along = (first * first - second * second + d * d) / (2 * d),
    h = Math.sqrt(Math.max(0, first * first - along * along)) * side;
  return [ax + ux * along - uy * h, ay + uy * along + ux * h];
}

/**
 * Night, a desk, a worksheet. The kid picks one of five pens (the five characters), writes one answer,
 * and the worksheet's equals signs grow jaws and pull the kid into the page.
 */
export class Prologue extends Phaser.Scene {
  private args!: PrologueArgs;
  private g!: Phaser.GameObjects.Graphics;
  private glyphs: { text: Phaser.GameObjects.Text; row: number; col: number; phi: number; t0: number }[] = [];
  private answer!: Phaser.GameObjects.Text;
  private name!: Phaser.GameObjects.Text;
  private trait!: Phaser.GameObjects.Text;
  private description!: Phaser.GameObjects.Text;
  private hover = -1;
  private picked = -1;
  /** Time since the pick; the scene before it only waits. */
  private t = 0;
  private clock = 0;
  private finished = false;
  /** The kid's head before the page pulls it in; the loose sums circle it. */
  private head: Point = [0, 0];

  constructor() {
    super('Prologue');
  }
  init(args: PrologueArgs): void {
    this.args = args;
    this.hover = this.picked = -1;
    this.t = this.clock = 0;
    this.finished = false;
    this.glyphs = [];
  }
  create(): void {
    this.cameras.main.setBackgroundColor('#06080d').setZoom(1).centerOn(640, 360).fadeIn(900, 6, 8, 13);
    this.g = this.add.graphics();
    ROWS.forEach((row, r) =>
      [...row].forEach((ch, col) => {
        const [x, y] = this.cell(r, col);
        this.glyphs.push({
          text: text(this, x, y, ch, 26, '#3b465c').setDepth(2),
          row: r,
          col,
          phi: Math.random() * Math.PI * 2,
          t0: 2.2 + Math.random() * 1.2,
        });
      }),
    );
    const [ax, ay] = this.cell(0, 4);
    this.answer = text(this, ax, ay, '2', 26, '#3b465c').setDepth(2).setAlpha(0);
    this.name = text(this, 640, 600, '', 26, '#ebece8', false).setDepth(5);
    this.trait = text(this, 640, 634, 'Choose your pen.', 15, '#a9b5bd', false).setDepth(5);
    this.description = text(this, 640, 660, '', 13, '#8c9ba6', false).setDepth(5);
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.picked < 0) this.setHover(this.penAt(p.x, p.y));
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.picked >= 0) return this.skip();
      const pen = this.penAt(p.x, p.y);
      if (pen >= 0) this.pick(pen);
    });
    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      if (this.picked >= 0) return this.skip();
      const n = Number(event.key);
      if (n >= 1 && n <= CHARACTERS.length) this.pick(n - 1);
      else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft')
        this.setHover(
          Phaser.Math.Wrap((this.hover < 0 ? 0 : this.hover) + (event.key === 'ArrowRight' ? 1 : -1), 0, 5),
        );
      else if ((event.key === 'Enter' || event.key === ' ') && this.hover >= 0) this.pick(this.hover);
      else if (event.key === 'Escape') queueMicrotask(this.args.cancel);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.removeAllListeners();
      this.input.keyboard?.removeAllListeners();
    });
  }

  /** Position of a character on the worksheet. */
  private cell(row: number, col: number): [number, number] {
    return [PAPER.x + col * PAPER.advance + row * PAPER.slant, PAPER.y + row * PAPER.row];
  }
  private penEnds(i: number, lift = 0): [number, number, number, number] {
    const x = PEN.x + i * PEN.gap,
      y = PEN.y - lift,
      dx = Math.cos(PEN.tilt) * PEN.length,
      dy = Math.sin(PEN.tilt) * PEN.length * 0.42;
    return [x - dx / 2, y - dy / 2, x + dx / 2, y + dy / 2];
  }
  private penAt(px: number, py: number): number {
    let best = -1,
      distance = 22;
    CHARACTERS.forEach((_, i) => {
      const [x1, y1, x2, y2] = this.penEnds(i);
      const d = Phaser.Geom.Line.GetNearestPoint(new Phaser.Geom.Line(x1, y1, x2, y2), new Phaser.Geom.Point(px, py));
      const along = Phaser.Math.Distance.Between(px, py, d.x, d.y);
      if (along < distance) {
        distance = along;
        best = i;
      }
    });
    return best;
  }
  private setHover(i: number): void {
    if (i === this.hover) return;
    this.hover = i;
    const c = CHARACTERS[i];
    this.name.setText(c ? c.name : '').setColor(c?.hex ?? '#ebece8');
    this.trait.setText(c ? c.trait : 'Choose your pen.');
    this.description.setText(c ? c.description : '');
  }
  private pick(i: number): void {
    this.setHover(i);
    this.picked = i;
    this.t = 0;
  }
  /** Any key or click after the pick skips to the page. */
  private skip(): void {
    if (this.t > 0.4 && !this.finished) this.t = Math.max(this.t, 5.2);
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.05);
    this.clock += dt;
    if (this.picked >= 0) this.t += dt;
    const t = this.t,
      picked = this.picked >= 0,
      color = picked ? CHARACTERS[this.picked].color : INK;
    const rush = picked ? ease(span(t, 4, 5.4)) : 0;
    const camera = this.cameras.main;
    if (!this.args.reducedMotion) {
      camera.setZoom(1 + rush * rush * 5);
      camera.centerOn(lerp(640, SINK[0], rush), lerp(360, SINK[1], rush));
      if (picked && t > 2.4 && t < 4.6) camera.setScroll(camera.scrollX + (Math.random() - 0.5) * 3, camera.scrollY);
    }
    if (picked && t > 5 && !this.finished) {
      this.finished = true;
      camera.fade(500, 250, 251, 255);
      // Hand over after this frame: stopping a scene mid-update would leave it running without cameras.
      camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
        queueMicrotask(() => this.args.done(CHARACTERS[this.picked].id)),
      );
    }
    const caption = picked ? 1 - span(t, 0.6, 1.5) : 1;
    [this.name, this.trait, this.description].forEach((label) => label.setAlpha(caption));
    const g = this.g.clear();
    const kid = this.skeleton(t, picked),
      width = 5 * (1 - 0.85 * kid.pull) + 0.5;
    this.room(g);
    this.chair(g);
    // The legs go under the desk, so the desk is drawn over them.
    g.lineStyle(width, color, 1 - kid.pull * 0.6);
    for (const leg of [
      [kid.hip, kid.knee, kid.foot],
      [kid.hip, kid.otherKnee, kid.otherFoot],
    ])
      g.strokePoints(leg.map(([x, y]) => new Phaser.Geom.Point(x, y)));
    this.desk(g);
    this.page(g, t, picked);
    g.lineStyle(width, color, 1 - kid.pull * 0.6).strokeCircle(...kid.head, BODY.head * (1 - 0.85 * kid.pull));
    for (const limb of [
      [kid.neck, kid.hip],
      [kid.shoulder, kid.otherElbow, kid.other],
      [kid.shoulder, kid.elbow, kid.hand],
    ])
      g.strokePoints(limb.map(([x, y]) => new Phaser.Geom.Point(x, y)));
    this.pens(g, t);
    this.jaws(g, t, picked);
  }

  private room(g: Phaser.GameObjects.Graphics): void {
    // Window and moon.
    g.fillStyle(0x0d1630, 1).fillRect(110, 90, 210, 170);
    g.lineStyle(2, 0x3c4f80, 0.8)
      .strokeRect(110, 90, 210, 170)
      .lineBetween(215, 90, 215, 260)
      .lineBetween(110, 175, 320, 175);
    g.fillStyle(0xe8eefc, 1).fillCircle(272, 128, 17);
    g.fillStyle(0x0d1630, 1).fillCircle(280, 122, 14);
    // A graduation cap waits on the shelf for the day after the last homework.
    g.lineStyle(2, 0x3c4f80, 0.8).lineBetween(350, 214, 450, 214);
    g.fillStyle(0x1a2440, 1).fillRect(384, 196, 32, 18);
    g.fillStyle(0x24305a, 1).fillPoints(
      [
        new Phaser.Geom.Point(400, 186),
        new Phaser.Geom.Point(440, 194),
        new Phaser.Geom.Point(400, 202),
        new Phaser.Geom.Point(360, 194),
      ],
      true,
    );
    g.lineStyle(2, 0xffd97a, 0.85).lineBetween(400, 194, 428, 200).lineBetween(428, 200, 428, 224);
    g.lineStyle(1, 0x2a3558, 0.9).lineBetween(0, 560, 1280, 560);
    // Lamp light pools on the desk.
    for (let i = 6; i > 0; i--) g.fillStyle(0xffd678, 0.022).fillCircle(900, 390, 70 + i * 55);
    g.lineStyle(3, 0x6b7bb0, 0.9).lineBetween(1060, 430, 1090, 300).lineBetween(1090, 300, 1010, 250);
    g.lineStyle(3, 0xffd97a, 0.95).strokePoints(
      [
        new Phaser.Geom.Point(970, 268),
        new Phaser.Geom.Point(1018, 236),
        new Phaser.Geom.Point(1040, 262),
        new Phaser.Geom.Point(990, 296),
      ],
      true,
    );
  }
  private desk(g: Phaser.GameObjects.Graphics): void {
    g.fillStyle(0x0b1020, 1).fillPoints(
      [
        new Phaser.Geom.Point(480, 430),
        new Phaser.Geom.Point(1140, 430),
        new Phaser.Geom.Point(1110, 540),
        new Phaser.Geom.Point(440, 540),
      ],
      true,
    );
    g.lineStyle(2, 0x6b7bb0, 0.9).lineBetween(440, 540, 1110, 540).lineBetween(480, 430, 1140, 430);
    g.lineBetween(440, 540, 480, 430).lineBetween(1110, 540, 1140, 430);
    g.lineBetween(460, 540, 460, 640).lineBetween(1090, 540, 1090, 640);
  }
  private chair(g: Phaser.GameObjects.Graphics): void {
    g.lineStyle(2, 0x6b7bb0, 0.8)
      .lineBetween(345, 452, 455, 452)
      .lineBetween(355, 452, 355, 560)
      .lineBetween(445, 452, 445, 560)
      .lineBetween(345, 452, 327, 320);
  }
  /** The worksheet: a pale sheet with four rows of sums. */
  private page(g: Phaser.GameObjects.Graphics, t: number, picked: boolean): void {
    const shake = picked && t > 2.4 && t < 5 ? (Math.random() - 0.5) * 2 : 0;
    g.fillStyle(0xe4e9f2, 1).fillPoints(
      [
        new Phaser.Geom.Point(475 + shake, 368),
        new Phaser.Geom.Point(665 + shake, 368),
        new Phaser.Geom.Point(695 + shake, 522),
        new Phaser.Geom.Point(495 + shake, 522),
      ],
      true,
    );
    g.lineStyle(1, 0x506eaa, 0.3);
    for (let r = 0; r < ROWS.length; r++) {
      const [, y] = this.cell(r, 0);
      g.lineBetween(482 + r * PAPER.slant, y + 14, 662 + r * PAPER.slant, y + 14);
    }
    const write = picked ? span(t, 0.9, 1.7) : 0;
    this.answer.setAlpha(write).setColor(picked ? CHARACTERS[this.picked].hex : '#3b465c');
    if (picked && t > 4) this.answer.setAlpha(1 - span(t, 4, 4.6));
  }
  /**
   * The seated kid, bent over the worksheet. After the pick, they lean in and the hand takes the pen to the first
   * row; at the end every joint is pulled into the page.
   */
  private skeleton(t: number, picked: boolean) {
    const pull = picked ? ease(span(t, 4.1, 5.2)) : 0,
      lean = KID.lean + (picked ? Math.min(1, t) * 0.25 : 0) + Math.sin(this.clock * 2) * 0.008;
    const hip = KID.hip as Point,
      along = (length: number, angle = lean): Point => [
        hip[0] + Math.sin(angle) * length,
        hip[1] - Math.cos(angle) * length,
      ];
    const neck = along(BODY.torso),
      shoulder = along(BODY.torso - BODY.shoulder),
      head: Point = [
        neck[0] + Math.sin(lean + 0.3) * (BODY.head + 5),
        neck[1] - Math.cos(lean + 0.3) * (BODY.head + 5),
      ],
      hand = this.hand(t, picked),
      other = KID.other as Point;
    const joints = {
      hip,
      neck,
      shoulder,
      head,
      hand,
      other,
      foot: KID.foot as Point,
      otherFoot: KID.otherFoot as Point,
      // Knees bend up and forward; elbows drop back toward the body.
      knee: joint(hip, KID.foot as Point, BODY.thigh, BODY.shin, -1),
      otherKnee: joint(hip, KID.otherFoot as Point, BODY.thigh, BODY.shin, -1),
      elbow: joint(shoulder, hand, BODY.upperArm, BODY.forearm, 1),
      otherElbow: joint(shoulder, other, BODY.upperArm, BODY.forearm, 1),
    };
    this.head = head;
    const sink = ([x, y]: Point): Point => [lerp(x, SINK[0], pull * pull), lerp(y, SINK[1], pull * pull)];
    return { pull, ...(Object.fromEntries(Object.entries(joints).map(([k, v]) => [k, sink(v)])) as typeof joints) };
  }
  private hand(t: number, picked: boolean): Point {
    const rest = KID.rest;
    if (!picked) return [rest[0], rest[1] + Math.sin(this.clock * 1.3) * 2];
    const [ax, ay] = this.cell(0, 4);
    if (t < 0.9) return [lerp(rest[0], ax - 4, ease(t / 0.9)), lerp(rest[1], ay + 12, ease(t / 0.9))];
    const w = span(t, 0.9, 1.7);
    return [ax - 6 + Math.sin(w * 9) * 6, ay + 12 + w * 4 - Math.abs(Math.cos(w * 7)) * 6];
  }
  private pens(g: Phaser.GameObjects.Graphics, t: number): void {
    CHARACTERS.forEach((c, i) => {
      const chosen = i === this.picked;
      if (chosen && t > 0.45) {
        // In the kid's hand: drawn from the fingers toward the page.
        const [hx, hy] = this.hand(t, true),
          pull = ease(span(t, 4.1, 5.2));
        const x = lerp(hx, SINK[0], pull * pull),
          y = lerp(hy, SINK[1], pull * pull);
        g.lineStyle(7 * (1 - 0.8 * pull), c.color, 1).lineBetween(x - 4, y - 14, x + 26, y - 52);
        return;
      }
      const lift = i === this.hover && this.picked < 0 ? 6 + Math.sin(this.clock * 4) * 2 : 0;
      const [x1, y1, x2, y2] = this.penEnds(i, lift);
      if (chosen) {
        const k = ease(clamp01(t / 0.45)),
          [hx, hy] = this.hand(t, true);
        g.lineStyle(7, c.color, 1).lineBetween(
          lerp(x1, hx, k),
          lerp(y1, hy, k),
          lerp(x2, hx + 30, k),
          lerp(y2, hy - 38, k),
        );
        return;
      }
      g.lineStyle(7, c.color, this.picked >= 0 ? 0.55 : 1).lineBetween(x1, y1, x2, y2);
      g.lineStyle(7, 0x0b1020, 0.8).lineBetween(x1, y1, lerp(x1, x2, 0.08), lerp(y1, y2, 0.08));
      if (i === this.hover && this.picked < 0)
        g.lineStyle(1, c.color, 0.35).strokeCircle((x1 + x2) / 2, (y1 + y2) / 2, 40);
    });
  }
  /** The sums come loose: digits peel off and circle the kid, and each equals sign grows jaws. */
  private jaws(g: Phaser.GameObjects.Graphics, t: number, picked: boolean): void {
    const head = this.head,
      pull = picked ? ease(span(t, 4.1, 5.2)) : 0;
    for (const glyph of this.glyphs) {
      const [x0, y0] = this.cell(glyph.row, glyph.col);
      const wobble = picked && t > 2 ? Math.sin(this.clock * 30 + glyph.col) * 0.08 : 0;
      if (glyph.text.text === '=') {
        const t0 = 2.6 + glyph.row * 0.25,
          k = picked ? ease(span(t, t0, t0 + 0.9)) : 0;
        glyph.text.setAlpha(k > 0 ? 0 : 1);
        if (!k) continue;
        // The equals sign leaves the page and snaps at the kid.
        let x = lerp(x0, head[0] + 70 + Math.cos(glyph.row * 1.7 + this.clock) * 34, k),
          y = lerp(y0, head[1] + 10 + Math.sin(glyph.row * 2.3 + this.clock * 1.3) * 30, k);
        x = lerp(x, SINK[0], pull);
        y = lerp(y, SINK[1], pull);
        const size = lerp(10, 22, k) * (1 - 0.7 * pull),
          bite = Math.abs(Math.sin(this.clock * 13 + glyph.row)) * 0.5;
        g.lineStyle(3 * (1 - 0.6 * pull), FALSEHOOD, 1 - pull);
        g.lineBetween(x - size, y - size * 0.35, x + size * Math.cos(bite), y - size * 0.35 - size * Math.sin(bite));
        g.lineBetween(x - size, y + size * 0.35, x + size * Math.cos(bite), y + size * 0.35 + size * Math.sin(bite));
        continue;
      }
      const k = picked ? ease(clamp01((t - glyph.t0) / 1.2)) : 0;
      const orbit = [
        head[0] + Math.cos(this.clock * 2 + glyph.phi) * 80,
        head[1] + 30 + Math.sin(this.clock * 2.6 + glyph.phi) * 50,
      ];
      let x = lerp(x0, orbit[0], k),
        y = lerp(y0, orbit[1], k) - Math.sin(k * Math.PI) * 40;
      x = lerp(x, SINK[0], pull);
      y = lerp(y, SINK[1], pull);
      glyph.text
        .setPosition(x, y)
        .setRotation(k ? this.clock * 2 + glyph.phi : wobble)
        .setColor(k ? '#ebece8' : '#3b465c')
        .setAlpha(1 - pull)
        .setScale(1 - 0.5 * pull);
    }
  }
}
