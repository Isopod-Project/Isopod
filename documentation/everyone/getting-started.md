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
3. **Open the Dashboard:**
   Navigate to [http://localhost:8000](http://localhost:8000) in your web browser.

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
