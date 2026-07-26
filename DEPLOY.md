# Deployment Guide

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
| `AUTH_SECRET` | prod | Random string for session tokens. Generate with `openssl rand -hex 32` |
| `KEY_ENCRYPTION_SECRET` | if BYOK | 64-char hex for encrypting stored API keys. `openssl rand -hex 32` |
| `CURSOR_API_KEY` | if Cloud | Shared server Cursor API key for Cloud runtime |
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

1. **Install the Redis adapter**:
   ```bash
   pnpm add @socket.io/redis-adapter redis
   ```
2. **Configure in `server/index.ts`**:
   ```typescript
   import { createAdapter } from "@socket.io/redis-adapter";
   import { createClient } from "redis";

   const pub = createClient({ url: process.env.REDIS_URL });
   const sub = pub.duplicate();
   await pub.connect();
   await sub.connect();
   io.adapter(createAdapter(pub, sub));
   ```
3. **Enable sticky sessions** in your load balancer (required for WebSocket upgrades).
   - Fly.io: use `fly-force-instance-id` header or single-instance.
   - nginx: `ip_hash` or `sticky cookie`.

For a single server, no Redis is needed.

## CLI worker (local agents)

Users who want Local runtime install the CLI:

```bash
npm i -g @oblivihon/steer
steer login     # pairs with their web account
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
