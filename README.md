# Symbolon

A single-player browser action-puzzle game inspired by Alan Becker’s _Animation vs. Math_. Carry numbers and operators, evaluate equations, and drive real middle-school physics and biology to change the arena. Built with TypeScript, Phaser 3, Arcade Physics, and Vite; menus and overlays use HTML/CSS.

## Run locally

Use Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Open the localhost address printed by Vite. The game uses keyboard and mouse and is intended for desktop browsers.

```sh
npm run build       # TypeScript check and static production build in dist/
npm run preview     # Serve the production build locally
npm run check       # TypeScript only
npm test            # Math, physics-law, and authored-rail checks; no browser automation
```

The build bundles its fonts and requires no remote services. Nothing is published online.

## Controls

| Input              | Action                                             |
| ------------------ | -------------------------------------------------- |
| A/D or Left/Right  | Run                                                |
| Space              | Jump; release early for a shorter jump             |
| E                  | Grab, drop, insert, or retrieve a symbol           |
| Mouse + left click | Aim and throw; melee when empty-handed             |
| Scroll or Q        | Cycle the nearby physical rack’s available symbols |
| F                  | Evaluate a nearby rail                             |
| R                  | Restore the current checkpoint                     |
| Escape             | Pause                                              |

Square slots hold numbers; round slots hold operators. Nothing is pre-filled: every operator is carried from a rack or found in the level, and 𝑥 can knock operators out of your rail. Some racks hold a fixed stock, one of each symbol shown. Aim at a slot to choose it. Without an explicit mouse target, a held symbol selects the first compatible empty slot. You must be near a rack or rail to manipulate it. Symbols thrown through empty compatible receivers also snap into place.

The equals sign lights when an expression is mathematically valid. There are no hints: objectives say what to achieve, and the numbers a puzzle needs are in the scene (tiles, bricks, rulers, stopwatches, counters, labels). Enemies keep arriving until a beat is solved. Other supported results can still exert force or create different geometry. Boss counters must satisfy the current component and its operation, where applicable.

Holding symbols or editing equations slows combat until focus runs out. Focus recovers while your hands are empty and you are no longer editing. Orange has longer focus; Green has longer attack warnings and quantized throw aiming; Yellow sees result and trajectory previews; Blue moves and handles symbols faster; Red hits and throws harder.

## Campaign

The campaign targets Chinese 初中 (middle school) mathematics, physics, and biology. Later challenge comes from multi-step reasoning, reading instruments, fetching operators under fire, and knowledge from other subjects, not from advanced math. It contains 21 encounters in six chapters, including three battles against 𝑥, the Unknown. Boss phases have individual checkpoints.

1. **One Becomes Many:** carrying symbols, cell division (1 → 2 → 4 → 8), counting brick courses with a limited stock, measuring with a ruler, microscope magnification (eyepiece × objective), and a launch pad under fire.
2. **Below Zero:** a ruler that doesn't start at 0, the microscope's inverted image (negative shifts), energy through a food chain, uniform motion with signed velocity and fractions, bacteria doubling on a clock (powers), square roots, and the first duel (linear equations and a meeting problem).
3. **Balance:** equal-arm balances, levers (F₁L₁ = F₂L₂), and weight (G = mg, g = 10 N/kg).
4. **Line of Sight:** the law of reflection, the Pythagorean theorem as areas, convex lenses (u = 2f, and f < u < 2f for an enlarged image), and a duel on the coordinate grid (y = kx + b).
5. **Waves:** frequency, oscilloscope waveforms (loudness and pitch), heart rate in beats per minute, and wave speed (v = λf).
6. **The Unknown:** a final duel that combines every mechanic, from cell division to pitch, and ends by solving 𝑥² − 2𝑥 + 1 = 0.

Progress and settings are stored locally in the browser. Continue returns to the saved beat or boss phase. Chapter replay becomes available as chapters are reached.

## Extending the game

- `src/content/campaign.ts` defines chapter order, encounters, beats, rail templates, unlocks, objectives, and boss phases. Add a beat to an encounter for another checkpointed puzzle or traversal section.
- `src/math/evaluate.ts` parses carried expressions (real numbers, exact fractions, integer powers, `√`) and substitutes 𝑥 for authored equations. It has no Phaser dependencies.
- `src/physics/model.ts` holds the physics laws and `judge()`, which decides every rail's outcome. It has no Phaser dependencies.
- `src/game/devices.ts` animates the physics and biology devices (levers, lenses, microscopes, cell cultures, food chains, hearts) and measuring instruments (rulers, protractors, stopwatches, counters). `src/game/objects.ts` implements tokens, typed rail slots, and racks. `Gameplay.ts` runs movement, combat, math devices, bosses, and operator theft.
- `src/main.ts` owns HTML overlays, character selection, local saves, and scene transitions.

Every rail lists a canonical `solution`. Its slots are derived from that solution, and the tests check that each solution uses tokens available at that point and passes `judge()`. Devices must follow one rule: each device simulates a textbook 初中 law exactly, in real units (1 m = 80 px, world seconds), and fails in the physically correct way. The numbers a puzzle needs come from instruments in the scene, not from rail labels. Math devices (the first bridge, launch pads) carry no physical law beyond their stated geometry.

Arcade Physics handles the player, loose objects, and enemies. The world runs on a shared scaled clock (focus slows devices and stopwatches too) while the player’s controller uses real time. Moving platforms use kinematic positions and carry riders explicitly.

## Credits

Original animation reference: Alan Becker’s _Animation vs. Math_. This is an independent fan game, not an official Alan Becker release. All game art and sound are generated procedurally; the reference video’s soundtrack is not used.

Typography: STIX Two Math and Manrope, distributed under the SIL Open Font License. Phaser is distributed under the MIT License. See `public/third-party-notices.txt` for the bundled notices.
