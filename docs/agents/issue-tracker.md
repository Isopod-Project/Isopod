# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues on `Isopod-Project/Isopod`. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments`
- **Link to Project Board**: Project #1 (`gh project item-add 1 --owner Isopod-Project --url "<ISSUE_URL>"`)
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or add `Part of #<parent>` at the top of the body.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Branch per issue**: Whenever a new issue is created or requested for work, always create and check out a dedicated branch named after the issue number (e.g. `git checkout -b <number>`). Never commit or implement changes directly on `main`.
- **Close**: `gh issue close <number> --comment "..."`

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue and add it to GitHub Project #1 when applicable.
