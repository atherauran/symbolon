import Phaser from 'phaser';
import { notation } from '../math/evaluate';

export const INK = 0xebece8;
export const MUTED = 0x565d62;
export const MATH_FONT = '"STIX Two Math", Georgia, serif';
export const UI_FONT = '"Manrope Variable", sans-serif';

export function text(
  scene: Phaser.Scene,
  x: number,
  y: number,
  value: string,
  size = 22,
  color = '#ebece8',
  math = true,
): Phaser.GameObjects.Text {
  if (size <= 12) size = Math.max(12, size + 2);
  return scene.add
    .text(x, y, value, { fontFamily: math ? MATH_FONT : UI_FONT, fontSize: `${size}px`, color, resolution: 2 })
    .setOrigin(0.5);
}

export class Formula extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, x: number, y: number, source: string, size = 36, color = '#ebece8') {
    super(scene, x, y);
    scene.add.existing(this);
    if (/^[-−]?\d+\/\d+$/.test(source)) {
      const [n, d] = source.replace('-', '−').split('/');
      this.add(text(scene, 0, -size * 0.3, n, size * 0.55, color));
      this.add(text(scene, 0, size * 0.36, d, size * 0.55, color));
      const line = scene.add
        .graphics()
        .lineStyle(1.3, Phaser.Display.Color.HexStringToColor(color).color)
        .lineBetween(-size * 0.3, 1, size * 0.3, 1);
      this.add(line);
    } else this.add(text(scene, 0, 0, notation(source), size, color));
  }
}

// Stick figure rig, in figure units relative to the body centre (feet rest on y = GROUND).
// Poses are authored side-on in the facing direction: f = forward, z = lateral (body side), y = down.
// A yaw angle projects them to the screen, so turning passes through a front view.
const GROUND = 31,
  THIGH = 13.5,
  SHIN = 13.5,
  TORSO = 21,
  UPPER_ARM = 10,
  FOREARM = 9.5,
  HEAD = 9,
  RUN_SPEED = 295,
  SKID_TIME = 0.45;

/** Foot: forward offset, lift off the ground, lateral distance from the centre line. */
type Foot = [number, number, number];
/** Arm: shoulder swing from straight down (+ forward), elbow bend (+ forearm forward), outward spread. */
type Arm = [number, number, number];
interface Pose {
  hip: number; // hip height above the ground
  lean: number; // torso tilt, + forward
  legs: [Foot, Foot]; // leg 0 on the +z side, leg 1 on the -z side
  arms: [Arm, Arm]; // arm i counter-swings leg i
}

const lerp = Phaser.Math.Linear,
  clamp01 = (v: number) => Phaser.Math.Clamp(v, 0, 1),
  smooth = (v: number) => Phaser.Math.SmoothStep(v, 0, 1);
const mixTuple = <T extends number[]>(a: T, b: T, t: number) => a.map((v, i) => lerp(v, b[i], t)) as T;
function mix(a: Pose, b: Pose, t: number): Pose {
  return {
    hip: lerp(a.hip, b.hip, t),
    lean: lerp(a.lean, b.lean, t),
    legs: [mixTuple(a.legs[0], b.legs[0], t), mixTuple(a.legs[1], b.legs[1], t)],
    arms: [mixTuple(a.arms[0], b.arms[0], t), mixTuple(a.arms[1], b.arms[1], t)],
  };
}
/** legs: [f0, lift0, f1, lift1]; arms: [swing0, bend0, swing1, bend1]. */
function pose(hip: number, lean: number, legs: number[], arms: number[], width: number, spread: number): Pose {
  return {
    hip,
    lean,
    legs: [
      [legs[0], legs[1], width],
      [legs[2], legs[3], width],
    ],
    arms: [
      [arms[0], arms[1], spread],
      [arms[2], arms[3], spread],
    ],
  };
}
/**
 * Static poses are drawn as 2D mirror images when facing left (like the reference's 3/4 stances),
 * so their limbs swap sides; side = 1 facing right, -1 facing left, 0 in the front view.
 */
function handed(p: Pose, side: number): Pose {
  return mix({ ...p, legs: [p.legs[1], p.legs[0]], arms: [p.arms[1], p.arms[0]] }, p, (side + 1) / 2);
}

const idlePose = (time: number) => {
  const breath = Math.sin(time * 2.2);
  return pose(26 + breath * 0.2, 0.03, [1.5, 0, -3.5, 0], [0.04, 0.22, -0.16, 0.3], 4.5, 0.42 + breath * 0.02);
};

/** Stride geometry at run intensity r: stance-foot travel and the fraction of the cycle a foot is planted. */
const stride = (r: number) => ({ step: lerp(14, 34, r), stance: lerp(0.58, 0.38, r) });

function runPose(phase: number, r: number): Pose {
  const { step, stance } = stride(r),
    lift = lerp(3, 8.5, r);
  const foot = (q: number): Foot => {
    if (q < stance) return [step / 2 - (step * q) / stance, 0, 4.5];
    // Swing: the heel kicks up behind first, then the knee drives the foot forward to a straight-leg contact.
    const t = (q - stance) / (1 - stance);
    return [-step / 2 + step * smooth(t), lift * Math.sin(Math.PI * t ** 0.7), 4.5];
  };
  const arm = (q: number): Arm => {
    const swing = -Math.cos(Math.PI * 2 * q);
    return [lerp(0.05, -0.3, r) + lerp(0.12, 0.6, r) * swing, lerp(0.3, 1.1, r) + 0.25 * r * swing, 0.35];
  };
  const qa = phase % 1,
    qb = (phase + 0.5) % 1;
  return {
    // Lowest at mid-stance, highest at contact.
    hip: 25.5 - 2.6 * r * (0.5 + 0.5 * Math.cos(Math.PI * 4 * (phase - stance / 2))),
    lean: lerp(0.03, 0.17, r) + 0.03 * r * Math.cos(Math.PI * 4 * phase),
    legs: [foot(qa), foot(qb)],
    arms: [arm(qa), arm(qb)],
  };
}

// Skid to a halt: lean back with the feet planted ahead and arms flung out, crouch, straighten, then idle.
const SKID: [number, Pose][] = [
  [0, pose(24.5, -0.24, [17, 0, 8, 5], [1.2, -0.85, -1.2, 1.7], 3.5, 0.2)],
  [0.35, pose(24, -0.28, [15, 0, 8, 4.5], [1.19, -0.87, -1.5, 1.86], 3.5, 0.2)],
  [0.62, pose(21.5, 0, [13, 0, 8, 0], [0.94, -0.8, -1.03, 0.87], 4, 0.3)],
  [0.82, pose(24.5, 0.03, [7, 0, 1.5, 0], [0.39, -0.25, -0.54, 0.25], 4.5, 0.4)],
];
function skidPose(k: number, idle: Pose): Pose {
  const keys = [...SKID, [1, idle] as [number, Pose]];
  const i = keys.findIndex(([at]) => at > k);
  const [a, from] = keys[i - 1],
    [b, to] = keys[i];
  return mix(from, to, smooth((k - a) / (b - a)));
}

const RISE = pose(26.5, 0.1, [7, 10, -5, 2.5], [-0.5, 1, 0.8, 1.2], 4, 0.3),
  FALL = pose(26, 0.02, [5, 4, -4, 0.5], [-0.9, 0.7, 1.4, 0.6], 4.5, 0.45);
const airPose = (vy: number) => mix(RISE, FALL, clamp01((vy + 200) / 500));

export interface FigureMotion {
  speed: number;
  vy: number;
  grounded: boolean;
  facing: number;
  attack: number;
}
export interface FigureLook {
  held: boolean;
  aim: number;
  hurt: boolean;
}

/** Keeps the animation state (stride phase, turn, skid, landing) for one stick figure. */
export class StickFigure {
  private time = 0;
  private phase = 0.3;
  private yaw = 0.5;
  private air = 0;
  private land = 0;
  private lastVx = 0;
  private momentum = 0; // run intensity averaged over the last ~quarter second
  private skid = -1; // seconds into the current skid, or -1
  private skidDir = 1;
  private skidPower = 0;
  private skidWeight = 0;
  private pose = idlePose(0);

  update(dt: number, m: FigureMotion): void {
    this.time += dt;
    const speed = Math.abs(m.speed),
      last = Math.abs(this.lastVx),
      r = Math.min(1, speed / RUN_SPEED);
    const { step, stance } = stride(r);
    // Advance the cycle by distance covered so planted feet stay put on the ground.
    if (speed < 6) this.phase = 0.3;
    else this.phase = (this.phase + (speed * dt * stance) / step) % 1;

    // Only a sustained run skids; a quick tap just stops.
    if (this.skid < 0 && m.grounded && this.momentum > 0.55 && speed < last - 1500 * dt) {
      this.skid = 0;
      this.skidDir = Math.sign(this.lastVx);
      this.skidPower = this.momentum;
    } else if (this.skid >= 0) {
      this.skid += dt;
      const along = m.speed * this.skidDir;
      // Running on again (or back the other way) cuts the skid short.
      if (this.skid >= SKID_TIME || !m.grounded || (along > 150 && speed > last) || along < -120) this.skid = -1;
    }
    this.lastVx = m.speed;
    this.momentum = lerp(this.momentum, r, Math.min(1, dt * 4));
    const k = this.skid / SKID_TIME;
    this.skidWeight = lerp(this.skidWeight, this.skid >= 0 ? 1 : 0, Math.min(1, dt * 25));

    const wasAir = this.air;
    this.air = lerp(this.air, m.grounded ? 0 : 1, Math.min(1, dt * 14));
    if (m.grounded && wasAir > 0.5) this.land = 1;
    this.land = Math.max(0, this.land - dt * 6);

    const hand = Phaser.Math.Clamp(Math.cos(this.yaw) / Math.cos(0.5), -1, 1),
      idle = handed(idlePose(this.time), hand);
    let pose = mix(idle, runPose(this.phase, r), smooth(r * 3));
    if (this.skidWeight > 0.001)
      pose = mix(pose, mix(idle, skidPose(Math.max(0, k), idle), this.skidPower), this.skidWeight);
    pose = mix(pose, handed(airPose(m.vy), hand), this.air);
    pose.hip -= 4 * this.land * this.land;
    if (m.attack > 0) {
      // Jab: snap out, hold, pull back over the last third.
      const e = smooth(Math.min(1, (0.28 - m.attack) / 0.04, m.attack / 0.09));
      pose.lean += 0.2 * e;
      pose.arms = [mixTuple(pose.arms[0], [1.5, 0.05, 0], e), mixTuple(pose.arms[1], [-0.9, 1.6, 0.1], e)];
    }
    this.pose = pose;

    const dir = this.skid >= 0 ? this.skidDir : m.facing,
      moving = Math.max(smooth(r * 3), this.skid >= 0 ? 1 - k : 0, this.air),
      side = lerp(0.5, 0.14, moving);
    this.yaw = lerp(this.yaw, dir > 0 ? side : Math.PI - side, Math.min(1, dt * 16));
  }

  draw(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, look: FigureLook, scale = 1): void {
    const { hip, lean, legs, arms } = this.pose,
      cos = Math.cos(this.yaw),
      sin = Math.sin(this.yaw);
    const at = (f: number, z: number, py: number) => ({ x: x + (f * cos + z * sin) * scale, y: y + py * scale });
    const line = (...points: { x: number; y: number }[]) => {
      g.beginPath().moveTo(points[0].x, points[0].y);
      for (const p of points.slice(1)) g.lineTo(p.x, p.y);
      g.strokePath();
      for (const p of points) g.fillCircle(p.x, p.y, 2.2 * scale);
    };
    g.lineStyle(4.4 * scale, look.hurt ? INK : color, 1);
    g.fillStyle(look.hurt ? INK : color, 1);

    const hipY = GROUND - hip,
      up = { f: Math.sin(lean), y: -Math.cos(lean) },
      neck = { f: up.f * TORSO, y: hipY + up.y * TORSO };
    const head = at(neck.f + up.f * (HEAD + 0.5), 0, neck.y + up.y * (HEAD + 0.5));
    g.strokeCircle(head.x, head.y, HEAD * scale);
    line(at(neck.f, 0, neck.y), at(0, 0, hipY));

    legs.forEach(([f, lift, width], i) => {
      const z = i ? -width : width;
      // Two-bone IK in the side plane, knee bending forward; past full reach the leg just straightens.
      const footY = GROUND - lift,
        d = Math.hypot(f, footY - hipY),
        base = Math.atan2(footY - hipY, f);
      const bend =
        d < THIGH + SHIN
          ? Math.acos(Phaser.Math.Clamp((d * d + THIGH * THIGH - SHIN * SHIN) / (2 * d * THIGH), -1, 1))
          : 0;
      const knee =
        d < THIGH + SHIN
          ? { f: Math.cos(base - bend) * THIGH, y: hipY + Math.sin(base - bend) * THIGH }
          : { f: f / 2, y: (hipY + footY) / 2 };
      line(at(0, z * 0.3, hipY), at(knee.f, z * 0.7, knee.y), at(f, z, footY));
    });

    const sf = neck.f - up.f * 1.5,
      sy = neck.y - up.y * 1.5;
    if (look.held) {
      // Both hands reach toward the aim in screen space, from chest height so they clear the head.
      const s = at(neck.f - up.f * 5, 0, neck.y - up.y * 5),
        hx = Math.cos(look.aim) * 21 * scale,
        hy = Math.sin(look.aim) * 21 * scale,
        back = Math.sign(cos) * 5 * scale;
      line(s, { x: s.x + hx * 0.5, y: s.y + hy * 0.5 + 3 * scale }, { x: s.x + hx, y: s.y + hy });
      line(s, { x: s.x + hx * 0.45, y: s.y + hy * 0.5 + 7 * scale }, { x: s.x + hx - back, y: s.y + hy + 5 * scale });
      return;
    }
    arms.forEach(([swing, bend, spread], i) => {
      const side = i ? -1 : 1,
        ef = sf + Math.sin(swing) * UPPER_ARM,
        ey = sy + Math.cos(swing) * UPPER_ARM,
        ez = side * (1.5 + Math.sin(spread) * UPPER_ARM);
      line(
        at(sf, side * 1.5, sy),
        at(ef, ez, ey),
        at(
          ef + Math.sin(swing + bend) * FOREARM,
          ez + side * Math.sin(spread) * FOREARM * 0.3,
          ey + Math.cos(swing + bend) * FOREARM,
        ),
      );
    });
  }
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: number;
}
export class Dust {
  private particles: Particle[] = [];
  constructor(private g: Phaser.GameObjects.Graphics) {}
  burst(x: number, y: number, color: number, count = 16, force = 150): void {
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2,
        speed = force * (0.25 + Math.random());
      const life = 0.25 + Math.random() * 0.6;
      this.particles.push({
        x,
        y,
        vx: Math.cos(theta) * speed,
        vy: Math.sin(theta) * speed,
        life,
        max: life,
        size: 1 + Math.random() * 2.5,
        color,
      });
    }
    if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
  }
  update(dt: number): void {
    this.g.clear();
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 75 * dt;
      this.g.fillStyle(p.color, Math.max(0, p.life / p.max)).fillRect(p.x, p.y, p.size, p.size);
    }
  }
}
