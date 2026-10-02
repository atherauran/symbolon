import { evaluate, format, near, type Value } from '../math/evaluate';
import type { Beat, DeviceSpec, Load } from '../game/types';

/**
 * Middle-school physics, exactly. Each function is a textbook law; devices animate with these
 * functions and `judge` decides success from them, so what the player sees and the verdict agree.
 */
export const M = 80; // pixels per meter
export const GY = 618; // ground top
export const LIP = 950; // edge of the starting ground
export const G = 10; // N/kg, the 初中 convention
/** The coordinate grid used by the line boss: origin and pixels per unit. */
export const GRID = { x: 320, y: 520, unit: 50 };
export const gridPoint = (x: number, y: number): [number, number] => [GRID.x + x * GRID.unit, GRID.y - y * GRID.unit];

const fmt = (n: number) => format({ num: n });
const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Uniform motion: time = distance ÷ speed. */
export const travelTime = (distance: number, speed: number) => distance / speed;
/** Weight: G = mg. */
export const weight = (load: Load) => load.force ?? (load.mass ?? 0) * G;
/** Lever: net moment F·L, positive when the right side is heavier. */
export const netMoment = (loads: Load[]) =>
  loads.reduce((sum, l) => sum + l.side * weight(l) * l.arm * (l.count ?? 1), 0);
/** Law of reflection for directions in degrees (0° = right, 90° = up). */
export const reflect = (incoming: number, tilt: number) => mod(2 * tilt - incoming, 360);
/** Vibration: y = A·sin(2πft). */
export const vibration = (amplitude: number, frequency: number, t: number, phase = 0) =>
  amplitude * Math.sin(2 * Math.PI * frequency * t + phase);
/** Waves: v = λf. */
export const wavelength = (speed: number, frequency: number) => speed / frequency;
/** Cell division: one cell becomes 2ⁿ cells after n divisions. */
export const cellsAfter = (divisions: number) => 2 ** divisions;
/** Whole divisions a culture completes: the value itself, or elapsed time ÷ period. */
export const divisionsFor = (spec: Extract<DeviceSpec, { kind: 'division' }>, value: number) =>
  spec.period ? Math.floor(value / spec.period + 1e-9) : value;
/** Microscope images are inverted: moving the slide by d moves the image by −d (in stage units). */
export const imageOffset = (offset: number, shift: number) => offset - shift;
/** Food chain energy: each level keeps `ratio` of the level below. */
export const chainEnergy = (sunlight: number, ratio: number, level: number) => sunlight * ratio ** level;
/** Convex lens image distance for a real image (u > f). Rendering only; puzzles use the 初中 f / 2f rules. */
export const imageDistance = (u: number, f: number) => (u * f) / (u - f);

export interface Ray {
  points: [number, number][];
  hit: boolean;
}
/** Traces a light ray in world pixels (y down) through one mirror. */
export function traceLight(spec: Extract<DeviceSpec, { kind: 'mirror' }>, value: number, sensorRadius = 18): Ray {
  const tilt = spec.control === 'tilt' ? value : (spec.tilt ?? 0);
  let angle = spec.control === 'aim' ? -value : spec.beam;
  let [x, y] = spec.laser;
  const points: [number, number][] = [[x, y]];
  const [mx, my] = spec.mirror,
    ux = Math.cos((tilt * Math.PI) / 180),
    uy = -Math.sin((tilt * Math.PI) / 180);
  const floor = spec.floor ?? GY;
  let reflected = false;
  for (let bounce = 0; bounce < 3; bounce++) {
    const dx = Math.cos((angle * Math.PI) / 180),
      dy = -Math.sin((angle * Math.PI) / 180);
    let best = 2600,
      event: 'mirror' | 'sensor' | 'end' = 'end';
    if (!reflected) {
      const denominator = dx * uy - dy * ux;
      if (Math.abs(denominator) > 1e-9) {
        const t = ((mx - x) * uy - (my - y) * ux) / denominator,
          s = ((mx - x) * dy - (my - y) * dx) / denominator;
        if (t > 1e-6 && Math.abs(s) <= M / 2 + 1e-6 && t < best) {
          best = t;
          event = 'mirror';
        }
      }
    }
    const [sx, sy] = spec.sensor,
      along = (sx - x) * dx + (sy - y) * dy;
    if (along > 0 && Math.hypot(sx - x - dx * along, sy - y - dy * along) <= sensorRadius && along < best) {
      best = along;
      event = 'sensor';
    }
    if (dy > 1e-9) {
      const t = (floor - y) / dy;
      if (t > 1e-6 && t < best - 1e-6) {
        best = t;
        event = 'end';
      }
    }
    x += dx * best;
    y += dy * best;
    points.push([x, y]);
    if (event !== 'mirror') return { points, hit: event === 'sensor' };
    angle = reflect(angle, tilt);
    reflected = true;
  }
  return { points, hit: false };
}

export interface Verdict {
  success: boolean;
  readout: string;
}
const verdict = (success: boolean, readout: string): Verdict => ({ success, readout });

/** Judges a rail's value against its device, or against its target for math devices. */
export function judge(beat: Beat, value: Value): Verdict {
  const v = value.num,
    spec = beat.rail,
    device = beat.device;
  if (!device) {
    if (spec.effect === 'solve') {
      const check = evaluate(spec.substitute!, value);
      if (!check.valid) return verdict(false, check.error ?? '');
      const success = near(check.value!.num, spec.target!);
      return verdict(
        success,
        `𝑥 = ${format(value)} makes the left side ${check.display}${success ? '' : `, not ${fmt(spec.target!)}`}.`,
      );
    }
    return verdict(near(v, spec.target!), `Result: ${format(value)}. ${spec.label}.`);
  }
  switch (device.kind) {
    case 'measure':
      if (v <= 0) return verdict(false, 'A bridge needs a positive length.');
      return verdict(
        near(v, device.gap),
        near(v, device.gap)
          ? `${fmt(v)} m spans the gap exactly.`
          : v > device.gap
            ? `${fmt(v)} m is too long. It jams against the far wall.`
            : `${fmt(v)} m is too short to reach the far side.`,
      );
    case 'launch':
      if (v <= 0) return verdict(false, 'The pad needs a positive height.');
      return verdict(
        near(v, device.height),
        `The pad throws you ${fmt(v)} m up${near(v, device.height) ? ', level with the ledge.' : v < device.height ? ', short of the ledge.' : ', into the spikes above the ledge.'}`,
      );
    case 'stairs':
      return verdict(
        near(v, device.height),
        `${fmt(v)} steps of 1 m reach ${fmt(v)} m${near(v, device.height) ? ', level with the ledge.' : v < device.height ? '. Too low for the ledge.' : '. Higher than the ledge.'}`,
      );
    case 'cart': {
      const speed = device.reverse ? -v : v;
      if (speed <= 0)
        return verdict(false, v === 0 ? 'At 0 m/s the cart never moves.' : 'The cart moves the wrong way.');
      const t = travelTime(device.distance, speed);
      return verdict(near(t, device.time), `${fmt(device.distance)} m at ${fmt(Math.abs(v))} m/s takes ${fmt(t)} s.`);
    }
    case 'meet': {
      if (v <= 0) return verdict(false, 'Your cart must move toward the trap.');
      const mine = travelTime(device.distance, v),
        theirs = travelTime(device.runnerDistance, device.runnerSpeed);
      return verdict(
        near(mine, theirs),
        `Your cart reaches the trap at ${fmt(mine)} s; 𝑥 reaches it at ${fmt(theirs)} s.`,
      );
    }
    case 'lever': {
      if (v <= 0) return verdict(false, 'The value must be positive.');
      if (device.control === 'arm' && v > device.arms[1])
        return verdict(false, `That hook is off the end of the ${device.arms[1]} m arm.`);
      const loads = leverLoads(device, v),
        net = netMoment(loads);
      const left = -netMoment(loads.filter((l) => l.side < 0)),
        right = netMoment(loads.filter((l) => l.side > 0));
      const unit = device.pans ? 'kg' : 'N·m',
        scale = device.pans ? G * device.arms[0] : 1;
      const readout = `Left ${fmt(left / scale)} ${unit}, right ${fmt(right / scale)} ${unit}.`;
      return verdict(
        near(net, 0),
        near(net, 0) ? `${readout} Balanced.` : `${readout} It tips ${net > 0 ? 'right' : 'left'}.`,
      );
    }
    case 'rotate': {
      const final = mod(90 - v, 360);
      return verdict(
        near(final, 0) || near(final, 360),
        `The bridge now points ${fmt(final > 180 ? final - 360 : final)}° from horizontal.`,
      );
    }
    case 'mirror': {
      const ray = traceLight(device, v, beat.layout === 'arena' ? 40 : 18);
      return verdict(ray.hit, ray.hit ? 'The beam reaches the sensor.' : 'The beam misses the sensor.');
    }
    case 'squares': {
      const target = device.plank ? device.plank ** 2 - device.run ** 2 : device.run ** 2 + (device.rise ?? 0) ** 2;
      if (v <= 0) return verdict(false, 'A square needs a positive area.');
      return verdict(near(v, target), `A square of area ${fmt(v)} m² has sides of ${fmt(Math.sqrt(v))} m.`);
    }
    case 'wave': {
      const target = device.mode === 'amplitude' ? device.ledge : device.cycles! / device.seconds!;
      if (v <= 0) return verdict(false, 'Nothing vibrates.');
      return verdict(
        near(v, target),
        device.mode === 'amplitude'
          ? `The platforms rise ${fmt(v)} m above rest.`
          : `${fmt(v)} Hz is ${fmt(v)} vibrations per second.`,
      );
    }
    case 'scope': {
      if (v <= 0) return verdict(false, 'Silence.');
      const target = device.mode === 'amplitude' ? device.amplitude : device.frequency;
      return verdict(
        near(v, target),
        device.mode === 'amplitude'
          ? `Amplitude ${fmt(v)} divisions.`
          : `${fmt(v)} Hz: ${fmt(v / 100)} vibrations every 10 ms.`,
      );
    }
    case 'rope': {
      if (v <= 0) return verdict(false, 'Nothing moves the rope.');
      const speed = device.distance / device.seconds,
        lambda = wavelength(speed, v),
        ratio = device.spacing / lambda;
      return verdict(
        near(ratio, Math.round(ratio)) && Math.round(ratio) >= 1,
        `At ${fmt(v)} Hz the crests are ${fmt(lambda)} m apart.`,
      );
    }
    case 'division': {
      if (v < 0)
        return verdict(
          false,
          device.period ? 'Time cannot run backwards.' : 'A cell cannot divide a negative number of times.',
        );
      if (!device.period && !Number.isInteger(v))
        return verdict(false, 'A cell divides whole times, never part of a time.');
      const n = divisionsFor(device, v),
        cells = cellsAfter(n),
        success = cells === device.cells;
      const count = n > 30 ? 'more than a billion cells' : `${cells} cell${cells === 1 ? '' : 's'}`;
      const lead = device.period
        ? `In ${fmt(v)} s the cell divides ${n} time${n === 1 ? '' : 's'}: ${count}.`
        : `${n} division${n === 1 ? '' : 's'} make${n === 1 ? 's' : ''} ${count}.`;
      if (beat.layout === 'arena')
        return verdict(
          success,
          `${lead} ${success ? 'One shard for every shield cell.' : 'The shards do not match the shield cells.'}`,
        );
      return verdict(
        success,
        `${lead} ${success ? 'They fill the gap exactly.' : cells < device.cells ? 'They fall short of the far side.' : 'Too many for the gap. The row buckles.'}`,
      );
    }
    case 'microscope': {
      if (device.mode === 'zoom') {
        if (v <= 0) return verdict(false, 'Magnification must be positive.');
        const image = device.specimen * v;
        return verdict(
          near(image, device.gate),
          `At ${fmt(v)}×, the ${fmt(device.specimen)} mm cell looks ${fmt(image)} mm long${near(image, device.gate) ? ', exactly as wide as the lock.' : image < device.gate ? '. It does not reach both sides of the lock.' : '. It overflows the lock.'}`,
        );
      }
      const final = imageOffset(device.offset, v);
      if (near(final, 0)) return verdict(true, 'The cell sits in the centre of the view.');
      return verdict(
        false,
        `The image moves ${v > 0 ? 'left' : 'right'}${Math.abs(final) > 5 ? ' and leaves the view' : `, ${fmt(Math.abs(final))} mm ${final < 0 ? 'left' : 'right'} of centre`}.`,
      );
    }
    case 'foodchain': {
      if (v <= 0) return verdict(false, 'Without sunlight nothing grows.');
      const fox = chainEnergy(v, device.ratio, 2);
      return verdict(
        near(fox, device.ledge),
        `Grass ${fmt(v)} kJ → rabbits ${fmt(chainEnergy(v, device.ratio, 1))} kJ → foxes ${fmt(fox)} kJ. The lift rises ${fmt(fox)} m${near(fox, device.ledge) ? ', level with the ledge.' : fox < device.ledge ? ', short of the ledge.' : ', into the spikes.'}`,
      );
    }
    case 'pulse': {
      if (v <= 0) return verdict(false, 'The pacemaker is silent.');
      return verdict(
        near(v, device.bpm),
        `${fmt(v)} beats per minute${near(v, device.bpm) ? ': in step with the heart.' : v < device.bpm ? ' is slower than the heart.' : ' is faster than the heart.'}`,
      );
    }
    case 'lens': {
      const f = device.focal;
      if (v <= 0) return verdict(false, 'The object must stand in front of the lens.');
      if (v <= f + 1e-9)
        return verdict(false, `At ${fmt(v)} m the object is inside the focal length. No image reaches the screen.`);
      const image = imageDistance(v, f),
        size = near(v, 2 * f) ? 'the same size' : v > 2 * f ? 'smaller' : 'larger';
      if (device.mode === 'same')
        return verdict(
          near(v, 2 * f),
          near(v, 2 * f)
            ? 'A sharp image, the same size as the object, lands on the screen.'
            : `The image forms ${fmt(image)} m behind the lens, ${size}. The screen shows a blur.`,
        );
      if (image > device.track! + 1e-9)
        return verdict(false, `The image forms ${fmt(image)} m behind the lens, past the end of the screen track.`);
      return verdict(
        v < 2 * f - 1e-9,
        `A sharp image lands ${fmt(image)} m behind the lens, ${size} than the object${v < 2 * f - 1e-9 ? '. It fills the lock.' : '. Too small for the lock.'}`.replace(
          'the same size than',
          'the same size as',
        ),
      );
    }
    case 'line': {
      const k = device.control === 'k' ? v : device.k!,
        b = device.control === 'b' ? v : (device.b ?? 0);
      const [x, y] = device.core,
        reached = k * x + b;
      return verdict(near(reached, y), `At x = ${x}, the line reaches y = ${fmt(reached)}.`);
    }
  }
}

/** The loads on a lever once the player's value is in place. */
export function leverLoads(device: Extract<DeviceSpec, { kind: 'lever' }>, value: number): Load[] {
  if (device.control === 'mass') return device.loads.map((l) => (l.label === '𝑥' ? { ...l, mass: value } : l));
  const mine: Load =
    device.control === 'arm'
      ? { side: 1, arm: value, force: device.controlForce!, label: 'you' }
      : device.pans
        ? { side: 1, arm: device.controlArm!, mass: value, label: 'you' }
        : { side: 1, arm: device.controlArm!, force: value, label: 'you' };
  return [...device.loads, mine];
}
