# Installing Isopod on CasaOS

This guide covers how to install Isopod as a native app on a CasaOS dashboard.

## 1. Build the Docker Image
Since Isopod is currently in development, you must build the image locally on your server.

1. SSH into your server.
2. Navigate to your Isopod project directory:
   ```bash
   cd /path/to/Isopod
   ```
3. Build the image:
   ```bash
   docker build -t isopod:latest .
   ```

## 2. Install via CasaOS Dashboard
1. Open your CasaOS dashboard.
2. Click **App Store**.
3. Click **Custom Install** (top right).
4. Click the **Import** button (the `[->]` icon in the top right).
5. Paste the following configuration:

```yaml
name: isopod

services:
  isopod:
    image: isopod:latest
    container_name: isopod
    privileged: true
    restart: unless-stopped
    network_mode: bridge
    ports:
      - "8000:8000"
      - "25565-25585:25565-25585"
    volumes:
      - /DATA/AppData/isopod/servers:/servers
      - /DATA/AppData/isopod/docker:/var/lib/docker
    environment:
      - SERVERS_DIR=/servers
    labels:
      icon: "https://raw.githubusercontent.com/Isopod-Project/Isopod-Website/main/public/Isopod_logo.png"
      title: "Isopod"
      description: "Modern Minecraft Server Manager"
      casaos_app_id: "isopod"

x-casaos:
  architectures:
    - amd64
    - arm64
  main: isopod
  author: Tacoz234
  category: Utilities
  description:
    en_us: Modern, lightweight Minecraft instance manager with a sleek web dashboard.
  developer: Tacoz234
  icon: https://raw.githubusercontent.com/Isopod-Project/Isopod-Website/main/public/Isopod_logo.png
  thumbnail: https://raw.githubusercontent.com/Isopod-Project/Isopod-Website/main/public/Isopod_logo.png
  title:
    en_us: Isopod
  port_map: "8000"
  scheme: http
```

6. Click **Submit**.
7. For Icon URL, replace what's autofilled from CasaOS with `https://raw.githubusercontent.com/Isopod-Project/Isopod-Website/main/public/Isopod_logo.png`
8. Click **Install**.

## 3. Configuration Details (Manual Check)
If you prefer to fill out the form manually, ensure these settings are correct:

- **Privileged Mode**: `Enabled` (Required for internal Docker-in-Docker isolation)
- **Web UI Port**: `8000` (Host `8000` -> Container `8000`)
- **Game Server Ports**: Host `25565-25585` -> Container `25565-25585` (Allows up to 21 concurrent server instances)
- **Volumes**:
    - `/DATA/AppData/isopod/servers` -> `/servers` (Stores your Minecraft servers and world data)
    - `/DATA/AppData/isopod/docker` -> `/var/lib/docker` (Persists downloaded server images and caches)
- **Environment Variables**:
    - `SERVERS_DIR`: `/servers`

> [!NOTE]
> **Single App Dashboard Experience**:
> Unlike older versions, Isopod no longer mounts the host `/var/run/docker.sock`. Because Isopod manages its server containers internally, individual Minecraft worlds will no longer spawn separate "Legacy app (To be rebuilt)" entries on your CasaOS home screen. Only the main Isopod application is displayed!

## 4. Accessing Isopod
Once installed, the Isopod icon will appear on your dashboard. Clicking it will open the management interface at `http://your-server-ip:8000`.

