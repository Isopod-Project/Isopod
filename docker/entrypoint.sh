#!/bin/bash
set -e

echo "===================================================="
echo "🦀 Starting Isopod Container"
echo "===================================================="

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

    enable_cgroup_nesting

    # Storage driver order: $DOCKER_STORAGE_DRIVER if set, then fuse-overlayfs (avoids DinD vfs
    # disk bloat), then vfs. Docker Desktop for Mac sets overlay2, since containers fail to exec
    # under fuse-overlayfs there ("exec ...: invalid argument").
    DRIVERS="${DOCKER_STORAGE_DRIVER:-}"
    if which fuse-overlayfs >/dev/null 2>&1 && [ "$DOCKER_STORAGE_DRIVER" != "fuse-overlayfs" ]; then
        DRIVERS="$DRIVERS fuse-overlayfs"
    fi
    DRIVERS="$DRIVERS vfs"

    # Isolated non-overlapping subnet to avoid collision with host bridge
    DOCKERD_FLAGS="--bip=172.28.0.1/16"
    DOCKER_READY=false

    for DRIVER in $DRIVERS; do
        echo "🔧 Trying storage driver: $DRIVER"
        dockerd $DOCKERD_FLAGS --storage-driver=$DRIVER > /var/log/dockerd.log 2>&1 &
        DOCKERD_PID=$!

        echo "⏳ Waiting for internal Docker daemon to become ready..."
        WAIT_COUNT=0
        while [ $WAIT_COUNT -lt 30 ]; do
            if docker info >/dev/null 2>&1; then
                DOCKER_READY=true
                break
            fi
            # dockerd exits right away when the driver is unsupported; don't wait out the timeout
            kill -0 $DOCKERD_PID 2>/dev/null || break
            sleep 1
            WAIT_COUNT=$((WAIT_COUNT + 1))
        done

        [ "$DOCKER_READY" = "true" ] && break

        echo "⚠️  dockerd did not start with $DRIVER. Log:"
        cat /var/log/dockerd.log || true
        kill -9 $DOCKERD_PID 2>/dev/null || true
        pkill -9 containerd 2>/dev/null || true
        sleep 2
        rm -f /var/run/docker.pid /var/run/docker.sock /var/run/docker/containerd/containerd.pid 2>/dev/null || true
    done

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
