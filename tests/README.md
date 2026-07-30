# Multi-agent tests

Automated coverage:

- `conflicts-and-parser.test.ts` — scope/file conflict detection + CursorAgentBackend line parser
- `multi-agent-db.test.ts` — agents table CRUD, per-agent messages, drivers, session ids

Manual / live server checklist (protocol-2 CLI):

1. Spawn 2 agents in one room → events stay in their own panels (`agentId` tags)
2. Independent driver grants (user A drives agent 1, user B drives agent 2)
3. One agent erroring / run lost does not disturb the other
4. Resume-by-`session_id`: each agent’s `worker:run-prompt` carries its own `sessionId`

Run with:

```bash
pnpm install
pnpm test
```
