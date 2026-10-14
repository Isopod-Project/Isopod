---
name: github-releases
description: Manage and publish GitHub releases for Isopod using the gh CLI. Trigger whenever the user asks to release a new version, announce updates, draft release notes (What's New, Bug Fixes), or verify in-dashboard update notifications.
---

# GitHub Releases & Announcement Skill

This skill guides the preparation, drafting, publishing, and verification of GitHub Releases for Isopod (`Isopod-Project/Isopod`) using the GitHub CLI (`gh`).

---

## Architecture & How Update Notifications Work

Isopod has a built-in update notification system:
1. **GitHub Releases API**: The backend periodically queries `https://api.github.com/repos/Isopod-Project/Isopod/releases/latest`.
2. **Version Comparison**: The backend compares `ISOPOD_VERSION` (defined in `backend/main.py`) against the latest release `tag_name`.
3. **Dashboard Notification Badge**: If `latest_version != ISOPOD_VERSION`, `has_update` is set to `true`.
   - In the frontend (`frontend/src/App.tsx`), a pulsing emerald green indicator badge appears over the **Settings** gear icon.
   - Inside **Settings > Updates**, the dashboard displays:
     - Current Version vs. Latest Version.
     - Release publication date.
     - The formatted Markdown release notes (**What's New**, **Bug Fixes**, etc.).

---

## Release Workflow

When the user asks to prepare or publish a release (e.g., *"prepare a release"*, *"announce what's new"*, *"publish v0.1.0"*):

### Step 1: Inspect Changes Since Last Release
1. Check existing releases:
   ```bash
   gh release list
   ```
2. Inspect git history since the previous tag (or all recent commits if this is the first release):
   ```bash
   git log --oneline -n 20
   # Or if previous tag exists:
   git log <LAST_TAG>..HEAD --oneline
   ```
3. Check recently closed issues and pull requests:
   ```bash
   gh issue list --state closed --limit 15
   gh pr list --state closed --limit 10
   ```

---

### Step 2: Draft Release Notes
Structure release notes cleanly using Markdown so they render well both on GitHub and inside the Isopod dashboard update modal:

```markdown
## What's New 🚀
- **CasaOS Native App & DinD Encapsulation**: Single-app dashboard integration with embedded Docker daemon, eliminating multi-instance clutter and subnet collisions.
- **Improved App Launcher & Logo**: Official Isopod branding and icons configured across CasaOS and Web UI.

## Bug Fixes 🐛
- Fix CasaOS bridge collision by isolating internal dockerd to `172.28.0.1/16` (#20).
- Fix static Docker CLI installation in Debian-based container.

## Upgrade Instructions 📦
Pull the latest image or rebuild your CasaOS app:
```bash
docker compose pull && docker compose up -d
```
```

---

### Step 3: Update Project Documentation
Whenever tickets are closed with new features or fixed bugs, ensure repository documentation reflects the updates before creating the release:
1. **Identify Affected Docs**: Check `README.md`, user guides in `Documentation/everyone/`, or developer guides in `Documentation/developers/` (or `docs/`).
2. **Document New Features & Changes**:
   - Add new capabilities (e.g., UI interactions, context menus, drag-and-drop, new API endpoints, keyboard shortcuts).
   - Update configuration options, guides, or troubleshooting steps if changed.
3. **Commit Documentation Updates**: Ensure documentation changes are committed to the repository so documentation accurately represents the released version.

---

### Step 4: Coordinate Version Number
1. Determine the tag following semantic versioning (e.g., `v0.1.0`).
2. Confirm the version tag with the user before publishing.
3. If publishing a new build of the application image, ensure `ISOPOD_VERSION` in `backend/main.py` is appropriately aligned so future instances reflect their running version.

---

### Step 5: Publish Release via GitHub CLI
Execute the release creation using `gh release create`:

```bash
gh release create <TAG> --title "<TAG> - <TITLE>" --notes "<MARKDOWN_NOTES>"
```

Alternatively, to write notes from a temporary file:
```bash
gh release create <TAG> --title "<TAG> - <TITLE>" --notes-file release_notes.md
```

To create a draft first for review:
```bash
gh release create <TAG> --draft --title "<TAG> - <TITLE>" --notes "<MARKDOWN_NOTES>"
```

---

### Step 6: Verify Release & Dashboard Update Notification
1. Verify the release exists on GitHub:
   ```bash
   gh release view <TAG>
   ```
2. Verify the backend update endpoint triggers the notification:
   - Query `/api/system/check-updates?force=true`.
   - Confirm `has_update: true` is returned for running instances on older versions.
   - Confirm `release_notes` contains the drafted text.
3. If connected to a test instance (e.g. via Tailscale or local dev), verify the green pulsing badge appears on the Settings button in the UI.

---

## Related Skills
- `github-projects`: For moving issues from *In Progress* to *Done* and referencing ticket numbers in release notes.
