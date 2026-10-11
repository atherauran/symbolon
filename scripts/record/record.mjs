#!/usr/bin/env node
/**
 * Records a full playthrough of Symbolon as an MP4.
 *
 * The page runs on a virtual clock (clock.js) and the autopilot (bot.ts) plays it with real mouse and keyboard
 * input. Every frame is stepped and captured explicitly, so the video is smooth however slow the machine renders.
 *
 *   npm run record                          full playthrough → recordings/symbolon-playthrough.mp4
 *   npm run record -- --pen blue            choose the pen (orange, green, yellow, blue, red)
 *   npm run record -- --from 3.2 --to 4.0   start at a checkpoint (region.zone) and stop on reaching another
 *   npm run record -- --dry                 play without rendering or capturing, for testing the autopilot
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const { values: options } = parseArgs({
  options: {
    out: { type: 'string', default: 'recordings/symbolon-playthrough.mp4' },
    pen: { type: 'string', default: 'blue' },
    from: { type: 'string' },
    to: { type: 'string' },
    fps: { type: 'string', default: '30' },
    seed: { type: 'string', default: '7' },
    dry: { type: 'boolean', default: false },
    /** Save a still every N seconds of game time, for checking a dry run. */
    stills: { type: 'string' },
    /** Give up after this many minutes of game time. */
    limit: { type: 'string', default: '75' },
    audio: { type: 'boolean', default: true },
  },
});
const FPS = Number(options.fps);
/** The game simulates at 60 Hz; frames in between are stepped without rendering. */
const HZ = 60;
const STEP = 1000 / HZ;
const EVERY = Math.max(1, Math.round(HZ / FPS));

const server = await createServer({
  root,
  configFile: resolve(root, 'vite.config.ts'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
});
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', (error) => console.error('[page error]', error.message));
page.on('console', (message) => {
  if (message.type() === 'error' || message.text().startsWith('[bot]')) console.log(message.text());
});
await page.addInitScript({
  content: `window.__seed = ${Number(options.seed)};\n${readFileSync(resolve(here, 'clock.js'), 'utf8')}`,
});
const cdp = await context.newCDPSession(page);

/** Steps the clock in real time until a condition holds, for page loads before the autopilot takes over. */
async function settle(condition) {
  for (let i = 0; i < 600; i++) {
    if (await page.evaluate(condition).catch(() => false)) return;
    await page.evaluate((ms) => window.__clock?.step(ms), STEP).catch(() => {});
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('The page did not become ready.');
}

await page.goto(url);
await settle(() => Boolean(document.querySelector('.title-screen')));
if (options.from) {
  // Write a save at that checkpoint, as Continue would find it, and reload.
  const [region, zone] = options.from.split('.').map(Number);
  await page.evaluate(
    async ({ region, zone, pen }) => {
      const { knownBefore } = await import('/src/content/campaign.ts');
      localStorage.setItem(
        'symbolon.save.v2',
        JSON.stringify({
          version: 4,
          character: pen,
          region,
          zone,
          furthest: region,
          known: knownBefore(region, zone),
          taught: [],
          complete: false,
          elapsed: 0,
        }),
      );
    },
    { region, zone, pen: options.pen },
  );
  await page.reload();
  await settle(() => Boolean(document.querySelector('.title-screen')));
} else await page.evaluate(() => localStorage.clear());

await page.evaluate(
  async (config) => {
    const { start } = await import('/scripts/record/bot.ts');
    start(config);
  },
  { pen: options.pen, resume: Boolean(options.from), until: options.to ?? null, audio: options.audio && !options.dry },
);

let ffmpeg;
if (!options.dry) {
  mkdirSync(dirname(resolve(root, options.out)), { recursive: true });
  ffmpeg = spawn(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-']
      .concat(['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'])
      .concat([resolve(root, options.out + '.video.mp4')]),
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
}
const stills = options.stills ? Number(options.stills) * HZ : 0;
if (stills) mkdirSync(resolve(root, 'recordings/stills'), { recursive: true });

const MODIFIERS = { buttons: { none: 0, left: 1 } };
async function dispatch(event) {
  if (event.kind === 'key')
    await cdp.send('Input.dispatchKeyEvent', {
      type: event.type,
      key: event.key,
      code: event.code,
      windowsVirtualKeyCode: event.keyCode,
      nativeVirtualKeyCode: event.keyCode,
    });
  else
    await cdp.send('Input.dispatchMouseEvent', {
      type: event.type,
      x: event.x,
      y: event.y,
      button: event.button ?? 'none',
      buttons: MODIFIERS.buttons[event.held ? 'left' : 'none'],
      clickCount: event.type === 'mouseMoved' ? 0 : 1,
      deltaX: 0,
      deltaY: event.deltaY ?? 0,
    });
}

const started = Date.now();
let frame = 0;
let status = {};
for (;;) {
  const still = stills > 0 && frame % stills === 0;
  const render = (!options.dry && frame % EVERY === 0) || still;
  status = await page.evaluate(({ ms, render }) => window.__frame(ms, render), { ms: STEP, render });
  for (const event of status.events) await dispatch(event);
  if (render && ffmpeg) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true });
    const buffer = Buffer.from(shot.data, 'base64');
    if (!ffmpeg.stdin.write(buffer)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
  }
  if (still) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    writeFileSync(
      resolve(root, `recordings/stills/${String(frame).padStart(7, '0')}.jpg`),
      Buffer.from(shot.data, 'base64'),
    );
  }
  if (frame % (HZ * 30) === 0)
    console.log(
      `[record] ${(frame / HZ / 60).toFixed(1)} min of play · ${status.where} · ${((Date.now() - started) / 60000).toFixed(1)} min elapsed`,
    );
  frame++;
  if (status.done || frame > Number(options.limit) * 60 * HZ) break;
}
console.log(`[record] finished: ${status.where} after ${(frame / HZ / 60).toFixed(1)} min of play`);

if (ffmpeg) {
  ffmpeg.stdin.end();
  await new Promise((r) => ffmpeg.on('close', r));
  const video = resolve(root, options.out + '.video.mp4');
  const output = resolve(root, options.out);
  if (options.audio) {
    // The soundtrack renders offline from the tones the game played, a minute at a time.
    const chunks = [];
    for (let i = 0; ; i++) {
      const chunk = await page.evaluate((i) => window.__soundtrack(i), i);
      if (chunk === null) break;
      chunks.push(Buffer.from(chunk, 'base64'));
    }
    const wav = resolve(root, options.out + '.wav');
    writeFileSync(wav, Buffer.concat([waveHeader(chunks.reduce((n, c) => n + c.length, 0)), ...chunks]));
    await run('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      video,
      '-i',
      wav,
      '-c:v',
      'copy',
      '-af',
      'volume=14dB,alimiter=limit=0.9',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-shortest',
      output,
    ]);
    await run('rm', [video, wav]);
  } else await run('mv', [video, output]);
  console.log(`[record] wrote ${options.out}`);
}
await browser.close();
await server.close();
if (!status.done) process.exitCode = 1;

function waveHeader(bytes, rate = 32000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(bytes, 40);
  return header;
}
function run(command, args) {
  return new Promise((resolve, reject) =>
    spawn(command, args, { stdio: 'inherit' }).on('close', (code) =>
      code ? reject(new Error(`${command} failed`)) : resolve(),
    ),
  );
}
