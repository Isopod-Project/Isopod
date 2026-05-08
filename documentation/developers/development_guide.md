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

*Note: I've added a `.gitattributes` file to the repo to help prevent this automatically in the future.*

---

## 🛠️ Tech Stack
- **Backend**: FastAPI (Python 3.11)
- **Frontend**: React + Vite (TypeScript)
- **Dev Tooling**: Uvicorn (Auto-reload), Node.js 20
