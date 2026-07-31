# Deployment Guide

## Recommended: Vercel (frontend) + Render (API)

### A. Render — API + SQLite (single node)

This project defaults to **SQLite** when `DATABASE_URL` is unset — good for one Render web service.

1. Push this repo to GitHub.
2. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint** → select the repo (`render.yaml`).
   Or create a **Web Service** (Node) manually:
   - Build: `npx --yes pnpm@9 install --frozen-lockfile --prod=false && npx --yes pnpm@9 exec tsc --outDir dist`
   - Start: `node dist/server/index.js`
   - Health check: `/api/auth/status`
   - **Disk**: mount `/var/data` (1 GB+) so SQLite survives deploys
3. Set env vars:

| Key | Value |
|-----|--------|
| `SQLITE_PATH` | `/var/data/steer.db` |
| *(no `DATABASE_URL`)* | omit — forces SQLite |
| `CLERK_SECRET_KEY` | From Clerk |
| `AUTH_SECRET` | `openssl rand -hex 32` |
| `KEY_ENCRYPTION_SECRET` | `openssl rand -hex 32` |
| `CORS_ORIGIN` | Your Vercel URL, e.g. `https://steer.vercel.app` |
| `CURSOR_API_KEY` | Optional (Cursor Cloud / server auth) |
| `ANTHROPIC_API_KEY` | Optional fallback for Claude Code cloud (prefer user BYOK) |
| `E2B_API_KEY` | Required for Claude Code cloud (E2B sandboxes) |
| `GITHUB_TOKEN` | Optional but recommended — push/PR for Claude Code cloud (`GH_TOKEN` also accepted) |

4. Note the service URL, e.g. `https://steer-api.onrender.com`.

**Important:** without a **persistent disk**, Render’s filesystem is ephemeral and you’ll lose the DB on every deploy.  
**Free tier note:** idle spin-down breaks long-lived WebSockets — prefer paid starter for prod.  
**Later:** if you need multiple API instances, switch to Postgres (`DATABASE_URL=postgres://...`).

### B. Vercel — Next.js web

1. [Vercel](https://vercel.com) → **Add New Project** → import the same repo.
2. Set **Root Directory** to `web`.
3. Framework: Next.js (auto).
4. Environment variables:

| Key | Value |
|-----|--------|
| `NEXT_PUBLIC_API_URL` | `https://cursor-multiplayer-agent.onrender.com` (browser → API) |
| `API_URL` | same Render URL (optional server rewrites) |
| `NEXT_PUBLIC_SOCKET_URL` | same Render URL (browser WebSocket) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | From Clerk |
| `CLERK_SECRET_KEY` | Same as Render |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/login` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | `/` |

5. Deploy. Copy the Vercel URL into Render’s `CORS_ORIGIN` (and redeploy API if needed).

### C. Clerk dashboard

Add both origins under **Paths / Domains**:
- `https://your-app.vercel.app`
- `http://localhost:3001` (dev)

### D. CLI workers (Local runtime)

Users point `steer login` at the **Render** API URL:

```bash
steer login
# Server URL: https://steer-api.onrender.com
steer start
```

---

## Quick start (Docker Compose)

```bash
cp .env.production.example .env.production

# Edit .env.production — set AUTH_SECRET, KEY_ENCRYPTION_SECRET, NEXT_PUBLIC_SOCKET_URL

docker compose up -d
```

The app will be available at `http://localhost:3001` (web) and `http://localhost:3000` (API/WebSocket).

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | prod | `postgres://user:pass@host:5432/db` — omit for SQLite (dev only) |
| `AUTH_SECRET` | no | Legacy deploy var (CLI tokens are random hex + SHA-256) |
| `ADMIN_USER_IDS` | no | Comma-separated Clerk user IDs that may manage the shared server key |
| `CLERK_SECRET_KEY` | yes | From Clerk dashboard |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | From Clerk dashboard |
| `KEY_ENCRYPTION_SECRET` | if BYOK | 64-char hex for encrypting stored API keys. `openssl rand -hex 32` |
| `CURSOR_API_KEY` | if Cloud | Shared server Cursor API key for Cloud runtime |
| `REDIS_URL` | multi-instance | Enables Socket.IO Redis adapter automatically |
| `INVITE_TTL_MS` | no | Invite link lifetime in ms (default 7 days) |
| `NEXT_PUBLIC_SOCKET_URL` | prod | Public URL where the API is reachable, e.g. `https://api.example.com` |
| `PORT` | no | API server port (default: 3000) |
| `DEFAULT_MODEL` | no | Default model ID (default: `auto`) |

## Fly.io

```bash
fly launch          # creates app
fly secrets set \
  DATABASE_URL="postgres://..." \
  AUTH_SECRET="$(openssl rand -hex 32)" \
  KEY_ENCRYPTION_SECRET="$(openssl rand -hex 32)" \
  NEXT_PUBLIC_SOCKET_URL="https://shared-agent-session.fly.dev"

fly deploy
```

For Postgres on Fly: `fly postgres create` then `fly postgres attach`.

## VPS / bare metal

1. Install Node 22+, git, and Postgres
2. Clone the repo, `pnpm install`, `pnpm build`, `cd web && pnpm build`
3. Set env vars in `.env` or system env
4. Run with PM2 or systemd:
   ```bash
   pm2 start dist/server/index.js --name api
   pm2 start "cd web && npx next start -p 3001" --name web
   ```
5. Put behind nginx/Caddy with TLS for HTTPS + WSS

## Socket.IO scaling (multi-instance)

By default, Socket.IO state is in-memory and tied to a single process. If you scale to multiple API instances:

1. Set `REDIS_URL` (e.g. `redis://…`). The API attaches `@socket.io/redis-adapter` on boot.
2. **Enable sticky sessions** in your load balancer (required for WebSocket upgrades).
   - Fly.io: use `fly-force-instance-id` header or single-instance.
   - nginx: `ip_hash` or `sticky cookie`.

For a single server, no Redis is needed.

## CLI worker (local agents)

Users who want Local runtime install the CLI:

```bash
npm i -g @oblivihon/steer
# Sign in on the web → open /cli-pair → generate code
steer login     # enter server URL + pairing code
steer start     # worker stays running, connects to hosted API
```

Prerequisite: [Cursor CLI](https://cursor.com) installed and logged in (`cursor agent whoami`).

## HTTPS / WSS

- Always use HTTPS in production. Fly.io provides TLS by default.
- Set `NEXT_PUBLIC_SOCKET_URL` to the `https://` origin.
- The Socket.IO client auto-upgrades `https://` to `wss://`.

## CORS

- In development (`NODE_ENV !== 'production'`), CORS is `*`.
- In production, Socket.IO CORS is restricted to same-origin. If your web and API are on different domains, set `CORS_ORIGIN` and update `server/index.ts`.
