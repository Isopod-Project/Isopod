"""Mirror .agent/skills/ into .claude/skills/ so Claude Code discovers them as skills.

.agent/skills/ is the source of truth. Re-run this after editing any skill:

    python scripts/sync_skills.py
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / ".agent" / "skills"
TARGET = ROOT / ".claude" / "skills"

# Per-agent metadata (e.g. agents/openai.yaml for Codex) that Claude Code doesn't use
IGNORE = shutil.ignore_patterns("agents")


def main() -> None:
    if TARGET.exists():
        shutil.rmtree(TARGET)
    TARGET.mkdir(parents=True)

    for skill_dir in sorted(SOURCE.iterdir()):
        if not (skill_dir / "SKILL.md").is_file():
            continue
        shutil.copytree(skill_dir, TARGET / skill_dir.name, ignore=IGNORE)
        print(f"synced {skill_dir.name}")


if __name__ == "__main__":
    main()
