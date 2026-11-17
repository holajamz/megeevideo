/*
# Restrict long-form production tables to their owners

1. Purpose
Replaces the open anonymous access on production plans and shot jobs with
ownership-based access. Each row records the signed-in user who created it,
and only that user can read, change, or delete it.

2. Modified Tables
- `production_plans`: adds `user_id uuid NOT NULL DEFAULT auth.uid()`
  referencing `auth.users(id)` with ON DELETE CASCADE.
- `shot_jobs`: adds `user_id uuid NOT NULL DEFAULT auth.uid()` referencing
  `auth.users(id)` with ON DELETE CASCADE.
Both tables were empty when this migration was written, so no rows are changed.

3. Security changes
- Removed all access for the `anon` role on both tables.
- Granted SELECT, INSERT, UPDATE, DELETE to `authenticated` only.
- Dropped the `USING (true)` policies and created four owner-scoped policies
  per table (select, insert, update, delete) that compare `user_id` with `auth.uid()`.
- `service_role` grants are kept unchanged.

4. Notes
- The DEFAULT on `user_id` fills the owner from the signed-in session, so inserts
  do not need to send it. Inserts from a signed-out client fail the policy check.
- Indexes on `user_id` are added for the owner-scoped lookups.
*/

ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid();
ALTER TABLE shot_jobs ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid();

ALTER TABLE production_plans ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE shot_jobs ALTER COLUMN user_id SET DEFAULT auth.uid();

ALTER TABLE production_plans ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE shot_jobs ALTER COLUMN user_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'production_plans_user_id_fkey'
  ) THEN
    ALTER TABLE production_plans
      ADD CONSTRAINT production_plans_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shot_jobs_user_id_fkey'
  ) THEN
    ALTER TABLE shot_jobs
      ADD CONSTRAINT shot_jobs_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

REVOKE ALL ON production_plans FROM anon;
REVOKE ALL ON shot_jobs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON production_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON shot_jobs TO authenticated;

DROP POLICY IF EXISTS "anon_select_plans" ON production_plans;
DROP POLICY IF EXISTS "anon_insert_plans" ON production_plans;
DROP POLICY IF EXISTS "anon_update_plans" ON production_plans;
DROP POLICY IF EXISTS "anon_delete_plans" ON production_plans;
DROP POLICY IF EXISTS "select_own_plans" ON production_plans;
DROP POLICY IF EXISTS "insert_own_plans" ON production_plans;
DROP POLICY IF EXISTS "update_own_plans" ON production_plans;
DROP POLICY IF EXISTS "delete_own_plans" ON production_plans;

CREATE POLICY "select_own_plans" ON production_plans FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_plans" ON production_plans FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_plans" ON production_plans FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_plans" ON production_plans FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "anon_select_jobs" ON shot_jobs;
DROP POLICY IF EXISTS "anon_insert_jobs" ON shot_jobs;
DROP POLICY IF EXISTS "anon_update_jobs" ON shot_jobs;
DROP POLICY IF EXISTS "anon_delete_jobs" ON shot_jobs;
DROP POLICY IF EXISTS "select_own_jobs" ON shot_jobs;
DROP POLICY IF EXISTS "insert_own_jobs" ON shot_jobs;
DROP POLICY IF EXISTS "update_own_jobs" ON shot_jobs;
DROP POLICY IF EXISTS "delete_own_jobs" ON shot_jobs;

CREATE POLICY "select_own_jobs" ON shot_jobs FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_jobs" ON shot_jobs FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_jobs" ON shot_jobs FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_jobs" ON shot_jobs FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_production_plans_user_id ON production_plans (user_id);
CREATE INDEX IF NOT EXISTS idx_shot_jobs_user_id ON shot_jobs (user_id);
