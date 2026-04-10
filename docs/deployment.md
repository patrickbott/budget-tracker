# Deployment

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
                   (TBD — decision pending)
```

## Initial VPS provisioning

### 1. Create the VPS

- Go to [Hetzner Cloud Console](https://console.hetzner.cloud/)
- Create a new server:
  - **Location:** Ashburn, VA (us-east) for lowest US latency
  - **Image:** Ubuntu 24.04 LTS
  - **Type:** CX22 (2 vCPU / 4 GB RAM / 40 GB SSD, ~$4.50/mo) or CAX11 (ARM, ~$3.50/mo)
  - **SSH key:** add your public key during creation
- Note the assigned IP address

### 2. Harden the server

SSH in as root and run:

```bash
# Update system
apt update && apt -y upgrade

# Create non-root deploy user
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy

# Copy SSH key to the deploy user
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

# Allow passwordless sudo for deploy (for Docker commands)
echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deploy

# Disable root SSH login and password auth
sed -i 's/^PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# Install firewall
apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (Caddy redirect)
ufw allow 443/tcp   # HTTPS
ufw allow 443/udp   # HTTP/3 (QUIC)
ufw --force enable

# Install fail2ban
apt install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban

# Enable unattended security updates
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# Install Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# (Optional) Install Tailscale for private admin access
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --ssh
```

Log out of root. From now on, SSH in as `deploy`.

### 3. Set up DNS

- In Cloudflare (or your DNS provider), create an **A record** pointing your domain to the VPS IP
- If using Cloudflare, enable **Proxy** (orange cloud) for DDoS protection
- **Note:** If Cloudflare proxy is enabled, set SSL mode to **Full (Strict)** so Caddy's cert is validated

### 4. Clone and configure

```bash
# As the deploy user
sudo mkdir -p /opt/budget-tracker
sudo chown deploy:deploy /opt/budget-tracker

# Clone (use a deploy key if private repo)
git clone https://github.com/<your-user>/budget-tracker.git /opt/budget-tracker
cd /opt/budget-tracker

# Create the production .env file
cat > .env << 'ENVEOF'
# Domain (Caddy uses this for auto-TLS)
APP_DOMAIN=budget.example.com

# Postgres
POSTGRES_DB=budget_tracker
POSTGRES_USER=budget
POSTGRES_PASSWORD=<generate: openssl rand -base64 32>
DATABASE_URL=postgresql://budget:<same-password>@postgres:5432/budget_tracker

# Auth
BETTER_AUTH_SECRET=<generate: openssl rand -base64 32>

# AI
ANTHROPIC_API_KEY=<your-key>

# SimpleFIN connection encryption
ENCRYPTION_MASTER_KEY=<generate: openssl rand -base64 32>
ENVEOF

# Lock down the .env file
chmod 600 .env
```

### 5. First deploy

```bash
# Run the deploy script with --first-run to include migrations
./scripts/deploy.sh --first-run

# Or manually:
docker compose -f infra/docker-compose.prod.yml up -d --build

# Verify
curl -sf https://<your-domain>/api/health
```

## Deploy script

Subsequent deploys use `scripts/deploy.sh`:

```bash
# From your local machine
VPS_HOST=<vps-ip> ./scripts/deploy.sh
```

The script:
1. SSHs into the VPS
2. Pulls latest code from `main`
3. Rebuilds and restarts Docker containers
4. Runs a health check

Use `--first-run` on the initial deploy to also run database migrations.

See `scripts/deploy.sh` for all configurable environment variables.

## Caddy configuration

The Caddyfile at `infra/Caddyfile` uses the `$APP_DOMAIN` environment variable (injected by docker-compose.prod.yml). Caddy automatically:
- Issues a Let's Encrypt TLS certificate
- Renews it before expiry
- Redirects HTTP to HTTPS
- Adds security headers (HSTS, X-Frame-Options, etc.)

No manual certificate management required.

## Backups

Nightly encrypted backups via `scripts/backup.sh`:

1. `pg_dump` pipes directly through `age` encryption — no unencrypted data touches disk
2. Encrypted dump stored locally in `/opt/budget-tracker/backups/`
3. Optionally uploaded to a Backblaze B2 bucket
4. Local backups older than `BACKUP_RETENTION_DAYS` (default 30) are pruned
5. Pings Healthchecks.io on success (if configured)

### Setting up backups

```bash
# Install age for encryption
apt install -y age

# Generate an age keypair (do this on your LOCAL machine, not the VPS)
age-keygen -o budget-backup.key
# Save the public key (starts with age1...) — this goes on the VPS
# Save the private key file OFFLINE — this is your recovery key

# Install B2 CLI (optional, for remote backups)
pip install b2

# Add the backup cron job on the VPS
crontab -e
# Add this line:
# 0 3 * * * cd /opt/budget-tracker && source .env && AGE_RECIPIENT=age1... POSTGRES_DB=budget_tracker POSTGRES_USER=budget ./scripts/backup.sh >> /var/log/budget-backup.log 2>&1
```

### Restore procedure

```bash
# 1. Download the encrypted dump (from B2 or local backup)
b2 download-file-by-name <bucket> backups/budget_tracker-20260410-030000.sql.age ./restore.sql.age

# 2. Decrypt with your offline private key
age -d -i budget-backup.key restore.sql.age > restore.sql

# 3. Restore into a fresh database
docker compose -f infra/docker-compose.prod.yml exec -T postgres \
  psql -U budget -d budget_tracker < restore.sql

# 4. Restart the app and verify
docker compose -f infra/docker-compose.prod.yml restart app
curl -sf https://<your-domain>/api/health
```

B2 pricing (2026): storing ~1 GB of backups costs less than $0.01/month.

## Monitoring

| Signal | Tool | Setup |
|---|---|---|
| App health | [Healthchecks.io](https://healthchecks.io) (free) | Create a check, set the period to 24h. The daily sync job and backup script ping it on success. Alerts if missed. |
| HTTP uptime | [UptimeRobot](https://uptimerobot.com) (free) | Create an HTTP(s) monitor for `https://<domain>/api/health`, check every 5 min. |
| Log retention | Docker json-file driver | Default Docker log driver. Configure rotation in `/etc/docker/daemon.json`: `{"log-opts": {"max-size": "100m", "max-file": "3"}}` |
| Resource usage | `docker stats`, `htop` | Manual for now. Revisit if the VPS gets tight. |

### Setting up Healthchecks.io

1. Create a free account at healthchecks.io
2. Create a new check with a 24-hour period and 1-hour grace
3. Copy the ping URL
4. Set it as `HEALTHCHECKS_PING_URL` in your backup cron and sync job config

## CI/CD

`.github/workflows/ci.yml`:
- On every push: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
- On PRs to main: also runs `pnpm build`
- No automatic deploy — production deploys are manual via `scripts/deploy.sh`

## Secrets management

| Context | Location | Notes |
|---|---|---|
| Local dev | `.env.local` at repo root | Gitignored |
| Production | `/opt/budget-tracker/.env` on VPS | Permissions `600`, owned by deploy user |
| CI | None | CI runs tests against a disposable Postgres, no prod secrets |

**Rotation:**
- `BETTER_AUTH_SECRET` — rotate freely; existing sessions will be invalidated
- `ENCRYPTION_MASTER_KEY` — rotating requires re-encrypting every `connection.access_url_encrypted` row. Use `scripts/rotate-encryption-key.sh` (Phase 1+)

## Upgrade / deploy loop

```bash
# From your local machine:
VPS_HOST=<ip> ./scripts/deploy.sh

# Or manually on the VPS:
cd /opt/budget-tracker
git pull origin main
docker compose -f infra/docker-compose.prod.yml up -d --build
docker compose -f infra/docker-compose.prod.yml logs --tail=100 -f
```

**Database migrations** run automatically on container startup via the Drizzle migrate step in the app's startup sequence.

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
- [ ] Nightly backup job has run at least once successfully (check Healthchecks.io)
- [ ] Caddy has issued a valid Let's Encrypt cert (check `docker compose logs caddy`)

## Restore test log

_Record quarterly restore test results here:_

| Date | Backup file | Result | Notes |
|---|---|---|---|
| — | — | — | No tests yet |
