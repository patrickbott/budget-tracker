# Deployment

> **Status:** Stub — fills in during Phase 0b (Docker Compose + CI) and hardens at Phase 1 deploy. This file describes the target deploy story; the scripts/playbooks referenced land incrementally.

## Target topology (VPS)

```
┌─────────────────────────────────────────────────────────────┐
│ Hetzner CX22 (or CAX11 ARM)                                 │
│ Ubuntu 24.04 LTS                                            │
│ - UFW: 22 (SSH), 80, 443 only                               │
│ - fail2ban on SSH                                           │
│ - unattended-upgrades                                       │
│ - SSH key-only, root login disabled                         │
│ - Tailscale (optional) for private admin access             │
│                                                             │
│ Docker Compose stack:                                       │
│   ┌──────────┐   ┌──────────────┐   ┌────────────────────┐  │
│   │  caddy   │──▶│ apps/web     │──▶│ packages/jobs      │  │
│   │  :80/443 │   │ Next.js 15   │   │ pg-boss workers    │  │
│   │  auto-TLS│   │ :3000        │   │                    │  │
│   └──────────┘   └──────┬───────┘   └────────┬───────────┘  │
│                         │                    │              │
│                         └────────┬───────────┘              │
│                                  ▼                          │
│                          ┌───────────────┐                  │
│                          │ postgres:16   │                  │
│                          │ named volume  │                  │
│                          └───────┬───────┘                  │
│                                  │                          │
│                                  ▼                          │
│                          ┌───────────────┐                  │
│                          │ nightly       │                  │
│                          │ pg_dump → age │                  │
│                          │ → Backblaze B2│                  │
│                          └───────────────┘                  │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTPS (Let's Encrypt via Caddy)
                              │
                   Cloudflare DNS (proxied)
                              ▲
                              │
                         Your domain
                   (e.g. budget.example.com)
```

## Initial VPS provisioning

_Playbook lives at `infra/vps-setup.md` from Phase 0b onward. Summary of what that file will contain:_

1. Spin up Hetzner CX22 (or CAX11 for ARM) in Ashburn, Virginia (or whichever region is closest)
2. Add your SSH public key during provisioning; receive root password via email (immediately change/disable)
3. SSH in, run the hardening script:
   - Update packages: `apt update && apt -y upgrade`
   - Create a non-root user, add to sudo, copy SSH key
   - Disable root SSH + password auth
   - Install `ufw`, `fail2ban`, `unattended-upgrades`
   - Open ports 22, 80, 443
   - Install Docker + Docker Compose v2
   - (Optional) Install Tailscale, run `tailscale up --ssh` for private admin access
4. Point your domain at the VPS IP via Cloudflare DNS (A record, proxied)
5. Copy the repo to `/opt/budget-tracker` via `git clone` (use a deploy key if the repo is private)
6. Create `/opt/budget-tracker/.env` with production values (use `openssl rand -base64 32` for all secrets)
7. `docker compose -f infra/docker-compose.prod.yml up -d`
8. Verify: `curl https://<your-domain>/api/health` should return 200

## Caddy configuration

`infra/Caddyfile`:

```
{
  email admin@example.com
}

budget.example.com {
  reverse_proxy web:3000
  encode gzip zstd
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Frame-Options "DENY"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
  }
}
```

Caddy automatically issues and renews Let's Encrypt certs. No manual cert management.

## Backups

Nightly cron (in `infra/backup/backup.sh`):

1. `pg_dump` the budget_tracker database
2. Encrypt the dump with `age -r <recipient>` using a public key (private key lives offline, not on the VPS)
3. Upload to a Backblaze B2 bucket via `b2` CLI
4. Prune backups older than `BACKUP_RETENTION_DAYS` (default 30)
5. Ping `HEALTHCHECKS_SYNC_PING_URL` on success

B2 pricing at current rates (2026): storing ~1 GB of backups costs less than $0.01/month.

**Restore procedure** (should be tested quarterly):

1. Download the most recent encrypted dump from B2
2. Decrypt with the offline private key
3. `psql budget_tracker < dump.sql` against a freshly-created database
4. Spin up the app against the restored DB, verify a recent transaction
5. Document the result in `docs/deployment.md` under "Restore test log"

## CI/CD

`.github/workflows/ci.yml` (Phase 0b):
- On every push: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
- On PRs to main: also run `pnpm build`
- No automatic deploy — production deploys are manual (`git pull && docker compose build && docker compose up -d` on the VPS)

## Secrets management

- **Local dev:** `.env.local` at repo root, gitignored
- **Production VPS:** `.env` in `/opt/budget-tracker/`, permissions `600`, owned by the deploy user
- **CI:** no production secrets in CI. CI only runs tests against a disposable Postgres, not the real DB
- **Rotation:** `BETTER_AUTH_SECRET` and `ENCRYPTION_MASTER_KEY` should be rotated if compromised. Rotating `ENCRYPTION_MASTER_KEY` requires re-encrypting every `connection.access_url_encrypted` row — there's a rotation script at `scripts/rotate-encryption-key.sh` (Phase 1+)

## Monitoring

| Signal | Tool | Notes |
|---|---|---|
| App health | Healthchecks.io (free) | Pinged by daily sync job; alerts if missed |
| HTTP uptime | UptimeRobot (free) | Polls `/api/health` every 5 min |
| Error reporting | Sentry (optional, Phase 4+) | Free tier: 5k errors/mo |
| Log retention | Docker's default json-file, rotated by Docker | Keep 3 days, 100MB max. For more, ship to Loki on the same VPS (Phase 5) |
| Resource usage | `docker stats`, `htop` on the VPS | Manual for now; revisit if the VPS gets tight |

## Upgrade / deploy loop

```bash
# On the VPS
cd /opt/budget-tracker
git pull origin main
docker compose -f infra/docker-compose.prod.yml pull  # if using pre-built images
docker compose -f infra/docker-compose.prod.yml up -d --build
docker compose -f infra/docker-compose.prod.yml logs --tail=100 -f
```

**Database migrations** run automatically on container startup via an `entrypoint.sh` that calls `pnpm db:migrate` before `next start`.

## Rollback

If a deploy goes bad:

```bash
cd /opt/budget-tracker
git log --oneline -10                    # find the last good commit
git checkout <good-sha>
docker compose -f infra/docker-compose.prod.yml up -d --build
```

For migration rollbacks: Drizzle doesn't have automatic down migrations. If a migration is bad, write a new forward migration that fixes it. Never edit applied migrations.

## Operational checklist (post-deploy)

- [ ] `https://<domain>` returns 200 and the landing page renders
- [ ] `https://<domain>/api/health` returns `{"status":"ok","db":"ok","version":"..."}`
- [ ] Signup works end-to-end (create a test family)
- [ ] `docker compose logs` shows no errors in the last 5 minutes
- [ ] `docker exec -it postgres psql -U budget -d budget_tracker -c '\dt'` shows the expected tables
- [ ] `docker exec -it postgres psql -U budget -d budget_tracker -c 'SELECT COUNT(*) FROM family'` returns a reasonable number
- [ ] Nightly backup job has run at least once successfully (check Healthchecks.io)
- [ ] Caddy has issued a valid Let's Encrypt cert (check `docker compose logs caddy`)
