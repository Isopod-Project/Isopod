# Update in place from a release bundle

**Update Now** has to work on a standard install, and the container can't rebuild its own image: it has no source checkout, no compose file, and only its own inner Docker daemon. Giving it the host's Docker socket would let it rebuild itself, but that hands every dashboard login root on the host and undoes [ADR 0001](0001-unprivileged-docker-in-docker.md).

So each release attaches a bundle per architecture (`isopod-app-<tag>-<arch>.tar.gz`, built by `.github/workflows/release-bundles.yml`) holding the backend, the built frontend, and the Python dependencies. The image has no pip, so dependencies ship in the bundle.

## How an update runs

1. `backend/self_update.py` downloads the bundle from the release, checks its SHA-256, unpacks it under `SERVERS_DIR/.isopod-app/versions/<tag>`, and imports the new code as a smoke test. Any failure stops here with nothing changed.
2. It writes the tag to `pending`, stops the inner Docker daemon so servers save and shut down, and exits. The compose file's `restart: unless-stopped` starts the container again.
3. `docker/entrypoint.sh` boots the pending version and creates `tried`. Once the app reaches startup, it promotes the version to `active`.
4. If the container restarts with `tried` still there, that version never started. The entrypoint records it in `failed` and boots `active`, or the image's own version.

The entrypoint only uses a bundle newer than the image, so a manual rebuild always wins.

## Limits

- A bundle can't change the image: the Dockerfile, the entrypoint, or the compose file. A release that changes any of them must raise `docker/image-rev`, and images on a lower revision get the manual commands. Installs older than this feature need one manual rebuild to get it.
- The checksum sits next to the bundle, so it catches corruption, not a compromised GitHub account or release. That's the same trust a `git pull` and rebuild places in the repository, but it isn't signed.
- Servers set to never restart stay stopped after an update.
- Running without a restart policy means Isopod doesn't come back on its own after an update.
