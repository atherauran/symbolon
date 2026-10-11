/**
 * The recording autopilot. record.mjs loads it into the running game through Vite, so it shares the game's own
 * modules. Nothing can hurt the player; otherwise it plays like a person, with mouse and keyboard input only and a
 * drawn cursor: it carries symbols or throws them into slots, repairs Falsehoods for the symbols they hold, swats
 * at them, runs and jumps.
 */
import { World } from '../../src/game/World';
import { Prologue } from '../../src/game/Prologue';
import { AudioEngine } from '../../src/game/audio';
import { compatible, type Rack, type Rail } from '../../src/game/objects';
import { isOperator } from '../../src/math/evaluate';
import { GY, vibration } from '../../src/physics/model';
import { CHARACTERS, type CharacterId } from '../../src/game/types';
import type { Lie } from '../../src/rules/lies';

interface Config {
  pen: CharacterId;
  /** Start from the saved checkpoint instead of a new journey. */
  resume: boolean;
  /** Stop on reaching this zone, as "region.zone". */
  until: string | null;
  audio: boolean;
}
interface Point {
  x: number;
  y: number;
}
type Co<T = void> = Generator<void, T, void>;
type Live = World['cur'];
type Token = World['tokens'][number];
type Foe = World['enemies'][number];
type Platform = World['platforms'][number];
/** Game internals the autopilot reads or patches; TypeScript privacy is compile-time only. */
type Internals = { [key: string]: any };

declare global {
  interface Window {
    __clock: { now: number; step(ms: number): void };
    __frame(ms: number, render: boolean): { events: InputEvent[]; done: boolean; where: string };
    __soundtrack(index: number): Promise<string | null>;
  }
}

const DT = 1 / 60;
const GRAVITY = 1450;
const RUN = 295;
const JUMP = 560;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const chance = (p: number) => Math.random() < p;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const log = (...parts: unknown[]) => console.log('[bot]', ...parts);

// ---------- Input ----------

type Key = 'a' | 'd' | 'space' | 'e' | 'f' | 'q' | 'r';
const KEYS: Record<Key, [string, string, number]> = {
  a: ['a', 'KeyA', 65],
  d: ['d', 'KeyD', 68],
  space: [' ', 'Space', 32],
  e: ['e', 'KeyE', 69],
  f: ['f', 'KeyF', 70],
  q: ['q', 'KeyQ', 81],
  r: ['r', 'KeyR', 82],
};
export type InputEvent =
  | { kind: 'key'; type: 'keyDown' | 'keyUp'; key: string; code: string; keyCode: number }
  | {
      kind: 'mouse';
      type: 'mouseMoved' | 'mousePressed' | 'mouseReleased' | 'mouseWheel';
      x: number;
      y: number;
      button?: 'left' | 'none';
      held?: boolean;
      deltaY?: number;
    };
let events: InputEvent[] = [];
/** Keys and the frames left to hold them; Infinity while held. */
const down = new Map<Key, number>();
const sent = new Set<Key>();
function hold(key: Key, on = true): void {
  if (on) down.set(key, Infinity);
  else down.delete(key);
}
function tap(key: Key): void {
  down.set(key, Math.round(rand(4, 7)));
}
function steer(direction: number): void {
  hold('d', direction > 0);
  hold('a', direction < 0);
}
function releaseAll(): void {
  down.clear();
}
function flushKeys(): void {
  for (const key of Object.keys(KEYS) as Key[]) {
    const left = down.get(key) ?? 0,
      want = left > 0;
    if (want !== sent.has(key)) {
      const [name, code, keyCode] = KEYS[key];
      events.push({ kind: 'key', type: want ? 'keyDown' : 'keyUp', key: name, code, keyCode });
      if (want) sent.add(key);
      else sent.delete(key);
    }
    if (left > 0 && left !== Infinity) down.set(key, left - 1);
    else if (!want) down.delete(key);
  }
}

/**
 * The cursor follows a damped spring toward its target, bending slightly on long moves the way a wrist arcs.
 * A target is a function, so it can track a point in the world while the camera scrolls.
 */
const cursor = { x: 1010, y: 330, vx: 0, vy: 0, pressed: 0 };
let target: (() => Point) | null = null;
let snappy = false;
let rest: Point = { x: 1010, y: 330 };
let lastGoal: Point = { ...rest };
let bend = { x: 0, y: 0, from: 1 };
let pointer: HTMLDivElement;
function aimScreen(point: () => Point, fast = false): void {
  target = point;
  snappy = fast;
}
function aimWorld(point: () => Point, fast = false): void {
  aimScreen(() => screenOf(point()), fast);
}
function letGo(): void {
  if (target) rest = { x: cursor.x, y: cursor.y };
  target = null;
  snappy = false;
}
function settled(tolerance = 4): boolean {
  const goal = target?.() ?? rest;
  return Math.hypot(goal.x - cursor.x, goal.y - cursor.y) < tolerance && Math.hypot(cursor.vx, cursor.vy) < 90;
}
function click(): void {
  events.push({ kind: 'mouse', type: 'mousePressed', x: cursor.x, y: cursor.y, button: 'left', held: true });
  cursor.pressed = Math.round(rand(4, 7));
}
function wheel(deltaY: number): void {
  events.push({ kind: 'mouse', type: 'mouseWheel', x: cursor.x, y: cursor.y, deltaY });
}
function moveCursor(): void {
  const goal = target?.() ?? rest;
  if (Math.hypot(goal.x - lastGoal.x, goal.y - lastGoal.y) > 60) {
    const d = Math.hypot(goal.x - cursor.x, goal.y - cursor.y) || 1,
      s = rand(-0.16, 0.16) * d;
    bend = { x: (-(goal.y - cursor.y) / d) * s, y: ((goal.x - cursor.x) / d) * s, from: d };
  }
  lastGoal = goal;
  const remaining = Math.min(1, Math.hypot(goal.x - cursor.x, goal.y - cursor.y) / bend.from);
  const tx = goal.x + bend.x * remaining,
    ty = goal.y + bend.y * remaining;
  const w = snappy ? 18 : 10,
    z = 0.88;
  const x0 = cursor.x,
    y0 = cursor.y;
  cursor.vx += (w * w * (tx - cursor.x) - 2 * z * w * cursor.vx) * DT;
  cursor.vy += (w * w * (ty - cursor.y) - 2 * z * w * cursor.vy) * DT;
  cursor.x = clamp(cursor.x + cursor.vx * DT, 1, 1279);
  cursor.y = clamp(cursor.y + cursor.vy * DT, 1, 719);
  if (Math.hypot(cursor.x - x0, cursor.y - y0) > 0.25)
    events.push({ kind: 'mouse', type: 'mouseMoved', x: cursor.x, y: cursor.y, held: cursor.pressed > 0 });
  if (cursor.pressed > 0 && --cursor.pressed === 0)
    events.push({ kind: 'mouse', type: 'mouseReleased', x: cursor.x, y: cursor.y, button: 'left' });
  pointer.style.transform = `translate(${cursor.x}px, ${cursor.y}px)`;
}
function makePointer(): void {
  pointer = document.createElement('div');
  pointer.innerHTML =
    '<svg width="20" height="28" viewBox="0 0 20 28"><path d="M1.5 1.5 L1.5 22.5 L6.6 17.8 L10.3 26.3 L13.7 24.8 L10 16.4 L17 16.4 Z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  Object.assign(pointer.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    zIndex: '2147483647',
    pointerEvents: 'none',
    filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.45))',
  });
  document.body.append(pointer);
}

// ---------- The game ----------

let world: World | undefined;
let generation = 0;
let prologue: Prologue | undefined;
const worldProto = World.prototype as unknown as Internals;
const create = worldProto.create;
worldProto.create = function (this: World, ...args: unknown[]) {
  world = this;
  generation++;
  return create.apply(this, args);
};
// Harmless: Falsehoods, 𝑥's symbols, spikes and charges no longer cost focus.
worldProto.damage = () => {};
const prologueProto = Prologue.prototype as unknown as Internals;
const createPrologue = prologueProto.create;
prologueProto.create = function (this: Prologue, ...args: unknown[]) {
  prologue = this;
  return createPrologue.apply(this, args);
};

const W = () => world!;
const live = (): Live => W().cur;
const ox = () => live().ox;
const internals = (o: object) => o as unknown as Internals;
const where = () => (world?.cur ? `${world.cur.region}.${world.cur.index}` : 'title');
function me() {
  const body = W().playerBody;
  return {
    x: body.center.x,
    y: body.center.y,
    bottom: body.bottom,
    grounded: body.blocked.down || internals(W()).onRamp,
    vx: W().vx,
    vy: W().vy,
    blockedLeft: body.blocked.left,
    blockedRight: body.blocked.right,
  };
}
function screenOf(p: Point): Point {
  const camera = world?.cameras?.main;
  if (!camera) return { x: cursor.x, y: cursor.y };
  return { x: (p.x - camera.scrollX - 640) * camera.zoom + 640, y: (p.y - camera.scrollY - 360) * camera.zoom + 360 };
}
function worldOf(p: Point): Point {
  const camera = W().cameras.main;
  return { x: (p.x - 640) / camera.zoom + 640 + camera.scrollX, y: (p.y - 360) / camera.zoom + 360 + camera.scrollY };
}
const character = () => CHARACTERS.find((c) => c.id === W().save.character)!;
/** Within the game's 215 px rail reach; a positive margin errs toward near, a negative one toward far. */
const nearRail = (margin = -12) => Math.hypot(W().player.x - W().rail.x, W().player.y - W().rail.y) < 215 + margin;
const top = (p: Platform) => p.rect.y - p.height / 2;
const visible = (selector: string) => document.querySelector<HTMLElement>(selector);
/**
 * The floor the autopilot may roam while working: the whole arena in a duel, otherwise the start ground and any
 * ground level with it, up to the first door or wall.
 */
function floor(): [number, number] {
  const left = ox() + 40;
  if (live().zone.duel) return [left, ox() + 1240];
  const platforms = W().platforms;
  let right = ox() + 950;
  for (;;) {
    const next = platforms.find(
      (p) =>
        p.width >= 100 &&
        Math.abs(top(p) - GY) < 2 &&
        p.rect.x - p.width / 2 <= right + 2 &&
        p.rect.x + p.width / 2 > right + 2,
    );
    if (!next) break;
    right = next.rect.x + next.width / 2;
  }
  for (const p of platforms)
    if (top(p) < GY - 41 && p.rect.y + p.height / 2 >= GY - 5 && p.rect.x > ox() + 100)
      right = Math.min(right, p.rect.x - p.width / 2);
  return [left, right - 35];
}
/** Spots to keep off: the launch pad fires as soon as it is armed. */
function safe(x: number): number {
  const [a, b] = floor();
  let v = clamp(x, a, b);
  if (live().zone.beat.device?.kind === 'launch' && !live().solved) v = Math.min(v, ox() + 830);
  return v;
}

// ---------- Coroutines ----------

let now = 0;
function* wait(seconds: number): Co {
  const end = now + seconds;
  while (now < end) yield;
}
function* until(test: () => boolean, timeout = 60): Co<boolean> {
  const end = now + timeout;
  while (!test()) {
    if (now >= end) return false;
    yield;
  }
  return true;
}
/** Runs a routine while `keep` holds; stops it, and lets go of everything, the moment it doesn't. */
function* guarded(routine: Co, keep: () => boolean): Co {
  for (;;) {
    if (!keep()) {
      routine.return();
      releaseAll();
      letGo();
      return;
    }
    if (routine.next().done) return;
    yield;
  }
}

// ---------- Moving ----------

/** Walks to x, hopping onto steps and over small walls on the way. Returns false on timeout. */
function* walkTo(goal: number | (() => number), tolerance = 10, timeout = 25): Co<boolean> {
  const end = now + timeout;
  let stuck = 0;
  for (;;) {
    const p = me(),
      x = typeof goal === 'number' ? goal : goal(),
      dx = x - p.x;
    // Ground friction stops a run in about 16 px; let go early so it ends on the spot.
    const coast = Math.sign(p.vx) === Math.sign(dx) && p.grounded ? Math.abs(p.vx) * 0.058 : 0;
    if (Math.abs(dx) <= tolerance + coast) {
      steer(0);
      if (Math.abs(dx) <= tolerance + 4 || Math.abs(p.vx) < 20) return true;
    } else steer(dx);
    if (now > end) {
      steer(0);
      return false;
    }
    // Now and then a hop on a long run, where the ground carries on well past the landing.
    if (Math.abs(dx) > 260 && p.grounded && Math.abs(p.vx) > 200 && chance(0.012) && groundAhead(Math.sign(dx), 170))
      down.set('space', Math.round(rand(7, 18)));
    const blocked = dx > 0 ? p.blockedRight : p.blockedLeft;
    stuck = blocked && p.grounded ? stuck + 1 : 0;
    if (stuck > 5) {
      const wall = obstacle(Math.sign(dx));
      if (!wall || top(wall) > p.bottom - 105) yield* jump(0.28);
      stuck = 0;
    }
    yield;
  }
}
/** Whether the floor under the player continues level for `distance` px ahead, with nothing in the way. */
function groundAhead(direction: number, distance: number): boolean {
  const body = W().playerBody,
    x = body.center.x + direction * distance;
  if (W().zones.some((z) => z.ramps.some((r) => body.center.x > r.x1 - 40 && body.center.x < r.x2 + 40))) return false;
  const under = W().platforms.find(
    (p) => Math.abs(top(p) - body.bottom) < 3 && p.rect.x - p.width / 2 < body.center.x && p.rect.x + p.width / 2 > x,
  );
  return Boolean(under) && !obstacle(direction);
}
/** The platform directly ahead of the player's body, if any. */
function obstacle(direction: number): Platform | undefined {
  const body = W().playerBody;
  return W().platforms.find((p) => {
    const left = p.rect.x - p.width / 2,
      right = p.rect.x + p.width / 2;
    const ahead =
      direction > 0
        ? left >= body.right - 3 && left < body.right + 26
        : right <= body.left + 3 && right > body.left - 26;
    return ahead && top(p) < body.bottom - 1 && p.rect.y + p.height / 2 > body.top;
  });
}
function* jump(holdFor = 0.3): Co {
  hold('space');
  yield* wait(holdFor);
  hold('space', false);
}
/**
 * A jump onto a platform: takes off now and steers in the air to land at `landX`, keeping clear of the
 * platform's near edge until high enough to pass over it.
 */
function* hop(landX: number, landTop: () => number, edge?: number, holdFor = 0.42): Co<boolean> {
  hold('space');
  const start = now;
  yield;
  for (;;) {
    const p = me(),
      t = now - start;
    if (t > holdFor) hold('space', false);
    if (t > 0.08 && p.grounded) break;
    if (t > 2.5) break;
    const y = landTop(),
      disc = p.vy * p.vy + 2 * GRAVITY * (y - p.bottom);
    const remaining = disc > 0 ? (-p.vy + Math.sqrt(disc)) / GRAVITY : Math.max(0.05, -p.vy / GRAVITY);
    let desired = (landX - p.x) / Math.max(remaining, 0.06);
    if (
      edge !== undefined &&
      p.bottom > y - 3 &&
      Math.abs(p.x - edge) < 22 &&
      Math.sign(landX - p.x) === Math.sign(edge - p.x)
    )
      desired = 0;
    steer(Math.abs(desired - p.vx) < 35 ? 0 : desired - p.vx);
    yield;
  }
  steer(0);
  const p = me();
  return p.grounded && Math.abs(p.bottom - landTop()) < 10;
}
/** Walks right until the zone hands over to the next one, waiting at gates that are still opening. */
function* walkRight(): Co {
  const zone = live();
  for (;;) {
    yield* walkTo(zone.ox + zone.zone.x[1] - zone.zone.x[0] + 140, 10, 6);
    yield* wait(0.2);
  }
}

// ---------- Throwing ----------

interface Flight {
  /** Slot the token would snap into, or -1. */
  slot: number;
  /** Time it reaches `goal`, or -1. */
  hit: number;
  /** The closest it passes to `goal`. */
  miss: number;
}
/** Simulates a thrown token the way Arcade Physics moves it: gravity 700, drag 80, speed cap 1100. */
function fly(angle: number, source: string, goal?: (t: number) => Point & { w: number }): Flight {
  const p = W().player,
    force = 660 * character().force,
    rail = W().rail;
  let x = p.x + Math.cos(angle) * 40,
    y = p.y - 10 + Math.sin(angle) * 30,
    vx = Math.cos(angle) * force,
    vy = Math.sin(angle) * force,
    miss = Infinity;
  for (let t = DT; t < 2.2; t += DT) {
    vy = clamp(vy + 700 * DT, -1100, 1100);
    const drag = 80 * DT;
    vx = vx - drag > 0.01 ? vx - drag : vx + drag < -0.01 ? vx + drag : 0;
    x += vx * DT;
    y += vy * DT;
    if (t > 0.15 && t < 2) {
      const slot = rail.slotAt(x, y);
      if (slot >= 0 && rail.values[slot] === null && compatible(source, rail.spec.slots[slot]))
        return { slot, hit: -1, miss };
    }
    if (goal) {
      const g = goal(t),
        d = Math.max(Math.abs(x - g.x) - g.w, 0) + Math.max(Math.abs(y - g.y) - 34, 0);
      miss = Math.min(miss, d);
      if (Math.abs(x - g.x) < g.w && Math.abs(y - g.y) < 34) return { slot: -1, hit: t, miss: 0 };
    }
    if (
      W().platforms.some((q) => Math.abs(x - q.rect.x) < q.width / 2 + 14 && Math.abs(y - q.rect.y) < q.height / 2 + 16)
    )
      break;
  }
  return { slot: -1, hit: -1, miss };
}
/** The throw angles toward `side` that satisfy `ok`, flattest first. */
function angles(side: number, ok: (angle: number) => boolean): number[] {
  const found: number[] = [];
  for (let a = -1.45; a <= 1.1; a += 0.012) {
    const angle = side > 0 ? a : Math.PI - a;
    if (ok(angle)) found.push(angle);
  }
  return found.sort((a, b) => Math.abs(Math.sin(a)) - Math.abs(Math.sin(b)));
}
/** Puts the cursor where the game reads `angle`, at a natural distance along it. */
function aimAngle(angle: () => number, reach: number): void {
  aimScreen(() => {
    const p = W().player,
      a = angle();
    let r = reach;
    for (;;) {
      const s = screenOf({ x: p.x + Math.cos(a) * r, y: p.y - 10 + Math.sin(a) * r });
      if ((s.x > 12 && s.x < 1268 && s.y > 12 && s.y < 708) || r < 70) return s;
      r *= 0.85;
    }
  }, true);
}
/** The angle the game would throw at right now, from the cursor. */
function cursorAngle(): number {
  const p = W().player,
    point = worldOf(cursor);
  return Math.atan2(point.y - (p.y - 10), point.x - p.x);
}
function* release(angle: number, reach: number): Co<boolean> {
  aimAngle(() => angle, reach);
  const steady = yield* until(() => settled(2.5) && Math.abs(cursorAngle() - angle) < 0.012, 1.6);
  if (!steady) return false;
  yield* wait(rand(0.04, 0.14));
  click();
  yield* wait(0.3);
  return true;
}

// ---------- Rails, racks and symbols ----------

/** Zone 3.2 holds one loose ^ while its canonical 3^2+4^2 needs two, and its rack withholds ^; 4·4 is 4². */
const OVERRIDES: Record<string, string[]> = { '3.2': ['3', '^', '2', '+', '4', '*', '4'] };
const plan = () => OVERRIDES[where()] ?? W().beat.rail.solution;
const racks = () => live().racks.filter((r) => r.container.visible);
const rackWith = (source: string) => racks().find((r) => r.choices.includes(source));
const slotX = (rail: Rail, slot: number) => rail.x + rail.slotPositions[slot];
/** Loose symbols the player can reach: on the working floor, not falling into a pit. */
function looseTokens(source?: string): Token[] {
  const [a, b] = floor();
  return W().tokens.filter(
    (t) => t.state !== 'held' && (!source || t.source === source) && t.x > a - 25 && t.x < b + 25 && t.y < GY + 5,
  );
}
function* face(direction: number): Co {
  if (Math.sign(W().facing) === Math.sign(direction)) return;
  steer(direction);
  yield* wait(0.05);
  steer(0);
}

function* pickUp(token: Token): Co {
  for (let tries = 0; tries < 5; tries++) {
    if (!W().tokens.includes(token) || token.state === 'held' || W().held) return;
    yield* until(() => token.state !== 'thrown' || token.body.speed < 120, 1.5);
    yield* walkTo(() => safe(token.x), 14, 8);
    if (nearRail(18)) {
      // E beside the rail takes from the slot under the cursor; rest it on an empty one so E picks up instead.
      const rail = W().rail,
        empty = rail.values.findIndex((v) => v === null);
      if (empty < 0) return;
      aimWorld(() => ({ x: slotX(rail, empty), y: rail.y }), true);
      yield* until(() => settled(5), 1.2);
      if (W().rail.slotAt(worldOf(cursor).x, worldOf(cursor).y) !== empty || rail.values[empty] !== null) continue;
    } else {
      aimWorld(() => ({ x: token.x + 6, y: token.y - 4 }));
      yield* wait(rand(0.06, 0.18));
    }
    if (token.y < me().y - 70) {
      // Floating out of reach: jump for it.
      hold('space');
      yield* until(() => Math.hypot(token.x - me().x, token.y - me().y) < 72, 0.5);
    }
    tap('e');
    yield* wait(0.18);
    hold('space', false);
    yield* until(() => me().grounded, 1);
    if (W().held) return;
    yield* wait(0.15);
  }
}

function* takeFromRack(rack: Rack, source: string): Co {
  yield* walkTo(safe(rack.x + rand(-28, 28)), 12, 10);
  const offset = { x: rand(-10, 10), y: rand(-14, 4) };
  aimWorld(() => ({ x: rack.x + offset.x, y: rack.y + offset.y }));
  yield* until(() => settled(14), 1.2);
  for (let turns = 0; rack.source !== source && turns < 24; turns++) {
    const n = rack.choices.length,
      i = rack.choices.indexOf(source);
    if (i < 0) return;
    const forward = (i - rack.index + n) % n,
      backward = (rack.index - i + n) % n;
    if (forward <= backward && chance(0.3)) tap('q');
    else wheel(forward <= backward ? 100 : -100);
    yield* wait(rand(0.13, 0.28));
  }
  // E prefers a loose symbol within reach over the rack; kick strays away first.
  const stray = looseTokens().find((t) => Math.hypot(t.x - W().player.x, t.y - W().player.y) < 88);
  if (stray) yield* strike({ x: stray.x, y: stray.y });
  yield* wait(rand(0.05, 0.15));
  tap('e');
  yield* wait(0.3);
}

/** Puts the held symbol into a slot: thrown from afar when the throw is clean, otherwise carried. */
function* deliver(slot: number): Co {
  const rail = W().rail,
    held = W().held!,
    x = slotX(rail, slot);
  const distance = Math.abs(W().player.x - x);
  if (distance > 240 && distance < 620 && chance(0.6)) {
    const options = angles(Math.sign(x - W().player.x), (a) => fly(a, held.source).slot === slot);
    if (options.length) {
      const angle = options[Math.floor(Math.random() * Math.min(options.length, 8))];
      if (yield* release(angle, rand(160, 260))) {
        yield* until(() => !W().tokens.includes(held) || held.state === 'loose', 2);
        letGo();
        return;
      }
    }
  }
  const spot = safe(x + rand(-45, 45));
  yield* walkTo(spot, 16, 10);
  const jitter = rand(-6, 6);
  aimWorld(() => ({ x: slotX(rail, slot) + jitter, y: rail.y + rand(-2, 2) }), true);
  yield* until(() => settled(6), 1.2);
  yield* wait(rand(0.04, 0.16));
  tap('e');
  yield* wait(rand(0.28, 0.45));
}

/** Takes a symbol out of a slot. */
function* takeOut(slot: number): Co {
  const rail = W().rail;
  yield* walkTo(safe(slotX(rail, slot) + rand(-40, 40)), 16, 10);
  aimWorld(() => ({ x: slotX(rail, slot), y: rail.y }), true);
  yield* until(() => settled(6), 1.2);
  tap('e');
  yield* wait(0.35);
}

/** Gets rid of the held symbol: tossed onto open ground, or dropped where it won't snap into the rail. */
function* putDown(): Co {
  const held = W().held!;
  const away = W().player.x > W().rail.x ? 1 : -1;
  const options = angles(away, (a) => fly(a, held.source).slot < 0 && Math.sin(a) < -0.3);
  if (options.length && chance(0.7)) yield* release(options[Math.floor(Math.random() * options.length)], 180);
  else {
    yield* walkTo(safe(W().rail.x + away * 330), 20, 8);
    tap('e');
    yield* wait(0.35);
  }
  letGo();
}

/** A swing at something: point at it, click. */
function* strike(at: Point): Co {
  aimWorld(() => at, true);
  yield* until(() => settled(25), 0.6);
  click();
  yield* wait(rand(0.35, 0.55));
  letGo();
}

// ---------- Falsehoods ----------

const alive = (foe: Foe) => W().enemies.includes(foe);
/** How much a Falsehood still needs to be true: the gap a thrown number must fill. */
function gap(lie: Lie): number {
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
  if (lie.kind === 'math') return lie.rhs - sum(lie.terms);
  if (lie.kind === 'force') return Math.abs(sum(lie.left) - sum(lie.right));
  return 0;
}
const fits = (source: string, need: number) =>
  source === '/'
    ? need >= 2
    : !isOperator(source) && Number.isInteger(Number(source)) && Number(source) > 0 && Number(source) <= need;
function ammo(need: number): string | undefined {
  const choices = racks()
    .flatMap((r) => r.choices)
    .filter((s) => fits(s, need));
  if (!choices.length) return undefined;
  const numbers = choices.filter((s) => s !== '/').sort((a, b) => Number(b) - Number(a));
  if (choices.includes('/') && need >= 4 && chance(0.35)) return '/';
  return chance(0.75) ? numbers[0] : numbers[Math.floor(Math.random() * numbers.length)];
}
const reachable = (foe: Foe) => {
  const [a, b] = floor();
  return foe.rect.x > a - 40 && foe.rect.x < b + 40 && foe.rect.y < GY;
};

/** Throws numbers at a Falsehood until it is true, then lets it dissolve into its symbol. */
function* repair(foe: Foe): Co {
  for (let shots = 0; shots < 14 && alive(foe) && !foe.resolved; shots++) {
    const need = gap(foe.lie),
      held = W().held;
    if (need <= 0 || !reachable(foe)) return;
    if (!held || !fits(held.source, need)) {
      if (held) {
        yield* putDown();
        continue;
      }
      const source = ammo(need);
      const rack = source && rackWith(source);
      if (!rack) return;
      yield* takeFromRack(rack, source);
      continue;
    }
    yield* throwAt(foe);
  }
  if (alive(foe) && foe.resolved) {
    letGo();
    yield* until(() => !alive(foe), 2);
  }
}
/** Gets within a comfortable throw of a Falsehood and throws, leading it as it walks. */
function* throwAt(foe: Foe): Co {
  const source = W().held!.source;
  const side = Math.sign(W().player.x - foe.rect.x) || 1;
  for (const s of [side, -side]) {
    const spot = safe(foe.rect.x + s * rand(110, 210));
    if (Math.abs(spot - foe.rect.x) < 70) continue;
    yield* walkTo(() => safe(foe.rect.x + s * clamp(Math.abs(W().player.x - foe.rect.x), 100, 230)), 30, 3);
    break;
  }
  yield* until(() => me().grounded, 1);
  const goal = (t: number) => ({
    x: foe.body.center.x + foe.body.velocity.x * t,
    y: foe.body.center.y,
    w: foe.body.halfWidth + 12,
  });
  const direction = Math.sign(foe.rect.x - W().player.x) || 1;
  const options = angles(direction, (a) => {
    const f = fly(a, source, goal);
    return f.hit > 0 && f.slot < 0;
  });
  if (!options.length) {
    yield* walkTo(safe(foe.rect.x - direction * 160), 30, 2);
    return;
  }
  const choice = options[Math.floor(Math.random() * Math.min(3, options.length))];
  // Re-aim continuously as it walks.
  aimAngle(
    () => {
      const again = angles(direction, (a) => {
        const f = fly(a, source, goal);
        return f.hit > 0 && f.slot < 0;
      });
      return again.length ? again.reduce((b, a) => (Math.abs(a - choice) < Math.abs(b - choice) ? a : b)) : choice;
    },
    clamp(Math.abs(foe.rect.x - W().player.x), 130, 260),
  );
  yield* until(() => settled(3), 1.2);
  yield* wait(rand(0.03, 0.1));
  click();
  yield* wait(rand(0.45, 0.7));
  letGo();
}

/** Repairs Falsehoods until one leaves the wanted symbol, waiting for reinforcements when none is left. */
function* hunt(source: string): Co {
  const foes = W().enemies.filter((e) => !e.resolved && reachable(e));
  const near = (e: Foe) => Math.abs(e.rect.x - W().player.x);
  const foe =
    foes.filter((e) => e.token === source).sort((a, b) => near(a) - near(b))[0] ??
    foes.sort((a, b) => near(a) - near(b))[0];
  if (!foe) {
    yield* idle(rand(0.8, 1.6));
    return;
  }
  yield* repair(foe);
}

// ---------- Idling ----------

/** Small things people do while waiting: shift about, hop, glance around, swat at a Falsehood. */
function* idle(seconds: number): Co {
  const end = now + seconds;
  while (now < end) {
    const p = me(),
      foe = W().enemies.find((e) => !e.resolved && Math.abs(e.rect.x - p.x) < 95 && Math.abs(e.rect.y - p.y) < 60);
    const r = Math.random();
    if (foe && !W().held && chance(0.5)) yield* strike({ x: foe.rect.x, y: foe.rect.y });
    else if (r < 0.12 && p.grounded) yield* jump(rand(0.1, 0.3));
    else if (r < 0.25) yield* walkTo(safe(p.x + rand(-50, 50)), 8, 1);
    else if (r < 0.4) {
      const glance = { x: rand(350, 1100), y: rand(170, 520) };
      aimScreen(() => glance);
      yield* wait(rand(0.5, 1));
      letGo();
    } else yield* wait(rand(0.3, 0.7));
  }
}

// ---------- A zone ----------

const seen = new WeakSet<object>();
let entered = 0;
let lastReport = 0;
/** A line about the current state, every half minute spent in one zone, to see where a run gets stuck. */
function report(): void {
  if (now - lastReport < 30 || now - entered < 30) return;
  lastReport = now;
  const zone = live(),
    p = me();
  const foes = W().enemies.map((e) => `${e.token}@${Math.round(e.rect.x - zone.ox)}${e.resolved ? '✓' : ''}`);
  log(
    `still in ${where()} after ${Math.round(now - entered)}s: rail [${W()
      .rail.values.map((v) => v ?? '_')
      .join(' ')}]`,
    `held ${W().held?.source ?? '-'} at x ${Math.round(p.x - zone.ox)} y ${Math.round(p.bottom)}`,
    `device ${W().device?.state ?? '-'} solved ${zone.solved} foes ${foes.join(' ')}`,
  );
}
function* playZone(): Co {
  const zone = live();
  if (!seen.has(zone)) {
    seen.add(zone);
    entered = now;
    log(`zone ${where()} ${zone.zone.beat.name}`);
    if (!zone.solved) yield* orient();
  }
  if (!zone.solved) yield* solve();
  yield* traverse();
}

/** A moment to take in a new zone and its objective. */
function* orient(): Co {
  const zone = live(),
    look = zone.zone.duel
      ? { x: zone.ox + zone.core.x, y: zone.core.y }
      : { x: zone.ox + rand(1050, 1500), y: rand(260, 420) };
  aimWorld(() => look);
  yield* wait(rand(1.2, 2));
  letGo();
}

/** Builds the zone's expression, slot by slot, and evaluates it until the zone works. */
function* solve(): Co {
  for (;;) {
    const zone = live(),
      rail = W().rail,
      device = W().device,
      held = W().held;
    if (zone.solved) return;
    if (W().transition || (device && device.state !== 'idle')) {
      yield* idle(0.4);
      continue;
    }
    const want = plan();
    if (held) {
      const slot = rail.values.findIndex((v, i) => v === null && want[i] === held.source);
      if (slot >= 0) yield* deliver(slot);
      else yield* putDown();
      continue;
    }
    const wrong = rail.values.findIndex((v, i) => v !== null && v !== want[i]);
    if (wrong >= 0) {
      yield* takeOut(wrong);
      continue;
    }
    const empty = rail.values.flatMap((v, i) => (v === null ? [i] : []));
    if (!empty.length) {
      yield* evaluateRail();
      continue;
    }
    const ready = empty.find((i) => looseTokens(want[i]).length || rackWith(want[i]));
    const source = want[ready ?? empty[0]];
    const loose = looseTokens(source).sort((a, b) => Math.abs(a.x - W().player.x) - Math.abs(b.x - W().player.x))[0];
    const rack = rackWith(source);
    const how =
      loose && (!rack || Math.abs(loose.x - W().player.x) < Math.abs(rack.x - W().player.x) + 200)
        ? 'loose'
        : rack
          ? 'rack'
          : 'hunt';
    if (how === 'loose') yield* pickUp(loose!);
    else if (rack) yield* takeFromRack(rack, source);
    else yield* hunt(source);
  }
}

function* evaluateRail(): Co {
  const rail = W().rail;
  if (live().zone.beat.device?.kind === 'foodchain') {
    yield* liftRide();
    return;
  }
  if (!nearRail()) yield* walkTo(safe(rail.x + rand(-80, 50)), 20, 10);
  aimWorld(() => ({ x: rail.x + rail.width / 2 + 40 + rand(-4, 4), y: rail.y + rand(-6, 6) }));
  yield* until(() => rail.cooldown <= 0 && W().counterLock <= 0 && !W().transition, 12);
  yield* wait(rand(0.25, 0.6));
  if (!nearRail() || rail.values.includes(null)) return;
  log(`evaluate [${rail.values.join(' ')}]`);
  tap('f');
  yield* wait(0.5);
  letGo();
  yield* until(() => !W().device?.busy, 25);
  yield* wait(rand(0.3, 0.7));
}

// ---------- Getting through ----------

function* traverse(): Co {
  const zone = live();
  yield* wait(rand(0.6, 1.2));
  log(`zone ${where()} solved`);
  if (zone.zone.duel) return yield* walkRight();
  switch (zone.zone.beat.device?.kind) {
    case undefined: {
      // The first bridge floats above the ground: jump onto it.
      const bridge = zone.bridge!;
      yield* walkTo(zone.ox + 890, 10);
      yield* hop(zone.ox + 1040, () => top(bridge), zone.ox + 940);
      break;
    }
    case 'launch': {
      yield* walkTo(zone.ox + 890, 8);
      yield* until(() => me().vy < -300, 3);
      hold('d');
      yield* until(() => me().grounded && me().x > zone.ox + 980, 4);
      steer(0);
      break;
    }
    case 'cart':
      yield* cartRide();
      break;
    case 'stairs':
      yield* climbStairs();
      break;
    case 'wave':
    case 'rope':
      yield* crossMoving();
      break;
  }
  yield* walkRight();
}

/** Rides the cart across once it shuttles: on at its home stop, off at the far dock. */
function* cartRide(): Co {
  const zone = live(),
    device = internals(zone.device!),
    cart: Platform = device.cart;
  const home = zone.ox + device.home;
  yield* walkTo(home - 75, 8);
  log(
    `cart wait: cart ${Math.round(cart.rect.x - zone.ox)} home ${device.home} wait ${device.wait} me ${Math.round(me().x - zone.ox)}`,
  );
  const ok = yield* until(() => Math.abs(cart.rect.x - home) < 2 && device.wait > 0.5, 20);
  log(`cart ready ${ok}: cart ${Math.round(cart.rect.x - zone.ox)} wait ${device.wait}`);
  yield* hop(home, () => top(cart), home - 40);
  yield* walkTo(() => cart.rect.x, 6, 2);
  yield* until(() => me().x > zone.ox + device.pivot + 10 && device.wait > 0, 20);
}

/** Climbs the brick wall's steps one by one, then jumps across to the top of the wall. */
function* climbStairs(): Co {
  const zone = live(),
    steps: Platform[] = internals(zone.device!).steps;
  yield* walkTo(zone.ox + 915, 6);
  for (const step of steps) {
    yield* until(() => me().grounded, 1);
    yield* wait(rand(0.08, 0.25));
    yield* hop(step.rect.x + rand(-8, 8), () => top(step), step.rect.x - step.width / 2);
    yield* walkTo(step.rect.x - 22, 5, 1);
  }
  const wall = W().platforms.find((p) => p.rect.x - p.width / 2 > steps[steps.length - 1].rect.x && top(p) < GY - 100)!;
  yield* wait(rand(0.1, 0.3));
  yield* hop(wall.rect.x - wall.width / 2 + 70, () => top(wall), wall.rect.x - wall.width / 2);
}

/**
 * The food-chain lift rises out of reach once powered. Holding a symbol keeps the world slow while focus lasts, so:
 * rest until focus is full, take a symbol along, evaluate from the rail's far end, then run and jump onto the rising
 * lift and ride it up to the ledge.
 */
function* liftRide(): Co {
  const zone = live(),
    rail = W().rail,
    device = internals(zone.device!),
    lift: Platform = device.lift;
  if (!W().held) {
    yield* idle(0.5);
    yield* until(() => W().focus > W().maxFocus - 0.3, 20);
    const rack = racks().find((r) => !isOperator(r.source)) ?? racks()[0];
    yield* takeFromRack(rack, rack.source);
  }
  yield* walkTo(rail.x + 200, 4, 10);
  aimWorld(() => ({ x: lift.rect.x, y: lift.rect.y - 60 }));
  yield* wait(rand(0.15, 0.3));
  tap('f');
  if (!(yield* until(() => device.state === 'running', 1))) return;
  yield* walkTo(zone.ox + 944, 4, 2);
  const rate = () => 1.5 * 80 * (W().held && W().focus > 0 ? 0.35 : 1);
  const goal = GY - device.spec.ledge * 80;
  for (let i = 0; i < 120; i++) {
    yield* until(() => me().grounded, 1);
    const plan = planJump(lift.rect.x, lift.width, (dt) => Math.max(goal, top(lift) - rate() * dt));
    if (plan) {
      yield* hopPlanned(lift.rect.x - 8, lift.width, () => top(lift), plan);
      break;
    }
    yield;
  }
  const p = me();
  if (Math.abs(p.bottom - top(lift)) > 6 || Math.abs(p.x - lift.rect.x) > 60) {
    // Missed it; the ledge is out of reach now. Start the checkpoint over.
    log('missed the lift; restarting the checkpoint');
    yield* wait(1);
    tap('r');
    yield* wait(1);
    return;
  }
  if (W().held && chance(0.5)) yield* putDown();
  yield* until(() => Math.abs(top(lift) - goal) < 2, 12);
  yield* wait(rand(0.2, 0.5));
  yield* walkTo(zone.ox + 1200, 10, 4);
  if (W().held) yield* putDown();
}

/**
 * Crosses platforms that move up and down (the vibrating platforms and the rope's stones). Each jump is planned
 * by simulating the player's own physics against where the next platform will be, and taken only when it lands
 * near the top of its motion.
 */
function* crossMoving(): Co {
  const zone = live(),
    device = internals(zone.device!);
  const kind = zone.zone.beat.device!.kind;
  const stops: Platform[] = kind === 'wave' ? [...device.near, ...device.far] : [...device.stones];
  const landing = W().platforms.find((p) => p.rect.x - p.width / 2 > stops[stops.length - 1].rect.x && p.width > 300)!;
  const topAt = (p: Platform, dt: number): number => {
    if (p === landing) return top(landing);
    const t = W().worldClock + dt;
    if (kind === 'wave') {
      const near = device.near.includes(p);
      const shift = near
        ? vibration(device.amplitude, device.frequency, t, device.offset)
        : vibration(1, device.reference, t);
      return p.baseY - shift * 80 - p.height / 2;
    }
    const k = device.stones.indexOf(p);
    return device.rest + 6 - device.height(1 + k * device.spec.spacing, t) * 80 - p.height / 2;
  };
  yield* walkTo(zone.ox + 925, 6);
  for (const next of [...stops, landing]) {
    const x = next.rect.x;
    for (let attempt = 0; ; attempt++) {
      yield* until(() => me().grounded, 1.5);
      const plan = planJump(x, next.width, (dt) => topAt(next, dt));
      if (plan) {
        yield* hopPlanned(x, next.width, () => topAt(next, 0), plan);
        break;
      }
      if (attempt > 360) return;
      yield;
    }
    yield* until(() => me().grounded, 2);
  }
}
/**
 * In-air steering toward `landX`, shared by the jump planner and the jump itself: head for the landing spot, but
 * hold off near the platform's edge until the feet are above its top.
 */
function airSteer(x: number, bottom: number, vx: number, landX: number, width: number, platformTop: number): number {
  const speed = RUN * character().speed,
    edge = landX - Math.sign(landX - x) * (width / 2 + 12);
  if (
    bottom > platformTop - 2 &&
    Math.abs(x - edge) < 26 &&
    Math.sign(landX - x) === Math.sign(edge - x + 1e-6 * Math.sign(landX - x))
  )
    return 0;
  const desired = clamp((landX - x) * 7, -speed, speed);
  return Math.abs(desired - vx) < 35 ? 0 : Math.sign(desired - vx);
}
/** Searches jump lengths for one that, taken now, lands on a (possibly moving) platform without a hard collision. */
function planJump(landX: number, width: number, topAt: (dt: number) => number): number | null {
  const speed = RUN * character().speed;
  for (const holdFor of [0.5, 0.3, 0.2, 0.12, 0.06]) {
    const p = me();
    let x = p.x,
      bottom = p.bottom,
      vx = p.vx,
      vy = -JUMP * character().jump;
    for (let t = DT; t < 1.6; t += DT) {
      if (t > holdFor && vy < -200 && t - DT <= holdFor) vy *= 0.52;
      const before = topAt(t - DT),
        after = topAt(t),
        last = bottom;
      const key = airSteer(x, bottom, vx, landX, width, before);
      vx += (key * speed - vx) * Math.min(1, DT * 10);
      vy = Math.min(1000, vy + GRAVITY * DT);
      x += vx * DT;
      bottom += vy * DT;
      if (bottom > 900) break;
      if (bottom > after + 3 && bottom - 62 < after + 12 && Math.abs(x - landX) < width / 2 + 12) break;
      if (last <= before + 1 && bottom >= after && Math.abs(x - landX) < width / 2 - 4) {
        // Arcade only separates small overlaps: the platform must not be rushing up into the feet.
        const closing = bottom - last + (before - after);
        if (closing < 9 && after < GY + 40) return holdFor;
        break;
      }
    }
  }
  return null;
}
function* hopPlanned(landX: number, width: number, platformTop: () => number, holdFor: number): Co {
  hold('space');
  const start = now;
  yield;
  for (;;) {
    const p = me(),
      t = now - start;
    if (t > holdFor) hold('space', false);
    if ((t > 0.08 && p.grounded) || t > 2) break;
    steer(airSteer(p.x, p.bottom, p.vx, landX, width, platformTop()));
    yield;
  }
  steer(0);
}

// ---------- Screens ----------

function center(element: Element): Point {
  const r = element.getBoundingClientRect();
  return { x: r.left + r.width * rand(0.35, 0.65), y: r.top + r.height * rand(0.4, 0.6) };
}
function* press(selector: string): Co<boolean> {
  const element = visible(selector);
  if (!element) return false;
  const spot = center(element);
  aimScreen(() => spot);
  yield* until(() => settled(3), 3);
  yield* wait(rand(0.12, 0.3));
  click();
  yield* wait(0.25);
  letGo();
  return true;
}
function* titleScreen(): Co {
  yield* until(() => Boolean(visible('.title-screen')), 10);
  rest = { x: 860, y: 260 };
  yield* wait(2.2);
  yield* press(config.resume ? '[data-action="continue"]' : '[data-action="prologue"]');
  if (config.resume) return;
  yield* until(() => Boolean(prologue?.scene.isActive()), 5);
  // The desk fades in; look over the five pens, then pick one.
  yield* wait(2.4);
  const pen = CHARACTERS.findIndex((c) => c.id === config.pen);
  for (let i = 0; i < CHARACTERS.length; i++) {
    aimScreen(() => ({ x: 800 + i * 50 + 3, y: 507 }));
    yield* wait(rand(0.9, 1.3));
  }
  aimScreen(() => ({ x: 800 + pen * 50 + 2, y: 506 }));
  yield* until(() => settled(2), 2);
  yield* wait(0.8);
  click();
  yield* wait(0.4);
  rest = { x: 960, y: 640 };
  letGo();
  yield* until(() => Boolean(world?.scene.isActive() || visible('#chapter-card.visible')), 15);
}

// ---------- Main loop ----------

let config: Config;
let finished = false;
function* main(): Co {
  yield* titleScreen();
  for (;;) {
    if (visible('#chapter-card.visible')) {
      yield* wait(rand(2.6, 3.6));
      yield* press('#chapter-card [data-action="begin-chapter"]');
      yield* wait(0.8);
      continue;
    }
    if (visible('.death-panel')) {
      log(`fell at ${where()}; trying again`);
      yield* wait(1.2);
      yield* press('.death-panel [data-action="restart"]');
      yield* wait(0.5);
      continue;
    }
    if (visible('.ending-screen')) {
      rest = { x: 900, y: 600 };
      yield* wait(7);
      finished = true;
      return;
    }
    const w = world;
    if (w?.scene.isActive() && w.cur && !w.dying) {
      if (config.until === where()) {
        finished = true;
        return;
      }
      const zone = w.cur,
        gen = generation;
      yield* guarded(
        playZone(),
        () =>
          world === w &&
          w.cur === zone &&
          generation === gen &&
          w.scene.isActive() &&
          !w.dying &&
          !visible('.modal-scrim, #chapter-card.visible'),
      );
      continue;
    }
    yield;
  }
}

// ---------- Soundtrack ----------

/** Every tone the game plays, by virtual time, so the soundtrack can be rendered afterwards in sync. */
const tones: [number, number, unknown[]][] = [];
let audioStart = 0;
const toneProto = AudioEngine.prototype as unknown as Internals;
const playTone = toneProto.tone;
toneProto.tone = function (this: AudioEngine, ...args: unknown[]) {
  const self = internals(this);
  if (config?.audio && self.context && self.master && this.settings.sound)
    tones.push([(window.__clock.now - audioStart) / 1000, self.master.gain.value, args]);
  return playTone.apply(this, args);
};
const RATE = 32000,
  CHUNK = 60,
  LEAD = 4;
window.__soundtrack = async (index: number) => {
  const start = index * CHUNK,
    length = (window.__clock.now - audioStart) / 1000;
  if (start >= length) return null;
  const seconds = Math.min(CHUNK, length - start);
  const context = new OfflineAudioContext(1, Math.ceil((seconds + LEAD) * RATE), RATE);
  const master = context.createGain();
  master.connect(context.destination);
  let offset = 0;
  const engine = Object.create(AudioEngine.prototype) as Internals;
  engine.settings = { sound: true, volume: 1, reducedMotion: false };
  engine.master = master;
  engine.context = new Proxy(context, {
    get: (target, key) => {
      if (key === 'currentTime') return offset;
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  for (const [time, gain, args] of tones)
    if (time >= start - LEAD && time < start + seconds) {
      offset = time - start + LEAD;
      master.gain.setValueAtTime(gain, offset);
      playTone.apply(engine, args);
    }
  const samples = (await context.startRendering()).getChannelData(0).subarray(LEAD * RATE);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) pcm[i] = clamp(samples[i], -1, 1) * 32767;
  let binary = '';
  const bytes = new Uint8Array(pcm.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

// ---------- Entry ----------

let draw: ((time: number, delta: number) => void) | undefined;
export function start(options: Config): void {
  config = options;
  audioStart = window.__clock.now;
  makePointer();
  const routine = main();
  window.__frame = (ms, render) => {
    const loop = world?.game.loop as unknown as Internals | undefined;
    if (loop) {
      // Frames between captures are simulated without drawing; the camera still follows as if drawn.
      draw ??= loop.callback;
      loop.callback = render ? draw : (time: number, delta: number) => W().game.headlessStep(time, delta);
    }
    window.__clock.step(ms);
    if (loop && !render && W().scene.isActive()) W().cameras.main.preRender();
    events = [];
    if (ms > 0) {
      now += ms / 1000;
      if (!finished) routine.next();
      if (world?.cur && world.scene.isActive()) report();
      flushKeys();
      moveCursor();
    }
    return { events, done: finished, where: where() };
  };
}
