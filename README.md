# Steer — Shared Live Agent Sessions

Multiplayer Cursor agent sessions where multiple people can watch, redirect, and hand off control — like Google Docs for agent work.

## Prerequisites

- **Node.js** 22+
- **pnpm** 9+
- **Cursor CLI** with `cursor agent` (for local Cursor runtime / CLI worker)
- **Claude Code CLI** (`claude`) when using local Claude Code agents
- **E2B** account + `E2B_API_KEY` when using Claude Code cloud

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
│   ├─ SdkAgentSession ──────────── Cursor Cloud / BYOK / server-key agents
│   ├─ ClaudeSandboxSession ─────── Claude Code cloud via E2B
│   ├─ WorkerRelay ──────────────── Local Cursor + Claude CLI via `steer start`
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
| `CURSOR_API_KEY` | | Shared server key for Cursor Cloud / server auth mode |
| `ANTHROPIC_API_KEY` | | Optional fallback for Claude Code cloud (prefer user BYOK) |
| `E2B_API_KEY` | | Required for Claude Code cloud sandboxes |
| `GITHUB_TOKEN` / `GH_TOKEN` | | Clone/push/PR for Claude Code cloud agents |
| `KEY_ENCRYPTION_SECRET` | | Encrypt Cursor/Anthropic BYOK + stored server keys |
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
- **Cloud + local** — Cursor Cloud via SDK; Claude Code cloud via E2B; local via CLI worker
- **Claude Code** — Local `claude` CLI (protocol 3 worker) or E2B sandbox with Anthropic BYOK, branch push, optional PR
- **Steering** — Attributed prompts from anyone in the room
- **Driver control** — Request, grant, and release the driver seat
- **Live diffs** — File changes stream into the room (sandbox `git diff` for cloud Claude)
- **Invites** — Host-managed invite links with max uses + expiry
- **BYOK** — Per-user saved Cursor and Anthropic API keys
- **Shared memory** — Room-scoped goals, decisions, constraints, discoveries, and handoffs, plus a budgeted repo map injected into every agent runtime

## Design proposals

- [Shared memory for multiplayer agents](docs/shared-memory-rfc.md) — design notes for the provider-neutral context and handoff layer (Phases 1–3 implemented)

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start API + web concurrently |
| `pnpm dev:server` | Express API only |
| `pnpm dev:web` | Next.js only |
| `pnpm build` | Typecheck + build Next.js |
| `pnpm typecheck` | Server TypeScript check |

## CLI worker (local agents)

Protocol **3+** is required for Claude Code and multi-agent file locks. Publish/install the latest `@oblivihon/steer`:

```bash
npm i -g @oblivihon/steer
# Sign in on the web → /cli-pair → generate code
steer login     # server URL + pairing code
steer start     # worker stays online for your account

# Optional: Claude Code local also needs the Anthropic CLI on PATH
# npm i -g @anthropic-ai/claude-code
```

## Socket.IO scaling

Set `REDIS_URL` and the API attaches `@socket.io/redis-adapter` automatically.
Sticky sessions are still required at the load balancer for WebSocket upgrades.

## Demo Reset

```bash
rm -f data.db data.db-*
```
