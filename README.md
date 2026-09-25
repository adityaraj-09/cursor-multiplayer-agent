# Steer

**Shared live agent sessions** — multiplayer Cursor and Claude Code work where teammates watch, steer, and hand off control in real time. Steer also runs **headless issue agents** and **long-horizon research swarms** on the same API keys, teams, and GitHub connections.

| Surface | What it is |
|--------|------------|
| [**Sessions**](/dashboard) | Collaborative rooms with chat, live diffs, driver seat, shared memory, and one or more agents |
| [**Issues**](/issues) | Linear-style tickets; a Cursor Cloud agent picks up the repo after a delay and opens a PR |
| [**Swarms**](/swarms) | Teams of Cursor Cloud agents on an MCP message board until the goal is verified (optional build → PR) |
| [**Board**](/board) | Multi-session wall: pin up to several rooms and follow them at once |
| **Teams** | Personal or org workspace with shared Cursor/Anthropic keys and GitHub OAuth |

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Architecture](#architecture)
- [Sessions](#sessions)
- [Issues](#issues)
- [Swarms](#swarms)
- [Teams, auth, and API keys](#teams-auth-and-api-keys)
- [Shared memory and repo map](#shared-memory-and-repo-map)
- [Voice approvals](#voice-approvals)
- [Notifications](#notifications)
- [CLI worker (local agents)](#cli-worker-local-agents)
- [Environment variables](#environment-variables)
- [Scripts and tests](#scripts-and-tests)
- [Deployment](#deployment)
- [Socket.IO scaling](#socketio-scaling)
- [Design notes](#design-notes)

---

## Prerequisites

- **Node.js** 22+
- **pnpm** 9+
- **Cursor CLI** with `cursor agent` (local Cursor runtime / CLI worker)
- **Claude Code CLI** (`claude`) when using local Claude Code agents
- **Codex CLI** (`codex`) when using local Codex agents
- **Blaxel** workspace (`BL_API_KEY` + `BL_WORKSPACE`) when using Claude Code or Codex **cloud**
- **Clerk** app for sign-in (`CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`)

---

## Quick start

```bash
pnpm install
cd web && pnpm install && cd ..

cp .env.example .env
# Fill Clerk keys; optional CURSOR_API_KEY, KEY_ENCRYPTION_SECRET for cloud/BYOK

pnpm dev
# API :3000, Next.js :3001 → http://localhost:3001
```

For swarms and voice webhooks in local dev, expose the API with a tunnel and set `API_PUBLIC_ORIGIN` to that URL (see [Swarms](#swarms)).

---

## Architecture

```
Express API (:3000)                    Next.js (:3001)
├─ REST  /api/rooms, /api/swarms, …  ──  /dashboard, /room/[id], /swarms/[id]
├─ Socket.IO (rooms + workers)       ──  live chat, presence, diffs
├─ /api/swarm-mcp                      ──  Cursor Cloud → swarm message board (MCP)
│
├─ RoomManager
│   ├─ SdkAgentSession      Cursor Cloud (BYOK / org key / server key)
│   ├─ CliSandboxSession    Claude Code / Codex cloud (Blaxel + BYOK)
│   ├─ WorkerRelay          Local Cursor + Claude + Codex via `steer start`
│   ├─ DiffWatcher          Git diffs for local SDK rooms
│   └─ SQLite or Postgres   rooms, chat, swarms, issues, keys, orgs
│
├─ IssueRunner              Headless Cursor Cloud runs (no room)
└─ SwarmRunner              Orchestrator + workers in resumable cycles
```

Chat, diffs, and presence are the live collaboration surface. There is no per-room tmux/PTY terminal in the product UI.

---

## Sessions

Create a session from **Sessions → New** (or `/create`, which opens the composer on the dashboard).

### Runtimes and backends

| Backend | Runtime | Auth | Repo |
|--------|---------|------|------|
| **Cursor** | Local | CLI login, server key, or BYOK | Folder on the machine running `steer start` |
| **Cursor** | Cloud | Server key or BYOK | GitHub HTTPS URL + branch; optional auto-PR |
| **Claude Code** | Local | CLI (`claude` on PATH) | Local folder |
| **Claude Code** | Cloud | Anthropic BYOK (user or org) | GitHub URL; Blaxel sandbox; push branch / optional PR |
| **Codex** | Local | CLI (`codex` on PATH) | Local folder |
| **Codex** | Cloud | OpenAI BYOK (user or org) | GitHub URL; Blaxel sandbox; push branch / optional PR |

Cloud Claude Code and Codex require `BL_API_KEY` and `BL_WORKSPACE` on the server. Clone/push/PR use `GITHUB_TOKEN` / `GH_TOKEN` and/or the user’s **Settings → GitHub** connection.

### Collaboration

- **Steering** — Anyone in the room can send attributed prompts to the active agent(s).
- **Driver seat** — Request, grant, and release who may steer.
- **Live diffs** — File changes stream into the room (sandbox `git diff` for cloud Claude).
- **Invites** — Host-managed links with max uses and expiry (`INVITE_TTL_MS`).
- **Members** — Join via invite; hosts can adjust roles and remove members.
- **Room export** — `GET /api/rooms/:id/export` returns markdown transcript + summary (UI where exposed).

### Multi-agent in one room

Add multiple agents (Cursor or Claude) to the same session. **File locks** prevent concurrent edits to the same path; hosts can force-release locks. An **integrator** agent can merge work from feature agents (room API: integrate flow).

### Room extras

- **Shared memory** — Goals, decisions, constraints, discoveries, handoffs (see below).
- **Repo map** — Budgeted structural map of the repo injected into agent context.
- **Uploads** — Attach files to a room (`ISSUE_UPLOAD_DIR`-style storage for room uploads).
- **Slack** — Per-room incoming webhook for session events (falls back to `SLACK_WEBHOOK_URL`).
- **Pings** — In-room acknowledgment flows for attention (`/api/rooms/:id/pings/...`).

Archive, stop, abort, revert, and model changes are available per room via the API and UI.

---

## Issues

**Issues** are tickets scoped to **personal** or **team** workspace — they do **not** create a session and do not appear under Sessions.

1. Create an issue with title, description, GitHub repo URL, branch, priority, and model.
2. Optionally attach images (size/count limits in `shared/issues.ts`).
3. After **pickup delay** (default **10 minutes**, configurable per issue and in team issue settings), a **headless Cursor Cloud** agent runs against the repo.
4. On success: markdown **writeup** stored in the DB, **PR URL** and branch on the issue; transcript available when a Cursor key resolves.
5. Statuses include `draft`, `queued`, `running`, `needs_input`, `in_review`, `done`, `failed`, `cancelled`. Queue, run-now, and cancel via the UI/API.

**Cursor API key resolution** (same order as swarms): org shared Cursor key → creator BYOK → server `CURSOR_API_KEY`.

Team admins can tune default pickup delay and max concurrent issues per scope.

---

## Swarms

**Swarms** tackle open-ended goals with many specialized **Cursor Cloud** agents coordinating on a **Steer-hosted MCP board** (`steer_swarm` at `/api/swarm-mcp`). Scope: personal or team. One **model** per swarm (`modelId`, default `auto`) applies to every agent cycle.

### Lifecycle

| Status | Meaning |
|--------|---------|
| `draft` | Created without auto-start; edit then start |
| `planning` / `researching` / `building` | Runner schedules agent cycles |
| `awaiting_approval` | Research done; human approves or rejects **build phase** |
| `paused` | Budget threshold or manual pause |
| `stopped` / `done` / `failed` | Terminal |

**Phases:** `research` (read-only repo access when a repo is attached) → optional **build** (engineers + integrator, PR on integration branch).

### Roles

| Role | Role in the swarm |
|------|-------------------|
| **Orchestrator** | Plans task graph, spawns workers, gates finish / phase change |
| **Researcher** | Evidence and findings on the board |
| **Critic** | Critiques hypotheses (`support` / `refute` / `needs_evidence`) |
| **Ranker** | Elo-style hypothesis tournament |
| **Synthesizer** | Produces the `report` artifact |
| **Verifier** | Verify task; must pass after latest report |
| **Engineer** | Build phase — scoped code tasks on branches |
| **Integrator** | Build phase — merges to integration branch; can auto-open PR |

When `repoUrl` is set, **all agents** receive a checkout (orchestrator included) so they can read the codebase; write-capable repo roles only run in **build**.

### Message board (MCP)

Agents call MCP tools (role-filtered) to:

- Post to channels (`plan`, `findings`, `questions`, `decisions`, task threads)
- Claim and complete tasks (research, critique, rank, synthesize, verify, build, integrate)
- Maintain a **ledger**, **hypotheses**, **critiques**, **artifacts**, and **activity**
- Spawn/retire workers, request human input, request build phase, or **declare_done**

Cursor’s backend must reach the board URL:

- Default: `{API_PUBLIC_ORIGIN}/api/swarm-mcp`
- Override: `SWARM_MCP_URL`

Set `API_PUBLIC_ORIGIN` to your public API (Render, Fly, ngrok, etc.) — not the Next.js origin.

### Limits (defaults)

Configurable at create time (clamped in `shared/swarm.ts`):

- Budget USD (default **$25**, max $2000) — pause near **80%** spend
- Deadline (default **24h**, max 14 days)
- Max workers / max concurrent runs / max cycles
- Global caps: `SWARM_ACCOUNT_SLOTS` (default **6**) concurrent Cursor Cloud runs per key scope; `SWARM_STARTS_PER_MINUTE` (default **10**) cycle starts across all swarms

Swarms share the Cursor slot pool with **sessions** and **issues**.

### Finish gate

The orchestrator may **declare_done** only when:

- A **`report`** artifact exists
- At least **4** critiqued hypotheses (default)
- Latest **verifier** result passes after that report
- In **build** phase: no open build tasks

Otherwise: **request_phase_change** to build (if repo attached), **request_human** for input, or stop on deadline / max cycles / user stop.

### Human controls

- **Directives** — Post to the board as a human (`POST /api/swarms/:id/directives`)
- **Approve / reject** build — `POST .../approve` or `.../reject` with optional note
- **Pause / resume / stop** — lifecycle actions on the swarm detail page

### Export

- **Full zip** — `GET /api/swarms/:id/export?scope=full` — board posts, tasks, hypotheses, ledger, agent notes/messages, artifacts, activity, JSON snapshots (folder layout under a slug from the title)
- **Artifacts only** — `?scope=artifacts`
- Single artifact download via `/api/swarms/:id/artifacts/:artifactId`

### Swarm API (summary)

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/swarms` | List (optional `orgId`) / create |
| GET/PATCH/DELETE | `/api/swarms/:id` | Snapshot / settings / delete |
| POST | `/api/swarms/:id/{start,pause,resume,stop,approve,reject}` | Actions |
| POST | `/api/swarms/:id/directives` | Human directive |
| GET | `/api/swarms/:id/export` | Zip export |
| GET | `/api/swarms/:id/agents/:agentId/messages` | Agent transcript |

---

## Teams, auth, and API keys

- **Clerk** — Web sign-in; user id drives ownership and org membership.
- **Personal workspace** — Your sessions, issues, and swarms.
- **Organizations** — Create/join teams, domain join, invites, owner transfer, shared **Cursor**, **Anthropic**, and **OpenAI** keys (`/api/orgs/...`).
- **BYOK** — Per-user Cursor, Anthropic, and OpenAI keys (encrypted with `KEY_ENCRYPTION_SECRET`).
- **Server key** — `CURSOR_API_KEY` env and/or admin “pick up” server key (`ADMIN_USER_IDS`).
- **GitHub** — OAuth in Settings for repo picker and cloud clone/push (workspace-scoped).

**Auth status** — `GET /api/auth/status` exposes configured providers, BYOK flags, Blaxel, Sarvam, models, etc.

---

## Shared memory and repo map

Room-scoped **memory** entries (goals, decisions, constraints, discoveries, handoffs) with accept/archive flows and **handoff drafts** for agent transitions. A **repo map** (POST/GET `/api/rooms/:id/repo-map`) provides a token-budgeted view of the repository structure injected into runs.

Design background: [Shared memory RFC](docs/shared-memory-rfc.md) (Phases 1–3 implemented).

---

## Voice approvals

Opt in with a **phone number** on your profile. When a tool hits an approval gate in a session, **Sarvam Voice Agents** can call you; say approve or deny. The in-room approval button still works.

Requires Sarvam app, connection, webhook secret, and `API_PUBLIC_ORIGIN` for decision/callback URLs. See env table below.

---

## Notifications

Optional global or per-room hooks:

- `SLACK_WEBHOOK_URL` — Slack incoming webhook
- `NOTIFY_WEBHOOK_URL` — Generic JSON webhook (Zapier, email bridges, etc.)
- Per-room Slack webhook via room settings API

Used for invites, driver changes, run finished, org events, and swarm budget warnings (where implemented).

---

## CLI worker (local agents)

Protocol **5+** is required for Codex. Protocol **3+** covers Claude Code and multi-agent file locks.

```bash
npm i -g @oblivihon/steer
# Web → Pair CLI → generate code
steer login    # server URL + pairing code
steer start    # worker stays online for your account

# Claude Code / Codex local also need their CLIs on PATH:
# npm i -g @anthropic-ai/claude-code
# npm i -g @openai/codex
```

Point `steer login` at your **API** URL in production (e.g. Render), not the Next.js host.

---

## Environment variables

Copy [`.env.example`](.env.example) to `.env`. Web app vars live under `web/` as documented in [DEPLOY.md](DEPLOY.md).

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Express API port |
| `DATABASE_URL` | — | Postgres; omit for SQLite (`SQLITE_PATH` or `./data.db`) |
| `CORS_ORIGIN` | — | Comma-separated browser origins in production |
| `APP_ORIGIN` | — | Public web origin (invites, Slack links, voice join URLs) |
| `NEXT_PUBLIC_SOCKET_URL` | — | Public API URL for browser Socket.IO |
| `DEFAULT_MODEL` | `composer-2.5` | Default model when create forms omit one |
| `INVITE_TTL_MS` | 7 days | Invite link lifetime |
| `REDIS_URL` | — | Socket.IO Redis adapter (multi-instance API) |

### Auth and encryption

| Variable | Description |
|----------|-------------|
| `CLERK_SECRET_KEY` | Clerk backend |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk frontend |
| `KEY_ENCRYPTION_SECRET` | Encrypt BYOK and stored server keys (64-char hex or passphrase) |
| `AUTH_SECRET` | Legacy deploy var; CLI tokens are random hex + SHA-256 |
| `ADMIN_USER_IDS` | Clerk user IDs allowed to manage the shared server key in UI |

### Agent providers

| Variable | Description |
|----------|-------------|
| `CURSOR_API_KEY` | Shared server key for Cursor Cloud |
| `ANTHROPIC_API_KEY` | Optional fallback for Claude Code cloud (prefer BYOK) |
| `OPENAI_API_KEY` / `CODEX_API_KEY` | Optional fallback for Codex cloud (prefer BYOK) |
| `BL_API_KEY` | Required for Claude Code / Codex cloud sandboxes |
| `BL_WORKSPACE` | Required Blaxel workspace slug |
| `GITHUB_TOKEN` / `GH_TOKEN` | Clone/push/PR for cloud agents |

### Issues and uploads

| Variable | Default | Description |
|----------|---------|-------------|
| `ISSUE_UPLOAD_DIR` | `data/issue-uploads` | Persistent issue attachment storage |

### Swarms and public API

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PUBLIC_ORIGIN` | `APP_ORIGIN` | URL Cursor/Sarvam reach (swarm MCP, voice callbacks) |
| `SWARM_MCP_URL` | `{API_PUBLIC_ORIGIN}/api/swarm-mcp` | Override swarm board URL |
| `SWARM_ACCOUNT_SLOTS` | `6` | Concurrent Cursor Cloud runs per API-key scope |
| `SWARM_STARTS_PER_MINUTE` | `10` | Swarm cycle starts per minute (rate-limit headroom) |

### Sarvam (voice approvals)

| Variable | Description |
|----------|-------------|
| `SARVAM_API_KEY` | Voice Agents API key |
| `SARVAM_ORG_ID` / `SARVAM_WORKSPACE_ID` | From Sarvam dashboard URL |
| `SARVAM_APP_ID` / `SARVAM_APP_VERSION` | Committed outbound agent (`4`, not `v4`; `v4` accepted) |
| `SARVAM_AGENT_VARIABLES` | Optional comma-separated agent input names |
| `SARVAM_CONNECTION_ID` / `SARVAM_AGENT_PHONE` | Telephony |
| `SARVAM_WEBHOOK_SECRET` | Bearer for `/api/voice-approvals/decision` |
| `VOICE_APPROVAL_COOLDOWN_MS` | `15000` default between calls |

### Notifications

| Variable | Description |
|----------|-------------|
| `SLACK_WEBHOOK_URL` | Global Slack incoming webhook |
| `NOTIFY_WEBHOOK_URL` | Generic JSON notification webhook |

---

## Scripts and tests

| Script | Description |
|--------|-------------|
| `pnpm dev` | API + web concurrently |
| `pnpm dev:server` | Express only |
| `pnpm dev:web` | Next.js only |
| `pnpm build` | Typecheck + build Next.js |
| `pnpm build:server` | Compile server to `dist/` |
| `pnpm start` | Run compiled server |
| `pnpm typecheck` | Server TypeScript check |
| `pnpm test` | Vitest (unit/integration) |

### Demo reset (SQLite)

```bash
rm -f data.db data.db-*
```

---

## Deployment

Production setup (Vercel + Render, Docker Compose, Fly.io, env checklist): **[DEPLOY.md](DEPLOY.md)**.

Use a **persistent disk** for SQLite on single-node hosts; use Postgres when running multiple API instances.

---

## Socket.IO scaling

Set `REDIS_URL` and the API attaches `@socket.io/redis-adapter` automatically. Sticky sessions are still required at the load balancer for WebSocket upgrades.

---

## Design notes

- [Shared memory for multiplayer agents](docs/shared-memory-rfc.md) — provider-neutral context and handoff layer

---

## License

Private monorepo (`shared-agent-session` v0.2.0). See repository settings for distribution terms.
