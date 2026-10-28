# Security Policy

## Reporting a vulnerability

Please report security problems privately through GitHub's **Report a vulnerability** button on the [Security tab](https://github.com/Isopod-Project/Isopod/security/advisories/new), not in a public issue. Include what you found, how to reproduce it, and which Isopod version you ran. You should hear back within a week.

If that button isn't available, open an issue that asks for a private contact. Leave the details of the problem out of the issue.

## What to know before exposing Isopod

Isopod is built to run on a trusted home network. Today:

- The dashboard and API on port 8000 have **no login**. Anyone who can reach the port can control your servers and files.
- The container runs **privileged** with its own Docker daemon, so control of Isopod amounts to control of the machine it runs on.

Don't forward port 8000 to the internet. To reach Isopod remotely, use a VPN such as Tailscale or WireGuard.

## How releases are checked

Every pull request to `main` and every release runs the [Security Audit workflow](.github/workflows/security-audit.yml):
- dependency audits for Python and npm
- Bandit and CodeQL static analysis
- a gitleaks secret scan
- a Trivy scan of the Docker image
- zizmor checks of the GitHub Actions workflows

Before a release, the changes since the previous release also get the manual review in [docs/security-audit.md](docs/security-audit.md).
