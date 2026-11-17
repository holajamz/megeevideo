/*
# Extend schema for full project, character, scene, shot, and job persistence

1. Purpose
This migration extends the existing projects and characters tables with
additional fields required by Phase 2, and creates three new tables
(scenes, shots, production_jobs) for persistent scene/shot/job management.
It preserves all existing data and RLS policies.

2. Modified Tables
- `projects`: adds `genre` (text, default 'Drama'), `aspect_ratio` (text,
  default '2.39:1'), `target_duration_seconds` (integer, default 0).
- `characters`: adds `project_id` (uuid, nullable, references projects(id)
  with ON DELETE SET NULL), `appearance_notes` (text, default ''),
  `updated_at` (timestamptz, default now()).

3. New Tables
- `scenes`: scene records belonging to a project (user_id, project_id,
  scene_number, title, location, time_of_day, description, script_content,
  status, duration_seconds, sort_order, timestamps).
- `shots`: shot records belonging to a scene and project (user_id, scene_id,
  project_id, shot_number, description, camera_angle, camera_movement,
  lighting, duration_seconds, dialogue, speaker, character_ids, acting/sound/
  continuity notes, status, sort_order, timestamps).
- `production_jobs`: persistent job records for future video production
  (user_id, project_id, job_type, status, progress, prompt, model,
  duration_seconds, aspect_ratio, error, result_thumbnail_color, timestamps).

4. Security
- RLS enabled on all three new tables.
- Grants: SELECT, INSERT, UPDATE, DELETE to `authenticated` only.
- Four owner-scoped policies per table using auth.uid() = user_id.
- Foreign keys with CASCADE delete on parent relationships.
- Indexes on user_id, project_id, scene_id for efficient lookups.

5. Notes
- All statements are idempotent (IF NOT EXISTS, DROP POLICY IF EXISTS).
- No data is lost: existing rows keep their values; new columns get defaults.
- Characters.project_id is nullable so existing reusable characters work.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'genre') THEN
    ALTER TABLE projects ADD COLUMN genre text NOT NULL DEFAULT 'Drama';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'aspect_ratio') THEN
    ALTER TABLE projects ADD COLUMN aspect_ratio text NOT NULL DEFAULT '2.39:1';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'target_duration_seconds') THEN
    ALTER TABLE projects ADD COLUMN target_duration_seconds integer NOT NULL DEFAULT 0 CHECK (target_duration_seconds >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'characters' AND column_name = 'project_id') THEN
    ALTER TABLE characters ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'characters' AND column_name = 'appearance_notes') THEN
    ALTER TABLE characters ADD COLUMN appearance_notes text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'characters' AND column_name = 'updated_at') THEN
    ALTER TABLE characters ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS characters_project_id_idx ON characters (project_id);

CREATE TABLE IF NOT EXISTS scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_number integer NOT NULL,
  title text NOT NULL,
  location text NOT NULL DEFAULT '',
  time_of_day text NOT NULL DEFAULT 'day',
  description text NOT NULL DEFAULT '',
  script_content text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in-progress', 'completed')),
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scenes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON scenes TO authenticated;

DROP POLICY IF EXISTS "select_own_scenes" ON scenes;
CREATE POLICY "select_own_scenes" ON scenes FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_scenes" ON scenes;
CREATE POLICY "insert_own_scenes" ON scenes FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_scenes" ON scenes;
CREATE POLICY "update_own_scenes" ON scenes FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_scenes" ON scenes;
CREATE POLICY "delete_own_scenes" ON scenes FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS scenes_user_id_idx ON scenes (user_id);
CREATE INDEX IF NOT EXISTS scenes_project_id_idx ON scenes (project_id);

CREATE TABLE IF NOT EXISTS shots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shot_number text NOT NULL,
  description text NOT NULL DEFAULT '',
  camera_angle text NOT NULL DEFAULT 'medium-shot',
  camera_movement text NOT NULL DEFAULT 'static',
  lighting text NOT NULL DEFAULT 'natural',
  duration_seconds integer NOT NULL DEFAULT 10 CHECK (duration_seconds >= 0),
  dialogue text NOT NULL DEFAULT '',
  speaker text,
  character_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  acting_instructions text NOT NULL DEFAULT '',
  sound_cues text NOT NULL DEFAULT '',
  continuity_notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'generating', 'generated', 'failed')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shots ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON shots TO authenticated;

DROP POLICY IF EXISTS "select_own_shots" ON shots;
CREATE POLICY "select_own_shots" ON shots FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_shots" ON shots;
CREATE POLICY "insert_own_shots" ON shots FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_shots" ON shots;
CREATE POLICY "update_own_shots" ON shots FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_shots" ON shots;
CREATE POLICY "delete_own_shots" ON shots FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS shots_user_id_idx ON shots (user_id);
CREATE INDEX IF NOT EXISTS shots_scene_id_idx ON shots (scene_id);
CREATE INDEX IF NOT EXISTS shots_project_id_idx ON shots (project_id);

CREATE TABLE IF NOT EXISTS production_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_type text NOT NULL DEFAULT 'video',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  prompt text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  aspect_ratio text NOT NULL DEFAULT '2.39:1',
  error text,
  result_thumbnail_color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE production_jobs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON production_jobs TO authenticated;

DROP POLICY IF EXISTS "select_own_production_jobs" ON production_jobs;
CREATE POLICY "select_own_production_jobs" ON production_jobs FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_production_jobs" ON production_jobs;
CREATE POLICY "insert_own_production_jobs" ON production_jobs FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_production_jobs" ON production_jobs;
CREATE POLICY "update_own_production_jobs" ON production_jobs FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_production_jobs" ON production_jobs;
CREATE POLICY "delete_own_production_jobs" ON production_jobs FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS production_jobs_user_id_idx ON production_jobs (user_id);
CREATE INDEX IF NOT EXISTS production_jobs_project_id_idx ON production_jobs (project_id);
