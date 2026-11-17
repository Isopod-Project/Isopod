// Virtual clock, injected before the app's own scripts.
// setTimeout/setInterval/Date only move when the stage calls __vt.advanceTo(ms),
// so the app's polling, toasts and "x ago" text are a pure function of demo time.
(() => {
  // 9:41 on the demo day, local time. stage.html's clock uses the same moment.
  const BASE = new Date(2026, 10, 13, 9, 41, 0).getTime();
  const realSetTimeout = window.setTimeout.bind(window);
  const RealDate = Date;
  let now = 0;
  let seq = 1;
  const timers = new Map();

  const add = (fn, ms, args, interval) => {
    const id = seq++;
    const delay = Math.max(0, Number(ms) || 0);
    timers.set(id, { fn, args, due: now + delay, interval: interval ? Math.max(1, delay) : 0, order: id });
    return id;
  };
  window.setTimeout = (fn, ms, ...args) => add(fn, ms, args, false);
  window.setInterval = (fn, ms, ...args) => add(fn, ms, args, true);
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };

  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(BASE + now); }
    static now() { return BASE + now; }
  }
  window.Date = FakeDate;

  const tick = () => new Promise((r) => realSetTimeout(r, 0));
  let pending = 0;
  window.__vtPending = { inc() { pending++; }, dec() { pending--; } };

  // Let promises, fetch mocks and React commits finish. Stops once nothing is in
  // flight and the DOM stayed the same for two macrotasks in a row.
  let mutations = 0;
  new MutationObserver(() => { mutations++; }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  async function settle() {
    let quiet = 0;
    for (let i = 0; i < 60 && quiet < 2; i++) {
      const before = mutations;
      await tick();
      quiet = pending === 0 && mutations === before ? quiet + 1 : 0;
    }
  }

  window.__vt = {
    BASE,
    get now() { return now; },
    settle,
    // Run every timer due up to `target`, in due order, settling after each.
    async advanceTo(target) {
      for (;;) {
        let next = null;
        for (const t of timers.values()) {
          if (t.due <= target && (!next || t.due < next.due || (t.due === next.due && t.order < next.order))) next = t;
        }
        if (!next) break;
        now = Math.max(now, next.due);
        const id = [...timers].find(([, v]) => v === next)[0];
        if (next.interval) next.due += next.interval; else timers.delete(id);
        try { typeof next.fn === "function" ? next.fn(...next.args) : 0; } catch (e) { console.error(e); }
        await settle();
      }
      now = Math.max(now, target);
      await settle();
    },
  };
})();
