# Steer — Shared Live Agent Sessions

Multiplayer Cursor agent sessions where multiple people can watch, redirect, and hand off control — like Google Docs for agent work.

## Prerequisites

- **Node.js** 22+
- **pnpm** 9+
- **Cursor CLI** with `cursor agent` (for local runtime / CLI worker)

## Quick Start

```bash
pnpm install
cd web && pnpm install && cd ..

# Start API (:3000) + Next.js (:3001)
pnpm dev

# Open http://localhost:3001
```

## Architecture

```
Express API (:3000)                 Next.js App (:3001)
├─ REST /api/rooms, /api/auth  ──── /dashboard, /create, /invite
├─ Socket.IO (rooms + workers) ──── /room/[id]
│
├─ RoomManager
│   ├─ SdkAgentSession ──────────── Cloud / BYOK / server-key agents
│   ├─ WorkerRelay ──────────────── Local CLI via `steer start`
│   ├─ DiffWatcher ──────────────── git diffs for local SDK rooms
│   └─ SQLite / Postgres ────────── rooms, chat, invites, keys
```

Chat + diffs + presence are the live collaboration surface. There is no per-room
tmux/PTY terminal in the current product UI.

## Environment Variables

Copy `.env.example` to `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Express API port |
| `CURSOR_API_KEY` | | Shared server key for Cloud / server auth mode |
| `KEY_ENCRYPTION_SECRET` | | Encrypt BYOK + stored server keys |
| `ADMIN_USER_IDS` | | Comma-separated Clerk user IDs allowed to manage the server key |
| `CLERK_SECRET_KEY` | | Clerk backend secret |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | | Clerk publishable key |
| `REDIS_URL` | | Optional — enables Socket.IO Redis adapter for multi-instance |
| `INVITE_TTL_MS` | 7 days | Invite link lifetime |
| `CORS_ORIGIN` | | Comma-separated allowed browser origins in production |
| `NEXT_PUBLIC_SOCKET_URL` | | Public API origin for Socket.IO |
| `DATABASE_URL` | | Postgres URL; omit for SQLite |

## Features

- **Multi-room** — Independent Steer sessions with durable chat history
- **Cloud + local** — Cloud agents via Cursor SDK; local via CLI worker
- **Steering** — Attributed prompts from anyone in the room
- **Driver control** — Request, grant, and release the driver seat
- **Live diffs** — File changes stream into the room
- **Invites** — Host-managed invite links with max uses + expiry
- **BYOK** — Per-user saved Cursor API keys for cloud sessions

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start API + web concurrently |
| `pnpm dev:server` | Express API only |
| `pnpm dev:web` | Next.js only |
| `pnpm build` | Typecheck + build Next.js |
| `pnpm typecheck` | Server TypeScript check |

## CLI worker (local agents)

```bash
# Sign in on the web → /cli-pair → generate code
steer login     # server URL + pairing code
steer start     # worker stays online for your account
```

## Socket.IO scaling

Set `REDIS_URL` and the API attaches `@socket.io/redis-adapter` automatically.
Sticky sessions are still required at the load balancer for WebSocket upgrades.

## Demo Reset

```bash
rm -f data.db data.db-*
```
