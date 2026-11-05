# 🤝 Contributing to Isopod

Thanks for helping out! Bug reports, ideas, docs fixes, and code are all welcome.

## 🐛 Reporting bugs and asking for features

Open an [issue](https://github.com/Isopod-Project/Isopod/issues). For a bug, include:

- your Isopod version (top bar of the dashboard) and OS
- the server type and Minecraft version, if it's about an instance
- what you did, what you expected, and what happened instead
- the instance console log or `docker logs isopod` output, if there's an error

Security problems go through [SECURITY.md](SECURITY.md), not a public issue.

## 🧭 Finding something to work on

Issues labeled [`good first issue`](https://github.com/Isopod-Project/Isopod/labels/good%20first%20issue) are small and self-contained. Comment on the issue before you start so two people don't build the same thing. For anything big that doesn't have an issue yet, open one first so we can agree on the approach.

## 🛠 Setting up

You need Git, Docker, and Node.js 24+.

- **Full dev environment** (backend, frontend, and real Minecraft servers in Docker): follow the [Development Guide](documentation/developers/development_guide.md).
- **Frontend only**: `npm run dev` in `frontend/` serves the dashboard at http://localhost:5173 and proxies `/api` to a backend on `localhost:8000` (set `VITE_API_PROXY` to point elsewhere). The Playwright suite mocks the whole API, so you can test dashboard changes without the backend or Docker.

[Project Organization](documentation/developers/organization_guide.md) explains where files go.

## ✅ Before you open a pull request

Run whichever of these apply to your change:

```bash
# Frontend
cd frontend
npm run lint
npm run build
npx playwright install chromium   # first time only
npm run test:e2e

# Backend (from the repo root)
python -m unittest discover backend/tests
```

Add or update tests for what you changed: Playwright specs live in `frontend/e2e/`, backend tests in `backend/tests/`.

## 🌿 Branches and pull requests

1. Fork the repo (or branch, if you have write access) and name the branch after the issue number, e.g. `142`.
2. Keep each PR to one issue. Small PRs get reviewed faster.
3. Write commit messages in the [Conventional Commits](https://www.conventionalcommits.org/) style the history uses, e.g. `fix: keep the console scrolled to the bottom (#142)`.
4. Open the PR against `main` and fill in the template. `Closes #<number>` links it to the issue.
5. CI runs a security audit on every PR, plus the Playwright suite when `frontend/` changes. Both need to pass.

## 📖 Docs and the wiki

If your change alters something users can see or configure, update the docs in the same PR: [documentation/everyone/getting-started.md](documentation/everyone/getting-started.md) here, and the [website wiki](https://isopod-project.github.io/Isopod-Website/#/wiki) in [Isopod-Website](https://github.com/Isopod-Project/Isopod-Website). Small bug fixes and internal changes are exempt. [docs/agents/wiki.md](docs/agents/wiki.md) has the details.

## 📄 License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
