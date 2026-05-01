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
version: '3.8'
services:
  isopod:
    image: isopod:latest
    container_name: isopod
    restart: unless-stopped
    network_mode: bridge
    ports:
      - "8000:8000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /DATA/AppData/isopod/servers:/DATA/AppData/isopod/servers
    environment:
      - SERVERS_DIR=/DATA/AppData/isopod/servers
    x-casaos:
      title: Isopod
      icon: https://raw.githubusercontent.com/Isopod-Project/Isopod-Website/main/public/Isopod_logo.png
      main: isopod
      port_map: "8000"
      scheme: http
```

6. Click **Submit**.
7. CasaOS will pre-fill the form. Click **Install**.

## 3. Configuration Details (Manual Check)
If you prefer to fill out the form manually, ensure these settings are correct:

- **Web UI Port**: `8000`
- **Port Mapping**: Host `8000` -> Container `8000`
- **Volumes**:
    - `/var/run/docker.sock` -> `/var/run/docker.sock` (Required for Docker-in-Docker support)
    - `/DATA/AppData/isopod/servers` -> `/DATA/AppData/isopod/servers` (Stores your MC servers)
- **Environment Variables**:
    - `SERVERS_DIR`: `/DATA/AppData/isopod/servers`

## 4. Accessing Isopod
Once installed, the Isopod icon will appear on your dashboard. Clicking it will open the management interface at `http://your-server-ip:8000`.
