#!/bin/bash
set -e

echo "===================================================="
echo "🦀 Starting Isopod Container"
echo "===================================================="

# Check if an external Docker socket is mounted and reachable
USE_EXTERNAL_DOCKER=false
if [ -S /var/run/docker.sock ]; then
    if docker info >/dev/null 2>&1; then
        echo "✅ Detected active host Docker socket at /var/run/docker.sock. Using host Docker daemon."
        USE_EXTERNAL_DOCKER=true
    fi
fi

if [ "$USE_EXTERNAL_DOCKER" = "false" ]; then
    echo "🐳 Initializing internal Docker daemon (DinD)..."

    # Clean up stale pid / sock files if container was restarted
    rm -f /var/run/docker.pid /var/run/docker.sock /var/run/docker/containerd/containerd.pid 2>/dev/null || true
    mkdir -p /var/log /var/run

    # Determine storage driver: prefer fuse-overlayfs if available to avoid DinD vfs disk bloat
    DRIVER_FLAG=""
    if which fuse-overlayfs >/dev/null 2>&1; then
        DRIVER_FLAG="--storage-driver=fuse-overlayfs"
    fi

    # Start dockerd in background with isolated non-overlapping subnet to avoid collision with host bridge
    DOCKERD_FLAGS="--bip=172.28.0.1/16"
    dockerd $DOCKERD_FLAGS $DRIVER_FLAG > /var/log/dockerd.log 2>&1 &

    DOCKERD_PID=$!

    echo "⏳ Waiting for internal Docker daemon to become ready..."
    MAX_WAIT=30
    WAIT_COUNT=0
    DOCKER_READY=false

    while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
        if docker info >/dev/null 2>&1; then
            DOCKER_READY=true
            break
        fi
        sleep 1
        WAIT_COUNT=$((WAIT_COUNT + 1))
    done

    if [ "$DOCKER_READY" = "false" ]; then
        echo "⚠️  dockerd did not start cleanly with initial driver. Checking log:"
        cat /var/log/dockerd.log || true
        echo "🔄 Retrying dockerd with fallback storage driver..."
        kill -9 $DOCKERD_PID 2>/dev/null || true
        pkill -9 containerd 2>/dev/null || true
        sleep 2
        rm -f /var/run/docker.pid /var/run/docker.sock /var/run/docker/containerd/containerd.pid 2>/dev/null || true
        if [ "$DRIVER_FLAG" = "" ] && which fuse-overlayfs >/dev/null 2>&1; then
            FALLBACK_DRIVER="--storage-driver=fuse-overlayfs"
        else
            FALLBACK_DRIVER="--storage-driver=vfs"
        fi
        dockerd $DOCKERD_FLAGS $FALLBACK_DRIVER > /var/log/dockerd.log 2>&1 &
        DOCKERD_PID=$!


        WAIT_COUNT=0
        while [ $WAIT_COUNT -lt 20 ]; do
            if docker info >/dev/null 2>&1; then
                DOCKER_READY=true
                break
            fi
            sleep 1
            WAIT_COUNT=$((WAIT_COUNT + 1))
        done
    fi

    if [ "$DOCKER_READY" = "true" ]; then
        echo "✅ Internal Docker daemon is ready!"
    else
        echo "❌ ERROR: Failed to start internal Docker daemon. Log output:"
        cat /var/log/dockerd.log || true
    fi
fi

echo "🚀 Starting Isopod Web Service..."
echo "===================================================="
exec "$@"
