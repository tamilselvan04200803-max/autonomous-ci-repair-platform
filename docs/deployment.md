# Production Deployment Guide

This guide covers deploying Aegis Forge to production environments using Docker, managed containers (AWS ECS, Google Cloud Run, Fly.io), and hardened PostgreSQL configurations.

---

## 1. Production Readiness Checklist

Before exposing Aegis Forge to production traffic, verify each requirement:

- [ ] **Admin Authentication**: `FORGE_ADMIN_TOKEN` is set to a cryptographically random string (min 32 characters). In production (`NODE_ENV=production`), unprotected requests to admin endpoints fail closed.
- [ ] **Runner Shared Secret**: `FORGE_RUNNER_SECRET` is set to a cryptographically strong secret shared only with authorized CI runners.
- [ ] **GitHub App Private Key**: Downloaded from GitHub and provided via `GITHUB_APP_PRIVATE_KEY` (or mounted from a secret manager).
- [ ] **Signing Key Rotation**: Set `FORGE_SIGNING_KEY` explicitly via environment variable rather than relying on auto-generated database keys.
- [ ] **HTTPS Enforcement**: Terminate TLS at your load balancer or reverse proxy with HTTP Strict Transport Security (HSTS) enabled.
- [ ] **PostgreSQL Persistence**: Hosted PostgreSQL 15+ with automated backups, point-in-time recovery, and connection pooling (PgBouncer or Supabase pooler).

---

## 2. Docker Deployment

Aegis Forge includes an optimized multi-stage `Dockerfile` configured for Next.js standalone mode.

### Building the Production Image
```bash
docker build -t aegis-forge:latest .
```

### Running with Docker Compose in Production
Use `docker-compose.yml` with a production environment file:
```bash
docker compose -f docker-compose.yml --env-file .env.production up -d
```

### Resource Recommendations
- **Control Plane**: 1-2 vCPU, 2GB RAM (Next.js server handles API and web traffic).
- **PostgreSQL**: 2 vCPU, 4GB RAM, SSD storage.
- **Verification Runner**: Ephemeral CI runners (GitHub-hosted `ubuntu-latest` or private runner instances with 2-4 vCPU).

---

## 3. Cloud Deployments

### Option A: Google Cloud Run
Google Cloud Run provides fully managed serverless containers with zero maintenance and native Secret Manager integration.

1. Build and push image to Artifact Registry:
   ```bash
   gcloud builds submit --tag gcr.io/YOUR_PROJECT/aegis-forge:latest
   ```
2. Deploy container to Cloud Run:
   ```bash
   gcloud run deploy aegis-forge \
     --image gcr.io/YOUR_PROJECT/aegis-forge:latest \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-secrets="DATABASE_URL=aegis_db_url:latest,FORGE_ADMIN_TOKEN=aegis_admin_token:latest,FORGE_RUNNER_SECRET=aegis_runner_secret:latest,GITHUB_APP_PRIVATE_KEY=aegis_github_pem:latest" \
     --set-env-vars="NODE_ENV=production,PORT=3000"
   ```

### Option B: Fly.io
Deploy to Fly.io with a single command:

1. Create a `fly.toml` configuration:
   ```toml
   app = "aegis-forge"
   primary_region = "iad"

   [build]
     dockerfile = "Dockerfile"

   [http_service]
     internal_port = 3000
     force_https = true
     auto_stop_machines = false
     auto_start_machines = true
     min_machines_running = 1

   [[http_service.checks]]
     grace_period = "10s"
     interval = "30s"
     method = "GET"
     timeout = "5s"
     path = "/api/health"
   ```
2. Set secrets:
   ```bash
   fly secrets set DATABASE_URL="postgres://..." FORGE_ADMIN_TOKEN="..." FORGE_RUNNER_SECRET="..."
   ```
3. Deploy:
   ```bash
   fly deploy
   ```

---

## 4. Reverse Proxy & Security Headers

If hosting on a Virtual Private Server (VPS) behind Nginx or Caddy, ensure security headers and large body limits (for CI log uploads) are properly configured:

### Nginx Example Configuration
```nginx
server {
    listen 443 ssl http2;
    server_name forge.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/forge.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/forge.yourdomain.com/privkey.pem;

    client_max_body_size 10M;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 5. Health Checks & Monitoring

Aegis Forge provides a zero-overhead health check endpoint at `/api/health`.

### Probing the Health Endpoint
```bash
curl -I https://forge.yourdomain.com/api/health
```
Response:
```http
HTTP/1.1 200 OK
Content-Type: application/json

{"ok":true,"status":"operational","timestamp":"2026-10-02T04:00:00.000Z"}
```

Configure your load balancer or container health check to poll `/api/health` every 30 seconds.

---

## 6. Database Migrations & Backups

### Migrations with Drizzle Kit
When deploying a new version of Aegis Forge, database tables and columns are automatically ensured on startup via `src/db/ensure.ts`. For strict schema validation before container spinup:
```bash
npm run db:push
```

### PostgreSQL Backups
Run automated nightly dumps of the `aegis_forge` database:
```bash
pg_dump -Fc -v -h localhost -U forge aegis_forge > aegis_forge_backup_$(date +%F).dump
```
Restore if necessary:
```bash
pg_restore -v -d aegis_forge aegis_forge_backup_YYYY-MM-DD.dump
```
