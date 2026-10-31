# Aegis Forge Integration Templates

This directory provides pre-configured workflow templates that repositories include to integrate with Aegis Forge.

---

## Template Catalog

- `aegis-verify.yml`: GitHub Actions workflow that listens for `repository_dispatch` events from Aegis Forge (`event_type: aegis-verify`), downloads the runner script, executes verification in a clean virtual machine, and pushes the certified repair branch.

---

## Setup Instructions

1. Copy `aegis-verify.yml` into your repository's `.github/workflows/` directory:
   ```bash
   cp templates/aegis-verify.yml .github/workflows/
   ```
2. Configure the following repository secrets and variables in GitHub (**Settings → Secrets and variables → Actions**):
   - `AEGIS_URL` (Repository Variable): The public URL of your Aegis Forge instance.
   - `AEGIS_RUNNER_SECRET` (Repository Secret): The matching runner secret configured on your control plane.
