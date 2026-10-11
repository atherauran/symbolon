// Virtual time for frame-exact recording. Injected before any page script runs: performance.now, Date.now,
// requestAnimationFrame, timers and CSS animations all follow a clock that only advances when the recorder steps it.
(() => {
  const realNow = performance.now.bind(performance);
  const perfBase = realNow();
  const dateBase = Date.now();
  let now = 0;
  let nextId = 1;
  let frames = new Map();
  const timers = new Map();
  const started = new WeakMap();
  // Seeded randomness, so a run can be reproduced.
  let seed = (window.__seed ?? 1) >>> 0;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  performance.now = () => perfBase + now;
  Date.now = () => dateBase + Math.floor(now);
  window.requestAnimationFrame = (callback) => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  const schedule =
    (repeat) =>
    (callback, delay = 0, ...args) => {
      const id = nextId++;
      timers.set(id, {
        due: now + Math.max(0, Number(delay) || 0),
        callback,
        args,
        repeat: repeat ? Math.max(1, delay) : 0,
      });
      return id;
    };
  window.setTimeout = schedule(false);
  window.setInterval = schedule(true);
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);

  /** CSS transitions and animations are paused and driven from the virtual clock. */
  function syncAnimations() {
    for (const animation of document.getAnimations()) {
      if (!started.has(animation)) {
        started.set(animation, now - (Number(animation.currentTime) || 0));
        animation.pause();
      }
      animation.currentTime = now - started.get(animation);
    }
  }

  window.__clock = {
    get now() {
      return now;
    },
    /** Advances the clock by `ms`, firing due timers, then one animation frame. */
    step(ms) {
      const end = now + ms;
      for (;;) {
        let first;
        for (const [id, timer] of timers)
          if (timer.due <= end && (!first || timer.due < first[1].due)) first = [id, timer];
        if (!first) break;
        const [id, timer] = first;
        now = Math.max(now, timer.due);
        if (timer.repeat) timer.due += timer.repeat;
        else timers.delete(id);
        try {
          typeof timer.callback === 'function' ? timer.callback(...timer.args) : eval(timer.callback);
        } catch (error) {
          console.error(error);
        }
      }
      now = end;
      const due = frames;
      frames = new Map();
      for (const callback of due.values())
        try {
          callback(perfBase + now);
        } catch (error) {
          console.error(error);
        }
      syncAnimations();
    },
  };
})();
