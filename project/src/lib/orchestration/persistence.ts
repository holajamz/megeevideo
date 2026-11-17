// Supabase persistence for the orchestrator. Converts between the
// OrchestratorSnapshot (in-memory) and the production_plans / shot_jobs
// tables. Rows are owner-scoped by Row Level Security, so every call requires
// a signed-in session. If Supabase is not configured or the session is missing,
// the helpers reject with a clear error so the UI can report it.

import { supabase } from '@/lib/supabase';
import type {
  OrchestratorSnapshot,
  ProductionPlan,
  ShotJob,
  ShotJobResult,
  ProviderCapabilities,
  OrchestratorStatus,
  JobState,
} from './types';

function getClient() {
  if (!supabase) throw new Error('Account service is not connected, so productions cannot be saved.');
  return supabase;
}

interface PlanRow {
  id: string;
  project_id: string;
  title: string;
  source_text: string;
  source_kind: 'screenplay' | 'prompt';
  target_duration_seconds: number;
  shots: ProductionPlan['shots'];
  global_continuity_notes: string;
  capabilities: ProviderCapabilities;
  status: OrchestratorStatus;
  next_shot_index: number;
  created_at: string;
  updated_at: string;
}

interface JobRow {
  id: string;
  plan_id: string;
  project_id: string;
  shot_id: string;
  state: JobState;
  progress: number;
  attempt: number;
  max_attempts: number;
  last_error: string | null;
  handle: { providerJobId: string } | null;
  result: ShotJobResult | null;
  created_at: string;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

function planToRow(snapshot: OrchestratorSnapshot): PlanRow {
  return {
    id: snapshot.plan.id,
    project_id: snapshot.plan.projectId,
    title: snapshot.plan.title,
    source_text: snapshot.plan.sourceText,
    source_kind: snapshot.plan.sourceKind,
    target_duration_seconds: snapshot.plan.targetDurationSeconds,
    shots: snapshot.plan.shots,
    global_continuity_notes: snapshot.plan.globalContinuityNotes,
    capabilities: snapshot.plan.capabilities,
    status: snapshot.status,
    next_shot_index: snapshot.nextShotIndex,
    created_at: snapshot.plan.createdAt,
    updated_at: snapshot.updatedAt,
  };
}

function jobToRow(job: ShotJob, planId: string): JobRow {
  return {
    id: job.id,
    plan_id: planId,
    project_id: job.projectId,
    shot_id: job.shotId,
    state: job.state,
    progress: job.progress,
    attempt: job.attempt,
    max_attempts: job.maxAttempts,
    last_error: job.lastError ?? null,
    handle: job.handle ?? null,
    result: job.result ?? null,
    created_at: job.createdAt,
    queued_at: job.queuedAt ?? null,
    started_at: job.startedAt ?? null,
    completed_at: job.completedAt ?? null,
  };
}

function rowToJob(row: JobRow): ShotJob {
  return {
    id: row.id,
    shotId: row.shot_id,
    projectId: row.project_id,
    state: row.state,
    progress: row.progress,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    lastError: row.last_error ?? undefined,
    handle: row.handle ?? undefined,
    result: row.result ?? undefined,
    createdAt: row.created_at,
    queuedAt: row.queued_at ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  };
}

function rowToSnapshot(planRow: PlanRow, jobRows: JobRow[]): OrchestratorSnapshot {
  const plan: ProductionPlan = {
    id: planRow.id,
    projectId: planRow.project_id,
    title: planRow.title,
    sourceText: planRow.source_text,
    sourceKind: planRow.source_kind,
    targetDurationSeconds: planRow.target_duration_seconds,
    shots: planRow.shots,
    globalContinuityNotes: planRow.global_continuity_notes,
    capabilities: planRow.capabilities,
    createdAt: planRow.created_at,
    updatedAt: planRow.updated_at,
  };
  return {
    plan,
    jobs: jobRows.map(rowToJob),
    status: planRow.status,
    nextShotIndex: planRow.next_shot_index,
    updatedAt: planRow.updated_at,
  };
}

/** Persist a full snapshot: upsert the plan and replace its jobs. */
export async function saveSnapshot(snapshot: OrchestratorSnapshot): Promise<void> {
  const sb = getClient();
  const planRow = planToRow(snapshot);
  const { error: planErr } = await sb
    .from('production_plans')
    .upsert(planRow, { onConflict: 'id' });
  if (planErr) throw new Error(`Failed to save plan: ${planErr.message}`);

  // Replace jobs atomically: delete then insert. The unique constraint on
  // (plan_id, shot_id) prevents duplicates; delete-then-insert keeps it simple.
  const { error: delErr } = await sb
    .from('shot_jobs')
    .delete()
    .eq('plan_id', snapshot.plan.id);
  if (delErr) throw new Error(`Failed to clear jobs: ${delErr.message}`);

  if (snapshot.jobs.length > 0) {
    const rows = snapshot.jobs.map((j) => jobToRow(j, snapshot.plan.id));
    const { error: insErr } = await sb.from('shot_jobs').insert(rows);
    if (insErr) throw new Error(`Failed to save jobs: ${insErr.message}`);
  }
}

/** Load the latest snapshot for a project, or null if none exists. */
export async function loadSnapshotByProject(projectId: string): Promise<OrchestratorSnapshot | null> {
  const sb = getClient();
  const { data: planRow, error } = await sb
    .from('production_plans')
    .select('*')
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to load plan: ${error.message}`);
  if (!planRow) return null;

  const { data: jobRows, error: jobErr } = await sb
    .from('shot_jobs')
    .select('*')
    .eq('plan_id', planRow.id)
    .order('created_at', { ascending: true });
  if (jobErr) throw new Error(`Failed to load jobs: ${jobErr.message}`);

  return rowToSnapshot(planRow as PlanRow, (jobRows ?? []) as JobRow[]);
}

/** Delete a plan and its jobs (cascade handles jobs). */
export async function deleteSnapshot(planId: string): Promise<void> {
  const sb = getClient();
  const { error } = await sb.from('production_plans').delete().eq('id', planId);
  if (error) throw new Error(`Failed to delete plan: ${error.message}`);
}

/** Subscribe to job changes for a plan (for realtime UI updates). */
export function subscribeToJobs(
  planId: string,
  onChange: (jobs: ShotJob[]) => void,
): () => void {
  const sb = getClient();
  const channel = sb
    .channel(`jobs:${planId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'shot_jobs', filter: `plan_id=eq.${planId}` },
      async () => {
        const { data, error } = await sb
          .from('shot_jobs')
          .select('*')
          .eq('plan_id', planId)
          .order('created_at', { ascending: true });
        if (!error && data) onChange((data as JobRow[]).map(rowToJob));
      },
    )
    .subscribe();
  return () => { sb.removeChannel(channel); };
}
