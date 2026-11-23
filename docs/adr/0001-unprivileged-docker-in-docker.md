# Run Docker-in-Docker without privileged mode

## Host Docker on Linux

Plain Linux installs now use host Docker by default through `compose.yml`. The dashboard mounts the local Docker socket and needs none of the Docker-in-Docker capabilities, devices, or security overrides listed below. Socket access is root-equivalent because the Docker API can create containers with host filesystem mounts.

Isopod runs each server in its own Compose project on the host. Project labels associate containers with their instance directories after dashboard restarts. The host publishes each server's ports separately. Stopping or recreating the dashboard leaves those projects running. Mount the servers directory at the same absolute path on the host and in the dashboard because Compose resolves relative binds in the dashboard and Docker mounts them on the host.

CasaOS and the macOS overlay continue to use `isopod-compose.yml` with an inner daemon. Existing Linux installs can retain that setup or use the [migration guide](../../documentation/everyone/getting-started.md#migrate-from-docker-in-docker-on-linux) to transfer images and recreate containers from their existing data and Compose definitions.

## Docker-in-Docker on CasaOS and macOS

Isopod starts its own Docker daemon inside its container (Docker-in-Docker) so server containers stay out of the host's Docker, which keeps them off the CasaOS home screen as "Legacy app" entries. That used to need `privileged: true`. Since #145, `isopod-compose.yml` grants only what the inner daemon needs:

| Setting | Why |
| --- | --- |
| `cap_add: SYS_ADMIN` | Mount filesystems (overlay layers, cgroups) and remount `/sys/fs/cgroup` read-write in the entrypoint. |
| `cap_add: NET_ADMIN` | Create bridges, veth pairs, and iptables rules for published ports. |
| `cap_add: SYS_PTRACE` | `docker exec` into server containers, which RCON commands use. The servers run as uid 1000, and reading another user's `/proc/<pid>/ns` needs this capability. It only reaches processes in Isopod's own PID namespace. |
| `seccomp:unconfined` | The inner runc creates a session keyring (`keyctl`), which Docker's default seccomp profile blocks. |
| `apparmor:unconfined` | Docker's default AppArmor profile blocks `mount`. |
| `devices: /dev/fuse` | The `fuse-overlayfs` storage driver. |
| `cgroup: private` | Gives the inner daemon its own cgroup tree to manage. |

The entrypoint also sets `DOCKER_ALLOW_IPV6_ON_IPV4_INTERFACE=1`. `/proc/sys` stays read-only, so the inner daemon can't turn off IPv6 on containers' IPv4-only interfaces, and would otherwise refuse to start them.

Tested on Docker Desktop with both `overlay2` and `fuse-overlayfs`: creating and starting a server, published ports, RCON, resource usage, the crash watchdog restarting a killed server, and installing a Modrinth modpack.

## What this does and doesn't protect against

This is hardening, not isolation. Compared to `privileged: true`, the container no longer sees the host's devices (disks, `/dev/mem`), and can't load kernel modules, do raw I/O, or change the host clock. But `SYS_ADMIN` without AppArmor can remount `/proc/sys` read-write, and writing `/proc/sys/kernel/core_pattern` runs code on the host. Code execution inside the Isopod container should still be treated as root on the host. The login (#143) and origin checks (#144) are what keep attackers from getting that far.

## Considered options

- **Keep `privileged: true`.** Works everywhere, but gives the host's devices and every capability to anything that compromises Isopod.
- **Mount the host's Docker socket on CasaOS.** Server containers would show up as legacy apps on the CasaOS home screen.
- **Docker socket proxy.** Isopod needs to create containers with bind mounts, and anyone who can do that can mount the host's `/`. A proxy doesn't help with the calls Isopod has to make.
- **Sysbox or rootless Docker.** The only options that actually isolate the inner daemon from the host. Both need software installed on the host, which CasaOS and Docker Desktop don't have, so they can't be the default. Users who run Sysbox can set `runtime: sysbox-runc` and remove the `cap_add`, `security_opt`, `devices`, and `cgroup` settings.

## Consequences

- Existing installs created from the old compose file keep `privileged: true` until their compose file is updated. Both setups use the same image and entrypoint.
- If the entrypoint can't remount `/sys/fs/cgroup`, it logs a warning that points at these settings, and server containers fail to start.
