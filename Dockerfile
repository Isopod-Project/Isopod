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

# Install Docker CLI and Docker Compose v2 for subprocess invocation
RUN apt-get update && \
    apt-get install -y docker.io curl && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /usr/lib/docker/cli-plugins/ && \
    curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" -o /usr/lib/docker/cli-plugins/docker-compose && \
    chmod +x /usr/lib/docker/cli-plugins/docker-compose

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application
COPY backend/ backend/

# Copy compiled frontend securely into place
COPY --from=frontend-builder /app/dist /app/frontend/dist

EXPOSE 8000
ENV SERVERS_DIR=/servers

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
