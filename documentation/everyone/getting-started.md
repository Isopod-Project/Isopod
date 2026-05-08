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
- **Mod Management**: Search and install mods directly from Modrinth and CurseForge.
- **Live Console**: Watch your server logs in real-time.
- **RCON Support**: Send commands to your server without leaving the dashboard.

## ❓ Need Help?
Check out the [FAQ](faq.md) (coming soon) or open an issue on GitHub.
