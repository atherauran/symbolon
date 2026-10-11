import Phaser from 'phaser';
import { ALL_ZONES, REGIONS, ZONE_COUNT, zoneOrder, type Zone } from '../content/campaign';
import { evaluate, isOperator, notation, OPERATORS } from '../math/evaluate';
import { isTrue, lieText, makeLie, repair, sizeOf, type Lie, type Thrown } from '../rules/lies';
import { GY, judge } from '../physics/model';
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
/** A Falsehood: a false statement that walks. Throws that move it toward true repair it. */
interface Enemy {
  rect: Phaser.GameObjects.Rectangle;
  body: Phaser.Physics.Arcade.Body;
  label: Phaser.GameObjects.Text;
  lie: Lie;
  time: number;
  stun: number;
  /** Counts down once it is true; it dissolves into its token at zero. */
  resolved: number;
  token: string;
  colliders: Phaser.Physics.Arcade.Collider[];
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
/** A zone built in the world: its rail, racks, device and gate. Its device draws in the zone's own coordinates. */
interface LiveZone {
  zone: Zone;
  region: number;
  index: number;
  ox: number;
  /** Everything the device creates, positioned at the zone's origin. */
  layer: Phaser.GameObjects.Container;
  sketch: Phaser.GameObjects.Graphics;
  platforms: Platform[];
  ramps: Ramp[];
  rail: Rail;
  racks: Rack[];
  device?: Device;
  /** The wall at the zone's right edge; it slides up once the zone is solved. */
  gate: Platform;
  bridge?: Platform;
  core: { x: number; y: number };
  boss?: { formula: Formula; label: Phaser.GameObjects.Text };
  solved: boolean;
  deviceHandled: boolean;
}

/** Start-ground layout inside a zone, in zone coordinates. */
const RAIL_X = 655,
  RAIL_Y = 536,
  GATE_TOP = -420;
/** Knowledge replaces health: each known concept adds focus, up to a cap. A hit costs one full point of it. */
const FOCUS_PER_CONCEPT = 0.2,
  FOCUS_BONUS_CAP = 4,
  HIT_COST = 1,
  /** 𝑥's thrown symbols hit harder than walking into things. */
  PROJECTILE_COST = 1.5,
  /** Focus regained per second with empty hands. Kept under HIT_COST / 1.5 s of invulnerability so constant hits still drain it. */
  FOCUS_REGEN = 0.4,
  /** Focus spent per second while holding or editing during combat. */
  FOCUS_DRAIN = 0.6;
/** Seconds between replacements for fallen Falsehoods while a zone is unsolved. */
const REINFORCE_DELAY = 12;
/** Uses before a control's hint retires. */
const TEACH_USES = 3;
const LIE_SIZE = { small: 24, large: 30, huge: 36 };
/** Tokens a rack can offer; laws in the known set are not symbols. */
const isSymbol = (t: string) => isOperator(t) || evaluate(t).valid;

/**
 * A view of the scene whose factory puts every new game object into `layer`. Devices keep their own coordinates
 * and the layer places them in the world.
 */
function layered(scene: Phaser.Scene, layer: Phaser.GameObjects.Container): Phaser.Scene {
  const add = new Proxy(scene.add, {
    get(factory, key) {
      const value = Reflect.get(factory, key);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const made = value.apply(factory, args);
        if (made instanceof Phaser.GameObjects.GameObject && !made.parentContainer) layer.add(made);
        return made;
      };
    },
  });
  return new Proxy(scene, { get: (target, key) => (key === 'add' ? add : Reflect.get(target, key)) });
}

export class World extends Phaser.Scene {
  args!: RuntimeArgs;
  save!: CheckpointState;
  character!: Character;
  known = new Set<string>();
  zones: LiveZone[] = [];
  cur!: LiveZone;
  player!: Phaser.GameObjects.Rectangle;
  playerBody!: Phaser.Physics.Arcade.Body;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  ground!: Phaser.Physics.Arcade.StaticGroup;
  platforms: Platform[] = [];
  private byRect = new Map<Phaser.GameObjects.GameObject, Platform>();
  tokens: Token[] = [];
  enemies: Enemy[] = [];
  bolts: Bolt[] = [];
  warnings: Warning[] = [];
  pulses: Pulse[] = [];
  held: Token | null = null;
  grid!: Phaser.GameObjects.TileSprite;
  geometry!: Phaser.GameObjects.Graphics;
  figures!: Phaser.GameObjects.Graphics;
  figure!: StickFigure;
  overlay!: Phaser.GameObjects.Graphics;
  dust!: Dust;
  hint!: Phaser.GameObjects.Text;
  cameo?: Formula;
  barrier!: Platform;
  leftBound = 0;
  clock = 0;
  worldClock = 0;
  focus = 4;
  invulnerable = 0;
  attack = 0;
  handling = 0;
  coyote = 0;
  jumpBuffer = 0;
  vy = 0;
  vx = 0;
  facing = 1;
  dying = false;
  transition = false;
  attackTimer = 4;
  hudTimer = 0;
  editTimer = 0;
  hitCount = 0;
  bossStun = 0;
  effectMagnitude = 0;
  counterLock = 0;
  meleeQueue = false;
  standing?: Platform;
  private introSafe = 0;
  private pauseDebounce = 0;
  private onRamp = false;
  private theftWarned = false;
  private reinforceTimer = 0;
  private launchVy = 0;
  private spawned = 0;
  private uses = new Map<string, number>();
  private moving = 0;

  constructor() {
    super('World');
  }
  init(args: RuntimeArgs): void {
    this.args = args;
    this.save = { ...args.save, known: [...args.save.known] };
  }
  get beat(): Beat {
    return this.cur.zone.beat;
  }
  get phase(): BossPhase | undefined {
    return this.cur.zone.duel ? (this.cur.zone.beat as BossPhase) : undefined;
  }
  get rail(): Rail {
    return this.cur.rail;
  }
  get device(): Device | undefined {
    return this.cur.device;
  }
  get chapter(): number {
    return this.cur.region + 1;
  }
  get maxFocus(): number {
    return this.character.focus + Math.min(FOCUS_BONUS_CAP, this.known.size * FOCUS_PER_CONCEPT);
  }
  /** Counts a control's use; its hint retires after a few. */
  private teach(control: string): void {
    const n = (this.uses.get(control) ?? 0) + 1;
    this.uses.set(control, n);
    if (n >= TEACH_USES && !this.save.taught.includes(control)) {
      this.save.taught.push(control);
      this.commitSave();
    }
  }
  /** The hint line: control reminders the player has not yet learned. A null control never retires. */
  private hintFor(parts: [string | null, string][]): string {
    return parts
      .filter(([control]) => !control || !this.save.taught.includes(control))
      .map(([, words]) => words)
      .join('     ·     ');
  }

  create(): void {
    this.character = CHARACTERS.find((c) => c.id === this.save.character)!;
    this.known = new Set(this.save.known);
    this.zones = [];
    this.platforms = [];
    this.byRect.clear();
    this.tokens = [];
    this.enemies = [];
    this.bolts = [];
    this.warnings = [];
    this.pulses = [];
    this.held = null;
    this.standing = this.cameo = undefined;
    this.onRamp = this.theftWarned = false;
    this.clock =
      this.worldClock =
      this.attack =
      this.invulnerable =
      this.handling =
      this.coyote =
      this.jumpBuffer =
      this.vy =
      this.vx =
      this.hudTimer =
      this.editTimer =
      this.effectMagnitude =
      this.launchVy =
      this.spawned =
        0;
    this.facing = 1;
    this.uses.clear();
    this.focus = this.maxFocus;
    this.pauseDebounce = 0.25;
    this.dying = this.transition = this.meleeQueue = false;
    this.physics.world.setBounds(-1000, -800, 1e6, 2000);
    this.ground = this.physics.add.staticGroup();
    this.grid = this.add.tileSprite(0, 0, 1280, 720, this.gridTexture()).setOrigin(0).setScrollFactor(0).setDepth(-10);
    this.geometry = this.add.graphics().setDepth(1);
    this.figures = this.add.graphics().setDepth(15);
    this.figure = new StickFigure();
    this.overlay = this.add.graphics().setDepth(20);
    this.dust = new Dust(this.add.graphics().setDepth(30));

    const start = ALL_ZONES[zoneOrder(this.save.region, this.save.zone)];
    this.cur = this.buildZone(start.region, start.index);
    this.leftBound = this.cur.ox;
    this.barrier = this.addPlatform(this.cur.ox - 10, GY - 520, 20, 1400, true);
    this.barrier.rect.setFillStyle(0x2c3338, 1);
    this.loadAhead();

    this.player = this.add.rectangle(this.cur.ox + 100, 563, 24, 62, 0xffffff, 0).setDepth(10);
    this.physics.add.existing(this.player);
    this.playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    this.playerBody.setMaxVelocity(1800, 3200);
    this.physics.add.collider(this.player, this.ground, (_player, rect) => {
      const p = this.byRect.get(rect as Phaser.GameObjects.GameObject);
      if (p && this.playerBody.blocked.down && Math.abs(this.playerBody.bottom - p.body.top) < 8) this.standing = p;
    });
    const camera = this.cameras.main.setBackgroundColor('#090b0d');
    camera.startFollow(this.player, false, 0.09, 0.09, -190, 50);
    this.updateCamera(0);
    camera.centerOn(this.player.x + 190, 360 - 50);
    this.updateCamera(0);

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
    this.hint = text(this, 640, 663, '', 16, '#c4ccd0', false).setScrollFactor(0).setDepth(60);
    if (!this.args.settings.reducedMotion) {
      camera.setZoom(this.phase ? 0.94 : 1.04);
      this.tweens.add({ targets: camera, zoom: 1, duration: 1900, ease: 'Sine.easeInOut' });
    }
    this.activate(this.args.chapterCard ?? false);
    this.commitSave();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.removeAllListeners();
    });
    this.updateHud();
  }

  private gridTexture(): string {
    if (!this.textures.exists('grid'))
      this.make
        .graphics({}, false)
        .lineStyle(1, 0x66717b, 0.04)
        .lineBetween(0.5, 0, 0.5, 80)
        .lineBetween(0, 0.5, 80, 0.5)
        .generateTexture('grid', 80, 80)
        .destroy();
    return 'grid';
  }

  // ---------- Zones ----------

  private buildZone(region: number, index: number): LiveZone {
    const zone = REGIONS[region].zones[index],
      ox = zone.x[0],
      beat = zone.beat;
    const layer = this.add.container(ox, 0).setDepth(2);
    const sketch = this.add.graphics();
    layer.add(sketch);
    const phase = zone.duel ? (beat as BossPhase) : undefined;
    const live: LiveZone = {
      zone,
      region,
      index,
      ox,
      layer,
      sketch,
      platforms: [],
      ramps: [],
      racks: [],
      rail: new Rail(this, ox + (zone.duel ? 650 : RAIL_X), RAIL_Y, beat.rail, this.character.color),
      gate: undefined!,
      core: phase?.core ? { x: phase.core[0], y: phase.core[1] } : { x: 940, y: 240 },
      solved: false,
      deviceHandled: false,
    };
    const local = layered(this, layer);
    if (zone.duel) {
      this.zonePlatform(live, 640, GY + 10, 1280, 20);
      this.zonePlatform(live, 180, 433, 150, 10);
      this.zonePlatform(live, 1080, 447, 170, 10);
    } else {
      this.zonePlatform(live, 475, GY + 10, 950, 20);
      if (beat.layout === 'gap') this.zonePlatform(live, 1920, GY + 10, 760, 20);
    }
    live.gate = this.zonePlatform(live, zone.x[1] - ox, (GATE_TOP + GY) / 2, 30, GY - GATE_TOP, true);
    if (beat.device) {
      live.device = createDevice(this.hostFor(live, local), beat.device);
      live.device.build();
    }
    this.makeRacks(live);
    const first = region === 0 && index === 0;
    if (first) {
      const one = this.spawnToken('1', ox + 330, 475);
      one.body.setGravityY(0);
      one.body.setVelocityY(-8);
      one.home = [ox + 330, 470];
      this.tweens.add({
        targets: one.collider,
        y: 460,
        duration: 1700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    for (const [source, x, y] of beat.loose ?? []) this.spawnToken(source, ox + x, y).home = [ox + x, y];
    const steps = REGIONS[region].zones;
    text(
      local,
      90,
      188,
      `${String(index + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}`,
      11,
      '#a4b1ba',
      false,
    )
      .setOrigin(0)
      .setLetterSpacing(3);
    text(local, 90, 218, beat.name, 31, '#b8c0c3', false).setOrigin(0);
    if (!zone.duel) text(local, 90, 270, zone.subtitle, 13, '#a9b5bd', false).setOrigin(0);
    this.zones.push(live);
    return live;
  }

  private hostFor(live: LiveZone, scene: Phaser.Scene): DeviceHost {
    const ox = live.ox;
    return {
      scene,
      accent: this.character.color,
      boss: live.zone.duel,
      core: live.core,
      platform: (x, y, width, height, hidden) => this.zonePlatform(live, x, y, width, height, hidden),
      removePlatform: (p) => {
        live.platforms = live.platforms.filter((q) => q !== p);
        this.removePlatform(p);
      },
      launch: (vy) => {
        this.launchVy = vy;
      },
      movePlatform: (p, x, y) => {
        p.x = x;
        p.y = y;
        this.movePlatform(p, x + ox, y);
      },
      addRamp: (ramp) => live.ramps.push({ x1: ramp.x1 + ox, y1: ramp.y1, x2: ramp.x2 + ox, y2: ramp.y2 }),
      player: () => ({ x: this.playerBody.center.x - ox, top: this.playerBody.top, bottom: this.playerBody.bottom }),
      hurt: (x) => this.damage(x + ox),
      burst: (x, y, color = INK, count, force) => this.dust.burst(x + ox, y, color, count, force),
      sound: (name) => this.args.audio.play(name),
      tone: (frequency, duration, gain = 0.2) => this.args.audio.tone(frequency, duration, 'sine', gain),
      time: () => this.worldClock,
    };
  }

  /** Racks offer the known tokens, minus those placed loose in this zone; a stock replaces them. */
  private makeRacks(live: LiveZone): void {
    live.racks.forEach((r) => r.container.destroy());
    live.racks = [];
    const beat = live.zone.beat,
      { stock } = beat,
      loose = (beat.loose ?? []).map(([source]) => source);
    const available = stock ?? [...this.known].filter((t) => isSymbol(t) && !loose.includes(t));
    const groups: [string, string[]][] = [
      ['numbers', available.filter((t) => !isOperator(t)).sort((a, b) => Number(a) - Number(b))],
      [
        'operators',
        beat.noOperatorRack ? [] : stock ? stock.filter(isOperator) : OPERATORS.filter((o) => available.includes(o)),
      ],
    ];
    groups
      .filter(([, values]) => values.length)
      .forEach(([name, choices], i) =>
        live.racks.push(new Rack(this, live.ox + 175 + i * 105, 557, choices, name, Boolean(stock))),
      );
  }

  /** Keeps the current zone and the next stretch of the spine built. Duel phases replace each other in place. */
  private loadAhead(): void {
    const order = zoneOrder(this.cur.region, this.cur.index);
    const next = ALL_ZONES.slice(order + 1).find(({ zone }) => zone.x[0] >= this.cur.zone.x[1]);
    if (next && !this.zones.some((z) => z.zone === next.zone)) this.buildZone(next.region, next.index);
  }

  private unloadZone(live: LiveZone): void {
    live.device = undefined;
    live.layer.destroy();
    live.rail.container.destroy();
    live.racks.forEach((r) => r.container.destroy());
    live.platforms.forEach((p) => this.removePlatform(p));
    live.boss?.formula.destroy();
    live.boss?.label.destroy();
    this.zones = this.zones.filter((z) => z !== live);
  }

  /** The zone where the player now is: enemies arrive, 𝑥 watches, a duel begins. */
  private activate(chapterCard: boolean): void {
    const beat = this.beat;
    this.hitCount = this.bossStun = this.counterLock = 0;
    this.attackTimer = this.phase ? 4.5 : 6;
    this.introSafe = this.cur.region === 0 && this.cur.index === 0 ? 9 : 3;
    this.reinforceTimer = REINFORCE_DELAY;
    this.cameo?.destroy();
    this.cameo = undefined;
    if (this.phase) this.buildBoss();
    else
      for (let i = 0; i < this.enemyCap; i++)
        this.spawnEnemy(this.cur.ox + (beat.layout === 'device' ? 330 + i * 190 : 790 + i * 330), 570);
    if (!this.phase && beat.hazard && this.chapter >= 2)
      this.cameo = new Formula(this, this.cur.ox + 1030, 230, '𝑥', 56, '#aab1b5').setDepth(4);
    if (chapterCard) {
      const region = REGIONS[this.cur.region];
      this.args.emit({ type: 'chapter', chapter: this.chapter, title: region.title, knowledge: region.knowledge });
    } else this.args.emit({ type: 'toast', text: beat.name, sub: beat.intro ?? beat.objective });
  }

  /** Crossing into the next zone makes it the checkpoint. The way back closes behind the player. */
  private advanceTo(live: LiveZone): void {
    const newRegion = live.region !== this.cur.region;
    this.cur = live;
    this.save.region = live.region;
    this.save.zone = live.index;
    this.save.known = [...this.known];
    this.save.furthest = Math.max(this.save.furthest, live.region);
    this.commitSave();
    this.barrier.x = live.ox - 10;
    this.movePlatform(this.barrier, live.ox - 10, this.barrier.rect.y);
    for (const enemy of [...this.enemies]) {
      this.dust.burst(enemy.rect.x, enemy.rect.y, INK, 10, 80);
      this.removeEnemy(enemy);
    }
    for (const token of [...this.tokens]) if (token.state !== 'held' && token.x < live.ox) this.discardToken(token);
    this.theftWarned = false;
    this.activate(newRegion);
    this.loadAhead();
  }

  /** The next boss phase rebuilds the arena in place. */
  private nextPhase(): void {
    const order = zoneOrder(this.cur.region, this.cur.index),
      next = ALL_ZONES[order + 1];
    const old = this.cur;
    this.unloadZone(old);
    this.cur = this.buildZone(next.region, next.index);
    this.save.region = next.region;
    this.save.zone = next.index;
    this.save.known = [...this.known];
    this.commitSave();
    this.transition = false;
    this.bolts.forEach((b) => b.glyph.destroy());
    this.bolts = [];
    this.activate(false);
  }

  private zonePlatform(
    live: LiveZone,
    x: number,
    y: number,
    width: number,
    height: number,
    hidden?: boolean,
  ): Platform {
    const p = this.addPlatform(live.ox + x, y, width, height, hidden);
    p.x = p.baseX = x;
    live.platforms.push(p);
    return p;
  }
  private addPlatform(x: number, y: number, width: number, height: number, hidden?: boolean): Platform {
    const rect = this.add.rectangle(x, y, width, height, 0x161b1e, 0.96);
    this.ground.add(rect);
    const platform: Platform = {
      rect,
      body: rect.body as Phaser.Physics.Arcade.StaticBody,
      width,
      height,
      x,
      y,
      baseX: x,
      baseY: y,
      hidden,
    };
    this.platforms.push(platform);
    this.byRect.set(rect, platform);
    return platform;
  }
  private removePlatform(platform: Platform): void {
    this.byRect.delete(platform.rect);
    platform.rect.destroy();
    this.platforms = this.platforms.filter((p) => p !== platform);
    if (this.standing === platform) this.standing = undefined;
  }
  /** Moves a kinematic platform (world coordinates) and carries whoever stands on it. */
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

  private spawnToken(source: string, x: number, y: number): Token {
    const token = new Token(this, source, x, y);
    token.ground = this.physics.add.collider(token.collider, this.ground);
    this.tokens.push(token);
    return token;
  }
  private discardToken(token: Token): void {
    this.tweens.killTweensOf(token.collider);
    token.destroy();
    this.tokens = this.tokens.filter((t) => t !== token);
    if (this.held === token) this.held = null;
  }
  private spawnEnemy(x: number, y: number): void {
    const index = this.spawned++,
      region = REGIONS[this.cur.region];
    // The first Falsehood of each kind is always the same, so it can be learned.
    const firstZone = ALL_ZONES.find((z) => z.zone.beat.enemies && REGIONS[z.region].lie === region.lie)?.zone;
    const roll = Math.random();
    const lie = makeLie(region.lie, Math.random, {
      first: index === 0 && firstZone === this.cur.zone,
      size: roll < region.huge ? 'huge' : roll < region.huge + region.large ? 'large' : 'small',
    });
    const label = text(this, x, y, lieText(lie), LIE_SIZE[sizeOf(lie)], '#efb7a4').setDepth(9);
    const rect = this.add.rectangle(x, y, label.width + 8, 38, 0xffffff, 0);
    this.physics.add.existing(rect);
    const body = rect.body as Phaser.Physics.Arcade.Body;
    body.setGravityY(1100).setBounce(0.1, 0).setMaxVelocity(650, 1000);
    const choices = this.beat.enemyTokens ?? ['1'];
    const enemy: Enemy = {
      rect,
      body,
      label,
      lie,
      time: index,
      stun: 0,
      resolved: 0,
      token: choices[index % choices.length],
      colliders: [],
    };
    enemy.colliders.push(
      this.physics.add.collider(rect, this.ground),
      this.physics.add.overlap(this.player, rect, () => {
        if (enemy.stun <= 0 && !enemy.resolved) this.damage(enemy.rect.x);
      }),
    );
    this.enemies.push(enemy);
  }
  private removeEnemy(enemy: Enemy): void {
    enemy.colliders.forEach((c) => c.destroy());
    enemy.label.destroy();
    enemy.rect.destroy();
    this.enemies = this.enemies.filter((e) => e !== enemy);
  }

  /** Falsehoods a zone holds at once: one fewer than its beat lists, but never none, since their drops can be needed. */
  private get enemyCap(): number {
    const n = this.beat.enemies ?? 0;
    return n > 1 ? n - 1 : n;
  }
  /** Until the zone is solved, fallen enemies are replaced from whichever side the player is not on. */
  private reinforce(dt: number): void {
    if (this.phase || this.cur.solved || this.transition || this.enemies.length >= this.enemyCap) return;
    this.reinforceTimer -= dt;
    if (this.reinforceTimer > 0) return;
    this.reinforceTimer = REINFORCE_DELAY;
    const x = this.cur.ox + (this.player.x < this.cur.ox + 475 ? 880 : 70);
    this.spawnEnemy(x, 540);
    this.dust.burst(x, 540, HAZARD, 18, 120);
  }

  private get core(): { x: number; y: number } {
    return { x: this.cur.ox + this.cur.core.x, y: this.cur.core.y };
  }
  private buildBoss(): void {
    const core = this.core,
      size = this.chapter === 6 ? 44 : 65;
    const formula = new Formula(this, 0, core.y - 5, this.phase!.component, size).setDepth(8);
    formula.setScale(Math.min(1, 560 / formula.getBounds().width));
    formula.x += core.x - formula.getBounds().centerX;
    const label = text(this, core.x + 25, core.y + 88, this.phase!.attack, 10, '#a4adb3', false).setLetterSpacing(4);
    this.cur.boss = { formula, label };
    this.args.audio.play('boss');
  }

  // ---------- Input ----------

  private aim(): number {
    const pointer = this.input.activePointer;
    const point = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    return Phaser.Math.Angle.Between(this.player.x, this.player.y - 10, point.x, point.y);
  }
  private nearbyRack(): Rack | undefined {
    const pointer = this.input.activePointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const near = this.cur.racks.filter(
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
        this.teach('place');
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
      this.teach('take');
      return;
    }
    const rack = this.nearbyRack();
    if (rack) {
      this.held = this.spawnToken(rack.take(), this.player.x, this.player.y);
      this.held.hold();
      this.args.audio.play('grab');
      this.teach('take');
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
      this.teach('throw');
    } else {
      if (this.attack > 0) return;
      this.attack = 0.28;
      this.handling = 0.3;
      this.args.audio.play('hit');
      this.dust.burst(this.player.x + this.facing * 45, this.player.y - 5, this.character.color, 5, 70);
      for (const enemy of [...this.enemies])
        if (
          Math.abs(enemy.rect.y - this.player.y) < 70 &&
          (enemy.rect.x - this.player.x) * this.facing > -10 &&
          (enemy.rect.x - this.player.x) * this.facing < 98
        )
          this.knock(enemy, this.facing * (this.character.id === 'red' ? 600 : 400));
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

  // ---------- Rails ----------

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
    if (!this.phase && this.cur.solved) return;
    this.teach('evaluate');
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
    const learned = this.learn();
    if (this.phase) this.performCounter();
    else {
      this.materialize(true);
      this.solveZone(learned);
    }
  }

  private onDeviceSuccess(): void {
    this.rail.solved = true;
    const learned = this.learn();
    if (this.phase) this.performCounter(this.device!.origin());
    else this.solveZone(learned);
  }

  /** A working rail's tokens become known, so racks ahead offer them. */
  private learn(): string[] {
    const before = this.maxFocus,
      fresh = [...this.rail.values, ...this.beat.rail.solution, this.beat.law].filter(
        (t): t is string => Boolean(t) && !this.known.has(t!),
      );
    fresh.forEach((t) => this.known.add(t));
    if (!fresh.length) return fresh;
    this.focus += this.maxFocus - before;
    this.zones.filter((z) => !z.solved && z !== this.cur).forEach((z) => this.makeRacks(z));
    return [...new Set(fresh)];
  }
  /** The zone's gate opens. */
  private solveZone(learned: string[] = []): void {
    this.cur.solved = true;
    if (this.phase) return;
    this.args.emit({
      type: 'toast',
      text: this.rail.display(),
      sub: learned.length ? `Learned:  ${learned.map(notation).join('   ·   ')}` : 'Now use what you made.',
      learned: learned.length > 0,
    });
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
    const live = this.cur;
    if (live.bridge) {
      live.platforms = live.platforms.filter((p) => p !== live.bridge);
      this.removePlatform(live.bridge);
    }
    const width = matched
      ? 610
      : 610 * Phaser.Math.Clamp(this.effectMagnitude / (this.beat.rail.target ?? 1), 0.08, 1.7);
    const bridge = (live.bridge = this.zonePlatform(live, 940 + width / 2, 546, width, 12));
    if (!matched) return;
    bridge.rect.setAlpha(0);
    this.tweens.add({ targets: bridge.rect, alpha: 1, duration: 450 });
    this.dust.burst(bridge.rect.x, bridge.rect.y, INK, 10, 80);
    if (!this.args.settings.reducedMotion) this.cameras.main.shake(120, 0.002);
  }

  // ---------- The Unknown ----------

  private performCounter(from?: { x: number; y: number }): void {
    this.counterLock = 2.7;
    const start = from
        ? new Phaser.Math.Vector2(this.cur.ox + from.x, from.y)
        : new Phaser.Math.Vector2(this.rail.x, this.rail.y - 35),
      end = new Phaser.Math.Vector2(this.core.x, this.core.y);
    const via = new Phaser.Math.Vector2((start.x + end.x) / 2 - 60, Math.min(start.y, end.y) - 60);
    const glyph = new Formula(this, start.x, start.y, this.rail.result.display, 34, this.character.hex).setDepth(25);
    this.pulses.push({ start, end, via, age: 0, duration: 1.1, glyph, trail: [], boss: true });
  }

  private bossHit(): void {
    if (this.transition || !this.phase) return;
    const core = this.core,
      formula = this.cur.boss?.formula;
    this.hitCount++;
    this.bossStun = Math.max(this.bossStun, 1.4);
    this.dust.burst(core.x, core.y, this.character.color, 65, 250);
    this.args.audio.play('hit');
    if (!this.args.settings.reducedMotion) this.cameras.main.shake(200, 0.004);
    formula?.setAlpha(0.2);
    this.tweens.add({ targets: formula, alpha: 1, duration: 400 });
    if (this.hitCount < this.phase.hits) {
      this.rail.status.setText('Counter landed. Shape the next one.');
      this.args.emit({
        type: 'toast',
        text: `${this.hitCount} / ${this.phase.hits}`,
        sub: 'The expression is coming apart.',
      });
      if (this.device)
        this.time.delayedCall(600, () => {
          this.device?.reset();
          this.cur.deviceHandled = false;
        });
      return;
    }
    this.bolts.forEach((b) => b.glyph.destroy());
    this.bolts = [];
    this.warnings.forEach((w) => w.glyph.destroy());
    this.warnings = [];
    this.transition = true;
    const order = zoneOrder(this.cur.region, this.cur.index),
      next = ALL_ZONES[order + 1];
    if (!next) {
      this.finishCampaign();
      return;
    }
    this.args.emit({ type: 'toast', text: this.phase.name, sub: 'Term removed.' });
    ['+', '−', '1', '(', ')', '𝑥'].forEach((piece, i) => {
      const glyph = new Formula(this, core.x, core.y, piece, 27).setDepth(25);
      this.tweens.add({
        targets: glyph,
        x: core.x + Math.cos(i) * 280,
        y: core.y + Math.sin(i) * 200,
        rotation: i,
        alpha: 0,
        duration: 1100,
        onComplete: () => glyph.destroy(),
      });
    });
    const live = this.cur;
    this.time.delayedCall(1800, () => {
      if (this.cur !== live) return;
      if (next.zone.x[0] === live.zone.x[0]) this.nextPhase();
      else {
        // The duel is over: the arena opens onto the next region.
        this.transition = false;
        live.boss?.formula.destroy();
        live.boss?.label.destroy();
        live.boss = undefined;
        this.solveZone();
      }
    });
  }

  /** The Unknown collapses into the value it always had. */
  private finishCampaign(): void {
    const core = this.core;
    this.save.complete = true;
    this.commitSave();
    this.args.audio.play('unlock');
    this.cur.boss?.label.destroy();
    this.tweens.add({ targets: this.cur.boss?.formula, alpha: 0, scale: 0.3, duration: 1200, ease: 'Cubic.easeIn' });
    const square = text(this, core.x - 100, core.y, '(𝑥 − 1)² = 0', 54)
      .setDepth(40)
      .setAlpha(0);
    this.tweens.add({ targets: square, alpha: 1, duration: 900, delay: 900, hold: 1600, yoyo: true });
    this.time.delayedCall(4200, () => {
      const one = text(this, core.x - 100, core.y, '𝑥 = 1', 96, this.character.hex)
        .setDepth(40)
        .setAlpha(0);
      this.tweens.add({ targets: one, alpha: 1, duration: 1200 });
      this.dust.burst(core.x - 100, core.y, this.character.color, 130, 350);
      this.args.emit({ type: 'toast', text: '𝑥 = 1', sub: 'It began with one.' });
    });
    // The page lets go the way it took hold: in white. The epilogue fades in from it.
    this.time.delayedCall(7600, () => {
      const camera = this.cameras.main;
      camera.fade(1100, 250, 251, 255);
      camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
        queueMicrotask(() => this.args.emit({ type: 'complete', elapsed: this.save.elapsed })),
      );
    });
  }

  private stealOperator(): void {
    const slots = this.rail.values.flatMap((v, i) => (v && isOperator(v) ? [i] : []));
    if (!slots.length) return;
    const slot = Phaser.Utils.Array.GetRandom(slots),
      source = this.rail.remove(slot)!;
    const x = this.rail.x + this.rail.slotPositions[slot],
      y = this.rail.y - 50,
      ox = this.cur.ox;
    const token = this.spawnToken(source, x, y);
    token.home = [
      Phaser.Math.Clamp(x + (Math.random() < 0.5 ? -1 : 1) * 260, ox + 60, ox + (this.phase ? 1220 : 900)),
      560,
    ];
    token.release(x, y, (token.home[0] - x) * 1.3, -380);
    this.dust.burst(x, this.rail.y, HAZARD, 14, 110);
    this.args.audio.play('wrong');
    if (!this.theftWarned) {
      this.theftWarned = true;
      this.args.emit({ type: 'toast', text: '𝑥 took your operator.', sub: 'Carry it back.' });
    }
  }

  /** Strikes push a Falsehood back; only the truth gets rid of it. */
  private knock(enemy: Enemy, force: number): void {
    enemy.stun = 0.8;
    enemy.body.setVelocity(force, -230);
    this.dust.burst(enemy.rect.x, enemy.rect.y, INK, 12, 100);
  }
  /** A thrown number adds a term toward true; a thrown ÷ halves how wrong it is. Anything else bounces off. */
  private throwAt(enemy: Enemy, token: Token): void {
    const value = evaluate(token.source).value;
    const thrown: Thrown | null =
      token.source === '/'
        ? { kind: 'halve' }
        : value && !isOperator(token.source)
          ? { kind: 'number', value: value.num }
          : null;
    if (!thrown || !repair(enemy.lie, thrown)) {
      token.body.setVelocity(-token.body.velocity.x * 0.35, -220);
      this.args.audio.play('wrong');
      return;
    }
    this.knock(enemy, token.body.velocity.x * 0.4);
    enemy.label.setText(lieText(enemy.lie)).setFontSize(LIE_SIZE[sizeOf(enemy.lie)]);
    enemy.rect.setSize(enemy.label.width + 8, 38);
    enemy.body.setSize(enemy.label.width + 8, 38);
    this.args.audio.play('hit');
    // Authored and stocked tokens are the only copies, so they go home instead of being used up.
    if (token.home) token.release(...token.home);
    else this.discardToken(token);
    if (isTrue(enemy.lie)) {
      enemy.resolved = 0.7;
      enemy.label.setColor(this.character.hex);
      this.args.audio.play('solve');
      this.teach('repair');
    }
  }
  /** A repaired Falsehood dissolves and leaves its token behind. */
  private dissolve(enemy: Enemy): void {
    this.dust.burst(enemy.rect.x, enemy.rect.y, this.character.color, 30, 160);
    this.spawnToken(enemy.token, enemy.rect.x, Math.min(enemy.rect.y, 580)).body.setVelocity(0, -200);
    this.removeEnemy(enemy);
  }
  private damage(fromX: number, cost = HIT_COST): void {
    if (this.invulnerable > 0 || this.dying || this.transition) return;
    this.focus = Math.max(0, this.focus - cost);
    this.invulnerable = 1.5;
    this.vx = this.player.x < fromX ? -270 : 270;
    this.vy = -250;
    this.dust.burst(this.player.x, this.player.y, this.character.color, 20, 170);
    this.args.audio.play('damage');
    if (!this.args.settings.reducedMotion) this.cameras.main.shake(130, 0.003);
    if (this.focus <= 0) this.die();
  }
  private die(): void {
    if (this.dying) return;
    this.dying = true;
    this.focus = 0;
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
    this.args.emit({ type: 'save', save: { ...this.save, known: [...this.save.known] } });
  }

  // ---------- Hazards ----------

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
    if (this.beat.theft && !this.cur.solved && Math.random() < 0.6) this.stealOperator();
    if (kind === 'charge') return;
    const boss = Boolean(this.phase),
      x = boss ? this.core.x + 10 : (this.cameo?.x ?? this.player.x + 560),
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
      if (boss && this.chapter === 6)
        for (let i = 0; i < 3; i++) this.warn(kind, x, y + i * 65, this.player.x, 420 + i * 65, 1.2 + i * 0.2);
    }
    this.args.audio.tone(100, 0.35, 'sine', 0.07, 70);
  }

  private updateProjectiles(dt: number): void {
    for (const warning of [...this.warnings]) {
      warning.timer -= dt;
      if (warning.timer <= 0) {
        const angle = Phaser.Math.Angle.Between(warning.x, warning.y, warning.tx, warning.ty);
        const speed = 245 + this.chapter * 20;
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
    const view = this.cameras.main.worldView;
    for (const bolt of [...this.bolts]) {
      bolt.age += dt;
      bolt.x += bolt.vx * dt;
      bolt.y += bolt.vy * dt;
      if (bolt.kind === 'waves') bolt.y += Math.cos(bolt.age * 5 + bolt.wave) * 95 * dt;
      bolt.glyph.setPosition(bolt.x, bolt.y);
      if (bolt.friendly) bolt.glyph.setAlpha(0.55);
      if (!bolt.friendly && Phaser.Math.Distance.Between(bolt.x, bolt.y, this.player.x, this.player.y) < 31) {
        this.damage(bolt.x, PROJECTILE_COST);
        bolt.age = 10;
      }
      if (bolt.age > 8 || bolt.x < view.x - 300 || bolt.x > view.right + 300 || bolt.y > 900 || bolt.y < -300) {
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

  // ---------- Frame ----------

  update(_time: number, delta: number): void {
    if (!this.playerBody) return;
    const dt = Math.min(delta / 1000, 0.035);
    this.clock += dt;
    this.save.elapsed += dt;
    this.pauseDebounce = Math.max(0, this.pauseDebounce - dt);
    const combat =
      Boolean(this.phase || ((this.beat.enemies || this.beat.hazard) && !this.cur.solved) || this.enemies.length) &&
      !this.transition;
    const manipulating = Boolean(this.held) || this.editTimer > 0;
    const slow = combat && manipulating && this.focus > 0;
    const scale = slow ? 0.35 : 1;
    const worldDt = dt * scale;
    this.worldClock += worldDt;
    if (slow) this.focus = Math.max(0, this.focus - dt * FOCUS_DRAIN);
    else if (!manipulating) this.focus = Math.min(this.maxFocus, this.focus + dt * FOCUS_REGEN);
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
    for (const live of this.zones) {
      live.device?.update(worldDt);
      if (live.device?.state === 'success' && !live.deviceHandled && live === this.cur) {
        live.deviceHandled = true;
        this.onDeviceSuccess();
      }
      if (live.solved && live.gate.y > GATE_TOP - 300) {
        const y = live.gate.y - 240 * dt;
        live.gate.y = y;
        this.movePlatform(live.gate, live.ox + live.gate.x, y);
      }
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
        const speed = { small: 80, large: 62, huge: 48 }[sizeOf(enemy.lie)];
        enemy.body.setVelocityX(enemy.resolved ? 0 : hasFloor ? direction * speed : -direction * 50);
        if (enemy.body.blocked.down && Math.sin(enemy.time * 2) > 0.985) enemy.body.setVelocityY(-300);
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
        const struck = this.enemies.find(
          (e) =>
            !e.resolved &&
            !token.hit.has(e) &&
            Math.abs(token.body.center.x - e.body.center.x) < e.body.halfWidth + 14 &&
            Math.abs(token.body.center.y - e.body.center.y) < 34,
        );
        if (struck) {
          token.hit.add(struck);
          this.throwAt(struck, token);
          if (!this.tokens.includes(token)) return;
        }
        if (token.body.speed < 45 && token.age > 0.5) token.state = 'loose';
      }
    });
    const view = this.cameras.main.worldView;
    for (const token of [...this.tokens])
      if (
        token.state !== 'held' &&
        (token.body.center.y > 820 ||
          (!token.home && token.age > 40) ||
          token.x < this.cur.ox - 80 ||
          token.x > view.right + 1500)
      ) {
        if (token.home && token.home[0] >= this.cur.ox) {
          token.release(...token.home);
          if (this.cur.region === 0 && this.cur.index === 0 && token.source === '1') token.body.setGravityY(0);
        } else this.discardToken(token);
      }
    if (this.tokens.length > 35) {
      const loose = this.tokens.find((t) => t.state === 'loose' && !t.home);
      if (loose) this.discardToken(loose);
    }
    this.enemies.forEach((e) => {
      e.label.setPosition(e.body.center.x, e.body.center.y).setRotation(Math.sin(e.time * 2) * 0.06);
    });
    for (const enemy of [...this.enemies])
      if (enemy.resolved && (enemy.resolved -= dt) <= 0) this.dissolve(enemy);
      else if (enemy.rect.y > 850) this.removeEnemy(enemy);
    if (combat && this.introSafe <= 0 && this.bossStun <= 0) {
      this.attackTimer -= worldDt;
      if (this.attackTimer <= 0) {
        this.attackPattern();
        this.attackTimer = this.phase
          ? Math.max(2.1, 4.2 - this.chapter * 0.34)
          : Math.max(3.2, 4.6 - this.chapter * 0.2);
      }
    }
    this.reinforce(worldDt);
    this.updateProjectiles(worldDt);
    if (this.playerBody.center.y > 830 && !this.dying) this.die();
    const next = this.zones.find((z) => z.ox === this.cur.zone.x[1]);
    if (next && this.cur.solved && !this.transition && this.playerBody.left > next.ox + 20) this.advanceTo(next);
    this.updateCamera(dt);
    this.drawWorld(dt, slow);
    this.dust.update(worldDt);
    this.args.audio.update(worldDt, this.chapter, combat);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.updateHud();
      this.hudTimer = 0.1;
    }
  }

  /**
   * The camera never shows what lies behind the checkpoint once it has scrolled past it, and holds still on a
   * duel's arena. Zones behind the view are unloaded.
   */
  private updateCamera(dt: number): void {
    const camera = this.cameras.main,
      live = this.cur;
    const arena = live.zone.duel && !live.solved;
    if (arena) this.leftBound = Math.min(live.ox, this.leftBound + Math.max(4, (live.ox - this.leftBound) * 4 * dt));
    else this.leftBound = Math.max(this.leftBound, Math.min(live.ox, camera.scrollX));
    const right = arena ? live.zone.x[1] : Math.max(...this.zones.map((z) => z.zone.x[1]));
    camera.setBounds(this.leftBound, -70, Math.max(1280, right - this.leftBound), 820);
    for (const z of [...this.zones]) if (z !== live && z.zone.x[1] <= this.leftBound) this.unloadZone(z);
    this.grid.setTilePosition(camera.scrollX, camera.scrollY);
  }

  /** Straight ramps (the Pythagoras plank) carry the player along their slope. */
  private applyRamps(): void {
    this.onRamp = false;
    if (this.vy < 0) return;
    const x = this.playerBody.center.x,
      bottom = this.playerBody.bottom;
    for (const r of this.zones.flatMap((z) => z.ramps)) {
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
      if (direction) {
        this.facing = direction;
        this.moving += dt;
        if (this.moving > 1) {
          this.moving = 0;
          this.teach('move');
        }
      }
      if (this.jumpBuffer > 0 && this.coyote > 0) {
        this.vy = -560 * this.character.jump;
        this.coyote = 0;
        this.jumpBuffer = 0;
        this.standing = undefined;
        this.onRamp = false;
        this.args.audio.play('jump');
        this.teach('jump');
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
  }

  private drawWorld(dt: number, slow: boolean): void {
    const g = this.geometry.clear(),
      overlay = this.overlay.clear(),
      fg = this.figures.clear(),
      view = this.cameras.main.worldView;
    this.platforms.forEach((p) => {
      if (p.hidden) return;
      g.lineStyle(p.height > 15 ? 1.2 : 1.7, INK, p.rect.alpha * 0.6).lineBetween(
        p.rect.x - p.width / 2,
        p.rect.y - p.height / 2,
        p.rect.x + p.width / 2,
        p.rect.y - p.height / 2,
      );
    });
    for (const live of this.zones) {
      const gate = live.gate,
        top = gate.rect.y - gate.height / 2,
        bottom = gate.rect.y + gate.height / 2,
        x = gate.rect.x;
      if (bottom > view.y) {
        g.lineStyle(2, INK, 0.7).strokeRect(x - 15, top, 30, gate.height);
        for (let y = Math.max(top, view.y - 45); y < bottom - 30; y += 45)
          g.lineStyle(1, INK, 0.2).lineBetween(x - 15, y, x + 15, y + 30);
      }
      if (!live.solved && live.zone.beat.layout === 'gap') {
        // Dashed tiles show how long the bridge must be.
        const tiles = live.zone.beat.rail.target ?? 1,
          w = 610 / tiles,
          ox = live.ox;
        g.lineStyle(1, INK, 0.35);
        for (let i = 0; i < tiles; i++)
          for (let x = 944 + i * w; x < 936 + (i + 1) * w; x += 20)
            g.lineBetween(ox + x, 540, ox + Math.min(x + 10, 936 + (i + 1) * w), 540).lineBetween(
              ox + x,
              552,
              ox + Math.min(x + 10, 936 + (i + 1) * w),
              552,
            );
        for (let i = 0; i <= tiles; i++) g.lineBetween(ox + 940 + i * w, 540, ox + 940 + i * w, 552);
      }
      for (const r of live.ramps) g.lineStyle(7, this.character.color, 0.8).lineBetween(r.x1, r.y1, r.x2, r.y2);
      if (live.device) live.device.draw(live.sketch.clear());
    }
    if (this.beat.hazard === 'waves') {
      g.lineStyle(1, INK, 0.22).beginPath();
      for (let x = Math.floor(view.x / 8) * 8; x <= view.right + 8; x += 8) {
        const y = 380 + Math.sin(x / 125 + this.worldClock) * 70;
        if (x <= view.x) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
    }
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
    const boss = this.cur.boss;
    if (this.phase && boss && !(this.transition && this.save.complete)) {
      const core = this.core;
      boss.formula.y = core.y - 5 + Math.sin(this.worldClock * 1.5) * (this.bossStun > 0 ? 2 : 12);
      const radius = 123,
        angle = this.worldClock * 0.5;
      for (let i = 0; i < this.phase.hits; i++) {
        const theta = angle + (i / this.phase.hits) * Math.PI * 2;
        g.lineStyle(2, i < this.hitCount ? this.character.color : INK, i < this.hitCount ? 0.12 : 0.5)
          .beginPath()
          .arc(core.x + 10, core.y - 2, radius + i * 10, theta, theta + 0.9)
          .strokePath();
      }
      if (this.chapter === 6) {
        const shrink = this.bossStun > 0 ? 0.75 : 1;
        for (let arm = 0; arm < 6; arm++) {
          const base = (arm * Math.PI) / 3 + this.worldClock * 0.07;
          let lastX = core.x + 10,
            lastY = core.y - 2;
          for (let node = 1; node <= 5; node++) {
            const a = base + Math.sin(this.worldClock * 0.7 + node * 0.6) * 0.22;
            const x = core.x + 10 + Math.cos(a) * node * 43 * shrink,
              y = core.y - 2 + Math.sin(a) * node * 43 * shrink;
            g.lineStyle(1.2, INK, 0.15 + node * 0.025).lineBetween(lastX, lastY, x, y);
            g.fillStyle(INK, 0.3).fillCircle(x, y, node === 5 ? 4 : 2);
            lastX = x;
            lastY = y;
          }
        }
      }
    }
    if (this.cameo) {
      this.cameo.x = Math.min(this.cur.zone.x[1] - 100, view.x + 1060);
      this.cameo.y = 230 + Math.sin(this.worldClock * 0.8) * 25;
      this.cameo.setAlpha(this.cur.solved ? 0.25 : 0.65);
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
    for (const live of this.zones)
      live.rail.draw(
        this.clock,
        live === this.cur && nearby,
        live === this.cur ? (this.held?.source ?? null) : null,
        this.character.id === 'yellow',
      );
    const rack = this.nearbyRack(),
      // Until a few are repaired, a Falsehood in play explains itself.
      lies: [string, string][] = this.enemies.some((e) => !e.resolved)
        ? [['repair', 'Throw numbers at Falsehoods to make them true']]
        : [];
    this.hint.setText(
      nearby
        ? this.hintFor(
            this.held
              ? [
                  ['place', 'E  place / swap'],
                  ['place', 'Aim at a slot to choose it'],
                  ['evaluate', 'F  evaluate'],
                ]
              : [
                  ['take', 'E  take a symbol'],
                  ['evaluate', 'F  evaluate'],
                ],
          )
        : rack
          ? this.hintFor([
              ['take', `E  take ${notation(rack.source)}`],
              [null, 'Scroll / Q  choose symbol'],
              [null, `${rack.index + 1} / ${rack.choices.length}`],
            ])
          : this.held
            ? this.hintFor([['take', 'E  drop'], ['throw', 'Aim + click  throw'], ...lies])
            : this.hintFor([['move', 'A D  move'], ['jump', 'Space  jump'], ['take', 'E  pick up'], ...lies]),
    );
  }

  private updateHud(): void {
    const steps = REGIONS[this.cur.region].zones;
    this.args.emit({
      type: 'hud',
      focus: this.focus,
      maxFocus: this.maxFocus,
      objective: this.cur.solved ? 'Go on through the open gate.' : this.beat.objective,
      chapter: this.chapter,
      title: this.cur.zone.title,
      phase: `${this.cur.index + 1} / ${steps.length}`,
      progress: zoneOrder(this.cur.region, this.cur.index) / ZONE_COUNT,
    });
  }
}
