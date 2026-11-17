// The whole video as a function of time: window.renderAt(t) puts the stage in its state
// at t seconds and returns the mouse hotspot in page pixels.
//
// Isopod is a React app with its own state, so unlike a page driven by pushed globals the
// app can't simply be "set" to time t. Instead every user action is an event at a fixed
// time, the app's clock is virtual (inject/clock.js), and renderAt replays events in
// order. Going backwards (a worker starting a later chunk) reloads the iframe and replays
// from 0, so frame t looks the same whichever worker renders it.
(() => {
  const DESK_W = 1600, DESK_H = 900;
  // ?layout=portrait renders the 1080x1920 version: same events, a camera that follows the cursor
  const PORTRAIT = new URLSearchParams(location.search).get("layout") === "portrait";
  if (PORTRAIT) document.body.classList.add("portrait");
  const VIEW = PORTRAIT ? { x: 0, y: 520, w: 1080, h: 980 } : { x: 0, y: 0, w: 1920, h: 1080 };
  const FRAME_X = 0, FRAME_Y = 80; // app iframe inside the desk (below tabs and toolbar)
  const frame = document.getElementById("appframe");
  const $ = (id) => document.getElementById(id);
  const win = () => frame.contentWindow;
  const doc = () => frame.contentDocument;
  const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- finding real elements in the app -------------------------------------
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const all = (sel) => [...doc().querySelectorAll(sel)].filter(shown);
  const button = (text) => () => all("button").find((b) => b.textContent.trim() === text);
  const input = (sel) => () => all(sel)[0];
  const leaf = (text) => all("*").find((e) => e.children.length === 0 && e.textContent.trim() === text);
  // The search result card for a mod, and a button inside it
  const inResult = (mod, label) => () => {
    let el = leaf(mod);
    while (el && !([...el.querySelectorAll("button")].some((b) => b.textContent.trim() === label))) el = el.parentElement;
    return el && [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
  };
  const autoBackups = () => {
    let el = leaf("Automatic backups");
    while (el && !el.querySelector('input[type="checkbox"]')) el = el.parentElement;
    return el && el.querySelector('input[type="checkbox"]');
  };

  // ---- beats ----------------------------------------------------------------
  const S = {
    addInstance: 1.7, nameField: 2.8, typeName: 3.05, fabric: 5.2, next: 6.4, create: 7.7,
    start: 10.0,
    edit: 15.9, modsTab: 16.8, download: 17.7, searchField: 18.6, typeSearch: 18.8, searchEnter: 19.85, addDeps: 21.3, back: 23.3,
    logTab: 25.6, cmdField: 26.5, typeCmd: 26.7, cmdEnter: 29.1,
    backupsTab: 32.6, autoToggle: 33.8, backupNow: 35.1,
    close: 38.6,
    end: 42.4, finish: 48.6,
  };
  const DURATION = S.finish;

  const CAPTIONS = [
    { t0: 0.9, t1: 9.3, text: "Create a server" },
    { t0: 9.5, t1: 15.3, text: "Start it" },
    { t0: 15.6, t1: 21.1, text: "Add mods from Modrinth" },
    { t0: 21.3, t1: 24.9, text: "Dependencies come along" },
    { t0: 25.2, t1: 32.1, text: "Live console with RCON" },
    { t0: 32.4, t1: 38.2, text: "Scheduled world backups" },
    { t0: 39.0, t1: 42.0, text: "Every server, one dashboard" },
  ];

  // Camera: from each keyframe's t it eases over dur to (z, x, y), a desk-space centre.
  const CAMERA = [
    { t: 0, dur: 0, z: 1, x: 800, y: 450 },
    { t: 2.0, dur: 0.9, z: 1.25, x: 800, y: 330 },
    { t: 4.4, dur: 0.8, z: 1.25, x: 900, y: 560 },
    { t: 6.0, dur: 0.8, z: 1.15, x: 900, y: 600 },
    { t: 8.4, dur: 0.9, z: 1.0, x: 800, y: 450 },
    { t: 9.4, dur: 1.0, z: 1.35, x: 1400, y: 300 },
    { t: 14.6, dur: 1.0, z: 1.0, x: 800, y: 450 },
    { t: 17.0, dur: 0.9, z: 1.16, x: 800, y: 500 },
    { t: 38.0, dur: 0.9, z: 1.0, x: 800, y: 450 },
  ];

  // ---- events: actions on the app, and cursor waypoints --------------------
  const EVENTS = [];   // { t, order, fn, sound }
  const WAYPOINTS = []; // { t, dur, get, pos }
  const SOUND_EVENTS = [];

  function setValue(el, value) {
    const proto = el instanceof win().HTMLTextAreaElement ? win().HTMLTextAreaElement.prototype : win().HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new (win().Event)("input", { bubbles: true }));
  }
  const need = (get, what) => { const el = get(); if (!el) throw new Error(`demo: no element for ${what}`); return el; };

  function moveTo(t, get, dur = 0.65) {
    WAYPOINTS.push({ t, dur, get });
    const i = WAYPOINTS.length - 1;
    // Fix the arrival point at exactly t, before any action at t, so replays agree.
    EVENTS.push({ t, order: 0, fn: () => { WAYPOINTS[i].pos = measure(WAYPOINTS[i]) || (i ? WAYPOINTS[i - 1].pos : null); } });
  }
  function clickOn(t, get, what, dur) {
    moveTo(t, get, dur);
    EVENTS.push({ t, order: 1, fn: () => { const el = need(get, what); el.focus?.({ preventScroll: true }); el.click(); } });
    SOUND_EVENTS.push({ type: "click", t });
  }
  function typeInto(t0, get, text, dt = 0.085) {
    [...text].forEach((_, i) => {
      const t = +(t0 + i * dt).toFixed(3);
      EVENTS.push({ t, order: 1, fn: () => setValue(need(get, "typing target"), text.slice(0, i + 1)) });
      SOUND_EVENTS.push({ type: "key", t });
    });
    return t0 + text.length * dt;
  }
  function pressKey(t, get, key) {
    EVENTS.push({
      t, order: 1, fn: () => {
        const el = need(get, key);
        for (const type of ["keydown", "keyup"]) el.dispatchEvent(new (win().KeyboardEvent)(type, { key, code: key, bubbles: true, cancelable: true }));
      },
    });
    SOUND_EVENTS.push({ type: "key", t });
  }
  // Rest the pointer somewhere neutral (a fixed desk point)
  const rest = (t, x, y, dur = 0.8) => moveTo(t, () => ({ x, y }), dur);

  // 1. Create a server
  rest(0.0, 760, 520, 0);
  clickOn(S.addInstance, button("Add Instance"), "Add Instance", 0.9);
  clickOn(S.nameField, input('input[placeholder^="e.g. My"]'), "name field");
  typeInto(S.typeName, input('input[placeholder^="e.g. My"]'), "Fabric Friends");
  clickOn(S.fabric, button("FABRIC"), "FABRIC");
  clickOn(S.next, button("Next"), "Next");
  clickOn(S.create, button("Create Instance"), "Create Instance");
  rest(8.9, 980, 560);
  // 2. Start it
  clickOn(S.start, button("Start"), "Start", 0.8);
  rest(11.0, 1300, 640);
  // 3. Mods
  clickOn(S.edit, button("Edit"), "Edit", 0.7);
  clickOn(S.modsTab, button("Mods"), "Mods tab");
  clickOn(S.download, button("Download Mods"), "Download Mods");
  clickOn(S.searchField, input('input[placeholder="Search for mods..."]'), "mod search");
  typeInto(S.typeSearch, input('input[placeholder="Search for mods..."]'), "waystones");
  pressKey(S.searchEnter, input('input[placeholder="Search for mods..."]'), "Enter");
  clickOn(S.addDeps, inResult("Waystones", "Add with Deps"), "Add with Deps", 0.8);
  clickOn(S.back, button("Back to Mods"), "Back to Mods", 0.75);
  rest(24.2, 1000, 600);
  // 4. Console
  clickOn(S.logTab, button("Minecraft Log"), "Minecraft Log");
  clickOn(S.cmdField, input('input[placeholder^="Type a command"]'), "command field");
  typeInto(S.typeCmd, input('input[placeholder^="Type a command"]'), "say Welcome to Fabric Friends!", 0.07);
  pressKey(S.cmdEnter, input('input[placeholder^="Type a command"]'), "Enter");
  rest(30.0, 1150, 600);
  // 5. Backups
  clickOn(S.backupsTab, button("Backups"), "Backups tab");
  clickOn(S.autoToggle, autoBackups, "Automatic backups");
  clickOn(S.backupNow, button("Back Up Now"), "Back Up Now");
  rest(36.2, 1080, 640);
  // 6. Back to the dashboard
  clickOn(S.close, () => all('button[title="Close"]')[0], "Close", 0.8);
  rest(40.0, 700, 620, 1.2);

  EVENTS.sort((a, b) => a.t - b.t || a.order - b.order);

  // ---- cursor ---------------------------------------------------------------
  function measure(wp) {
    const target = wp.get();
    if (!target) return null;
    if (!(target instanceof win().Element)) return { x: target.x, y: target.y };
    const r = target.getBoundingClientRect();
    return { x: FRAME_X + r.left + r.width / 2, y: FRAME_Y + r.top + r.height / 2 };
  }
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const clamp01 = (u) => Math.max(0, Math.min(1, u));

  function cursorAt(t) {
    let i = -1;
    for (let k = 0; k < WAYPOINTS.length; k++) if (WAYPOINTS[k].t - WAYPOINTS[k].dur <= t) i = k;
    if (i < 0) return WAYPOINTS[0].pos || { x: 800, y: 450 };
    const wp = WAYPOINTS[i];
    const from = i > 0 ? WAYPOINTS[i - 1].pos : wp.pos;
    if (t >= wp.t && wp.pos) return wp.pos;
    const to = wp.pos || measure(wp) || from;
    if (!from) return to;
    const u = ease(clamp01(wp.dur ? (t - (wp.t - wp.dur)) / wp.dur : 1));
    const dx = to.x - from.x, dy = to.y - from.y;
    const arc = Math.sin(Math.PI * u) * Math.hypot(dx, dy) * 0.08;
    const len = Math.hypot(dx, dy) || 1;
    return { x: from.x + dx * u - (dy / len) * arc, y: from.y + dy * u + (dx / len) * arc };
  }

  // Arrow, I-beam or hand, from the CSS cursor of whatever the app has under the pointer
  function cursorKind(p) {
    if (p.y < FRAME_Y) return "arrow";
    const el = doc().elementFromPoint(p.x - FRAME_X, p.y - FRAME_Y);
    if (!el) return "arrow";
    const c = win().getComputedStyle(el).cursor;
    if (c === "pointer") return "hand";
    if (c === "text" || (el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit"].includes(el.type)) || el.tagName === "TEXTAREA") return "ibeam";
    return "arrow";
  }

  // ---- camera ---------------------------------------------------------------
  // Portrait shows ~1000 desk px of width, so each beat gets its own focus point.
  const CAMERA_PORTRAIT = [
    { t: 0, dur: 0, z: 1.0, x: 520, y: 450 },
    { t: 1.9, dur: 0.8, z: 1.12, x: 720, y: 320 },
    { t: 4.5, dur: 0.7, z: 1.12, x: 900, y: 500 },
    { t: 5.9, dur: 0.7, z: 1.05, x: 1080, y: 600 },
    { t: 8.4, dur: 0.9, z: 1.0, x: 1150, y: 420 },
    { t: 10.3, dur: 0.8, z: 1.25, x: 1420, y: 330 },
    { t: 15.0, dur: 0.8, z: 1.0, x: 1150, y: 450 },
    { t: 16.2, dur: 0.6, z: 1.0, x: 640, y: 470 },
    { t: 17.1, dur: 0.6, z: 1.0, x: 900, y: 470 },
    { t: 25.0, dur: 0.6, z: 1.0, x: 700, y: 470 },
    { t: 26.1, dur: 0.7, z: 1.12, x: 880, y: 500 },
    { t: 32.1, dur: 0.6, z: 1.0, x: 700, y: 470 },
    { t: 33.1, dur: 0.6, z: 1.0, x: 960, y: 500 },
    { t: 38.1, dur: 0.6, z: 1.0, x: 1050, y: 450 },
    { t: 39.0, dur: 1.0, z: 1.0, x: 650, y: 450 },
  ];

  function cameraAt(t) {
    const keys = PORTRAIT ? CAMERA_PORTRAIT : CAMERA;
    let cur = keys[0], prev = keys[0];
    for (let k = 0; k < keys.length; k++) if (keys[k].t <= t) { prev = k ? keys[k - 1] : keys[0]; cur = keys[k]; }
    // prev should be where the camera was when cur started, i.e. cur's predecessor fully settled
    const u = ease(clamp01(cur.dur ? (t - cur.t) / cur.dur : 1));
    const lerp = (a, b) => a + (b - a) * u;
    const z = lerp(prev.z, cur.z), x = lerp(prev.x, cur.x), y = lerp(prev.y, cur.y);
    const s = (PORTRAIT ? VIEW.h / DESK_H : VIEW.w / DESK_W) * z;
    const tx = Math.min(0, Math.max(VIEW.w - DESK_W * s, VIEW.w / 2 - x * s));
    const ty = Math.min(0, Math.max(VIEW.h - DESK_H * s, VIEW.h / 2 - y * s));
    return { s, tx, ty };
  }

  // ---- overlays -------------------------------------------------------------
  function drawCaption(t) {
    const c = CAPTIONS.find((c) => t >= c.t0 - 0.25 && t <= c.t1 + 0.25);
    const el = $("caption");
    if (!c) { el.style.opacity = 0; return; }
    const a = Math.min(clamp01((t - (c.t0 - 0.25)) / 0.25), clamp01((c.t1 + 0.25 - t) / 0.25));
    $("captext").textContent = c.text;
    $("capkeys").innerHTML = (c.keys || []).map((k) => `<span class="key">${k}</span>`).join("");
    el.style.opacity = a;
    el.style.transform = `translateX(-50%) translateY(${(1 - a) * 12}px)`;
  }

  // ---- replay ---------------------------------------------------------------
  let applied = -1, next = 0, generation = 0;

  async function imagesReady() {
    for (let i = 0; i < 100; i++) {
      if ([...doc().images].every((im) => im.complete)) return;
      await realSleep(20);
    }
  }

  async function boot() {
    generation++;
    if (generation > 1) {
      await new Promise((r) => { frame.onload = r; frame.src = `/?replay=${generation}`; });
    }
    for (let i = 0; i < 500; i++) {
      try {
        if (win().__vt && doc().readyState === "complete" && button("Add Instance")()) break;
      } catch { /* not ready */ }
      await realSleep(20);
    }
    await doc().fonts.ready;
    await win().__vt.advanceTo(0);
    for (const wp of WAYPOINTS) delete wp.pos;
    applied = 0;
    next = 0;
  }

  window.renderAt = async (t) => {
    if (t < applied) await boot();
    while (next < EVENTS.length && EVENTS[next].t <= t) {
      const ev = EVENTS[next++];
      await win().__vt.advanceTo(ev.t * 1000);
      ev.fn();
      await win().__vt.settle();
    }
    await win().__vt.advanceTo(t * 1000);
    applied = t;
    await imagesReady();

    // Stage. Focusing an input inside the iframe can scroll the clipped containers around
    // it (overflow:hidden is still scrollable), which would shift the shot, so undo that.
    for (const el of [$("camwin"), $("viewport"), document.scrollingElement]) { el.scrollLeft = 0; el.scrollTop = 0; }
    const cam = cameraAt(t);
    $("desk").style.transform = `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})`;

    const p = cursorAt(t);
    const kind = cursorKind(p);
    const sinceClick = Math.min(...SOUND_EVENTS.filter((e) => e.type === "click" && e.t <= t).map((e) => t - e.t), 9);
    const press = sinceClick < 0.09 ? 0.9 : 1;
    const cur = $("cursor");
    cur.dataset.kind = kind;
    const hot = kind === "ibeam" ? { x: 11, y: 15 } : kind === "hand" ? { x: 9, y: 2 } : { x: 1.5, y: 1.5 };
    cur.style.transform = `translate(${p.x - hot.x * press}px, ${p.y - hot.y * press}px) scale(${press})`;
    cur.style.opacity = t < S.end ? 1 : 0;

    drawCaption(t);
    const endA = clamp01((t - S.end) / 0.6);
    $("endcard").style.opacity = endA;
    $("fade").style.opacity = clamp01((t - (S.finish - 0.8)) / 0.8);

    return { x: VIEW.x + cam.tx + p.x * cam.s, y: VIEW.y + cam.ty + p.y * cam.s, hover: t < S.end };
  };

  window.DEMO = { S, DURATION, CAPTIONS, SCENES: [
    ["Create a server", 0, S.start - 0.5],
    ["Start it", S.start - 0.5, S.edit - 0.4],
    ["Mods", S.edit - 0.4, S.logTab - 0.5],
    ["Console", S.logTab - 0.5, S.backupsTab - 0.5],
    ["Backups", S.backupsTab - 0.5, S.close - 0.5],
    ["Dashboard and end card", S.close - 0.5, S.finish],
  ] };
  window.SOUND_EVENTS = SOUND_EVENTS.sort((a, b) => a.t - b.t);
  window.STAGE_READY = boot();
})();
