# 🦀 Isopod
![Isopod Logo](README_logo.png)

**Isopod** is a modern, lightweight, and powerful Minecraft Instance Manager built on Docker. It provides a Prism-like experience for self-hosted Minecraft servers with a sleek, interactive dashboard.

## ✨ Features
- **Prism-Like Instance Management**: Easily create, configure, and manage separate Minecraft server instances.
- **Smart Mod Management**: 
  - Integrated Search for **Modrinth** and **CurseForge**.
  - **Auto-Dependency Resolution**: Automatically find and add required library mods.
  - **Version/Loader Safety**: Warnings for mismatched mods (e.g., Forge mod on a Fabric server).
  - **Server-Only Filtering**: Results are filtered to hide client-only mods by default.
- **Live Console & RCON**: 
  - Auto-scrolling logs with real-time updates.
  - Integrated RCON command input to execute commands on the fly.
- **Status Awareness**: Distinguishes between `Offline`, `Starting`, and `Online` states using log-based heartbeat detection.
- **Modern UI**: Dark-mode, glassmorphic design built with React, Tailwind, and Lucide icons.

## 🚀 Quick Start
1. Ensure you have **Docker** and **Docker Compose** installed.
2. Clone this repository: `git clone https://github.com/Tacoz234/Isopod.git`
3. Start the application: `docker compose up -d`
4. Access the dashboard at `http://localhost:8000`.

## 🛠 Tech Stack
- **Frontend**: React, TypeScript, Vite, TailwindCSS, Lucide Icons.
- **Backend**: Python, FastAPI, Docker SDK.
- **Orchestration**: Docker Compose.
- **Base Image**: [itzg/minecraft-server](https://github.com/itzg/docker-minecraft-server).

## 🦀 Mascot
The official mascot of Isopod is a colorful, rolling isopod (woodlouse), representing the project's focus on encapsulation, portability (rolling!), and vibrancy.

---
*Created by [Tacoz234](https://github.com/Tacoz234)*
