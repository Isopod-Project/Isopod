# 🛠️ Isopod Development Guide

This guide will walk you through setting up the **Isopod Development Environment**. 

The goal of this setup is to allow you (or a friend!) to develop and test changes in real-time. This environment automatically syncs your code changes, rebuilds the frontend, and restarts the backend whenever you restart the container.

---

## 📋 Prerequisites

Before you start, make sure you have:
1. **Git** installed on your server or local machine.
2. **Docker** and **Docker Compose** installed.
3. **CasaOS** installed (if you prefer using the dashboard).

---

## 🏠 Method 1: Setup via CasaOS Dashboard (Recommended)

Follow these steps exactly to get a "100% working" setup.

### 1. Clone the Repository
SSH into your server and download the code to a known location:
```bash
cd /home/your-user  # Or wherever you store apps
git clone https://github.com/tacoz234/Isopod.git
cd Isopod
```

### 2. Build the Dev Image (One-Time)
Run this command to create the specialized development image:
```bash
docker build -t isopod:dev -f docker/Dockerfile.dev .
```

### 3. Install in CasaOS
1. Open your **CasaOS Dashboard**.
2. Click **App Store** -> **Custom Install** (top right).
3. Click the **Import** button (top right icon) and paste the contents of `docker/docker-compose.dev.yml` from your repo.
4. **Important UI Settings**: After importing, fill in these specific fields:
   - **App Name**: `Isopod Dev`
   - **Icon URL**: `https://raw.githubusercontent.com/tacoz234/Isopod/main/assets/dev_logo.png`
   - **Web UI Port**: `8001`
   - **Network**: `Bridge`
5. **Volume Mapping**: Scroll down to "Volumes" and ensure these are set:
   - **Host Path**: `/home/your-user/Isopod` (The absolute path to your repo)
   - **Container Path**: `/app`
   - **Host Path**: `/DATA/AppData/isopod/servers` (Or wherever you store server data)
   - **Container Path**: `/DATA/AppData/isopod/servers`
6. Click **Install**.

---

## 💻 Method 2: Setup via Terminal (Docker Compose)

If you prefer using the command line:

### 1. Configure your Environment
Create a file named `.env` in the root of the Isopod directory:
```env
PROJECT_ROOT=/home/your-user/Isopod
SERVERS_DIR=/DATA/AppData/isopod/servers
DEV_PORT=8001
```

### 2. Launch the Container
```bash
docker compose -f docker/docker-compose.dev.yml up -d
```

---

## 🔄 The "Pull & Restart" Workflow

Once set up, your development cycle becomes incredibly simple:

1. **Modify Code**: Edit files locally (if using VS Code Remote) or run `git pull` on the server.
2. **Restart**: 
   - **CasaOS**: Click the three dots on the "Isopod Dev" icon and select **Restart**.
   - **Terminal**: Run `docker restart isopod-dev`.
3. **Watch the Magic**: The container will automatically:
   - Install any new Python packages found in `requirements.txt`.
   - Re-build the React frontend with development flags.
   - Start the FastAPI backend with **Hot Reload** (backend changes sync instantly without needing another restart!).

---

## ❓ Troubleshooting

### "Port already in use"
If you get an error saying port 8001 is taken, change the **Web UI Port** to `8002` or any other free port in the CasaOS settings or your `.env` file.

### "Frontend not loading"
Wait a minute! The first time you start the container, it has to run `npm install`, which can take 1-2 minutes depending on your internet and CPU. You can check progress by clicking **Settings -> Terminal & Logs** in CasaOS.

### "Permission Denied"
Make sure the user running Docker has permissions to the `Isopod` folder. You can fix this with:
```bash
sudo chown -R $USER:$USER /home/your-user/Isopod
```

### "exec /app/docker/dev-entrypoint.sh: no such file or directory"
This is a common issue when cloning the repository on **Windows**. Windows uses different "line endings" (CRLF) than Linux (LF). 

**The Fix**:
1. Open the project in **VS Code**.
2. Open `docker/dev-entrypoint.sh`.
3. In the bottom-right corner of the window, you will see `CRLF`. Click it and change it to `LF`.
4. Save the file and restart the container.

### RAM usage always shows 0
Isopod runs servers on its own Docker daemon inside the container (DinD). On cgroup v2 hosts, `docker/entrypoint.sh` and `docker/dev-entrypoint.sh` move the container's processes into a child cgroup and enable every controller before starting `dockerd`, the same as the official `docker:dind` image. Without that step `dockerd` falls back to a threaded cgroup that only supports CPU stats, so memory reads as 0 (`docker exec isopod docker stats` shows `0B / 0B`).

**The Fix**: Rebuild the image and recreate the container. The setting can't be changed on a container that's already running.

---

## 🔌 Resource Usage API
`GET /api/resources` returns live usage for every running instance plus totals, read from Docker container stats (`backend/resource_usage.py`):
```json
{
  "instances": { "my-server": { "cpu_percent": 3.1, "memory_used": 2368000000, "memory_allocated": 2147483648 } },
  "total": { "cpu_percent": 3.1, "memory_used": 2368000000, "memory_allocated": 2147483648, "host_memory": 16295006208, "host_cpus": 32 }
}
```
- `cpu_percent` is a share of the whole host (100 = every core busy), not per-core like `docker stats`.
- `memory_used` excludes reclaimable page cache, matching `docker stats`.
- `memory_allocated` is the instance's `MEMORY` setting (the Java heap) in bytes, or `null` if unset.
- Only running instances appear in `instances`. Each call takes about a second because Docker samples CPU twice.

---

## 📱 Bedrock Support
`backend/bedrock.py` holds everything Bedrock-specific; `frontend/src/lib/bedrock.ts` and `frontend/src/components/Bedrock.tsx` mirror it in the dashboard.

**Bedrock servers.** `POST /api/instances` with `"template": "bedrock"` writes a compose service on `itzg/minecraft-bedrock-server` instead of `itzg/minecraft-server`:
- The port maps to `19132/udp`, and `TYPE=BEDROCK` stays in the environment so the rest of the backend can tell Bedrock instances apart (the image itself ignores it).
- World settings use the Bedrock image's names: `LEVEL_SEED`, `GAMEMODE`, `LEVEL_TYPE` (`DEFAULT`/`FLAT`/`LEGACY`), and `ALLOW_LIST`/`ALLOW_LIST_USERS` for the whitelist. `VERSION` is `LATEST`, `PREVIEW`, or an exact release.
- There's no RCON. `POST /api/instances/{id}/command` runs the image's `send-command` helper, which needs `stdin_open` and `tty` on the service; its output only reaches the log. `GET /players` always returns `available: false`.
- User Management uses the same `/users` endpoints, handled by `backend/bedrock_users.py`. `users.json` is the source of truth. A save mirrors it to `ALLOW_LIST`/`ALLOW_LIST_USERS`/`OPS` (the entrypoint rebuilds `allowlist.json` and `permissions.json` from them on every start), to those two files directly (the entrypoint leaves a file alone when its variable is empty), and to `allowlist add/remove`, `allowlist on/off`, and `op`/`deop` on a running server. `ALLOW_LIST_USERS` stays empty while the allowlist is off, because the entrypoint turns the allowlist on whenever it has names. Operators are stored by XUID, which is taken from `allowlist.json` (BDS fills it in when an allowlisted player joins) or looked up from mcprofile.io, falling back to the gamertag in `OPS`. Gamertags can't contain commas, colons, or quotes.
- The server is **Online** once the log prints `Server started.`.
- Worlds live in `data/worlds/<level name>/`, so `backups.find_world_dirs` reports `worlds`. While the server runs, backups send `save hold`, wait a few seconds, and `save resume` afterwards.

**Cross-play.** Java servers keep two settings in their environment: `ISOPOD_CROSSPLAY` (`true`/`false`) and `ISOPOD_BEDROCK_PORT`. On `PUT /api/instances/{id}/config`, `bedrock.apply_crossplay` turns them into real settings:
- Adds Geyser and Floodgate download URLs from `download.geysermc.org` to `PLUGINS` (Paper, Purpur) or `MODS` (Fabric, NeoForge), and `fabric-api` to `MODRINTH_PROJECTS` on Fabric.
- Publishes `<ISOPOD_BEDROCK_PORT>:19132/udp`.
- Turning it off removes those URLs, the port, and any `geyser*`/`floodgate*` jars in `plugins/` or `mods/`. Nothing happens unless cross-play is on or was on before the save, so a hand-installed Geyser is left alone.
- Other server types get a 400.

Duplicating or importing an instance moves every published port, the Bedrock UDP one included, to a free host port.

`GET /api/instances/{id}/status` also returns `type` (the `TYPE` setting) and `bedrock_port`: the UDP port Bedrock players join on, or `null` if they can't.

The Isopod container publishes UDP `19132-19152` for these ports next to TCP `25565-25585`.

---

## 🔐 Authentication

`backend/auth.py` adds a single admin login:

- **Storage:** `SERVERS_DIR/.isopod_auth.json` holds the username, the argon2 password hash, and the SHA-256 hashes of live session tokens. If the file exists but can't be read, the API answers `503` instead of reopening first-run setup.
- **Sessions:** `POST /api/auth/setup` (only while no account exists) and `POST /api/auth/login` set the `isopod_session` cookie: random, `HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS, 30 days. `POST /api/auth/logout` revokes it on the server. `POST /api/auth/password` changes the password and ends every other session. After 10 failed logins from one address in 15 minutes, logins from it get `429`.
- **Enforcement:** `AuthMiddleware` answers `401` to every `/api` request and WebSocket upgrade without a valid session. Only `/api/health` and `/api/auth/{status,login,setup,logout}` are open. The frontend files themselves are public.
- **Frontend:** `AuthGate` (`frontend/src/components/AuthGate.tsx`) wraps `App`. It shows setup or login until `/api/auth/status` says the user is logged in, and goes back to the login screen whenever an `/api` call returns `401`. The e2e fixtures answer `/api/auth/status` as logged in, so other specs don't need to log in.

For scripts, log in once and reuse the cookie:

```bash
curl -c jar -H 'Content-Type: application/json' -d '{"username":"admin","password":"..."}' http://<host>:8000/api/auth/login
curl -b jar http://<host>:8000/api/instances
```

Scoped API tokens for automation (`Authorization: Bearer`) are tracked in #68.

---

## 🔒 Cross-origin requests

The backend serves the frontend, so the browser only talks to the API from the same origin and the backend allows no cross-origin access by default (`backend/security.py`):

- No CORS headers are sent unless `ISOPOD_CORS_ORIGINS` is set.
- `POST`/`PUT`/`PATCH`/`DELETE` requests and WebSocket upgrades are rejected with `403` when their `Origin` header doesn't match the `Host` they were sent to. CORS alone doesn't stop a foreign page from sending a simple form `POST` or opening a WebSocket. Requests without an `Origin` header (curl, scripts) aren't affected.

For the Vite dev server, `npm run dev` proxies `/api` to `http://localhost:8000` (change it with `VITE_API_PROXY`), so the frontend stays same-origin and needs no extra setting. To call the API from another origin, such as a reverse proxy that rewrites the `Host` header or a separately hosted frontend, list the origins comma-separated:

```env
ISOPOD_CORS_ORIGINS=http://localhost:5173,https://isopod.example.com
```

---

## 🛠️ Tech Stack
- **Backend**: FastAPI (Python 3.11)
- **Frontend**: React + Vite (TypeScript)
- **Dev Tooling**: Uvicorn (Auto-reload), Node.js 20
