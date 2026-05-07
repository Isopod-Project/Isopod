# 🛠️ Isopod Development Guide

This guide explains how to set up and use the **Isopod Development Environment**. This environment allows you to see changes to the backend and frontend immediately without full rebuilds.

## 🏗️ The "Pull & Restart" Workflow
1. **Pull Changes**: `git pull` or `git checkout <branch>` on your server.
2. **Restart**: Click "Restart" in CasaOS or run `docker restart isopod-dev`.
3. **Automatic Sync**: The container will automatically:
   - Install new Python dependencies.
   - Rebuild the React frontend.
   - Hot-reload the FastAPI backend.

---

## 🏠 Setup via CasaOS Dashboard

1. **Build the image locally** (One-time only):
   SSH into your server and run:
   ```bash
   cd /path/to/Isopod
   docker build -t isopod:dev -f Dockerfile.dev .
   ```

2. **Install in CasaOS**:
   - Go to **App Store** -> **Custom Install**.
   - Click **Import** and paste the contents of `docker-compose.dev.yml`.
   - **Important**: In the "Volumes" section, ensure the Host path for `/app` is set to the **absolute path** of your repository (e.g., `/home/tacoz/Isopod`).

3. **Port**: The dev environment defaults to port **8001** to avoid conflicting with the production build on 8000.

---

## 💻 Setup via Terminal (Docker Compose)

If you prefer using the terminal directly:

1. **Configure Paths**:
   Create a `.env` file in the root directory (optional):
   ```env
   PROJECT_ROOT=/home/tacoz/Isopod
   SERVERS_DIR=/DATA/AppData/isopod/servers
   DEV_PORT=8001
   ```

2. **Start the Environment**:
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```

3. **View Logs**:
   ```bash
   docker compose -f docker-compose.dev.yml logs -f
   ```

---

## 📁 Key Development Files
- **`Dockerfile.dev`**: Defines the environment (Python + Node.js).
- **`dev-entrypoint.sh`**: The script that manages dependencies and builds on every restart.
- **`docker-compose.dev.yml`**: Orchestrates the development container.

## 🛠️ Tech Stack
- **Backend**: FastAPI (Python)
- **Frontend**: React + Vite (TypeScript)
- **Containerization**: Docker
