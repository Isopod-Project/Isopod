# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root (if it exists)
- **`docs/adr/`**: read Architecture Decision Records that touch the area you are about to work in.

If any of these files don't exist, proceed silently. The `domain-modeling` skill creates them lazily when terms or decisions get resolved.

## File structure

Single-context repo:

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-...
└── backend/ / frontend/
```

## Use the glossary's vocabulary

When naming domain concepts (container lifecycles, RCON connection, resource packs, world templates, daemon health checks), adhere to defined vocabulary.
