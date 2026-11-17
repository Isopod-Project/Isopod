// In-page stand-in for the Isopod FastAPI backend. It replaces window.fetch, keeps its
// state in memory (so reloading the iframe resets it) and reads time from the virtual
// clock, so a server "started" at 12.0 s is Online at the same frame in every worker.
// Response shapes follow backend/main.py; unknown endpoints are logged and answer [].
(() => {
  const S = 1000;
  const vnow = () => window.__vt.now;
  const GB = 1024 ** 3, MB = 1024 ** 2;
  const unix = (ms) => (window.__vt.BASE + ms) / 1000;

  const ICON = (name) => `http://demo.local/demo/icons/${name}.png`;

  // ---- world state ---------------------------------------------------------
  const db = {
    groups: ["No group", "Friends"],
    instances: [
      { id: "survival-smp", name: "Survival SMP", group: "Friends", type: "PAPER", version: "1.21.4", port: 25565, memory: "4G", icon: "grass" },
      { id: "creative-build", name: "Creative Build", group: "Friends", type: "VANILLA", version: "1.21.4", port: 25566, memory: "2G", icon: "bricks" },
      { id: "skyblock", name: "Skyblock", group: "No group", type: "FABRIC", version: "1.21.1", port: 25567, memory: "3G", icon: "sky" },
    ],
    // instance id -> virtual ms it was started (running), or "online" for already-up servers
    running: { "survival-smp": -3600 * S },
    stopping: {},
    mods: { skyblock: ["fabric-api", "lithium"] },
    backups: {
      "survival-smp": [
        { name: "world-2026-11-13-03-00.zip", created: unix(-6.7 * 3600 * S), size: 182 * MB, kind: "scheduled" },
        { name: "world-2026-11-12-03-00.zip", created: unix(-30.7 * 3600 * S), size: 179 * MB, kind: "scheduled" },
        { name: "world-2026-11-11-03-00.zip", created: unix(-54.7 * 3600 * S), size: 171 * MB, kind: "scheduled" },
      ],
    },
    commands: {},
    modsAtStart: { skyblock: 5 },
    backupSettings: { "survival-smp": { enabled: true, interval_hours: 24, keep: 7, snapshot_keep: 3 } },
  };
  window.__demoDb = db;

  const inst = (id) => db.instances.find((i) => i.id === id);

  // ---- server lifecycle ----------------------------------------------------
  // Startup phases follow the log markers get_instance_status() looks for.
  const PHASES = [
    [0.0, "Downloading server files...", 10],
    [0.5, "Starting Minecraft server...", 15],
    [1.0, "Loading mods...", 30],
    [1.5, "Loading properties...", 20],
    [1.8, "Preparing level...", 40],
    [2.1, "spawn", 0],
    [3.4, "Online", 100],
  ];
  function lifecycle(id) {
    const started = db.running[id];
    if (started === undefined) {
      if (db.stopping[id] !== undefined && vnow() - db.stopping[id] < 2.5 * S) return { running: true, ready: false, status: "Stopping...", pct: 0 };
      return { running: false, ready: false, status: "Offline", pct: 0 };
    }
    const e = (vnow() - started) / S;
    let phase = PHASES[0];
    for (const p of PHASES) if (e >= p[0]) phase = p;
    if (phase[1] === "Online") return { running: true, ready: true, status: "Online", pct: 100, e };
    if (phase[1] === "spawn") {
      const spawn = Math.min(99, Math.floor(((e - 2.1) / 1.3) * 100));
      return { running: true, ready: false, status: `Preparing spawn area (${spawn}%)`, pct: Math.floor(45 + spawn * 0.5), e };
    }
    return { running: true, ready: false, status: phase[1], pct: phase[2], e };
  }

  function statusOf(id) {
    const i = inst(id);
    const l = lifecycle(id);
    return {
      instance_id: id, is_running: l.running, is_ready: l.ready, is_paused: false,
      pending_snapshot: null, crash: null,
      version: i.version, type: i.type, port: i.port, bedrock_port: null,
      public_ip: "203.0.113.24", last_online: unix(-2 * 3600 * S),
      containers: l.running ? [{ id: "4f1c2a9e", name: `${id}-mc-1`, state: "running", image: "itzg/minecraft-server:latest" }] : [],
      startup_status: l.status, startup_percent: l.pct,
    };
  }

  const ONLINE_PLAYERS = { "survival-smp": ["Pillbug", "MossyCobble", "Tater_Tot"] };
  function players(id) {
    const l = lifecycle(id);
    if (!l.ready) return { available: false, online: 0, max: 0, players: [] };
    const names = ONLINE_PLAYERS[id] || [];
    return { available: true, online: names.length, max: 20, players: names };
  }

  // Minecraft's own log format, which the console's Simplified filter expects
  function stamp(e, thread = "Server thread") {
    const d = new Date(window.__vt.BASE + (db.running[currentLogId] ?? 0) + e * S);
    return `[${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}] [${thread}/INFO]: `;
  }
  let currentLogId = null;
  function logs(id) {
    const i = inst(id);
    const started = db.running[id];
    if (started === undefined) return { logs: "" };
    currentLogId = id;
    const e = (vnow() - started) / S;
    const L = [];
    const at = (t, msg, thread) => { if (e >= t) L.push(msg.startsWith("[init]") ? msg : stamp(t, thread) + msg); };
    at(0.0, `[init] Running as uid=1000 gid=1000 with /data as 'drwxr-xr-x 3 1000 1000 4096'`);
    at(0.1, `[init] Resolving type given ${i.type}`);
    at(0.3, `[init] Starting the Minecraft server...`);
    if (i.type === "FABRIC") {
      at(0.4, `Loading Minecraft ${i.version} with Fabric Loader 0.16.9`, "main");
      at(0.45, `Loading ${db.modsAtStart[id] ?? 3} mods:`, "main");
      at(0.45, `    - fabricloader 0.16.9`, "main");
      at(0.45, `    - java 21`, "main");
      at(0.45, `    - minecraft ${i.version}`, "main");
    }
    at(0.5, `Starting minecraft server version ${i.version}`);
    at(1.5, `Loading properties`);
    at(1.55, `Default game type: SURVIVAL`);
    at(1.6, `Starting Minecraft server on *:${i.port}`);
    at(1.8, `Preparing level "world"`);
    for (let p = 0; p <= 4; p++) at(2.1 + p * 0.3, `Preparing spawn area: ${Math.min(100, p * 25)}%`);
    at(3.4, `Done (3.391s)! For help, type "help"`);
    at(3.45, `Thread RCON Listener started`);
    for (const c of db.commands[id] || []) if (vnow() >= c.at + 300) L.push(stamp((c.at + 300 - started) / S) + c.log);
    return { logs: L.join("\n") + "\n" };
  }

  function config(id) {
    const i = inst(id);
    const env = { EULA: "TRUE", TYPE: i.type, VERSION: i.version, MEMORY: i.memory, DIFFICULTY: "normal", MODE: "survival", MOTD: i.name, ENABLE_RCON: "true" };
    if (db.mods[id]?.length) env.MODRINTH_PROJECTS = db.mods[id].join(",");
    return { image: "itzg/minecraft-server:latest", environment: env, restart_policy: "on-failure" };
  }

  // Search results. Names and summaries follow the projects' Modrinth pages; authors and
  // download counts are rounded placeholders, see README.md.
  const MODRINTH = {
    waystones: { name: "Waystones", author: "BlayTheNinth", dl: 41000000, summary: "Teleport back to activated waystones. For Survival, Adventure or Servers.", icon: "waystones", v: "21.1.13+fabric-1.21.1" },
    lithium: { name: "Lithium", author: "jellysquid3", dl: 39000000, summary: "No-compromises game logic optimization mod.", icon: "lithium", v: "mc1.21.1-0.14.3" },
    "fabric-api": { name: "Fabric API", author: "modmuss50", dl: 130000000, summary: "Lightweight and modular API providing common hooks and intercompatibility measures utilized by mods using the Fabric toolchain.", icon: "fabric", v: "0.116.0+1.21.1" },
    balm: { name: "Balm", author: "BlayTheNinth", dl: 36000000, summary: "Abstraction layer for Fabric, Forge and NeoForge mods.", icon: "balm", v: "21.0.31+fabric-1.21.1" },
    "ferrite-core": { name: "FerriteCore", author: "malte0811", dl: 60000000, summary: "Memory usage optimizations.", icon: "ferrite", v: "7.0.2" },
    terralith: { name: "Terralith", author: "Stardust Labs", dl: 16000000, summary: "Explore almost 100 new biomes consisting of both realism and light fantasy, using just Vanilla blocks.", icon: "terralith", v: "2.5.5" },
    chunky: { name: "Chunky", author: "pop4959", dl: 12000000, summary: "Pre-generates chunks, quickly, efficiently, and safely.", icon: "chunky", v: "1.4.16" },
    spark: { name: "spark", author: "lucko", dl: 30000000, summary: "spark is a performance profiler for Minecraft clients, servers, and proxies.", icon: "spark", v: "1.10.109" },
  };
  const DEPS = { waystones: ["balm", "fabric-api"] };
  const hit = (id) => {
    const m = MODRINTH[id];
    return { id, name: m.name, summary: m.summary, icon_url: ICON(m.icon), latest_version: m.v, url: `https://modrinth.com/mod/${id}`, provider: "modrinth", author: m.author, downloads: m.dl, client_side: "optional", server_side: "required" };
  };

  function modsList(id) {
    return (db.mods[id] || []).map((mid) => {
      const m = MODRINTH[mid];
      return { filename: `${mid}-${m.v}.jar`, id: mid, name: m.name, version: m.v, enabled: true, size: 1.4 * MB, modified: unix(-86400 * S), modified_str: "11/12/26 21:14", icon_url: ICON(m.icon), summary: m.summary, url: `https://modrinth.com/mod/${mid}`, provider: "modrinth", source: "file" };
    });
  }

  function resources() {
    const out = {};
    let cpu = 0, mem = 0;
    for (const i of db.instances) {
      const l = lifecycle(i.id);
      if (!l.running) continue;
      const c = l.ready ? 6.5 + 2 * Math.sin(vnow() / 4000 + i.port) : 38;
      const m = (l.ready ? 2.1 : 0.9) * GB;
      out[i.id] = { cpu_percent: c, memory_used: m, memory_allocated: parseInt(i.memory) * GB };
      cpu += c; mem += m;
    }
    return { instances: out, total: { cpu_percent: cpu / 8, memory_used: mem, memory_allocated: 0, host_memory: 32 * GB, host_cpus: 8 } };
  }

  // ---- router ----------------------------------------------------------------
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  function route(method, path, q, body) {
    let m;
    if (path === "/api/auth/status") return { setup_required: false, authenticated: true, username: "admin" };
    if (path === "/api/health") return { status: "ok" };
    if (path === "/api/settings") return { theme: "Light", language: "en", autoRefresh: true, showSnapshots: false, defaultPort: "25565", defaultMemory: "2G", defaultLoader: "vanilla", defaultWhitelistEnabled: false, defaultWhitelistUsers: [] };
    if (path === "/api/groups") return db.groups;
    if (path === "/api/system/check-updates") return { current_version: "0.5.0", has_update: false };
    if (path === "/api/system/info") return { version: "0.5.0" };
    if (path === "/api/resources") return resources();
    if (path === "/api/meta/versions") return { versions: ["1.21.4", "1.21.3", "1.21.1", "1.21", "1.20.6", "1.20.4", "1.20.1", "1.19.4", "1.18.2"].map((id) => ({ id, type: "release", releaseTime: "2024-12-03T10:12:57+00:00" })) };
    if ((m = path.match(/^\/api\/meta\/loaders\/(\w+)$/))) return (m[1] === "FABRIC" ? ["0.16.9", "0.16.8", "0.16.7", "0.16.6"] : m[1] === "PAPER" ? ["232", "231", "230"] : ["21.4.75", "21.4.70"]).map((id) => ({ id, stable: true }));
    if (path === "/api/instances" && method === "GET")
      return db.instances.map((i) => ({ id: i.id, name: i.name, path: `/servers/${i.id}`, has_compose: true, status: "Valid", group: i.group, icon_url: i.icon ? ICON(i.icon) : undefined }));
    if (path === "/api/instances" && method === "POST") {
      const i = { id: slug(body.name), name: body.name, group: body.group || "No group", type: (body.template || "vanilla").toUpperCase(), version: body.version || "1.21.4", port: body.port || 25565, memory: body.memory || "2G", icon: null };
      db.instances.push(i);
      return { id: i.id, name: i.name, path: `/servers/${i.id}`, has_compose: true, status: "Valid", group: i.group };
    }
    if (path.startsWith("/api/mods/search/")) {
      const term = (q.get("q") || "").toLowerCase();
      const ids = Object.keys(MODRINTH).filter((k) => (!term || k.includes(term) || MODRINTH[k].name.toLowerCase().includes(term)));
      return ids.map(hit);
    }
    if (path === "/api/mods/dependencies") return DEPS[q.get("project_id")] || [];
    if (path === "/api/mods/metadata") return (q.get("modrinth_ids") || "").split(",").filter(Boolean).map((id) => ({ ...hit(id), requested_id: id }));
    if (path === "/api/mods/check-compatibility") return { compatible: true, issues: [] };

    if ((m = path.match(/^\/api\/instances\/([^/]+)(\/.*)?$/))) {
      const id = m[1], rest = m[2] || "";
      if (rest === "/status") return statusOf(id);
      if (rest === "/start") { db.running[id] = vnow(); db.modsAtStart[id] = 3 + (db.mods[id] || []).length; delete db.stopping[id]; return { message: "started" }; }
      if (rest === "/stop" || rest === "/kill") { delete db.running[id]; db.stopping[id] = vnow(); return { message: "stopped" }; }
      if (rest === "/players") return players(id);
      if (rest === "/bans") return [];
      if (rest === "/logs") return logs(id);
      if (rest === "/config" && method === "PUT") { db.mods[id] = (body?.environment?.MODRINTH_PROJECTS || "").split(",").filter(Boolean); return { message: "saved", failed: [] }; }
      if (rest === "/config") return config(id);
      if (rest === "/users") return { users: [], whitelist_enabled: false, whitelist: [], ops: [], banned: [] };
      if (rest === "/mods" && method === "GET") return modsList(id);
      if (rest === "/mods" && method === "POST") { const add = body?.mod_ids || body?.ids || []; db.mods[id] = [...new Set([...(db.mods[id] || []), ...add])]; return { message: "ok" }; }
      if (rest === "/snapshots/pending") return null;
      if (rest === "/crash" || rest === "/crash-report") return null;
      if (rest === "/backups" && method === "GET") return { settings: db.backupSettings[id] || { enabled: false, interval_hours: 24, keep: 7, snapshot_keep: 3 }, backups: db.backups[id] || [], snapshots: [], worlds: ["world"], location: `/servers/${id}/backups` };
      if (rest === "/backups" && method === "POST") {
        const d = new Date();
        const b = { name: `world-2026-11-13-${String(d.getHours()).padStart(2, "0")}-${String(d.getMinutes()).padStart(2, "0")}.zip`, created: unix(vnow()), size: 184 * MB, kind: "manual" };
        db.backups[id] = [b, ...(db.backups[id] || [])];
        return b;
      }
      if (rest === "/backups/settings") { if (method !== "GET" && body) db.backupSettings[id] = body; return db.backupSettings[id] || {}; }
      if (rest === "/command") {
        const cmd = body?.command || "";
        const reply = cmd === "list" ? `There are 0 of a max of 20 players online: ` : "";
        const log = cmd.startsWith("say ") ? `[Rcon] ${cmd.slice(4)}` : `Rcon issued server command: /${cmd}`;
        (db.commands[id] ||= []).push({ at: vnow(), log });
        return { response: cmd === "list" ? reply : "" };
      }
      if (rest === "/files") return { path: ".", items: [] };
      if (rest === "") return inst(id);
    }
    console.warn("[demo backend] unhandled", method, path);
    return [];
  }

  const DELAYS = [
    ["POST", /^\/api\/instances$/, 900],
    ["POST", /\/backups$/, 1100],
    ["GET", /^\/api\/mods\/search\//, 350],
    ["PUT", /\/config$/, 900],
  ];
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
    const method = (init.method || "GET").toUpperCase();
    let body = null;
    if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    // Slow operations answer after a delay on the virtual clock, like the real backend would.
    const delay = DELAYS.find(([m, re]) => m === method && re.test(url.pathname))?.[2] || 0;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    window.__vtPending.inc();
    try {
      const out = route(method, url.pathname, url.searchParams, body);
      (window.__apiLog ||= []).push(`${method} ${url.pathname}${url.search}${body ? " " + JSON.stringify(body) : ""}`);
      return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
    } finally {
      window.__vtPending.dec();
    }
  };
})();
