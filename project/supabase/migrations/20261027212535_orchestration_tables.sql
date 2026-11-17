/*
# Long-form film orchestration tables

1. Purpose
This migration adds persistence for the Megee VP long-form AI film orchestrator.
It stores production plans (the structured breakdown of a screenplay/prompt into
ordered shots) and the generation jobs that execute those shots. This lets
long-running film productions survive page refreshes and resume from where they
left off, and lets a future backend worker pick up queued jobs.

2. New Tables
- `production_plans` — one row per long-form production plan
  - `id` text primary key (stable client-generated id)
  - `project_id` text not null (references the app's project concept)
  - `title` text not null
  - `source_text` text not null (original screenplay or prompt)
  - `source_kind` text not null ('screenplay' | 'prompt')
  - `target_duration_seconds` integer not null default 0 (0 = unlimited)
  - `shots` jsonb not null (ordered PlannedShot[] array)
  - `global_continuity_notes` text not null default ''
  - `capabilities` jsonb not null (ProviderCapabilities object)
  - `status` text not null default 'ready' (OrchestratorStatus)
  - `next_shot_index` integer not null default 0
  - `created_at` timestamptz default now()
  - `updated_at` timestamptz default now()
- `shot_jobs` — one row per generation job executing a planned shot
  - `id` text primary key (stable client-generated id)
  - `plan_id` text not null references production_plans(id) on delete cascade
  - `project_id` text not null
  - `shot_id` text not null (matches a shot id inside the plan's shots array)
  - `state` text not null default 'pending' (JobState)
  - `progress` integer not null default 0 (0..100)
  - `attempt` integer not null default 0
  - `max_attempts` integer not null default 3
  - `last_error` text
  - `handle` jsonb (provider job handle, when dispatched)
  - `result` jsonb (ShotJobResult, when completed)
  - `created_at` timestamptz default now()
  - `queued_at` timestamptz
  - `started_at` timestamptz
  - `completed_at` timestamptz
  - Unique constraint on (plan_id, shot_id) to prevent duplicate jobs per shot

3. Security
- Single-tenant app (no real auth; login is simulated in demo mode).
- RLS enabled on both tables.
- CRUD granted to `anon` + `authenticated` so the anon-key frontend can operate.
- Policies use `USING (true)` / `WITH CHECK (true)` because the data is
  intentionally shared within this single-tenant demo app. When real auth is
  added later, these policies must be replaced with ownership checks.
- `service_role` granted CRUD so a future backend worker can dispatch jobs.

4. Notes
- `shots`, `capabilities`, `handle`, and `result` are stored as jsonb because
  their shapes are defined by the orchestrator's TypeScript types and may evolve
  as provider capabilities are introduced. Keeping them as jsonb avoids
  expensive migrations when the orchestrator adds fields.
- The unique constraint on (plan_id, shot_id) enforces "no duplicate jobs for
  the same shot within a plan" at the database level, complementing the
  orchestrator's in-memory hasActiveJobForShot check.
*/

CREATE TABLE IF NOT EXISTS production_plans (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  title text NOT NULL,
  source_text text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('screenplay', 'prompt')),
  target_duration_seconds integer NOT NULL DEFAULT 0,
  shots jsonb NOT NULL,
  global_continuity_notes text NOT NULL DEFAULT '',
  capabilities jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ready',
  next_shot_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE production_plans ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON production_plans TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON production_plans TO service_role;

DROP POLICY IF EXISTS "anon_select_plans" ON production_plans;
CREATE POLICY "anon_select_plans" ON production_plans FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_plans" ON production_plans;
CREATE POLICY "anon_insert_plans" ON production_plans FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_plans" ON production_plans;
CREATE POLICY "anon_update_plans" ON production_plans FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_plans" ON production_plans;
CREATE POLICY "anon_delete_plans" ON production_plans FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS shot_jobs (
  id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  shot_id text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  progress integer NOT NULL DEFAULT 0,
  attempt integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  last_error text,
  handle jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  queued_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (plan_id, shot_id)
);

ALTER TABLE shot_jobs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON shot_jobs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON shot_jobs TO service_role;

DROP POLICY IF EXISTS "anon_select_jobs" ON shot_jobs;
CREATE POLICY "anon_select_jobs" ON shot_jobs FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_jobs" ON shot_jobs;
CREATE POLICY "anon_insert_jobs" ON shot_jobs FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_jobs" ON shot_jobs;
CREATE POLICY "anon_update_jobs" ON shot_jobs FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_jobs" ON shot_jobs;
CREATE POLICY "anon_delete_jobs" ON shot_jobs FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_shot_jobs_plan_id ON shot_jobs (plan_id);
CREATE INDEX IF NOT EXISTS idx_shot_jobs_state ON shot_jobs (state);
CREATE INDEX IF NOT EXISTS idx_production_plans_project_id ON production_plans (project_id);
