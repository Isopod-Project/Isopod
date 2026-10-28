---
name: github-projects
description: Manage GitHub Projects (v2) boards, issues, drafts, and item status transitions using the gh CLI. Trigger whenever the user asks to create tickets, find items on a project board, move cards, or track tasks.
---

# GitHub Projects Management Skill

This skill allows the agent to interact with GitHub Projects (v2) and repository issues using the GitHub CLI (`gh`).

## Default Context
- **Target Project Number**: 1
- **Owner / Org**: Isopod-Project

---

## Operations & Commands

### 1. Discover Projects and Fields
Before updating columns/statuses for the first time, inspect the board schema:

- **List available projects**:
  ```bash
  gh project list --owner <OWNER>
  ```

- **Inspect fields & status options (In Progress, Done, Todo, etc.)**:
  ```bash
  gh project field-list <PROJECT_NUMBER> --owner <OWNER> --format json
  ```

---

### 2. Finding & Listing Items

- **View all items on the board**:
  ```bash
  gh project item-list <PROJECT_NUMBER> --owner <OWNER> --format json
  ```

- **Search existing issues across the repository**:
  ```bash
  gh issue list --search "<keyword>" --json number,title,state,url
  ```

---

### 3. Creating Tickets & Issues

#### Option A: Create a Standard Issue & Add to Project
1. **Create the issue**:
   ```bash
   gh issue create --title "<Title>" --body "<Markdown Body>"
   ```
2. **Add the created issue to the project board**:
   ```bash
   gh project item-add <PROJECT_NUMBER> --owner <OWNER> --url "<ISSUE_URL>"
   ```

#### Option B: Create a Draft Item Directly on the Board
```bash
gh project item-create <PROJECT_NUMBER> --owner <OWNER> --title "<Draft Title>" --body "<Description>"
```

---

### 4. Moving Items / Updating Status
To move an item to a new column (e.g., from Todo to In Progress or Done):

1. Locate the item ID from `gh project item-list`.
2. Locate the `field_id` for "Status" and the `single_select_option_id` for the target status from `gh project field-list`.
3. Update the item:
   ```bash
   gh project item-edit --id "<ITEM_ID>" --project-id "<PROJECT_ID>" --field-id "<STATUS_FIELD_ID>" --single-select-option-id "<TARGET_STATUS_OPTION_ID>"
   ```

---

### 5. Archiving & Deleting Items (Optional)

- **Archive an item on the board**:
  ```bash
  gh project item-archive <PROJECT_NUMBER> --owner <OWNER> --id <ITEM_ID>
  ```

- **Delete an item from the board**:
  ```bash
  gh project item-delete <PROJECT_NUMBER> --owner <OWNER> --id <ITEM_ID>
  ```

---

## Agent Execution Rules

- **Dedicated Branch per Issue**: Whenever creating a new issue or beginning work on an issue, the agent MUST immediately create and check out a dedicated git branch named after the issue number (e.g., `git checkout -b <ISSUE_NUMBER>`). Never implement or commit new issue code directly on `main`.
- **Always query IDs first**: Never hardcode status IDs if they are unknown; query `gh project field-list` before executing status edits.
- **Link Issues to Branches/Commits**: When creating tickets intended for immediate work, report the issue number back to the user and ensure commit messages reference it (e.g., `feat(#12): ...`).
- **Verify Transitions**: After moving or editing an item, verify the JSON output to ensure the status change succeeded before confirming completion.

---

## Releases & Changelog Integration

When completing tickets that are ready to be packaged into a new release:
- Track resolved issues moving into **Done**.
- Use the `github-releases` skill (`.agent/skills/github-releases/SKILL.md`) to compile the release notes (**What's New**, **Bug Fixes**) from closed issues.
- Publishing a GitHub release via `gh release create` triggers the in-dashboard update notification dot (pulsing green dot on Settings) and renders release notes in the dashboard's **Settings > Updates** tab.