#!/bin/bash
set -e

echo "----------------------------------------------------"
echo "🚀 Isopod Development Mode Starting..."
echo "----------------------------------------------------"

# On cgroup v2 the container starts in the root cgroup, which has processes in it, so the
# kernel won't delegate domain controllers (memory, io) to the daemon's child cgroups and
# `docker stats` reports 0 memory. Move our processes into a leaf and enable every
# controller for children first (same as the official docker:dind entrypoint).
enable_cgroup_nesting() {
    if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
        mkdir -p /sys/fs/cgroup/init
        xargs -rn1 < /sys/fs/cgroup/cgroup.procs > /sys/fs/cgroup/init/cgroup.procs 2>/dev/null || true
        sed -e 's/ / +/g' -e 's/^/+/' < /sys/fs/cgroup/cgroup.controllers > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true
    fi
}

# Check if external docker socket is available, or start internal dockerd (DinD)
if [ -S /var/run/docker.sock ] && docker info >/dev/null 2>&1; then
    echo "✅ Using host Docker daemon at /var/run/docker.sock."
else
    echo "🐳 Initializing internal Docker daemon (DinD) in dev mode..."
    rm -f /var/run/docker.pid /var/run/docker.sock /var/run/docker/containerd/containerd.pid 2>/dev/null || true
    mkdir -p /var/log /var/run
    enable_cgroup_nesting
    dockerd > /var/log/dockerd.log 2>&1 &
    DOCKERD_PID=$!
    WAIT_COUNT=0
    while [ $WAIT_COUNT -lt 30 ]; do
        if docker info >/dev/null 2>&1; then
            echo "✅ Internal Docker daemon is ready."
            break
        fi
        sleep 1
        WAIT_COUNT=$((WAIT_COUNT + 1))
    done
fi


echo "📦 Checking Python dependencies..."
if [ -f "backend/requirements.txt" ]; then
    # Using default cache location which is mapped to a volume
    pip install -r backend/requirements.txt
fi

# 2. Build Frontend (if source exists)
if [ -d "frontend" ]; then
    echo "🏗️ Checking Frontend..."
    cd frontend
    
    # Only install if node_modules is missing
    if [ ! -d "node_modules" ]; then
        echo "📥 Installing Node modules (first time only)..."
        npm install
    fi
    
    echo "🔨 Building frontend (Dev Mode)..."
    echo "VITE_DEV_BUILD=true" > .env
    npm run build
    cd ..
fi

# 3. Start Backend with Auto-Reload
echo "🔥 Starting FastAPI backend with reload enabled..."
echo "----------------------------------------------------"

# Note: We use --reload-dir to focus only on backend changes
exec uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir backend
