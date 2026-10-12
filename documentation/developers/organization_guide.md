# 📂 Project Organization & Standards

This document outlines the directory structure and organization standards for the **Isopod** project. Maintaining a clean and predictable structure is crucial for future development and collaboration.

## 🏗 Directory Structure

| Directory | Purpose |
| :--- | :--- |
| `assets/` | Static assets like logos, icons, and diagrams. |
| `backend/` | Python/FastAPI source code for the Isopod service. |
| `frontend/` | React/Vite source code for the dashboard UI. |
| `documentation/` | Project documentation (split by audience). |
| `documentation/everyone/` | General information, user guides, and FAQs for non-developers. |
| `documentation/developers/` | Technical specs, API docs, and architecture diagrams. |
| `servers/` | Managed Minecraft server instances (Docker volumes/mappings). |
| `build/` | Temporary build artifacts, exports, and deployment packages. |
| `logs/` | Debug logs, temporary traces, and diagnostic files. |

## 📏 Organization Rules

### 1. File Placement
- **No loose files in root:** Only essential configuration files (e.g., `.env`, `Dockerfile`, `docker-compose.yml`, `README.md`) should reside in the root directory.
- **Assets:** All images, videos, and static design files must go into `assets/`.
- **Logs & Diffs:** Any output from debug sessions or temporary logs should be directed to `logs/` (and ignored by `.git` if possible).
- **Builds:** Generated artifacts like `.tar` files or production bundles belong in `build/`.

### 2. Documentation
- Use **Markdown** for all documentation.
- Document new features in `documentation/everyone/` if they impact the user experience.
- Document internal changes or API updates in `documentation/developers/`.

### 3. Future Development
- If a directory grows too large (e.g., `backend/`), consider creating a `src/` subfolder with logical modules (e.g., `api/`, `docker/`, `utils/`).
- Always update this guide if you introduce a new top-level directory.

## 🤖 AI Skill: "Organize Everything"

When asked to "organize" or "clean up," follow these steps:
1. **Categorize:** Identify files that don't belong in their current location.
2. **Relocate:** Use the table above to find the correct destination.
3. **Reference Fix:** Search for references to moved files (especially in `README.md` or code) and update them.
4. **Prune:** Remove empty directories or obsolete files.
