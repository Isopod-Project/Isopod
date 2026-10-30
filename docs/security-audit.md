# Security audit

Every release gets two checks. The [`github-releases`](../.agent/skills/github-releases/SKILL.md) skill won't publish a release until both pass.

## 1. Security Audit workflow

[`.github/workflows/security-audit.yml`](../.github/workflows/security-audit.yml) runs on every PR to `main`, whenever a `v*` tag is pushed, and on demand. Each job fails on high or critical findings.

| Job | Tool | Fails on |
| --- | --- | --- |
| Python dependencies | pip-audit on `backend/requirements.txt` | any known vulnerability |
| JavaScript dependencies | `npm audit` with and without dev dependencies | high or critical |
| Static analysis | Bandit on `backend/` | high severity, high confidence; medium findings are listed in the job summary |
| CodeQL | Python and JavaScript/TypeScript, `security-extended` queries | new high alerts, through code scanning's PR check; all alerts are on the Security tab |
| Secrets | gitleaks: the PR's commits, the commits since the previous tag, or the full history on manual runs | any leak |
| Container image | Trivy on the image built from `Dockerfile` | fixable high or critical vulnerabilities |
| Workflow hygiene | zizmor on `.github/workflows` | any finding |

To run it on `main` before a release:

```bash
gh workflow run security-audit.yml --ref main
gh run watch "$(gh run list --workflow security-audit.yml --branch main --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

### When a job fails

- **Dependencies:** update the package. Python versions are pinned in `backend/requirements.txt`, and Dependabot proposes updates weekly. For npm, `npm audit fix` usually works; check that `npm run build` and the e2e suite still pass.
- **Trivy:** most fixes are a newer base image, a newer `DOCKER_CLI_VERSION` in the `Dockerfile`, or a dependency bump. If nothing upstream has the fix yet, add the finding to [`.trivyignore.yaml`](../.trivyignore.yaml). Each entry needs a reason (`statement`) and an `expired_at` date, so it fails again later and gets re-checked.
- **CodeQL:** fix the code. If the alert is a false positive, dismiss it on the Security tab with the reason. For example, the offline-mode player UUID has to use MD5 to match Minecraft's `UUID.nameUUIDFromBytes`.
- **Bandit:** fix the code. If it's a false positive, add `# nosec BXXX` with a comment explaining why.
- **gitleaks:** treat the secret as leaked. Revoke it first, then remove it from the code.
- **zizmor:** pin actions to a full commit SHA with the tag in a comment, give jobs only the `permissions:` they need, and don't put `${{ }}` expressions directly in `run:` scripts. Pass them through `env:` instead.

## 2. Release diff review

Review everything since the previous release, `git diff <last-tag>..main`, with a security focus. In Claude Code, `/security-review` covers this. Check:

- [ ] **New or changed API endpoints:** input is validated. File and upload handlers reject `..`, absolute paths, and symlinks that point outside the instance folder.
- [ ] **Subprocess and Docker SDK calls:** user input never reaches shell commands, container arguments, or mount paths without being checked. Commands are argument lists, never `shell=True`.
- [ ] **Third-party downloads** (Modrinth, CurseForge, Mojang, PaperMC, Purpur):
  - URLs come from the expected hosts.
  - Hashes are checked where the API provides them.
  - Archives are extracted with path checks, not with a bare `extractall` (zip slip).
  - The CurseForge API key (`CURSEFORGE_API_KEY`) is only sent to `api.curseforge.com`, per request, and never written to an instance's `docker-compose.yml`. IDs placed in CurseForge URLs are checked to be numeric.
- [ ] **`isopod-compose*.yml`, `Dockerfile`, `docker/`:** no new ports, mounts, capabilities, or privileges without a reason in the PR, and no `privileged: true`. New capabilities go in the table in [ADR 0001](adr/0001-unprivileged-docker-in-docker.md).
- [ ] **Network exposure:** no new routes in `auth.PUBLIC_PATHS` or outside `/api` that skip the login, and no CORS or bind-address changes.
- [ ] **New dependencies:** maintained, widely used, and spelled correctly (no typosquats).
- [ ] **No secrets,** tokens, or personal paths committed.

Add the result to the release notes, for example: `Security audit: passed (0 high/critical; release diff reviewed).`

## Known risks

These are by design for now and are tracked separately:

- First-run setup is open: until the admin account exists, anyone who can reach port 8000 can create it.
- Isopod serves plain HTTP, so logins and session cookies aren't encrypted in transit.
- The container runs its own Docker daemon. Since #145 it isn't privileged, but `SYS_ADMIN` with seccomp and AppArmor off is still enough to reach the host. See [ADR 0001](adr/0001-unprivileged-docker-in-docker.md).

`SECURITY.md` tells users not to expose port 8000 for these reasons.

Cross-origin access is off by default: there are no CORS headers unless `ISOPOD_CORS_ORIGINS` lists extra origins, and state-changing requests and WebSocket upgrades from a foreign `Origin` get `403` (`backend/security.py`, #144). This doesn't stop DNS rebinding, where the attacker's page and the API share an origin; the login covers that, since the attacker's origin never gets the session cookie.

Every `/api` route and WebSocket needs a session from the dashboard login (`backend/auth.py`, #143). The password is stored as an argon2 hash.
