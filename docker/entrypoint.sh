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
        mkdir -p /sys/fs/cgroup/init 2>/dev/null || return 0
        xargs -rn1 < /sys/fs/cgroup/cgroup.procs > /sys/fs/cgroup/init/cgroup.procs 2>/dev/null || true
        sed -e 's/ / +/g' -e 's/^/+/' < /sys/fs/cgroup/cgroup.controllers > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true
    fi
}

# Isopod runs without privileged mode (#145), so Docker mounts /sys/fs/cgroup read-only.
# CAP_SYS_ADMIN lets us remount it for the inner daemon. /proc/sys stays read-only, so the
# daemon also has to skip turning off IPv6 on containers' IPv4-only interfaces.
prepare_unprivileged_dind() {
    if ! touch /sys/fs/cgroup/.isopod-rw 2>/dev/null; then
        if ! mount -o remount,rw /sys/fs/cgroup 2>/dev/null; then
            echo "⚠️  /sys/fs/cgroup is read-only. Check the cap_add and security_opt settings in isopod-compose.yml."
        fi
    fi
    rm -f /sys/fs/cgroup/.isopod-rw 2>/dev/null || true
    export DOCKER_ALLOW_IPV6_ON_IPV4_INTERFACE=1
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

    prepare_unprivileged_dind
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
    # The long shutdown timeout gives servers time to save when an update stops the daemon
    DOCKERD_FLAGS="--bip=172.28.0.1/16 --shutdown-timeout=60"
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

# Self-update (docs/adr/0002-in-place-self-update.md): start from a version installed under
# .isopod-app if it's newer than this image, and go back if a new version never reached startup.
start_installed_version() {
    local root="${SERVERS_DIR:-/servers}/.isopod-app"
    [ -d "$root" ] || return 0

    local tag=""
    if [ -f "$root/pending" ]; then
        if [ -f "$root/tried" ]; then
            echo "⚠️  $(cat "$root/pending") didn't start. Going back to the previous version."
            mv -f "$root/pending" "$root/failed"
            rm -f "$root/tried"
        else
            tag="$(cat "$root/pending")"
            touch "$root/tried"
        fi
    fi
    [ -n "$tag" ] || [ ! -f "$root/active" ] || tag="$(cat "$root/active")"
    [ -n "$tag" ] || return 0

    local image_version newest
    image_version="$(sed -n 's/^ISOPOD_VERSION = "\(.*\)".*/\1/p' /app/backend/main.py)"
    newest="$(printf '%s\n%s\n' "$image_version" "$tag" | sort -V | tail -n 1)"
    if [ "$tag" = "$image_version" ] || [ "$newest" != "$tag" ] || [ ! -f "$root/versions/$tag/backend/main.py" ]; then
        return 0
    fi

    echo "📦 Starting installed version $tag"
    cd "$root/versions/$tag"
    export PYTHONPATH="$root/versions/$tag/deps"
}
start_installed_version

echo "🚀 Starting Isopod Web Service..."
echo "===================================================="
exec "$@"
