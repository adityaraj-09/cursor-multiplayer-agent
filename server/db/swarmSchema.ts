/**
 * Swarm tables. Written in the SQL subset shared by SQLite and Postgres so one
 * store implementation (server/swarm/store.ts) serves both backends.
 * Timestamps are BIGINT milliseconds; money is DOUBLE PRECISION dollars.
 */
export const SWARM_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS swarms (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  creator_id TEXT NOT NULL,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  phase TEXT NOT NULL DEFAULT 'research',
  repo_url TEXT,
  starting_ref TEXT NOT NULL DEFAULT 'main',
  model_id TEXT NOT NULL DEFAULT 'auto',
  budget_usd DOUBLE PRECISION NOT NULL DEFAULT 25,
  spent_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  tokens_used BIGINT NOT NULL DEFAULT 0,
  deadline_at BIGINT,
  max_workers INTEGER NOT NULL DEFAULT 5,
  max_running INTEGER NOT NULL DEFAULT 3,
  max_cycles INTEGER NOT NULL DEFAULT 200,
  cycles_done INTEGER NOT NULL DEFAULT 0,
  stall_count INTEGER NOT NULL DEFAULT 0,
  idle_orchestrator_cycles INTEGER NOT NULL DEFAULT 0,
  budget_warned INTEGER NOT NULL DEFAULT 0,
  stop_reason TEXT,
  approval_note TEXT,
  lease_owner TEXT,
  lease_until BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  started_at BIGINT,
  finished_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_swarms_status ON swarms(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_swarms_org ON swarms(org_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_swarms_creator ON swarms(creator_id, updated_at);

CREATE TABLE IF NOT EXISTS swarm_agents (
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  label TEXT NOT NULL,
  brief TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idle',
  cursor_agent_id TEXT,
  has_repo INTEGER NOT NULL DEFAULT 0,
  branch TEXT,
  current_task_id TEXT,
  cycles INTEGER NOT NULL DEFAULT 0,
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  spent_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  tokens_used BIGINT NOT NULL DEFAULT 0,
  notes_md TEXT NOT NULL DEFAULT '',
  token_hash TEXT,
  token_expires_at BIGINT,
  last_cycle_at BIGINT,
  last_board_call_at BIGINT,
  run_started_at BIGINT,
  last_error TEXT,
  spawned_by TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_swarm_agents_swarm ON swarm_agents(swarm_id, created_at);
CREATE INDEX IF NOT EXISTS idx_swarm_agents_token ON swarm_agents(token_hash);

CREATE TABLE IF NOT EXISTS swarm_tasks (
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  owner_agent_id TEXT,
  role_hint TEXT,
  blocked_by_json TEXT NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 2,
  result_md TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  completed_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_swarm_tasks_swarm ON swarm_tasks(swarm_id, status);

CREATE TABLE IF NOT EXISTS swarm_posts (
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  author_agent_id TEXT,
  author_user_id TEXT,
  author_label TEXT NOT NULL,
  author_role TEXT NOT NULL,
  channel TEXT NOT NULL,
  kind TEXT NOT NULL,
  body_md TEXT NOT NULL,
  refs_json TEXT NOT NULL DEFAULT '[]',
  mentions_json TEXT NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_swarm_posts_swarm ON swarm_posts(swarm_id, created_at);

CREATE TABLE IF NOT EXISTS swarm_ledger (
  swarm_id TEXT PRIMARY KEY REFERENCES swarms(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0,
  facts_md TEXT NOT NULL DEFAULT '',
  guesses_md TEXT NOT NULL DEFAULT '',
  plan_md TEXT NOT NULL DEFAULT '',
  open_questions_md TEXT NOT NULL DEFAULT '',
  progress_json TEXT,
  updated_by TEXT,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS swarm_ledger_revisions (
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  facts_md TEXT NOT NULL,
  guesses_md TEXT NOT NULL,
  plan_md TEXT NOT NULL,
  open_questions_md TEXT NOT NULL,
  progress_json TEXT,
  updated_by TEXT,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (swarm_id, revision)
);

CREATE TABLE IF NOT EXISTS swarm_hypotheses (
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  claim_md TEXT NOT NULL,
  evidence_md TEXT NOT NULL DEFAULT '',
  parent_ids_json TEXT NOT NULL DEFAULT '[]',
  elo DOUBLE PRECISION NOT NULL DEFAULT 1200,
  matches INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  critiques INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'proposed',
  author_agent_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_swarm_hypotheses_swarm ON swarm_hypotheses(swarm_id, elo);

CREATE TABLE IF NOT EXISTS swarm_critiques (
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  hypothesis_id TEXT NOT NULL,
  author_agent_id TEXT,
  verdict TEXT NOT NULL,
  score INTEGER NOT NULL,
  body_md TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_swarm_critiques_swarm ON swarm_critiques(swarm_id, created_at);

CREATE TABLE IF NOT EXISTS swarm_matches (
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  hypothesis_a TEXT NOT NULL,
  hypothesis_b TEXT NOT NULL,
  winner TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  judge_agent_id TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS swarm_artifacts (
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  agent_id TEXT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (swarm_id, name)
);

CREATE TABLE IF NOT EXISTS swarm_events (
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  agent_id TEXT,
  kind TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  meta_json TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_swarm_events_swarm ON swarm_events(swarm_id, created_at);

CREATE TABLE IF NOT EXISTS swarm_messages (
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  cycle INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_name TEXT,
  status TEXT,
  ts BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_swarm_messages_agent ON swarm_messages(agent_id, ts);
`;
