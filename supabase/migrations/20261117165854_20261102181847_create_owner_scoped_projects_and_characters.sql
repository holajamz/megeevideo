/*
# Create owner-scoped projects and characters tables

1. New Tables
- `projects`: a user's film projects (name, description, status, progress, duration, counts, timestamps). `user_id` defaults to the signed-in user.
- `characters`: a user's reusable character profiles (name, role, description, wardrobe and voice notes, color, reference count, timestamps). `user_id` defaults to the signed-in user.

2. Security
- Row level security enabled on both tables.
- Grants: SELECT, INSERT, UPDATE, DELETE to `authenticated` only (the app requires sign-in). No access for `anon`.
- Four separate owner-scoped policies per table, each checking `auth.uid() = user_id`.

3. Important notes
- Idempotent: safe to re-run.
- Foreign keys to `auth.users` with ON DELETE CASCADE so a deleted account removes its rows.
- Indexes on `user_id` for per-user loading.
*/

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in-progress', 'review', 'completed')),
  thumbnail_color text NOT NULL DEFAULT 'from-primary/30 to-primary-deep/40',
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  scene_count integer NOT NULL DEFAULT 0 CHECK (scene_count >= 0),
  shot_count integer NOT NULL DEFAULT 0 CHECK (shot_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_opened_at timestamptz
);

CREATE INDEX IF NOT EXISTS projects_user_id_idx ON projects (user_id);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO authenticated;

DROP POLICY IF EXISTS "select_own_projects" ON projects;
CREATE POLICY "select_own_projects" ON projects FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_projects" ON projects;
CREATE POLICY "insert_own_projects" ON projects FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_projects" ON projects;
CREATE POLICY "update_own_projects" ON projects FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_projects" ON projects;
CREATE POLICY "delete_own_projects" ON projects FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'Supporting',
  description text NOT NULL DEFAULT '',
  wardrobe_notes text NOT NULL DEFAULT '',
  voice_notes text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT 'from-primary/40 to-primary-deep/40',
  reference_image_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS characters_user_id_idx ON characters (user_id);

ALTER TABLE characters ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON characters TO authenticated;

DROP POLICY IF EXISTS "select_own_characters" ON characters;
CREATE POLICY "select_own_characters" ON characters FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_characters" ON characters;
CREATE POLICY "insert_own_characters" ON characters FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_characters" ON characters;
CREATE POLICY "update_own_characters" ON characters FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_characters" ON characters;
CREATE POLICY "delete_own_characters" ON characters FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
