/*
# Remove unnecessary anon privileges from application tables

1. Purpose
The `anon` role still holds SELECT, INSERT, UPDATE, DELETE grants on
`projects`, `characters`, `scenes`, `shots`, and `production_jobs`.
This app requires sign-in, so the anon role should have no access to
any of these tables. The `production_plans` and `shot_jobs` tables
already had anon revoked in a prior migration.

2. Changes
- REVOKE ALL on `projects`, `characters`, `scenes`, `shots`, and
  `production_jobs` FROM `anon`.
- Re-affirm GRANT SELECT, INSERT, UPDATE, DELETE to `authenticated`
  (idempotent — no effect if already present).
- All existing RLS policies and owner-isolation checks are preserved
  unchanged. No policies are dropped or recreated.
*/

REVOKE ALL ON projects FROM anon;
REVOKE ALL ON characters FROM anon;
REVOKE ALL ON scenes FROM anon;
REVOKE ALL ON shots FROM anon;
REVOKE ALL ON production_jobs FROM anon;

-- Re-affirm authenticated grants (idempotent).
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON characters TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON scenes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON shots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON production_jobs TO authenticated;
