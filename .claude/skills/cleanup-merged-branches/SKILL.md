---
name: cleanup-merged-branches
description: Delete git branches (local and on GitHub) whose work is fully merged into main, never anything with unmerged commits. Trigger right after merging a branch into main, after closing an issue whose branch was merged, or when the user asks to clean up, prune, or delete old/merged branches.
---

# Cleanup Merged Branches

Delete branches whose commits are all contained in `main`, locally and on `origin`. Branches with unmerged work are reported, never deleted.

Applies to `Isopod-Project/Isopod` and `Isopod-Project/Isopod-Website` (and any repo with a `main` branch).

---

## When to Run

- **After merging an issue branch into `main`**: clean up just that branch (`<n>` below). This is the normal case.
- **On request** ("clean up old branches"): sweep every merged branch.

Only clean up after the merge has been **pushed** (`origin/main` contains it), so the remote copy is never the last place the work exists.

---

## Workflow

### Step 1: Sync and get off the branch

```bash
git fetch --prune origin
git checkout main
git pull --ff-only
```

You cannot delete the branch you are on. If the working tree has uncommitted changes, stop and ask the user instead of switching.

### Step 2: Find what is safe

```bash
git branch --merged main --format='%(refname:short)' | grep -vx main                                         # local
git branch -r --merged main --format='%(refname:short)' | grep -vxE 'origin|origin/HEAD|origin/main'       # remote
git branch --no-merged main; git branch -r --no-merged main                                                 # NOT safe: report only
```

For a single branch after a merge, check it directly:

```bash
git merge-base --is-ancestor <n> main && echo "local safe"
git merge-base --is-ancestor origin/<n> main && echo "remote safe"
```

### Step 3: Delete local branches

```bash
git branch -d <branches...>
```

Always use `-d`, which refuses to delete unmerged work. If git refuses with *"not yet merged to refs/remotes/origin/<n>, even though it is merged to HEAD"*, the local and remote copies differ. Run `git merge-base --is-ancestor <n> main`:
- **yes** → the local copy is fully in `main`; `git branch -D <n>` is safe. Check the remote copy separately in Step 4.
- **no** → keep it and report it.

`-D` is only ever used after that ancestor check passes.

### Step 4: Delete remote branches

Delete only branches listed by `git branch -r --merged main`:

```bash
git push origin --delete <branches...>
git fetch --prune origin
```

A remote branch can be unmerged even when its local copy was merged (someone pushed more commits to it). It stays.

### Step 5: Report

Tell the user:
- Which branches were deleted, locally and on GitHub.
- Which were kept and why: unmerged commits (list the count or `git log --oneline main..<branch>` for context), checked out in a worktree, or the current branch.

---

## Rules

- **Never delete** `main`, the current branch, or any branch with commits not in `main`. Report those instead.
- **Never force-delete (`-D`)** without first confirming `git merge-base --is-ancestor <branch> main`.
- **Skip branches checked out in another worktree** (git refuses with *"used by worktree at …"*). They may belong to another agent or session; report them and leave them alone.
- **Squash-merged PRs** show as unmerged because the squash commit has a different hash. Don't delete them automatically. Report them, and only delete with `-D` if the user confirms the PR was merged.
- Empty branches created for issues that are still open count as merged and are safe to delete; they can be recreated with `git checkout -b <n>` when work starts.
