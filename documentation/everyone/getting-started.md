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

## 📂 File Explorer Shortcuts & Actions
- **Right-Click**: Access context menus for quick actions (New File, New Folder, Rename, Delete, Cut, Copy, Paste, Download).
- **Drag & Drop**: Drag files and folders into directories or breadcrumbs to move them; drag files directly from your computer to upload.
- **Keyboard Shortcuts**:
  - `Delete`: Delete selected files.
  - `F2`: Inline rename selected item.
  - `Ctrl + C` / `Ctrl + X` / `Ctrl + V`: Copy, cut, and paste files.
  - `Ctrl + A`: Select all items.
  - `Esc`: Cancel inline editing or dismiss context menu.

## ❓ Need Help?
Check out the [FAQ](faq.md) (coming soon) or open an issue on GitHub.
