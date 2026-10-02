import Phaser from 'phaser';
import { evaluate, isOperator, type EvaluationResult } from '../math/evaluate';
import { Formula, text } from './art';
import type { RailSpec, SlotType } from './types';

/** Slot and rack outlines: brighter than the background grid so empty slots stay readable. */
export const SLOT = 0xa3adb3;

export class Token {
  body: Phaser.Physics.Arcade.Body;
  collider: Phaser.GameObjects.Rectangle;
  visual: Formula;
  state: 'loose' | 'held' | 'thrown' = 'loose';
  age = 0;
  hit = new Set<object>();
  /** Authored and stolen tokens return here instead of disappearing. */
  home?: [number, number];
  constructor(
    public scene: Phaser.Scene,
    public source: string,
    x: number,
    y: number,
  ) {
    this.collider = scene.add.rectangle(x, y, 32, 34, 0xffffff, 0);
    scene.physics.add.existing(this.collider);
    this.body = this.collider.body as Phaser.Physics.Arcade.Body;
    this.body.setBounce(0.42, 0.25).setDragX(80).setGravityY(700).setMaxVelocity(1100, 1100);
    this.visual = new Formula(scene, x, y, source, 36).setDepth(12);
  }
  get x(): number {
    return this.collider.x;
  }
  get y(): number {
    return this.collider.y;
  }
  hold(): void {
    this.state = 'held';
    this.body.enable = false;
    this.age = 0;
  }
  release(x: number, y: number, vx = 0, vy = 0): void {
    this.state = vx || vy ? 'thrown' : 'loose';
    this.age = 0;
    this.hit.clear();
    this.body.enable = true;
    this.body.reset(x, y);
    this.body.setVelocity(vx, vy);
  }
  update(dt: number, x?: number, y?: number): void {
    this.age += dt;
    if (this.state === 'held') this.visual.setPosition(x!, y!).setRotation(0);
    else {
      this.visual.setPosition(this.body.center.x, this.body.center.y);
      if (this.state === 'thrown') this.visual.rotation += this.body.velocity.x * dt * 0.002;
      else this.visual.rotation *= 0.85;
    }
  }
  destroy(): void {
    this.visual.destroy();
    this.collider.destroy();
  }
}

export function compatible(source: string, type: SlotType): boolean {
  return type === 'operator' ? isOperator(source) : !isOperator(source) && evaluate(source).valid;
}

export class Rack {
  container: Phaser.GameObjects.Container;
  value!: Formula;
  index = 0;
  label: Phaser.GameObjects.Text;
  /** A limited rack hands out each of its choices once. */
  constructor(
    public scene: Phaser.Scene,
    public x: number,
    public y: number,
    public choices: string[],
    name: string,
    public limited = false,
  ) {
    const graphic = scene.add.graphics();
    graphic
      .lineStyle(1.5, SLOT, 0.9)
      .lineBetween(-35, 26, 35, 26)
      .lineBetween(-35, 26, -35, 19)
      .lineBetween(35, 26, 35, 19);
    this.container = scene.add.container(x, y, [graphic]);
    this.label = text(scene, 0, 45, name.toUpperCase(), 9, '#bdc6cc', false).setLetterSpacing(1.4);
    this.container.add(this.label);
    this.refresh();
  }
  get source(): string {
    return this.choices[this.index];
  }
  cycle(direction: number): void {
    this.index = Phaser.Math.Wrap(this.index + direction, 0, this.choices.length);
    this.refresh();
  }
  take(): string {
    const source = this.source;
    if (this.limited) {
      this.choices.splice(this.index, 1);
      this.index = 0;
      this.refresh();
    }
    return source;
  }
  refresh(): void {
    this.value?.destroy();
    this.container.setVisible(this.choices.length > 0);
    if (!this.choices.length) return;
    this.value = new Formula(this.scene, 0, 0, this.source, 29);
    this.container.add(this.value);
  }
}

export class Rail {
  container: Phaser.GameObjects.Container;
  graphic: Phaser.GameObjects.Graphics;
  values: (string | null)[];
  slotPositions: number[];
  slotTexts: Formula[] = [];
  equals: Phaser.GameObjects.Text;
  status: Phaser.GameObjects.Text;
  preview: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  result: EvaluationResult = evaluate('');
  cooldown = 0;
  selected = -1;
  solved = false;
  failureSlot = -1;
  width: number;
  constructor(
    public scene: Phaser.Scene,
    public x: number,
    public y: number,
    public spec: RailSpec,
    public accent: number,
  ) {
    this.values = spec.slots.map(() => null);
    const spacing = spec.slots.length === 1 ? 120 : 66;
    this.width = spec.slots.length * spacing;
    this.slotPositions = spec.slots.map((_, i) => (i - (spec.slots.length - 1) / 2) * spacing);
    this.graphic = scene.add.graphics();
    this.equals = text(scene, this.width / 2 + 40, 0, '=', 44);
    this.status = text(scene, 0, 42, '', 11, '#b6c0c6', false)
      .setOrigin(0.5, 0)
      .setWordWrapWidth(Math.max(440, this.width + 180))
      .setAlign('center');
    this.preview = text(scene, this.width / 2 + 100, 0, '', 29);
    this.label = text(scene, 0, -104, spec.label.toUpperCase(), 10, '#c3ccd1', false).setLetterSpacing(1.7);
    this.container = scene.add
      .container(x, y, [this.graphic, this.equals, this.status, this.preview, this.label])
      .setDepth(5);
    this.refresh();
  }
  source(): string {
    return this.values.map((t) => t ?? '').join('');
  }
  /** The result with the rail's unit, e.g. "3/2 m/s". */
  display(): string {
    return `${this.result.display}${this.spec.units ? ` ${this.spec.units}` : ''}`.replace(' °', '°');
  }
  refresh(): void {
    this.slotTexts.forEach((t) => t.destroy());
    this.slotTexts = [];
    this.values.forEach((source, i) => {
      if (source !== null) {
        const item = new Formula(this.scene, this.slotPositions[i], 0, source, 30);
        this.container.add(item);
        this.slotTexts.push(item);
      }
    });
    this.result = this.values.some((v) => v === null)
      ? { valid: false, display: '…', error: 'Every slot needs a symbol.' }
      : evaluate(this.source());
    this.failureSlot = this.result.valid ? -1 : this.values.findIndex((v) => v === null);
    if (!this.result.valid && this.failureSlot < 0) {
      const division = this.values.indexOf('/');
      this.failureSlot = this.result.error?.includes('zero') && division >= 0 ? division + 1 : this.values.length - 1;
    }
    this.equals.setColor(this.result.valid ? '#ebece8' : '#4a5258');
    this.status
      .setText(this.result.valid ? 'F  ·  evaluate' : (this.result.error ?? ''))
      .setColor(this.result.valid ? '#d3d9dc' : '#b6c0c6');
    this.preview.setText('');
  }
  slotAt(worldX: number, worldY: number): number {
    if (Math.abs(worldY - this.y) > 75) return -1;
    return this.slotPositions.findIndex(
      (x) => Math.abs(this.x + x - worldX) < (this.spec.slots.length === 1 ? 65 : 30),
    );
  }
  insert(source: string, slot: number): string | null | undefined {
    if (slot < 0 || !compatible(source, this.spec.slots[slot])) return undefined;
    const old = this.values[slot];
    this.values[slot] = source;
    this.solved = false;
    this.refresh();
    return old;
  }
  remove(slot: number): string | null {
    const source = this.values[slot];
    this.values[slot] = null;
    this.solved = false;
    this.refresh();
    return source;
  }
  draw(time: number, nearby: boolean, held: string | null, showPreview: boolean): void {
    const g = this.graphic.clear();
    g.fillStyle(0x0a0d10, 0.9).fillRoundedRect(-this.width / 2 - 28, -34, this.width + 198, 73, 8);
    this.slotPositions.forEach((x, i) => {
      const acceptable = held !== null && compatible(held, this.spec.slots[i]);
      const chosen = nearby && this.selected === i;
      const failed = i === this.failureSlot && this.values.every((v) => v !== null);
      const color = failed ? 0xe07a78 : chosen ? (held && !acceptable ? 0xe07a78 : this.accent) : SLOT;
      g.lineStyle(chosen ? 2.5 : 2, color, 1);
      if (this.spec.slots[i] === 'operator') g.strokeCircle(x, 2, 20);
      else {
        const w = this.spec.slots.length === 1 ? 102 : 48;
        g.lineBetween(x - w / 2, 28, x + w / 2, 28)
          .lineBetween(x - w / 2, 28, x - w / 2, 18)
          .lineBetween(x + w / 2, 28, x + w / 2, 18);
      }
      if (!this.values[i]) g.fillStyle(chosen ? color : SLOT, 0.85 + Math.sin(time * 2) * 0.1).fillCircle(x, 2, 3);
    });
    if (this.result.valid) {
      g.lineStyle(1, this.accent, 0.3 + Math.sin(time * 3) * 0.15).strokeCircle(this.width / 2 + 40, 2, 27);
      if (showPreview) this.preview.setText(this.display()).setAlpha(0.6);
    }
    if (this.solved) {
      g.lineStyle(1, this.accent, 0.7).lineBetween(-this.width / 2, 36, this.width / 2 + 145, 36);
    }
  }
}
