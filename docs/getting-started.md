# Getting Started with Aegis Forge

This guide walks you through setting up and running Aegis Forge locally, deploying with Docker Compose, and connecting it to a GitHub repository as an autonomous CI repair agent.

---

## Prerequisites

Before starting, ensure you have the following installed:
- **Node.js**: `v20.0.0` or higher (LTS recommended)
- **PostgreSQL**: `v15` or higher (or Docker)
- **Git**: `2.38+`
- **Optional**: An API key for an LLM provider (OpenAI, Gemini, Anthropic, or local Ollama)

---

## 1. Local Quickstart (Bare Metal)

### Step 1: Clone the Repository
```bash
git clone https://github.com/tamilselvan04200803-max/autonomous-ci-repair-platform.git
cd autonomous-ci-repair-platform
```

### Step 2: Install Dependencies
```bash
npm install
```

### Step 3: Configure Environment Variables
Copy the template `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Update your configuration in `.env.local`:
```env
# Database
DATABASE_URL=postgres://forge:forge@localhost:5432/aegis_forge

# Security & Runner Tokens
FORGE_ADMIN_TOKEN=forge_admin_secret_local
FORGE_RUNNER_SECRET=dev-runner-shared-secret

# LLM Provider (Optional for testing deterministic analysis, required for candidate synthesis)
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
```

### Step 4: Seed the Database
Ensure PostgreSQL is running, then run the seed script to create tables and load the specimen demonstration run:
```bash
npm run db:seed
```

### Step 5: Start the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser. You can inspect active runs, test log analysis at `/analyze`, and verify attestation envelopes at `/verify`.

---

## 2. Docker Compose Quickstart

If you prefer running everything in isolated containers, use the provided Docker Compose stack:

```bash
docker compose up -d
```

This starts:
1. **PostgreSQL**: Available on port `5432` with pre-configured credentials.
2. **Aegis Forge Control Plane**: Available at `http://localhost:3000` with automatic database initialization and health checks.

To view logs:
```bash
docker compose logs -f app
```

To stop the containers:
```bash
docker compose down
```

---

## 3. Registering the GitHub App

To enable Aegis Forge to ingest CI failures and open draft pull requests:

1. Navigate to **GitHub Settings** > **Developer settings** > **GitHub Apps** > **New GitHub App**.
2. Set the following fields:
   - **GitHub App name**: `Aegis-Forge-YourOrg`
   - **Homepage URL**: `https://your-domain.com` (or `http://localhost:3000` for testing)
   - **Webhook URL**: `https://your-domain.com/api/webhooks/github` (use [smee.io](https://smee.io) for local proxying)
   - **Webhook secret**: Choose a strong secret and set it as `GITHUB_WEBHOOK_SECRET` in `.env.local`.
3. Configure **Repository Permissions**:
   - **Actions**: Read-only (to download workflow logs)
   - **Checks**: Read & write (to publish check runs)
   - **Pull requests**: Read & write (to create draft repair PRs)
   - **Contents**: Read & write (to push repair branches)
4. Subscribe to **Events**:
   - `Workflow run`
5. Generate and download a **Private Key** (`.pem` format) and set `GITHUB_APP_PRIVATE_KEY` in `.env.local`.
6. Note the **App ID** and set `GITHUB_APP_ID`.
7. Install the App on your desired repositories.

---

## 4. Running Verification Locally

You can test the autonomous verification runner directly without waiting for a GitHub webhook:

### Run the Unit Test Suite
```bash
npm test
```

### Test Offline Bundle Verification
Verify an in-toto DSSE proof bundle cryptographically using the zero-dependency CLI:
```bash
# Verify using the running control plane public key:
curl -s http://localhost:3000/api/runs/AF-04-1187/bundle > bundle.json
node runner/aegis.mjs verify bundle.json --key http://localhost:3000/api/keys
```

### Run the End-to-End Simulation
Test the full intake, proposal, runner reproduction, gating, and bundle creation loop:
```bash
FORGE_RUNNER_SECRET=dev-runner-shared-secret npm run dev &
AEGIS_RUNNER_SECRET=dev-runner-shared-secret bash scripts/e2e-local.sh
```

---

## Next Steps

- Explore the **[Architecture Guide](./architecture.md)** to learn how the 16-stage pipeline works.
- Learn about production hardening in the **[Deployment Guide](./deployment.md)**.
- Review security parameters and threat models in the **[Security Policy](../SECURITY.md)**.
