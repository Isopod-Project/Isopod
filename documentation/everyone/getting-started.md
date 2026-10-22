# 🚀 Getting Started with Isopod

Welcome to **Isopod**! This guide will help you get your Minecraft Instance Manager up and running.

## 📋 Prerequisites
- **Docker**: [Install Docker](https://docs.docker.com/get-docker/)
- **Docker Compose**: [Install Docker Compose](https://docs.docker.com/compose/install/)

## 🛠 Installation
1. **Clone the project:**
   ```bash
   git clone https://github.com/Tacoz234/Isopod.git
   ```
2. **Launch the service:**
   ```bash
   docker compose -f isopod-compose.yml up -d --build
   ```
   On macOS, see [Running on macOS](#-running-on-macos) instead.
3. **Open the Dashboard:**
   Navigate to [http://localhost:8000](http://localhost:8000) in your web browser.

## 🍎 Running on macOS
`isopod-compose.yml` stores data under `/DATA/AppData/isopod`, a CasaOS path that doesn't exist on a Mac. Docker Desktop can only mount folders it shares with containers (your home folder by default). The macOS overlay `docker/isopod-compose.macos.yml` swaps in Mac-friendly locations.

**One-time setup:** create a file named `.env` in the root of your clone so Docker Compose always loads the overlay:

```bash
echo "COMPOSE_FILE=isopod-compose.yml:docker/isopod-compose.macos.yml" > .env
```

From then on, run plain `docker compose` commands without any `-f` flags:

```bash
docker compose up -d --build   # start or update
docker compose down            # stop
docker compose logs -f         # watch logs
```

> Don't add `-f isopod-compose.yml`: any `-f` flag makes Docker Compose ignore the `.env` setting and skip the overlay, and the start fails with `mounts denied`. To skip the `.env` file, pass both files on every command: `docker compose -f isopod-compose.yml -f docker/isopod-compose.macos.yml up -d --build`.

Server folders and worlds are stored in `data/servers` inside your clone. Docker images that Isopod downloads, like `itzg/minecraft-server`, go in a Docker volume named `isopod_isopod-docker`. Keep the clone under your home folder, or add its location in Docker Desktop under **Settings → Resources → File sharing**.

## 🦀 Features at a Glance
- **Instance Creation**: Quickly spin up new Minecraft servers.
- **Mod Management**: Search and install mods directly from Modrinth.
- **Desktop-Grade File Explorer**: Right-click context menus, drag-and-drop file moves & direct OS uploads, breadcrumb navigation, inline renaming/creation, multi-select, and conflict resolution.
- **Live Console**: Watch your server logs in real-time.
- **RCON Support**: Send commands to your server without leaving the dashboard.
- **Resource Usage**: See live CPU and RAM use for each running server and for all of them combined.

## 📂 File Explorer Shortcuts & Actions
- **Right-Click**: Access context menus for quick actions (New File, New Folder, Rename, Delete, Cut, Copy, Paste, Download).
- **Drag & Drop**: Drag files and folders into directories or breadcrumbs to move them; drag files directly from your computer to upload.
- **Keyboard Shortcuts**:
  - `Delete`: Delete selected files.
  - `F2`: Inline rename selected item.
  - `Ctrl + C` / `Ctrl + X` / `Ctrl + V`: Copy, cut, and paste files.
  - `Ctrl + A`: Select all items.
  - `Esc`: Cancel inline editing or dismiss context menu.

## 📊 Resource Usage
Live usage updates every few seconds while **Automatic Refresh** is on in Settings, and whenever you press **Refresh**.
- **All servers**: The top bar shows total CPU and RAM for every running server, with RAM shown against your machine's total memory (e.g. `3.1/16 GB`). It is hidden on screens narrower than 1366px to keep the top bar from wrapping.
- **One server**: Select a running server to see its CPU and RAM in the side panel. Running servers also show their RAM under their tile.
- **CPU** is a share of your whole machine: 100% means every core is busy. Minecraft mostly runs on one core, so a busy server on an 8-core machine shows around 12%.
- **RAM** is shown as `2.2 GB used · 2.0 GB heap`. The heap is the memory set aside for Minecraft's world data: **Default RAM Allocation** in Settings when the server was created, or `MEMORY` in its raw environment config. Java needs extra memory on top of it, so using 10–30% more than the heap is normal and not a sign the server is over its limit.

## ❓ Need Help?
Check out the [FAQ](faq.md) (coming soon) or open an issue on GitHub.
