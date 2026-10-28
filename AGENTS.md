# Isopod Agent Guidelines

## Agent skills

### Issue tracker

GitHub Issues via `gh` CLI. Linked with Isopod-Project GitHub Project #1. See [issue-tracker.md](file:///c:/Coding/Isopod/docs/agents/issue-tracker.md).
- **Branch Strategy**: Always create and check out a dedicated branch named after the issue number (`git checkout -b <number>`) whenever an issue is created or requested for work. Never implement directly on `main`.
- **Branch Cleanup**: After a branch is merged into `main` and pushed, delete it locally and on GitHub using the [cleanup-merged-branches](file:///c:/Coding/Isopod/.agent/skills/cleanup-merged-branches/SKILL.md) skill.

### Wiki

Every issue that changes something users can see or configure updates the website wiki in the same piece of work. Small bug fixes and internal changes are exempt. See [wiki.md](docs/agents/wiki.md) for the rule, the article layout, and how help-button links work.

### Domain docs

Single-context documentation layout. See [domain.md](file:///c:/Coding/Isopod/docs/agents/domain.md).
- Domain Glossary: `GLOSSARY.md` (root)
- Architectural Decision Records: `docs/adr/`

### Installed Skills in `.agent/skills/`

`.agent/skills/` is the source of truth. `.claude/skills/` is a generated mirror for Claude Code; after editing a skill, run `python scripts/sync_skills.py` and commit both.

- [spec-review](file:///c:/Coding/Isopod/.agent/skills/spec-review/SKILL.md): Strict pre-commit review along repo standards and spec fulfillment. (For bug-hunting reviews in Claude Code, use the built-in `/code-review`.)
- [diagnosing-bugs](file:///c:/Coding/Isopod/.agent/skills/diagnosing-bugs/SKILL.md): Hypothesis-driven bug reproduction and resolution.
- [domain-modeling](file:///c:/Coding/Isopod/.agent/skills/domain-modeling/SKILL.md): Expand and maintain `GLOSSARY.md` and ADR records.
- [handoff](file:///c:/Coding/Isopod/.agent/skills/handoff/SKILL.md): Structured state handoff across agent turns or sessions.
- [to-spec](file:///c:/Coding/Isopod/.agent/skills/to-spec/SKILL.md): Synthesize discussions into a concrete PRD / spec.
- [to-tickets](file:///c:/Coding/Isopod/.agent/skills/to-tickets/SKILL.md): Deconstruct specs into vertical issues with blocking dependencies.
- [github-projects](file:///c:/Coding/Isopod/.agent/skills/github-projects/SKILL.md): Interact with Isopod GitHub Projects board.
- [github-releases](file:///c:/Coding/Isopod/.agent/skills/github-releases/SKILL.md): Publish GitHub releases with verified notes.
- [cleanup-merged-branches](file:///c:/Coding/Isopod/.agent/skills/cleanup-merged-branches/SKILL.md): Delete local and remote branches that are fully merged into `main`; report unmerged ones.
