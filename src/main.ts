import Phaser from 'phaser';
import '@fontsource/stix-two-math';
import '@fontsource-variable/manrope';
import './style.css';
import { Backdrop } from './game/Backdrop';
import { Epilogue } from './game/Epilogue';
import { Prologue } from './game/Prologue';
import { World } from './game/World';
import { AudioEngine } from './game/audio';
import { REGIONS, knownBefore } from './content/campaign';
import { CHARACTERS, type CharacterId, type CheckpointState, type GameEvent, type Settings } from './game/types';

const root = document.querySelector<HTMLDivElement>('#interface')!;
const SAVE_KEY = 'symbolon.save.v2';
const SETTINGS_KEY = 'symbolon.settings.v1';
const TITLE_FADE = 600;
function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}
/** Version 3 saved an encounter index; each now resumes at the start of its chapter's region. */
const V3_CHAPTERS = [1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6];
function migrate(save: CheckpointState | { version: 3; encounter: number; furthest: number } | null) {
  if (save?.version !== 3) return save;
  const region = V3_CHAPTERS[save.encounter] - 1;
  return {
    ...(save as unknown as CheckpointState),
    version: 4,
    region,
    zone: 0,
    furthest: V3_CHAPTERS[save.furthest] - 1,
    known: knownBefore(region, 0),
    taught: [],
  } as CheckpointState;
}
let saved = migrate(read(SAVE_KEY));
if (
  saved &&
  (saved.version !== 4 ||
    !REGIONS[saved.region]?.zones[saved.zone] ||
    !CHARACTERS.some((c) => c.id === saved!.character))
)
  saved = null;
let settings: Settings = { sound: true, reducedMotion: false, volume: 0.55, ...read<Settings>(SETTINGS_KEY) };
const audio = new AudioEngine(settings);
let selected: CharacterId = saved?.character ?? 'orange';
let screen = 'title';
let toastTimer: ReturnType<typeof setTimeout>;
let currentHud: Extract<GameEvent, { type: 'hud' }> | undefined;
function persist(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Private browsing can disable storage; the current run remains playable. */
  }
}

await Promise.all([document.fonts.load('16px "STIX Two Math"'), document.fonts.load('400 16px "Manrope Variable"')]);
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#090b0d',
  antialias: true,
  roundPixels: false,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false, fixedStep: false, customUpdate: true },
  },
  scene: [Backdrop, Prologue, World, Epilogue],
  render: { transparent: false, powerPreference: 'high-performance' },
});

function brand(): string {
  return '<a class="brand" href="#" data-action="title" aria-label="Symbolon home"><span class="brand-mark">s<span>n</span></span><span>SYMBOLON</span></a>';
}
function soundButton(): string {
  return `<button class="text-button sound-toggle" data-action="sound" aria-label="${settings.sound ? 'Mute' : 'Enable'} sound"><span class="sound-icon">${settings.sound ? '◖))' : '◖×'}</span> SOUND ${settings.sound ? 'ON' : 'OFF'}</button>`;
}
function title(): void {
  screen = 'title';
  clearTimeout(toastTimer);
  game.scene.stop('World');
  game.scene.wake('Backdrop');
  root.innerHTML = `<div class="title-screen">
    <header>${brand()}<nav><button class="text-button" data-action="controls">HOW TO PLAY <span>↗</span></button>${soundButton()}<button class="icon-button" data-action="fullscreen" aria-label="Toggle fullscreen">⛶</button></nav></header>
    <main class="title-main">
      <h1><span class="math">Symbolon<span class="period">.</span></span></h1>
      <p class="lead">The world is an equation.<br>Be the unexpected variable.</p>
      <div class="title-actions"><button class="primary" data-action="${saved && !saved.complete ? 'continue' : 'prologue'}">${saved && !saved.complete ? 'Continue your journey' : 'Enter the equation'}<span>↗</span></button>${saved && !saved.complete ? '<button class="secondary" data-action="prologue">New journey</button>' : ''}</div>
      <div class="game-meta"><span>SINGLE PLAYER</span><i></i><span>SIX CHAPTERS</span><i></i><span>KEYBOARD + MOUSE</span></div>
    </main>
    <footer class="chapter-strip">${REGIONS.map((chapter, i) => `<button class="chapter-link ${i === 0 ? 'available' : ''}" data-action="chapters"><span class="chapter-number">0${i + 1}</span><span>${chapter.title}</span><span class="chapter-symbol">${chapter.symbol}</span></button>`).join('')}</footer>
  </div>`;
}
/** The title fades to black before the desk scene fades in. */
function leaveTitle(): void {
  screen = 'leaving';
  root.querySelector('.title-screen')?.classList.add('leaving');
  game.scene.getScene('Backdrop').cameras.main.fade(TITLE_FADE, 9, 11, 13);
  setTimeout(prologue, TITLE_FADE);
}
/** The prologue's pen pick chooses the character. */
function prologue(): void {
  screen = 'prologue';
  clearTimeout(toastTimer);
  root.innerHTML = '';
  game.scene.stop('World');
  game.scene.sleep('Backdrop');
  game.scene.start('Prologue', {
    reducedMotion: settings.reducedMotion,
    cancel: () => {
      game.scene.stop('Prologue');
      title();
    },
    done: (character: CharacterId) => {
      selected = character;
      game.scene.stop('Prologue');
      launch(newSave(), true);
    },
  });
}
function newSave(region = 0): CheckpointState {
  return {
    version: 4,
    character: selected,
    region,
    zone: 0,
    furthest: saved?.furthest ?? 0,
    known: knownBefore(region, 0),
    taught: saved?.taught ?? [],
    complete: false,
    elapsed: 0,
  };
}
function launch(save: CheckpointState, fromPrologue = false): void {
  audio.start();
  saved = { ...save };
  persist(SAVE_KEY, saved);
  showHud();
  // The page's white clears to the chapter card alone; the world appears only once it begins.
  if (fromPrologue) {
    document.getElementById('chapter-card')?.classList.add('opaque');
    root.insertAdjacentHTML('beforeend', '<div class="whiteout"></div>');
  }
  game.scene.sleep('Backdrop');
  game.scene.start('World', { save: saved, settings, audio, emit: onEvent, chapterCard: save.zone === 0 });
}
function showHud(): void {
  screen = 'playing';
  root.innerHTML = `<div class="hud"><div class="hud-top"><div class="hud-location"><span id="hud-chapter">CHAPTER I</span><span id="hud-title"></span></div><div class="hud-right"><span id="hud-phase"></span><button class="pause-button" data-action="pause" aria-label="Pause game">Ⅱ</button></div></div><div class="hud-bottom"><div class="vitals"><div id="focus-track" class="focus-track"><div id="focus-fill"></div></div><span class="focus-label">FOCUS</span></div><div class="hud-shortcuts"><span>R <small>restart</small></span></div></div><div class="objective"><span id="objective-text"></span></div><div class="progress-track"><div id="campaign-progress"></div></div></div><div id="toast" class="toast" role="status"></div><div id="chapter-card" class="chapter-card"></div><div id="modal-host"></div>`;
  if (currentHud) renderHud(currentHud);
}
function renderHud(event: Extract<GameEvent, { type: 'hud' }>): void {
  currentHud = event;
  if (screen !== 'playing' && screen !== 'paused' && screen !== 'dead') return;
  const set = (id: string, value: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  set('hud-chapter', `CHAPTER ${REGIONS[event.chapter - 1].numeral}`);
  set('hud-title', event.title);
  set('hud-phase', event.phase);
  set('objective-text', event.objective);
  // Focus is health; its bar lengthens as the known set grows.
  const track = document.getElementById('focus-track');
  if (track) track.style.width = `${Math.round(event.maxFocus * 14)}px`;
  const fill = document.getElementById('focus-fill');
  if (fill) {
    fill.style.width = `${(event.focus / event.maxFocus) * 100}%`;
    fill.style.background = CHARACTERS.find((c) => c.id === saved?.character)?.hex ?? '#ff962f';
  }
  const progress = document.getElementById('campaign-progress');
  if (progress) progress.style.width = `${event.progress * 100}%`;
}
function onEvent(event: GameEvent): void {
  if (event.type === 'save') {
    saved = { ...event.save };
    persist(SAVE_KEY, saved);
  } else if (event.type === 'hud') renderHud(event);
  else if (event.type === 'toast') {
    const element = document.getElementById('toast');
    if (!element) return;
    clearTimeout(toastTimer);
    element.replaceChildren();
    const title = document.createElement('strong');
    const sub = document.createElement('span');
    title.textContent = event.text;
    sub.textContent = event.sub ?? '';
    sub.classList.toggle('learned', Boolean(event.learned));
    element.append(title, sub);
    element.classList.add('visible');
    toastTimer = setTimeout(() => element.classList.remove('visible'), 4200);
  } else if (event.type === 'chapter') {
    const card = document.getElementById('chapter-card');
    if (!card) return;
    game.scene.pause('World');
    card.innerHTML = `<span>CHAPTER ${REGIONS[event.chapter - 1].numeral}</span><strong>${event.title}</strong><p>${event.knowledge}</p><button class="primary" data-action="begin-chapter">Begin<span>→</span></button>`;
    card.classList.add('visible');
  } else if (event.type === 'pause') pause();
  else if (event.type === 'death') death();
  else if (event.type === 'complete') epilogue(event.elapsed);
}
function pause(): void {
  screen = 'paused';
  game.scene.pause('World');
  document.getElementById('modal-host')!.innerHTML =
    `<div class="modal-scrim"><section class="pause-panel"><div class="eyebrow">TAKE A MOMENT</div><h2>Between<br><em>possibilities.</em></h2><p>Your progress is saved.</p><button class="primary" data-action="resume">Keep going<span>→</span></button><button class="menu-row" data-action="restart">Restart this checkpoint <span>↺</span></button><button class="menu-row" data-action="controls">Controls <span>↗</span></button><button class="menu-row" data-action="motion">Camera motion <span>${settings.reducedMotion ? 'REDUCED' : 'FULL'}</span></button><button class="menu-row" data-action="sound">Sound <span>${settings.sound ? 'ON' : 'OFF'}</span></button><button class="menu-row" data-action="title">Return to title <span>↗</span></button></section></div>`;
}
function resume(): void {
  screen = 'playing';
  document.getElementById('modal-host')!.innerHTML = '';
  (game.scene.getScene('World') as World).resumeFromMenu();
}
function death(): void {
  screen = 'dead';
  document.getElementById('modal-host')!.innerHTML =
    `<div class="modal-scrim"><section class="pause-panel death-panel"><span class="death-glyph">≠</span><div class="eyebrow">YOU FAILED</div><h2>Try another<br><em>possibility.</em></h2><button class="primary" data-action="restart">Try again<span>↺</span></button><button class="menu-row" data-action="title">Return to title<span>↗</span></button><small>PRESS R TO RESTART</small></section></div>`;
}
function controls(): void {
  const returnScreen = screen;
  const rows = [
    ['A D / ← →', 'Run'],
    ['SPACE', 'Jump · release early for a shorter jump'],
    ['E', 'Grab, drop, or place a symbol'],
    ['MOUSE + CLICK', 'Aim and throw · strike when empty-handed'],
    ['SCROLL / Q', 'Choose a symbol while beside a rack'],
    ['F', 'Evaluate the nearby equation'],
    ['R / ESC', 'Restart checkpoint / pause'],
  ]
    .map(([key, label]) => `<kbd>${key}</kbd><span>${label}</span>`)
    .join('');
  const markup = `<div class="modal-scrim controls-scrim"><section class="controls-panel"><div class="eyebrow">A FEW SIMPLE RULES</div><h2>Think with<br><em>your hands.</em></h2><div class="control-grid">${rows}</div><p class="control-note">Square slots hold numbers; round slots hold operators. Aim at a slot to choose it. The equals sign lights when the expression is valid. Holding a symbol slows combat while focus lasts. Hits cost focus, and running out returns you to the checkpoint. Every concept you learn lengthens it.</p><button class="primary" data-action="close-controls">Got it<span>→</span></button></section></div>`;
  root.insertAdjacentHTML('beforeend', markup);
  const close = () => {
    root.querySelector('.controls-scrim')?.remove();
    screen = returnScreen;
  };
  root.querySelector('[data-action="close-controls"]')!.addEventListener('click', close, { once: true });
}
function chapters(): void {
  screen = 'chapters';
  const entries = REGIONS.map((chapter, i) => {
    const unlocked = i <= (saved?.furthest ?? 0);
    return `<button class="chapter-entry" data-replay="${i}" ${unlocked ? '' : 'disabled'}><span class="chapter-number">${chapter.numeral}</span><span><strong>${chapter.title}</strong><small>${chapter.subtitle}</small></span><span class="chapter-entry-symbol">${unlocked ? '↗' : '·'}</span></button>`;
  }).join('');
  root.innerHTML = `<div class="selection-screen"><header>${brand()}<button class="text-button" data-action="title">← BACK</button></header><main class="chapter-menu"><div class="eyebrow">FROM ONE TO INFINITY</div><h2>A world<br><em>of possibilities.</em></h2><div class="chapter-list">${entries}</div><p class="muted">Chapters unlock as you move forward. Replay starts at the beginning of a chapter.</p></main></div>`;
}
/** The kid steps out of the page and graduates. */
function epilogue(elapsed: number): void {
  screen = 'epilogue';
  root.innerHTML = '';
  game.scene.stop('World');
  game.scene.start('Epilogue', {
    character: saved?.character ?? selected,
    audio,
    done: () => {
      game.scene.stop('Epilogue');
      game.scene.wake('Backdrop');
      ending(elapsed);
    },
  });
}
function ending(elapsed: number): void {
  screen = 'ending';
  root.innerHTML = `<div class="ending-screen"><div class="eyebrow">EVERY END IS A BEGINNING</div><div class="ending-formula">(𝑥 − 1)² = 0</div><h2>Congratulations,<br><em>graduate.</em></h2><p>It began with one sum on a worksheet. Every unknown since has had a value.</p><div class="ending-stats"><span>6 CHAPTERS</span><span>${Math.floor(elapsed / 60)} MINUTES</span><span>GRADUATED</span></div><button class="primary" data-action="chapters">Find another possibility<span>↗</span></button><button class="text-button" data-action="title">RETURN TO TITLE</button><div class="credits">Inspired by Alan Becker’s <em>Animation vs. Math</em><br>An independent fan game · Original procedural art and sound<br>Mathematics belongs to everyone.</div></div>`;
}

root.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-replay]');
  if (!target) return;
  event.preventDefault();
  if (target.dataset.replay !== undefined && !(target as HTMLButtonElement).disabled) {
    launch(newSave(Number(target.dataset.replay)));
    return;
  }
  const action = target.dataset.action;
  if (action === 'title') title();
  else if (action === 'prologue') leaveTitle();
  else if (action === 'continue' && saved) launch(saved);
  else if (action === 'begin-chapter') {
    const card = document.getElementById('chapter-card');
    card?.classList.remove('visible');
    // Stay opaque while fading out, so the world appears through the fade rather than at once.
    setTimeout(() => card?.classList.remove('opaque'), 700);
    game.scene.resume('World');
  } else if (action === 'chapters') chapters();
  else if (action === 'pause') pause();
  else if (action === 'resume') resume();
  else if (action === 'restart') {
    showHud();
    game.scene.resume('World');
    (game.scene.getScene('World') as World).restartCheckpoint();
  } else if (action === 'controls') controls();
  else if (action === 'fullscreen') {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  } else if (action === 'sound' || action === 'motion') {
    if (action === 'sound') settings.sound = !settings.sound;
    else settings.reducedMotion = !settings.reducedMotion;
    persist(SETTINGS_KEY, settings);
    audio.configure(settings);
    if (settings.sound) audio.start();
    if (screen === 'paused') pause();
    else if (screen === 'title') title();
  }
});
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyR' && screen === 'dead') {
    showHud();
    game.scene.resume('World');
    (game.scene.getScene('World') as World).restartCheckpoint();
  }
  if (event.code === 'Escape' && screen === 'paused') resume();
});
window.addEventListener('blur', () => {
  if (screen === 'playing') pause();
});
void document.fonts.ready.then(() => title());
