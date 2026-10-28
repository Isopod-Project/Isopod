# Stage 1: Build the Vite frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY assets/ ../assets/
RUN npm run build

# Stage 2: Serve via Python FastAPI
FROM python:3.11-slim
WORKDIR /app

# Install Docker CLI, Docker Daemon (docker.io), iptables, and Docker Compose v2 for DinD invocation.
# Downloads match the build arch (x86_64 or aarch64) so arm64 hosts like Apple Silicon don't need emulation.
# Keep DOCKER_CLI_VERSION current: older static CLIs are built with Go releases that have known CVEs.
ARG DOCKER_CLI_VERSION=29.9.2
RUN ARCH="$(uname -m)" && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        docker.io \
        fuse-overlayfs \
        iptables \
        kmod \
        ca-certificates \
        curl && \
    rm -rf /var/lib/apt/lists/* && \
    curl -fsSL "https://download.docker.com/linux/static/stable/${ARCH}/docker-${DOCKER_CLI_VERSION}.tgz" | tar -xz -C /tmp && \
    mv /tmp/docker/docker /usr/local/bin/docker && \
    rm -rf /tmp/docker && \
    mkdir -p /usr/lib/docker/cli-plugins/ && \
    curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${ARCH}" -o /usr/lib/docker/cli-plugins/docker-compose && \
    chmod +x /usr/lib/docker/cli-plugins/docker-compose


COPY backend/requirements.txt ./
# The app never runs pip; removing it and setuptools/wheel drops the outdated libraries
# they vendor from the image.
RUN pip install --no-cache-dir -r requirements.txt && \
    pip uninstall -y pip setuptools wheel

# Copy backend application
COPY backend/ backend/

# Copy compiled frontend securely into place
COPY --from=frontend-builder /app/dist /app/frontend/dist

# Entrypoint for Docker-in-Docker isolation
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Metadata for CasaOS
LABEL com.casaos.app.name="Isopod"
LABEL com.casaos.app.icon="https://raw.githubusercontent.com/Isopod-Project/Isopod-Website/main/public/Isopod_logo.png"
LABEL icon="https://raw.githubusercontent.com/Isopod-Project/Isopod-Website/main/public/Isopod_logo.png"
LABEL name="Isopod"
LABEL title="Isopod"

EXPOSE 8000
ENV SERVERS_DIR=/servers

ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]


