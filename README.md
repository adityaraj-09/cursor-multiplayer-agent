# Shared Live Agent Session

Multiplayer AI — shared live Cursor Agent sessions where multiple people can watch, redirect, and hand off control, like Google Docs for agent work.

## Prerequisites

- **Node.js** 22+
- **pnpm** 9+
- **tmux** 3.x (`brew install tmux`)
- **Cursor CLI** with `cursor agent` (`cursor agent --help` to verify)

## Quick Start

```bash
# Install dependencies
pnpm install
cd web && pnpm install && cd ..

# Start both servers (Express API on :3000, Next.js on :3001)
pnpm dev

# Open http://localhost:3001
```

## Architecture

```
Express API (:3000)              Next.js App (:3001)
├─ POST /api/rooms  ──────────── /create page
├─ GET  /api/rooms  ──────────── / dashboard
├─ Socket.IO (per-room)  ─────── /room/[id] page
│
├─ RoomManager
│   ├─ per-room PtyRunner  ───── tmux session (durable)
│   ├─ per-room DiffWatcher ──── chokidar + git diff
│   ├─ per-room participants ─── driver lock + steer
│   └─ SQLite persistence ────── rooms + steer history
```

## Environment Variables

Copy `.env.example` to `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Express API port |
| `REPO_PATH` | `./demo-repo` | Default repository path for new sessions |
| `AGENT_COMMAND` | `cursor agent --force --trust` | Default agent command |

## Features

- **Multi-room** — Create multiple independent agent sessions
- **Live terminal** — Watch cursor-agent work in real time via xterm.js
- **Steering** — Anyone can redirect the agent with attributed messages
- **Driver control** — Request, grant, and release keyboard control
- **Live diff** — See file changes as they happen via diff2html
- **Persistence** — Rooms and steer history stored in SQLite
- **Durability** — tmux sessions survive server restarts
- **Auto-reassign** — Driver automatically transferred on disconnect

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start both servers concurrently |
| `pnpm dev:server` | Start Express API only |
| `pnpm dev:web` | Start Next.js only |
| `pnpm build` | Typecheck + build Next.js |
| `pnpm smoke:pty` | Verify tmux + node-pty integration |

## tmux Fallback

Connect to any session directly:

```bash
tmux list-sessions
tmux attach -t <session-id>
```

## Demo Reset

```bash
cd demo-repo && git checkout . && git clean -fd
```
