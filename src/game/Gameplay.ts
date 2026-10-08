import Phaser from 'phaser';
import { CAMPAIGN, CHAPTERS, unlockedThrough } from '../content/campaign';
import { isOperator, notation, OPERATORS } from '../math/evaluate';
import { judge } from '../physics/model';
import { AudioEngine } from './audio';
import { Dust, Formula, INK, MUTED, StickFigure, text } from './art';
import { createDevice, HAZARD, type Device, type DeviceHost, type Platform, type Ramp } from './devices';
import { compatible, Rack, Rail, Token } from './objects';
import {
  CHARACTERS,
  type Beat,
  type BossPhase,
  type Character,
  type CheckpointState,
  type Encounter,
  type GameEvent,
  type Settings,
} from './types';

export interface RuntimeArgs {
  save: CheckpointState;
  settings: Settings;
  audio: AudioEngine;
  emit: (event: GameEvent) => void;
  chapterCard?: boolean;
}
interface Enemy {
  rect: Phaser.GameObjects.Rectangle;
  body: Phaser.Physics.Arcade.Body;
  glyph: Formula;
  hp: number;
  time: number;
  stun: number;
  kind: 'cluster' | 'operator';
  token: string;
}
interface Bolt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  glyph: Formula;
  age: number;
  kind: string;
  friendly: boolean;
  wave: number;
}
interface Warning {
  x: number;
  y: number;
  tx: number;
  ty: number;
  timer: number;
  total: number;
  kind: string;
  glyph: Phaser.GameObjects.Text;
}
interface Pulse {
  start: Phaser.Math.Vector2;
  end: Phaser.Math.Vector2;
  via: Phaser.Math.Vector2;
  age: number;
  duration: number;
  glyph: Formula;
  trail: Phaser.Math.Vector2[];
  boss: boolean;
}

export class Gameplay extends Phaser.Scene {
  args!: RuntimeArgs;
  save!: CheckpointState;
  character!: Character;
  encounter!: Encounter;
  beat!: Beat;
  phase?: BossPhase;
  player!: Phaser.GameObjects.Rectangle;
  playerBody!: Phaser.Physics.Arcade.Body;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  platforms: Platform[] = [];
  tokens: Token[] = [];
  racks: Rack[] = [];
  enemies: Enemy[] = [];
  bolts: Bolt[] = [];
  warnings: Warning[] = [];
  pulses: Pulse[] = [];
  ramps: Ramp[] = [];
  rail!: Rail;
  device?: Device;
  held: Token | null = null;
  background!: Phaser.GameObjects.Graphics;
  geometry!: Phaser.GameObjects.Graphics;
  figures!: Phaser.GameObjects.Graphics;
  figure!: StickFigure;
  overlay!: Phaser.GameObjects.Graphics;
  dust!: Dust;
  hint!: Phaser.GameObjects.Text;
  bossFormula?: Formula;
  bossLabel?: Phaser.GameObjects.Text;
  cameo?: Formula;
  portal!: Phaser.GameObjects.Container;
  core = { x: 940, y: 240 };
  clock = 0;
  worldClock = 0;
  hp = 4;
  focus = 4;
  invulnerable = 0;
  attack = 0;
  handling = 0;
  coyote = 0;
  jumpBuffer = 0;
  vy = 0;
  vx = 0;
  facing = 1;
  solved = false;
  dying = false;
  transition = false;
  attackTimer = 4;
  hudTimer = 0;
  editTimer = 0;
  hitCount = 0;
  bossStun = 0;
  worldWidth = 2300;
  goalX = 2160;
  effectMagnitude = 0;
  counterLock = 0;
  meleeQueue = false;
  standing?: Platform;
  private introSafe = 0;
  private pauseDebounce = 0;
  private builtPlatforms: Platform[] = [];
  private deviceHandled = false;
  private onRamp = false;
  private theftWarned = false;
  private reinforceTimer = 0;
  private launchVy = 0;
  private spawned = 0;

  constructor() {
    super('Gameplay');
  }
  init(args: RuntimeArgs): void {
    this.args = args;
    this.save = { ...args.save, unlocked: [...args.save.unlocked] };
  }
  create(): void {
    this.character = CHARACTERS.find((c) => c.id === this.save.character)!;
    this.encounter = CAMPAIGN[this.save.encounter];
    this.phase = this.encounter.phases?.[this.save.beat];
    this.beat = this.phase ?? this.encounter.beats[this.save.beat];
    this.platforms = [];
    this.tokens = [];
    this.racks = [];
    this.enemies = [];
    this.bolts = [];
    this.warnings = [];
    this.pulses = [];
    this.ramps = [];
    this.held = null;
    this.standing = undefined;
    this.bossFormula = undefined;
    this.bossLabel = undefined;
    this.cameo = undefined;
    this.device = undefined;
    this.builtPlatforms = [];
    this.deviceHandled = this.onRamp = this.theftWarned = false;
    this.clock =
      this.worldClock =
      this.attack =
      this.invulnerable =
      this.handling =
      this.coyote =
      this.jumpBuffer =
      this.vy =
      this.vx =
      this.hitCount =
      this.hudTimer =
      this.editTimer =
      this.effectMagnitude =
      this.counterLock =
      this.bossStun =
      this.spawned =
      this.launchVy =
        0;
    this.facing = 1;
    this.hp = 4;
    this.focus = this.character.focus;
    this.pauseDebounce = 0.25;
    this.reinforceTimer = 8;
    this.solved = this.dying = this.transition = this.meleeQueue = false;
    this.core = this.phase?.core ? { x: this.phase.core[0], y: this.phase.core[1] } : { x: 940, y: 240 };
    this.attackTimer = this.phase ? 4.5 : 6;
    this.introSafe = this.beat.unlock?.length ? 9 : 3;
    this.worldWidth = this.phase ? 1280 : 2300;
    this.goalX = this.worldWidth - 145;
    this.save.unlocked = unlockedThrough(this.save.encounter, this.save.beat);
    this.physics.world.setBounds(0, -400, this.worldWidth, 1600);
    this.cameras.main.setBounds(0, -70, this.worldWidth, 820).setBackgroundColor('#090b0d');
    this.background = this.add.graphics().setDepth(-10);
    this.geometry = this.add.graphics().setDepth(1);
    this.figures = this.add.graphics().setDepth(15);
    this.figure = new StickFigure();
    this.overlay = this.add.graphics().setDepth(20);
    this.dust = new Dust(this.add.graphics().setDepth(30));
    this.drawBackdrop();
    this.buildArena();
    this.player = this.add.rectangle(100, 563, 24, 62, 0xffffff, 0).setDepth(10);
    this.physics.add.existing(this.player);
    this.playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    this.playerBody.setMaxVelocity(1800, 3200);
    for (const platform of this.platforms) this.collidePlayer(platform);
    if (!this.phase) this.cameras.main.startFollow(this.player, false, 0.09, 0.09, -190, 50);
    this.keys = this.input.keyboard!.addKeys('A,D,LEFT,RIGHT,SPACE,E,F,R,ESC,Q') as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    this.input.keyboard!.addCapture(['SPACE', 'UP', 'DOWN', 'LEFT', 'RIGHT']);
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) this.meleeQueue = true;
    });
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) =>
      this.cycleRack(dy > 0 ? 1 : -1),
    );
    this.hint = text(this, 640, 663, '', 12, '#c4ccd0', false).setScrollFactor(0).setDepth(60);
    if (this.phase) this.buildBoss();
    else
      for (let i = 0; i < (this.beat.enemies ?? 0); i++)
        this.spawnEnemy(this.beat.layout === 'device' ? 330 + i * 190 : 790 + i * 330, 570);
    if (!this.phase && this.beat.hazard && this.encounter.chapter >= 2)
      this.cameo = new Formula(this, 1030, 230, '𝑥', 56, '#aab1b5').setDepth(4);
    if (!this.args.settings.reducedMotion) {
      this.cameras.main.setZoom(this.phase ? 0.94 : 1.04);
      this.tweens.add({ targets: this.cameras.main, zoom: 1, duration: 1900, ease: 'Sine.easeInOut' });
    }
    if (this.args.chapterCard) {
      const chapter = CHAPTERS[this.encounter.chapter - 1];
      this.args.emit({
        type: 'chapter',
        chapter: this.encounter.chapter,
        title: chapter.title,
        knowledge: chapter.knowledge,
      });
    } else this.args.emit({ type: 'toast', text: this.beat.name, sub: this.beat.intro ?? this.beat.objective });
    this.commitSave();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.removeAllListeners();
    });
    this.updateHud();
  }

  private buildArena(): void {
    if (this.phase) {
      this.platform(640, 628, 1280, 20);
      this.platform(180, 433, 150, 10);
      this.platform(1080, 447, 170, 10);
    } else {
      this.platform(475, 628, 950, 20);
      if (this.beat.layout === 'gap') this.platform(1920, 628, 760, 20);
    }
    this.rail = new Rail(this, this.phase ? 650 : 655, 536, this.beat.rail, this.character.color);
    this.makeRacks();
    if (this.beat.device) {
      this.device = createDevice(this.deviceHost(), this.beat.device);
      this.device.build();
    }
    if (this.save.encounter === 0 && this.save.beat === 0) {
      this.racks.forEach((r) => r.container.setVisible(false));
      const one = this.spawnToken('1', 330, 475);
      one.body.setGravityY(0);
      one.body.setVelocityY(-8);
      one.home = [330, 470];
      this.tweens.add({
        targets: one.collider,
        y: 460,
        duration: 1700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    for (const [source, x, y] of this.beat.loose ?? []) this.spawnToken(source, x, y).home = [x, y];
    const exitY = this.device ? this.device.goal.y : 628;
    if (this.device) this.goalX = this.device.goal.x;
    const g = this.add.graphics().lineStyle(1, MUTED, 0.8).strokeRect(-23, -70, 46, 70);
    const arrow = text(this, 0, -35, '→', 26, '#8c9ba6');
    const label = text(this, 0, 22, 'CONTINUE', 9, '#a9b5bd', false).setLetterSpacing(2);
    this.portal = this.add.container(this.goalX, exitY - 10, [g, arrow, label]).setAlpha(this.phase ? 0 : 0.5);
  }

  private deviceHost(): DeviceHost {
    return {
      scene: this,
      accent: this.character.color,
      boss: Boolean(this.phase),
      core: this.core,
      platform: (x, y, width, height, hidden) => {
        const p = this.platform(x, y, width, height);
        p.hidden = hidden;
        return p;
      },
      removePlatform: (p) => this.removePlatform(p),
      launch: (vy) => {
        this.launchVy = vy;
      },
      movePlatform: (p, x, y) => this.movePlatform(p, x, y),
      addRamp: (ramp) => this.ramps.push(ramp),
      player: () => ({ x: this.playerBody.center.x, top: this.playerBody.top, bottom: this.playerBody.bottom }),
      hurt: (x) => this.damage(x),
      burst: (x, y, color = INK, count, force) => this.dust.burst(x, y, color, count, force),
      sound: (name) => this.args.audio.play(name),
      tone: (frequency, duration, gain = 0.2) => this.args.audio.tone(frequency, duration, 'sine', gain),
      time: () => this.worldClock,
    };
  }

  private makeRacks(): void {
    const { stock } = this.beat,
      loose = (this.beat.loose ?? []).map(([source]) => source);
    const unlocked = stock ?? this.save.unlocked.filter((t) => !loose.includes(t));
    const groups: [string, string[]][] = [
      ['numbers', unlocked.filter((t) => !isOperator(t)).sort((a, b) => Number(a) - Number(b))],
      [
        'operators',
        this.beat.noOperatorRack
          ? []
          : stock
            ? stock.filter(isOperator)
            : OPERATORS.filter((o) => unlocked.includes(o)),
      ],
    ];
    groups
      .filter(([, values]) => values.length)
      .forEach(([name, choices], i) =>
        this.racks.push(new Rack(this, 175 + i * 105, 557, choices, name, Boolean(stock))),
      );
  }

  private platform(x: number, y: number, width: number, height: number): Platform {
    const rect = this.add.rectangle(x, y, width, height, 0x161b1e, 0.96);
    this.physics.add.existing(rect, true);
    const platform: Platform = {
      rect,
      body: rect.body as Phaser.Physics.Arcade.StaticBody,
      width,
      height,
      baseX: x,
      baseY: y,
      phase: 0,
      amplitude: 60,
    };
    this.platforms.push(platform);
    if (this.player?.active) this.collidePlayer(platform);
    for (const token of this.tokens) this.physics.add.collider(token.collider, rect);
    return platform;
  }
  private removePlatform(platform: Platform): void {
    platform.rect.destroy();
    this.platforms = this.platforms.filter((p) => p !== platform);
    if (this.standing === platform) this.standing = undefined;
  }
  /** Moves a kinematic platform and carries whoever stands on it. */
  private movePlatform(p: Platform, x: number, y: number): void {
    const dx = x - p.rect.x,
      dy = y - p.rect.y;
    if (!dx && !dy) return;
    p.rect.setPosition(x, y);
    p.body.updateFromGameObject();
    if (
      this.standing === p &&
      this.playerBody.blocked.down &&
      this.vy >= 0 &&
      Math.abs(this.playerBody.bottom - (y - dy - p.height / 2)) < 12
    ) {
      this.player.x += dx;
      this.player.y += dy;
    }
  }
  private collidePlayer(p: Platform): void {
    this.physics.add.collider(this.player, p.rect, () => {
      if (this.playerBody.blocked.down && Math.abs(this.playerBody.bottom - p.body.top) < 8) this.standing = p;
    });
  }
  private spawnToken(source: string, x: number, y: number): Token {
    const token = new Token(this, source, x, y);
    this.tokens.push(token);
    this.platforms.forEach((p) => this.physics.add.collider(token.collider, p.rect));
    return token;
  }
  private discardToken(token: Token): void {
    this.tweens.killTweensOf(token.collider);
    token.destroy();
    this.tokens = this.tokens.filter((t) => t !== token);
    if (this.held === token) this.held = null;
  }
  private spawnEnemy(x: number, y: number): void {
    const index = this.spawned++;
    const rect = this.add.rectangle(x, y, 37, 38, 0xffffff, 0);
    this.physics.add.existing(rect);
    const body = rect.body as Phaser.Physics.Arcade.Body;
    body.setGravityY(1100).setBounce(0.1, 0).setMaxVelocity(650, 1000);
    const choices = this.beat.enemyTokens ?? ['1', '+'],
      token = choices[index % choices.length];
    const enemy: Enemy = {
      rect,
      body,
      glyph: new Formula(this, x, y, token, 38, '#d6d9d7'),
      hp: 2,
      time: index,
      stun: 0,
      kind: isOperator(token) ? 'operator' : 'cluster',
      token,
    };
    this.enemies.push(enemy);
    this.platforms.forEach((p) => this.physics.add.collider(rect, p.rect));
    this.physics.add.overlap(this.player, rect, () => {
      if (enemy.stun <= 0) this.damage(enemy.rect.x);
    });
  }

  /** Until the beat is solved, fallen enemies are replaced from whichever side the player is not on. */
  private reinforce(dt: number): void {
    if (this.phase || this.solved || this.transition || this.enemies.length >= (this.beat.enemies ?? 0)) return;
    this.reinforceTimer -= dt;
    if (this.reinforceTimer > 0) return;
    this.reinforceTimer = 7;
    const x = this.player.x < 475 ? 880 : 70;
    this.spawnEnemy(x, 540);
    this.dust.burst(x, 540, HAZARD, 18, 120);
  }

  private buildBoss(): void {
    this.bossFormula = this.makeBossFormula(this.phase!.component, this.encounter.chapter === 6 ? 44 : 65);
    this.bossLabel = text(
      this,
      this.core.x + 25,
      this.core.y + 88,
      this.phase!.attack,
      10,
      '#a4adb3',
      false,
    ).setLetterSpacing(4);
    this.args.audio.play('boss');
  }
  private makeBossFormula(source: string, size: number): Formula {
    const formula = new Formula(this, 0, this.core.y - 5, source, size).setDepth(8);
    formula.setScale(Math.min(1, 560 / formula.getBounds().width));
    formula.x += this.core.x - formula.getBounds().centerX;
    return formula;
  }
  private drawBackdrop(): void {
    const g = this.background;
    g.fillStyle(0x090b0d).fillRect(0, -400, this.worldWidth, 1500);
    g.lineStyle(1, 0x66717b, 0.04);
    for (let x = 0; x < this.worldWidth; x += 80) g.lineBetween(x, -200, x, 1000);
    for (let y = -160; y < 1000; y += 80) g.lineBetween(0, y, this.worldWidth, y);
    text(
      this,
      90,
      188,
      `${String(this.save.encounter + 1).padStart(2, '0')} / ${String(CAMPAIGN.length).padStart(2, '0')}`,
      11,
      '#a4b1ba',
      false,
    )
      .setOrigin(0)
      .setLetterSpacing(3);
    text(this, 90, 218, this.beat.name, 31, '#b8c0c3', false).setOrigin(0);
    if (!this.phase) text(this, 90, 270, this.encounter.subtitle, 13, '#a9b5bd', false).setOrigin(0);
  }

  private aim(): number {
    const pointer = this.input.activePointer;
    const point = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    return Phaser.Math.Angle.Between(this.player.x, this.player.y - 10, point.x, point.y);
  }
  private nearbyRack(): Rack | undefined {
    const pointer = this.input.activePointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const near = this.racks.filter(
      (r) => r.container.visible && Phaser.Math.Distance.Between(this.player.x, this.player.y, r.x, r.y) < 115,
    );
    return near.sort(
      (a, b) =>
        Phaser.Math.Distance.Between(pointer.x, pointer.y, a.x, a.y) -
        Phaser.Math.Distance.Between(pointer.x, pointer.y, b.x, b.y),
    )[0];
  }
  private nearRail(): boolean {
    return Phaser.Math.Distance.Between(this.player.x, this.player.y, this.rail.x, this.rail.y) < 215;
  }
  private cycleRack(direction: number): void {
    const rack = this.nearbyRack();
    if (rack) {
      rack.cycle(direction);
      this.args.audio.play('grab');
    }
  }
  private selectedSlot(): number {
    const pointer = this.input.activePointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const pointed = this.rail.slotAt(pointer.x, pointer.y);
    if (pointed >= 0) return pointed;
    if (this.held) {
      const empty = this.rail.values.findIndex(
        (v, i) => v === null && compatible(this.held!.source, this.rail.spec.slots[i]),
      );
      if (empty >= 0) return empty;
    }
    return this.rail.slotPositions.reduce(
      (best, x, i) =>
        Math.abs(this.player.x - this.rail.x - x) <
        Math.abs(this.player.x - this.rail.x - this.rail.slotPositions[best])
          ? i
          : best,
      0,
    );
  }

  private interact(): void {
    if (this.handling > 0 || this.transition || this.dying) return;
    this.handling = 0.2 / this.character.handling;
    if (this.nearRail()) {
      const slot = this.selectedSlot();
      if (this.held) {
        const old = this.rail.insert(this.held.source, slot);
        if (old === undefined) {
          this.args.audio.play('wrong');
          this.rail.status.setText(
            isOperator(this.held.source) ? 'Operators go in round slots.' : 'Numbers go in square slots.',
          );
          return;
        }
        this.dust.burst(this.rail.x + this.rail.slotPositions[slot], this.rail.y, this.character.color, 8, 70);
        this.discardToken(this.held);
        if (old) {
          this.held = this.spawnToken(old, this.player.x, this.player.y);
          this.held.hold();
        }
        this.editTimer = 0.8;
        this.args.audio.play('grab');
        return;
      }
      const source = this.rail.remove(slot);
      if (source) {
        this.held = this.spawnToken(source, this.player.x, this.player.y);
        this.held.hold();
        this.editTimer = 0.8;
        this.args.audio.play('grab');
        return;
      }
    }
    if (this.held) {
      this.held.release(this.player.x + this.facing * 37, this.player.y, this.facing * 35, -30);
      this.held = null;
      return;
    }
    const nearest = this.tokens
      .filter((t) => t.state !== 'held' && Phaser.Math.Distance.Between(this.player.x, this.player.y, t.x, t.y) < 86)
      .sort((a, b) => Math.abs(this.player.x - a.x) - Math.abs(this.player.x - b.x))[0];
    if (nearest) {
      this.tweens.killTweensOf(nearest.collider);
      nearest.body.setGravityY(700);
      nearest.hold();
      this.held = nearest;
      this.args.audio.play('grab');
      return;
    }
    const rack = this.nearbyRack();
    if (rack) {
      this.held = this.spawnToken(rack.take(), this.player.x, this.player.y);
      this.held.hold();
      this.args.audio.play('grab');
      // Stocked tokens are the only copies, so they return to the rack instead of expiring.
      if (rack.limited) this.held.home = [rack.x, rack.y - 40];
    }
  }

  private strikeOrThrow(): void {
    if (this.handling > 0 || this.dying || this.transition) return;
    const angle = this.aim();
    this.facing = Math.cos(angle) < 0 ? -1 : 1;
    if (this.held) {
      const throwAngle = this.character.id === 'green' ? (Math.round(angle / (Math.PI / 36)) * Math.PI) / 36 : angle;
      const force = 660 * this.character.force;
      this.held.release(
        this.player.x + Math.cos(throwAngle) * 40,
        this.player.y - 10 + Math.sin(throwAngle) * 30,
        Math.cos(throwAngle) * force,
        Math.sin(throwAngle) * force,
      );
      this.held = null;
      this.handling = 0.24 / this.character.handling;
      this.args.audio.play('throw');
    } else {
      if (this.attack > 0) return;
      this.attack = 0.28;
      this.handling = 0.3;
      this.args.audio.play('hit');
      this.dust.burst(this.player.x + this.facing * 45, this.player.y - 5, this.character.color, 5, 70);
      for (const enemy of this.enemies)
        if (
          Math.abs(enemy.rect.y - this.player.y) < 70 &&
          (enemy.rect.x - this.player.x) * this.facing > -10 &&
          (enemy.rect.x - this.player.x) * this.facing < 98
        )
          this.hitEnemy(enemy, this.facing * (this.character.id === 'red' ? 600 : 400), 1);
      for (const token of this.tokens)
        if (
          token.state !== 'held' &&
          Phaser.Math.Distance.Between(this.player.x + this.facing * 35, this.player.y, token.x, token.y) < 80
        )
          token.release(token.x, token.y, this.facing * 420 * this.character.force, -180);
      for (const bolt of this.bolts)
        if (
          bolt.kind === 'bolts' &&
          Phaser.Math.Distance.Between(this.player.x + this.facing * 40, this.player.y, bolt.x, bolt.y) < 85
        ) {
          bolt.vx = this.facing * Math.abs(bolt.vx);
          bolt.friendly = true;
        }
    }
  }

  private evaluateRail(): void {
    if (!this.nearRail() || this.rail.cooldown > 0 || this.transition || this.dying) return;
    const { result } = this.rail;
    if (!result.valid) {
      this.args.audio.play('wrong');
      return;
    }
    if (this.device && this.device.state !== 'idle') {
      this.rail.status.setText(this.device.busy ? 'Let the device finish.' : 'It already works.');
      return;
    }
    if (this.phase && this.counterLock > 0) {
      this.rail.status.setText('Let the current counter land.');
      return;
    }
    if (!this.phase && this.solved) return;
    const value = result.value!,
      verdict = judge(this.beat, value),
      display = this.rail.display();
    this.editTimer = 1;
    this.rail.cooldown = this.phase ? 2 : 0.8;
    this.rail.preview.setText(display).setAlpha(1);
    this.rail.status.setText(verdict.readout);
    this.effectMagnitude = Math.min(12, Math.abs(value.num));
    this.animateSimplification(display, verdict.success);
    if (this.device) {
      this.device.run(value.num, verdict.success);
      this.args.audio.play('grab');
      return;
    }
    if (!verdict.success) {
      this.args.audio.play('grab');
      this.previewEffect(value.num);
      if (!this.phase) this.materialize(false);
      return;
    }
    this.args.audio.play('solve');
    this.rail.solved = true;
    if (this.phase) this.performCounter();
    else {
      this.solved = true;
      this.materialize(true);
      this.portal.setAlpha(1);
      this.args.emit({ type: 'toast', text: display, sub: 'Now use what you made.' });
    }
  }

  private onDeviceSuccess(): void {
    this.rail.solved = true;
    if (this.phase) this.performCounter(this.device!.origin());
    else {
      this.solved = true;
      this.portal.setAlpha(1);
      this.args.emit({ type: 'toast', text: this.rail.display(), sub: 'Now use what you made.' });
    }
  }

  private animateSimplification(result: string, success: boolean): void {
    const terms = this.rail.values.filter((s): s is string => s !== null);
    terms.forEach((term, i) => {
      const glyph = new Formula(this, this.rail.x + (i - (terms.length - 1) / 2) * 60, this.rail.y, term, 32).setDepth(
        40,
      );
      this.tweens.add({
        targets: glyph,
        x: this.rail.x + 40,
        y: this.rail.y - 80,
        scale: 0.5,
        alpha: 0,
        duration: 450 + i * 60,
        ease: 'Cubic.easeIn',
        onComplete: () => glyph.destroy(),
      });
    });
    const glyph = text(this, this.rail.x + 40, this.rail.y - 60, result, 46, success ? this.character.hex : '#ebece8')
      .setDepth(40)
      .setAlpha(0);
    this.tweens.add({
      targets: glyph,
      alpha: 1,
      y: this.rail.y - 100,
      duration: 400,
      delay: 240,
      yoyo: true,
      hold: 300,
      onComplete: () => glyph.destroy(),
    });
    this.dust.burst(this.rail.x, this.rail.y, success ? this.character.color : INK, 24, 130);
  }

  private previewEffect(value: number): void {
    // Valid alternatives still exert force, even when they do not satisfy this device's goal.
    for (const token of this.tokens)
      if (token.state !== 'held' && !token.home)
        token.body.setVelocity(token.body.velocity.x + value * 24, token.body.velocity.y - Math.abs(value) * 20);
  }

  /** The gap bridge: its length is the value, one tile per unit of the target. */
  private materialize(matched: boolean): void {
    for (const p of this.builtPlatforms) p.rect.destroy();
    this.platforms = this.platforms.filter((p) => !this.builtPlatforms.includes(p));
    this.standing = undefined;
    const width = matched
      ? 610
      : 610 * Phaser.Math.Clamp(this.effectMagnitude / (this.beat.rail.target ?? 1), 0.08, 1.7);
    const bridge = this.platform(940 + width / 2, 546, width, 12);
    this.builtPlatforms = [bridge];
    if (!matched) return;
    bridge.rect.setAlpha(0);
    this.tweens.add({ targets: bridge.rect, alpha: 1, duration: 450 });
    this.dust.burst(bridge.rect.x, bridge.rect.y, INK, 10, 80);
    if (!this.args.settings.reducedMotion) this.cameras.main.shake(120, 0.002);
  }

  private performCounter(from?: { x: number; y: number }): void {
    this.counterLock = 2.7;
    const start = from
        ? new Phaser.Math.Vector2(from.x, from.y)
        : new Phaser.Math.Vector2(this.rail.x, this.rail.y - 35),
      end = new Phaser.Math.Vector2(this.core.x, this.core.y);
    const via = new Phaser.Math.Vector2((start.x + end.x) / 2 - 60, Math.min(start.y, end.y) - 60);
    const glyph = new Formula(this, start.x, start.y, this.rail.result.display, 34, this.character.hex).setDepth(25);
    this.pulses.push({ start, end, via, age: 0, duration: 1.1, glyph, trail: [], boss: true });
  }

  private bossHit(): void {
    if (this.transition) return;
    this.hitCount++;
    this.bossStun = Math.max(this.bossStun, 1.4);
    this.dust.burst(this.core.x, this.core.y, this.character.color, 65, 250);
    this.args.audio.play('hit');
    if (!this.args.settings.reducedMotion) this.cameras.main.shake(200, 0.004);
    this.bossFormula?.setAlpha(0.2);
    this.tweens.add({ targets: this.bossFormula, alpha: 1, duration: 400 });
    if (this.hitCount >= this.phase!.hits) {
      this.bolts.forEach((b) => b.glyph.destroy());
      this.bolts = [];
      this.warnings.forEach((w) => w.glyph.destroy());
      this.warnings = [];
      this.transition = true;
      if (this.save.encounter === CAMPAIGN.length - 1 && this.save.beat === this.encounter.phases!.length - 1) {
        this.finishCampaign();
        return;
      }
      this.args.emit({ type: 'toast', text: this.phase!.name, sub: 'Term removed.' });
      ['+', '−', '1', '(', ')', '𝑥'].forEach((piece, i) => {
        const glyph = new Formula(this, this.core.x, this.core.y, piece, 27).setDepth(25);
        this.tweens.add({
          targets: glyph,
          x: this.core.x + Math.cos(i) * 280,
          y: this.core.y + Math.sin(i) * 200,
          rotation: i,
          alpha: 0,
          duration: 1100,
          onComplete: () => glyph.destroy(),
        });
      });
      this.time.delayedCall(1800, () => this.advance());
    } else {
      this.rail.status.setText('Counter landed. Shape the next one.');
      this.args.emit({
        type: 'toast',
        text: `${this.hitCount} / ${this.phase!.hits}`,
        sub: 'The expression is coming apart.',
      });
      if (this.device)
        this.time.delayedCall(600, () => {
          this.device!.reset();
          this.deviceHandled = false;
        });
    }
  }

  /** The Unknown collapses into the value it always had. */
  private finishCampaign(): void {
    this.save.complete = true;
    this.commitSave();
    this.args.audio.play('unlock');
    this.bossLabel?.destroy();
    this.tweens.add({ targets: this.bossFormula, alpha: 0, scale: 0.3, duration: 1200, ease: 'Cubic.easeIn' });
    const square = text(this, this.core.x - 100, this.core.y, '(𝑥 − 1)² = 0', 54)
      .setDepth(40)
      .setAlpha(0);
    this.tweens.add({ targets: square, alpha: 1, duration: 900, delay: 900, hold: 1600, yoyo: true });
    this.time.delayedCall(4200, () => {
      const one = text(this, this.core.x - 100, this.core.y, '𝑥 = 1', 96, this.character.hex)
        .setDepth(40)
        .setAlpha(0);
      this.tweens.add({ targets: one, alpha: 1, duration: 1200 });
      this.dust.burst(this.core.x - 100, this.core.y, this.character.color, 130, 350);
      this.args.emit({ type: 'toast', text: '𝑥 = 1', sub: 'It began with one.' });
    });
    this.time.delayedCall(8500, () => this.args.emit({ type: 'complete', elapsed: this.save.elapsed }));
  }

  private stealOperator(): void {
    const slots = this.rail.values.flatMap((v, i) => (v && isOperator(v) ? [i] : []));
    if (!slots.length) return;
    const slot = Phaser.Utils.Array.GetRandom(slots),
      source = this.rail.remove(slot)!;
    const x = this.rail.x + this.rail.slotPositions[slot],
      y = this.rail.y - 50;
    const token = this.spawnToken(source, x, y);
    token.home = [Phaser.Math.Clamp(x + (Math.random() < 0.5 ? -1 : 1) * 260, 60, this.phase ? 1220 : 900), 560];
    token.release(x, y, (token.home[0] - x) * 1.3, -380);
    this.dust.burst(x, this.rail.y, HAZARD, 14, 110);
    this.args.audio.play('wrong');
    if (!this.theftWarned) {
      this.theftWarned = true;
      this.args.emit({ type: 'toast', text: '𝑥 took your operator.', sub: 'Carry it back.' });
    }
  }

  private hitEnemy(enemy: Enemy, force: number, damage: number): void {
    enemy.hp -= damage;
    enemy.stun = 0.8;
    enemy.body.setVelocity(force, -230);
    this.dust.burst(enemy.rect.x, enemy.rect.y, INK, 12, 100);
    if (enemy.hp <= 0) {
      this.spawnToken(enemy.token, enemy.rect.x, Math.min(enemy.rect.y, 580)).body.setVelocity(force * 0.3, -150);
      enemy.glyph.destroy();
      enemy.rect.destroy();
      this.enemies = this.enemies.filter((e) => e !== enemy);
    }
  }
  private damage(fromX: number): void {
    if (this.invulnerable > 0 || this.dying || this.transition) return;
    this.hp--;
    this.invulnerable = 1.5;
    this.vx = this.player.x < fromX ? -270 : 270;
    this.vy = -250;
    this.dust.burst(this.player.x, this.player.y, this.character.color, 20, 170);
    this.args.audio.play('damage');
    if (!this.args.settings.reducedMotion) this.cameras.main.shake(130, 0.003);
    if (this.hp <= 0) this.die();
  }
  private die(): void {
    if (this.dying) return;
    this.dying = true;
    this.hp = 0;
    this.vx = 0;
    this.time.delayedCall(650, () => {
      this.args.emit({ type: 'death' });
      this.scene.pause();
    });
  }
  restartCheckpoint(): void {
    this.scene.restart({ ...this.args, save: this.save, chapterCard: false });
  }
  resumeFromMenu(): void {
    this.pauseDebounce = 0.25;
    this.input.keyboard?.resetKeys();
    this.scene.resume();
  }
  private commitSave(): void {
    this.args.emit({ type: 'save', save: { ...this.save } });
  }
  private advance(): void {
    const steps = this.encounter.phases ?? this.encounter.beats;
    const oldChapter = this.encounter.chapter;
    if (this.save.beat + 1 < steps.length) this.save.beat++;
    else {
      this.save.encounter++;
      this.save.beat = 0;
    }
    this.save.furthest = Math.max(this.save.furthest, this.save.encounter);
    this.commitSave();
    this.scene.restart({
      ...this.args,
      save: this.save,
      chapterCard: CAMPAIGN[this.save.encounter].chapter !== oldChapter,
    });
  }

  private warn(kind: string, x: number, y: number, tx: number, ty: number, delay = 0.95): void {
    const total = delay * this.character.timing;
    const glyph = text(
      this,
      x,
      y - 24,
      ({ negative: '−', vectors: '→', waves: '∿', bolts: '÷' } as Record<string, string>)[kind] ?? '+',
      28,
      '#aab1b5',
    ).setDepth(18);
    this.warnings.push({ x, y, tx, ty, timer: total, total, kind, glyph });
  }
  private attackPattern(): void {
    if (!this.phase && !this.beat.hazard) return;
    const kind = this.beat.hazard ?? 'bolts';
    if (this.beat.theft && !this.solved && Math.random() < 0.6) this.stealOperator();
    if (kind === 'charge') return;
    const boss = Boolean(this.phase),
      x = boss ? this.core.x + 10 : (this.cameo?.x ?? Math.min(this.worldWidth - 50, this.player.x + 560)),
      y = boss ? this.core.y + 45 : this.cameo ? this.cameo.y + 20 : 300;
    if (kind === 'negative') {
      this.warn(kind, x, y, this.player.x, this.player.y);
      this.warn(kind, x - 110, y - 70, this.player.x + 85, 600, 1.3);
    } else if (kind === 'vectors') {
      for (let i = 0; i < (boss ? 3 : 2); i++)
        this.warn(kind, x + i * 45 - 45, y - 80, this.player.x + (i - 1) * 85, 620, 1 + i * 0.15);
    } else if (kind === 'waves') {
      this.warn(kind, x, 520, this.player.x - 100, 520, 1.2);
      if (boss) this.warn(kind, x, 390, this.player.x, 460, 1.6);
    } else {
      this.warn(kind, x, y, this.player.x, this.player.y, 1.1);
      if (boss && this.encounter.chapter === 6)
        for (let i = 0; i < 3; i++) this.warn(kind, x, y + i * 65, this.player.x, 420 + i * 65, 1.2 + i * 0.2);
    }
    this.args.audio.tone(100, 0.35, 'sine', 0.07, 70);
  }

  private updateProjectiles(dt: number): void {
    for (const warning of [...this.warnings]) {
      warning.timer -= dt;
      if (warning.timer <= 0) {
        const angle = Phaser.Math.Angle.Between(warning.x, warning.y, warning.tx, warning.ty);
        const speed = 245 + this.encounter.chapter * 20;
        const symbol = ({ negative: '−1', vectors: '×', waves: '∿' } as Record<string, string>)[warning.kind] ?? '÷';
        const glyph = new Formula(this, warning.x, warning.y, symbol, 30).setDepth(16);
        this.bolts.push({
          x: warning.x,
          y: warning.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          glyph,
          age: 0,
          kind: warning.kind,
          friendly: false,
          wave: Math.random() * 6,
        });
        warning.glyph.destroy();
        this.warnings.splice(this.warnings.indexOf(warning), 1);
      }
    }
    for (const bolt of [...this.bolts]) {
      bolt.age += dt;
      bolt.x += bolt.vx * dt;
      bolt.y += bolt.vy * dt;
      if (bolt.kind === 'waves') bolt.y += Math.cos(bolt.age * 5 + bolt.wave) * 95 * dt;
      bolt.glyph.setPosition(bolt.x, bolt.y);
      if (bolt.friendly) bolt.glyph.setAlpha(0.55);
      if (!bolt.friendly && Phaser.Math.Distance.Between(bolt.x, bolt.y, this.player.x, this.player.y) < 31) {
        this.damage(bolt.x);
        bolt.age = 10;
      }
      if (bolt.age > 8 || bolt.x < -100 || bolt.x > this.worldWidth + 100 || bolt.y > 900 || bolt.y < -300) {
        bolt.glyph.destroy();
        this.bolts.splice(this.bolts.indexOf(bolt), 1);
      }
    }
    for (const pulse of [...this.pulses]) {
      pulse.age += dt;
      if (pulse.age < 0) continue;
      const t = Math.min(1, pulse.age / pulse.duration),
        one = 1 - t;
      const x = one * one * pulse.start.x + 2 * one * t * pulse.via.x + t * t * pulse.end.x;
      const y = one * one * pulse.start.y + 2 * one * t * pulse.via.y + t * t * pulse.end.y;
      pulse.glyph.setPosition(x, y);
      pulse.trail.push(new Phaser.Math.Vector2(x, y));
      if (pulse.trail.length > 28) pulse.trail.shift();
      if (t >= 1) {
        pulse.glyph.destroy();
        this.pulses.splice(this.pulses.indexOf(pulse), 1);
        if (pulse.boss) this.bossHit();
      }
    }
  }

  update(_time: number, delta: number): void {
    if (!this.playerBody) return;
    const dt = Math.min(delta / 1000, 0.035);
    this.clock += dt;
    this.save.elapsed += dt;
    this.pauseDebounce = Math.max(0, this.pauseDebounce - dt);
    const combat = Boolean(this.phase || this.beat.enemies || this.beat.hazard) && !this.transition;
    const manipulating = Boolean(this.held) || this.editTimer > 0;
    const slow = combat && manipulating && this.focus > 0;
    const scale = slow ? 0.35 : 1;
    const worldDt = dt * scale;
    this.worldClock += worldDt;
    if (slow) this.focus = Math.max(0, this.focus - dt);
    else if (!manipulating) this.focus = Math.min(this.character.focus, this.focus + dt * 0.8);
    for (const key of ['invulnerable', 'attack', 'handling', 'editTimer', 'counterLock'] as const)
      this[key] = Math.max(0, this[key] - dt);
    this.bossStun = Math.max(0, this.bossStun - worldDt);
    this.introSafe -= worldDt;
    this.rail.cooldown = Math.max(0, this.rail.cooldown - worldDt);
    if (Phaser.Input.Keyboard.JustDown(this.keys.ESC) && this.pauseDebounce <= 0) {
      this.commitSave();
      this.args.emit({ type: 'pause' });
      this.scene.pause();
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) {
      this.restartCheckpoint();
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.Q)) this.cycleRack(1);
    if (Phaser.Input.Keyboard.JustDown(this.keys.E)) this.interact();
    if (Phaser.Input.Keyboard.JustDown(this.keys.F)) this.evaluateRail();
    if (this.meleeQueue) {
      this.strikeOrThrow();
      this.meleeQueue = false;
    }
    this.updateMovement(dt, scale);
    this.moveLifts();
    this.device?.update(worldDt);
    if (this.device) this.portal.y = this.device.goal.y - 10;
    if (this.device?.state === 'success' && !this.deviceHandled) {
      this.deviceHandled = true;
      this.onDeviceSuccess();
    }
    this.enemies.forEach((enemy) => {
      enemy.time += worldDt;
      enemy.stun -= worldDt;
      if (enemy.stun <= 0) {
        let direction = Math.sign(this.player.x - enemy.rect.x);
        if (Math.abs(this.player.x - enemy.rect.x) > 430) direction = Math.cos(enemy.time) > 0 ? 1 : -1;
        const ahead = enemy.rect.x + direction * 40;
        const hasFloor = this.platforms.some(
          (p) => Math.abs(ahead - p.rect.x) < p.width / 2 && p.rect.y >= enemy.rect.y && p.rect.y < enemy.rect.y + 85,
        );
        enemy.body.setVelocityX(hasFloor ? direction * (enemy.kind === 'operator' ? 95 : 65) : -direction * 50);
        if (enemy.kind === 'cluster' && enemy.body.blocked.down && Math.sin(enemy.time * 2) > 0.985)
          enemy.body.setVelocityY(-300);
      }
    });
    this.physics.world.update(this.worldClock * 1000, worldDt * 1000);
    this.vy = this.playerBody.velocity.y * scale;
    this.applyRamps();
    this.tokens.forEach((token) => {
      token.update(
        worldDt,
        this.playerBody.center.x + Math.cos(this.aim()) * 39,
        this.playerBody.center.y - 10 + Math.sin(this.aim()) * 29,
      );
      if (token.state === 'thrown') {
        if (token.age > 0.15 && token.age < 2) {
          const slot = this.rail.slotAt(token.body.center.x, token.body.center.y);
          if (slot >= 0 && this.rail.values[slot] === null && compatible(token.source, this.rail.spec.slots[slot])) {
            this.rail.insert(token.source, slot);
            this.discardToken(token);
            return;
          }
        }
        for (const enemy of [...this.enemies])
          if (
            !token.hit.has(enemy) &&
            Phaser.Math.Distance.Between(
              token.body.center.x,
              token.body.center.y,
              enemy.body.center.x,
              enemy.body.center.y,
            ) < 40
          ) {
            token.hit.add(enemy);
            this.hitEnemy(enemy, token.body.velocity.x * 0.65, Math.abs(token.body.velocity.x) > 450 ? 2 : 1);
            token.body.velocity.x *= 0.55;
          }
        if (token.body.speed < 45 && token.age > 0.5) token.state = 'loose';
      }
    });
    for (const token of [...this.tokens])
      if (
        token.state !== 'held' &&
        (token.body.center.y > 820 ||
          (!token.home && token.age > 40) ||
          token.x < -80 ||
          token.x > this.worldWidth + 80)
      ) {
        if (token.home) {
          token.release(...token.home);
          if (this.save.encounter === 0 && this.save.beat === 0) token.body.setGravityY(0);
        } else this.discardToken(token);
      }
    if (this.tokens.length > 35) {
      const loose = this.tokens.find((t) => t.state === 'loose' && !t.home);
      if (loose) this.discardToken(loose);
    }
    this.enemies.forEach((e) => {
      e.glyph.setPosition(e.body.center.x, e.body.center.y).setRotation(Math.sin(e.time * 2) * 0.12);
    });
    for (const enemy of [...this.enemies]) if (enemy.rect.y > 850) this.hitEnemy(enemy, 0, 99);
    if (combat && this.introSafe <= 0 && this.bossStun <= 0) {
      this.attackTimer -= worldDt;
      if (this.attackTimer <= 0) {
        this.attackPattern();
        this.attackTimer = this.phase
          ? Math.max(2.1, 4.2 - this.encounter.chapter * 0.34)
          : Math.max(3.2, 4.6 - this.encounter.chapter * 0.2);
      }
    }
    this.reinforce(worldDt);
    this.updateProjectiles(worldDt);
    if (this.playerBody.center.y > 830 && !this.dying) this.die();
    if (
      !this.phase &&
      this.solved &&
      !this.transition &&
      Math.abs(this.playerBody.center.x - this.goalX) < 45 &&
      Math.abs(this.playerBody.bottom - this.portal.y) < 90
    ) {
      this.transition = true;
      this.args.audio.play('unlock');
      this.time.delayedCall(650, () => this.advance());
    }
    this.drawWorld(dt, slow);
    this.dust.update(worldDt);
    this.args.audio.update(worldDt, this.encounter.chapter, combat);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.updateHud();
      this.hudTimer = 0.1;
    }
  }

  /** Straight ramps (the Pythagoras plank) carry the player along their slope. */
  private applyRamps(): void {
    this.onRamp = false;
    if (this.vy < 0) return;
    const x = this.playerBody.center.x,
      bottom = this.playerBody.bottom;
    for (const r of this.ramps) {
      if (x < r.x1 || x > r.x2) continue;
      const y = r.y1 + ((r.y2 - r.y1) * (x - r.x1)) / (r.x2 - r.x1);
      if (bottom >= y - 4 && bottom <= y + 22) {
        this.player.y = y - this.playerBody.height / 2;
        this.vy = 0;
        this.onRamp = true;
      }
    }
  }

  private updateMovement(dt: number, scale: number): void {
    const grounded = this.playerBody.blocked.down || this.onRamp;
    this.coyote = grounded ? 0.12 : Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) this.jumpBuffer = 0.13;
    const direction =
      (this.keys.D.isDown || this.keys.RIGHT.isDown ? 1 : 0) - (this.keys.A.isDown || this.keys.LEFT.isDown ? 1 : 0);
    if (!this.dying && !this.transition) {
      if (this.invulnerable < 1.3)
        this.vx = Phaser.Math.Linear(
          this.vx,
          direction * 295 * this.character.speed,
          Math.min(1, dt * (grounded ? 18 : 10)),
        );
      if (direction) this.facing = direction;
      if (this.jumpBuffer > 0 && this.coyote > 0) {
        this.vy = -560 * this.character.jump;
        this.coyote = 0;
        this.jumpBuffer = 0;
        this.standing = undefined;
        this.onRamp = false;
        this.args.audio.play('jump');
        this.dust.burst(this.player.x, this.player.y + 30, this.character.color, 6, 70);
      }
      if (Phaser.Input.Keyboard.JustUp(this.keys.SPACE) && this.vy < -200) this.vy *= 0.52;
    } else this.vx *= 0.85;
    if (!this.onRamp || this.vy < 0) this.vy = Math.min(1000, this.vy + 1450 * dt);
    if (this.launchVy) {
      this.vy = this.launchVy;
      this.launchVy = 0;
      this.coyote = 0;
      this.standing = undefined;
      this.args.audio.play('throw');
    }
    this.playerBody.setVelocity(this.vx / scale, this.vy / scale);
    if (this.player.x < 18) {
      this.player.x = 18;
      this.vx = Math.max(0, this.vx);
    }
    if (this.player.x > this.worldWidth - 18) {
      this.player.x = this.worldWidth - 18;
      this.vx = Math.min(0, this.vx);
    }
  }

  private moveLifts(): void {
    for (const p of this.platforms)
      if (p.motion === 'lift')
        this.movePlatform(p, p.baseX, p.baseY + Math.sin(this.worldClock * 1.05 + p.phase) * p.amplitude);
  }

  private drawWorld(dt: number, slow: boolean): void {
    const g = this.geometry.clear(),
      overlay = this.overlay.clear(),
      fg = this.figures.clear();
    this.platforms.forEach((p) => {
      if (p.hidden) return;
      g.lineStyle(p.height > 15 ? 1.2 : 1.7, INK, p.rect.alpha * (p.motion ? 0.85 : 0.6)).lineBetween(
        p.rect.x - p.width / 2,
        p.rect.y - p.height / 2,
        p.rect.x + p.width / 2,
        p.rect.y - p.height / 2,
      );
    });
    if (!this.solved && this.beat.layout === 'gap') {
      // Dashed tiles show how long the bridge must be.
      const tiles = this.beat.rail.target ?? 1,
        w = 610 / tiles;
      g.lineStyle(1, INK, 0.35);
      for (let i = 0; i < tiles; i++)
        for (let x = 944 + i * w; x < 936 + (i + 1) * w; x += 20)
          g.lineBetween(x, 540, Math.min(x + 10, 936 + (i + 1) * w), 540).lineBetween(
            x,
            552,
            Math.min(x + 10, 936 + (i + 1) * w),
            552,
          );
      for (let i = 0; i <= tiles; i++) g.lineBetween(940 + i * w, 540, 940 + i * w, 552);
    }
    for (const r of this.ramps) g.lineStyle(7, this.character.color, 0.8).lineBetween(r.x1, r.y1, r.x2, r.y2);
    if (this.beat.hazard === 'waves') {
      g.lineStyle(1, INK, 0.22).beginPath();
      for (let x = 0; x <= this.worldWidth; x += 8) {
        const y = 380 + Math.sin(x / 125 + this.worldClock) * 70;
        if (!x) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
    }
    this.device?.draw(g);
    this.warnings.forEach((w) => {
      const alpha = 0.18 + 0.45 * (1 - w.timer / w.total);
      overlay.lineStyle(1, HAZARD, alpha);
      const distance = Phaser.Math.Distance.Between(w.x, w.y, w.tx, w.ty),
        count = Math.max(1, Math.floor(distance / 18));
      for (let i = 0; i < count; i++) {
        const a = i / count,
          b = Math.min(1, a + 0.5 / count);
        overlay.lineBetween(
          Phaser.Math.Linear(w.x, w.tx, a),
          Phaser.Math.Linear(w.y, w.ty, a),
          Phaser.Math.Linear(w.x, w.tx, b),
          Phaser.Math.Linear(w.y, w.ty, b),
        );
      }
      overlay.strokeCircle(w.tx, w.ty, 18 + w.timer * 8);
      w.glyph.setAlpha(0.4 + Math.sin(this.clock * 12) * 0.3);
    });
    this.pulses.forEach((p) => {
      if (p.trail.length > 1) {
        overlay.lineStyle(2, this.character.color, 0.5).beginPath().moveTo(p.trail[0].x, p.trail[0].y);
        p.trail.forEach((point) => overlay.lineTo(point.x, point.y));
        overlay.strokePath();
      }
    });
    const grounded = this.playerBody.blocked.down || this.onRamp,
      walled = this.vx < 0 ? this.playerBody.blocked.left : this.playerBody.blocked.right;
    this.figure.update(dt, {
      speed: walled ? 0 : this.vx,
      vy: this.vy,
      grounded,
      facing: this.facing,
      attack: this.attack,
    });
    if (!this.dying || this.clock % 0.2 < 0.1)
      this.figure.draw(fg, this.playerBody.center.x, this.playerBody.center.y, this.character.color, {
        held: Boolean(this.held),
        aim: this.aim(),
        hurt: this.invulnerable > 0 && this.clock % 0.16 < 0.08,
      });
    if (grounded && Math.abs(this.vx) > 170 && Math.random() < dt * 12)
      this.dust.burst(this.player.x, this.player.y + 30, MUTED, 1, 30);
    if (this.attack > 0) {
      overlay
        .lineStyle(2, this.character.color, this.attack * 2)
        .beginPath()
        .arc(this.player.x, this.player.y - 8, 55, this.facing > 0 ? -0.8 : 2.3, this.facing > 0 ? 0.8 : 3.9)
        .strokePath();
    }
    if (this.phase && this.bossFormula && !(this.transition && this.save.complete)) {
      this.bossFormula.y = this.core.y - 5 + Math.sin(this.worldClock * 1.5) * (this.bossStun > 0 ? 2 : 12);
      const radius = 123,
        angle = this.worldClock * 0.5;
      for (let i = 0; i < this.phase.hits; i++) {
        const theta = angle + (i / this.phase.hits) * Math.PI * 2;
        g.lineStyle(2, i < this.hitCount ? this.character.color : INK, i < this.hitCount ? 0.12 : 0.5)
          .beginPath()
          .arc(this.core.x + 10, this.core.y - 2, radius + i * 10, theta, theta + 0.9)
          .strokePath();
      }
      if (this.encounter.chapter === 6) {
        const shrink = this.bossStun > 0 ? 0.75 : 1;
        for (let arm = 0; arm < 6; arm++) {
          const base = (arm * Math.PI) / 3 + this.worldClock * 0.07;
          let lastX = this.core.x + 10,
            lastY = this.core.y - 2;
          for (let node = 1; node <= 5; node++) {
            const a = base + Math.sin(this.worldClock * 0.7 + node * 0.6) * 0.22;
            const x = this.core.x + 10 + Math.cos(a) * node * 43 * shrink,
              y = this.core.y - 2 + Math.sin(a) * node * 43 * shrink;
            g.lineStyle(1.2, INK, 0.15 + node * 0.025).lineBetween(lastX, lastY, x, y);
            g.fillStyle(INK, 0.3).fillCircle(x, y, node === 5 ? 4 : 2);
            lastX = x;
            lastY = y;
          }
        }
      }
    }
    if (this.cameo) {
      this.cameo.x = Math.min(this.worldWidth - 100, this.cameras.main.scrollX + 1060);
      this.cameo.y = 230 + Math.sin(this.worldClock * 0.8) * 25;
      this.cameo.setAlpha(this.solved ? 0.25 : 0.65);
    }
    if (slow)
      overlay
        .lineStyle(1, this.character.color, 0.15)
        .strokeCircle(this.player.x, this.player.y, 76 + Math.sin(this.clock * 2) * 5);
    if (this.held && this.character.id === 'yellow') {
      const angle = this.aim(),
        force = 660;
      overlay.fillStyle(this.character.color, 0.45);
      for (let t = 0.05; t < 0.8; t += 0.065)
        overlay.fillCircle(
          this.player.x + Math.cos(angle) * (40 + force * t),
          this.player.y - 10 + Math.sin(angle) * (30 + force * t) + 350 * t * t,
          1.8,
        );
    }
    const nearby = this.nearRail();
    this.rail.selected = this.selectedSlot();
    this.rail.draw(this.clock, nearby, this.held?.source ?? null, this.character.id === 'yellow');
    const rack = this.nearbyRack();
    if (nearby)
      this.hint.setText(
        this.held
          ? 'E  place / swap     ·     Aim at a slot to choose it     ·     F  evaluate'
          : 'E  take a symbol     ·     F  evaluate',
      );
    else if (rack)
      this.hint.setText(
        `E  take ${notation(rack.source)}     ·     Scroll / Q  choose symbol     ·     ${rack.index + 1} / ${rack.choices.length}`,
      );
    else if (this.held) this.hint.setText('E  drop     ·     Aim + click  throw');
    else if (this.clock < 18 && this.save.encounter === 0)
      this.hint.setText('A D  move     ·     Space  jump     ·     E  pick up');
    else this.hint.setText('');
  }

  private updateHud(): void {
    this.args.emit({
      type: 'hud',
      hp: this.hp,
      focus: this.focus,
      maxFocus: this.character.focus,
      objective: this.solved ? 'Reach the open doorway.' : this.beat.objective,
      chapter: this.encounter.chapter,
      title: this.encounter.title,
      phase: `${this.save.beat + 1} / ${(this.encounter.phases ?? this.encounter.beats).length}`,
      progress:
        (this.save.encounter + this.save.beat / (this.encounter.phases ?? this.encounter.beats).length) /
        CAMPAIGN.length,
    });
  }
}
