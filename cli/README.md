# @oblivihon/steer

CLI worker for **Steer** — runs local Cursor agents on your machine for multiplayer sessions hosted in the web app.

When you create a **Local** session in Steer, prompts are relayed to this worker, which executes `cursor agent` against a folder on your machine.

## Requirements

- Node.js 18+
- [Cursor CLI](https://cursor.com) on your `PATH` (`cursor` command)
- A Steer account (sign in on the web app)

## Install

```bash
npm install -g @oblivihon/steer
```

Or from this repo:

```bash
cd cli
pnpm install
pnpm build
npm link
```

## Quick start

1. Sign in on the Steer web app and open **Pair CLI** (`/cli-pair`).
2. Generate a pairing code.
3. On your machine:

```bash
steer login
# Server URL defaults to https://cursor-multiplayer-agent.onrender.com — press Enter
# Paste the pairing code

cursor agent login   # if not already logged into Cursor CLI
steer start
```

4. Keep `steer start` running while you use Local sessions in the browser.

Credentials are stored at `~/.config/steer/config.json`.

## Commands

| Command | Description |
|---------|-------------|
| `steer login` | Pair with your Steer account via a one-time web code |
| `steer logout` | Clear stored credentials |
| `steer status` | Show logged-in user, server URL, and your rooms |
| `steer start` | Start the worker (connects to the API over WebSocket) |
| `steer start --repo <path>` | Same, but force every prompt to use this repo path |

## Server URL

`steer login` defaults to:

```
https://cursor-multiplayer-agent.onrender.com
```

Override per login at the prompt, or with:

```bash
export STEER_SERVER_URL=http://localhost:3000
steer login
```

Use the local URL when developing against a local API.

## What the worker does

While `steer start` is connected, the API can ask your machine to:

- List Cursor models (`cursor agent --list-models`)
- Open a native folder picker for Local session create
- Run agent prompts in the selected repo and stream events back to the room

## Development

```bash
pnpm install
pnpm dev          # run via tsx without building
pnpm build        # compile to dist/
```

The published binary is `dist/index.js` (`bin`: `steer`).

## License

MIT
