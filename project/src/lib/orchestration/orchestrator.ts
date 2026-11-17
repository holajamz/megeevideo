// Orchestrator state machine: pure reducer-like functions over an
// OrchestratorSnapshot. No side effects, no timers, no network. A
// backend worker (or a client-side driver in demo mode) calls these
// to compute the next snapshot and then persists it.
//
// Provider execution is intentionally abstracted behind an
// `OrchestrationDriver` interface. The real driver is not wired here;
// when no provider is connected, use `createNoOpDriver()` which never
// reports success and surfaces a clear "no provider" error.

import type {
  OrchestratorSnapshot,
  ProductionPlan,
  ShotJob,
  JobState,
  ShotJobResult,
  ProviderCapabilities,
} from './types';

let jobIdCounter = 0;
const jobId = () => `job-${Date.now()}-${++jobIdCounter}`;

const now = () => new Date().toISOString();

/** Initialize a snapshot from a built plan. */
export function initOrchestrator(plan: ProductionPlan): OrchestratorSnapshot {
  const jobs: ShotJob[] = plan.shots.map((shot) => ({
    id: jobId(),
    shotId: shot.id,
    projectId: plan.projectId,
    state: 'pending',
    progress: 0,
    attempt: 0,
    maxAttempts: 3,
    createdAt: now(),
  }));
  return {
    plan,
    jobs,
    status: 'ready',
    nextShotIndex: 0,
    updatedAt: now(),
  };
}

/** A driver abstracts the provider. The orchestrator calls it to
 * start a job and to poll its progress. Real implementations come later. */
export interface OrchestrationDriver {
  /** Begin generating a shot. Returns when the job is accepted (queued/generating). */
  startJob(shot: ProductionPlan['shots'][number], caps: ProviderCapabilities): Promise<DriverJobHandle>;
  /** Poll a started job. Returns current progress and final result. */
  pollJob(handle: DriverJobHandle): Promise<DriverJobStatus>;
  /** Cancel a started job at the provider, if possible. */
  cancelJob?(handle: DriverJobHandle): Promise<void>;
}

export interface DriverJobHandle {
  /** Provider-side job identifier. */
  providerJobId: string;
}

export type DriverJobStatus =
  | { state: 'generating'; progress: number }
  | { state: 'completed'; result: ShotJobResult }
  | { state: 'failed'; error: string };

/** A driver that always fails with a clear "no provider connected" message.
 *  This is the correct driver to use in demo mode: it never fabricates a
 *  successful generation, so the UI can honestly distinguish infrastructure
 *  that works from provider-dependent features that are not yet operational. */
export function createNoOpDriver(): OrchestrationDriver {
  return {
    async startJob() {
      throw new Error('No video generation provider is connected. Orchestration is ready; connect a provider in Settings to begin generating.');
    },
    async pollJob() {
      return { state: 'failed', error: 'No provider connected.' };
    },
  };
}

/** Snapshot transition: mark a pending job as queued (waiting for a slot). */
export function enqueueNext(snapshot: OrchestratorSnapshot): OrchestratorSnapshot {
  if (snapshot.status !== 'running') return snapshot;
  const caps = snapshot.plan.capabilities;
  const activeCount = snapshot.jobs.filter(
    (j) => j.state === 'generating' || j.state === 'queued',
  ).length;
  if (activeCount >= caps.maxConcurrentJobs) return snapshot;

  const jobs = snapshot.jobs.map((j) => ({ ...j }));
  let queued = 0;
  for (let i = 0; i < jobs.length && activeCount + queued < caps.maxConcurrentJobs; i++) {
    if (jobs[i].state === 'pending') {
      jobs[i].state = 'queued' as JobState;
      jobs[i].queuedAt = now();
      queued++;
    }
  }
  return { ...snapshot, jobs, updatedAt: now() };
}

/** Snapshot transition: move a queued job to generating using a driver handle. */
export function markGenerating(
  snapshot: OrchestratorSnapshot,
  jobId: string,
  handle: { providerJobId: string },
): OrchestratorSnapshot {
  const jobs = snapshot.jobs.map((j) =>
    j.id === jobId
      ? { ...j, state: 'generating' as JobState, startedAt: now(), progress: 0, handle }
      : j,
  );
  return { ...snapshot, jobs, updatedAt: now() };
}

/** Snapshot transition: update progress on a generating job. */
export function setProgress(
  snapshot: OrchestratorSnapshot,
  jobId: string,
  progress: number,
): OrchestratorSnapshot {
  const jobs = snapshot.jobs.map((j) =>
    j.id === jobId && j.state === 'generating' ? { ...j, progress: Math.min(100, Math.max(0, progress)) } : j,
  );
  return { ...snapshot, jobs, updatedAt: now() };
}

/** Snapshot transition: a job completed successfully. */
export function markCompleted(
  snapshot: OrchestratorSnapshot,
  jobId: string,
  result: ShotJobResult,
): OrchestratorSnapshot {
  const jobs = snapshot.jobs.map((j) =>
    j.id === jobId
      ? { ...j, state: 'completed' as JobState, progress: 100, completedAt: now(), result }
      : j,
  );
  return computeStatus({ ...snapshot, jobs, updatedAt: now() });
}

/** Snapshot transition: a job failed. Schedules a retry if attempts remain. */
export function markFailed(
  snapshot: OrchestratorSnapshot,
  jobId: string,
  error: string,
): OrchestratorSnapshot {
  const jobs = snapshot.jobs.map((j) => {
    if (j.id !== jobId) return j;
    const nextAttempt = j.attempt + 1;
    if (nextAttempt < j.maxAttempts) {
      return { ...j, state: 'retrying' as JobState, attempt: nextAttempt, lastError: error };
    }
    return { ...j, state: 'failed' as JobState, lastError: error };
  });
  return computeStatus({ ...snapshot, jobs, updatedAt: now() });
}

/** Snapshot transition: move a retrying job back to queued. */
export function requeueRetrying(snapshot: OrchestratorSnapshot): OrchestratorSnapshot {
  const jobs = snapshot.jobs.map((j) =>
    j.state === 'retrying'
      ? { ...j, state: 'queued' as JobState, queuedAt: now() }
      : j,
  );
  return { ...snapshot, jobs, updatedAt: now() };
}

/** User controls. */
export function pause(snapshot: OrchestratorSnapshot): OrchestratorSnapshot {
  if (snapshot.status !== 'running') return snapshot;
  return { ...snapshot, status: 'paused', updatedAt: now() };
}

export function resume(snapshot: OrchestratorSnapshot): OrchestratorSnapshot {
  if (snapshot.status !== 'paused') return snapshot;
  return { ...snapshot, status: 'running', updatedAt: now() };
}

export function cancel(snapshot: OrchestratorSnapshot): OrchestratorSnapshot {
  const jobs = snapshot.jobs.map((j) => {
    if (j.state === 'completed' || j.state === 'skipped') return j;
    return { ...j, state: 'cancelled' as JobState };
  });
  return { ...snapshot, status: 'cancelled', jobs, updatedAt: now() };
}

export function skipJob(snapshot: OrchestratorSnapshot, jobId: string): OrchestratorSnapshot {
  const jobs = snapshot.jobs.map((j) =>
    j.id === jobId ? { ...j, state: 'skipped' as JobState } : j,
  );
  return computeStatus({ ...snapshot, jobs, updatedAt: now() });
}

/** Recompute overall status from job states. */
function computeStatus(snapshot: OrchestratorSnapshot): OrchestratorSnapshot {
  const all = snapshot.jobs;
  const active = all.filter((j) => j.state === 'generating' || j.state === 'queued' || j.state === 'pending' || j.state === 'retrying');
  const failed = all.filter((j) => j.state === 'failed');
  if (all.length === 0) return { ...snapshot, status: 'idle', updatedAt: now() };
  if (active.length === 0) {
    if (failed.length > 0 && failed.length === all.filter((j) => j.state !== 'skipped' && j.state !== 'completed' && j.state !== 'cancelled').length) {
      return { ...snapshot, status: 'failed', updatedAt: now() };
    }
    const completed = all.filter((j) => j.state === 'completed').length;
    const skippedOrCancelled = all.filter((j) => j.state === 'skipped' || j.state === 'cancelled').length;
    if (completed + skippedOrCancelled === all.length) {
      return { ...snapshot, status: 'completed', updatedAt: now() };
    }
  }
  return snapshot;
}

/** Prevent duplicate jobs: returns true if a job for this shot already exists
 *  in a non-terminal state. Used before creating new jobs. */
export function hasActiveJobForShot(snapshot: OrchestratorSnapshot, shotId: string): boolean {
  return snapshot.jobs.some(
    (j) => j.shotId === shotId && j.state !== 'completed' && j.state !== 'failed' && j.state !== 'skipped' && j.state !== 'cancelled',
  );
}

/** Summary stats for UI. */
export interface OrchestratorStats {
  total: number;
  pending: number;
  queued: number;
  generating: number;
  completed: number;
  failed: number;
  retrying: number;
  skipped: number;
  cancelled: number;
  overallProgress: number; // 0..100
}

export function getStats(snapshot: OrchestratorSnapshot): OrchestratorStats {
  const jobs = snapshot.jobs;
  const total = jobs.length;
  const count = (s: JobState) => jobs.filter((j) => j.state === s).length;
  const completedProgress = jobs
    .filter((j) => j.state === 'completed')
    .reduce((sum) => sum + 100, 0);
  const inFlightProgress = jobs
    .filter((j) => j.state === 'generating')
    .reduce((s, j) => s + j.progress, 0);
  return {
    total,
    pending: count('pending'),
    queued: count('queued'),
    generating: count('generating'),
    completed: count('completed'),
    failed: count('failed'),
    retrying: count('retrying'),
    skipped: count('skipped'),
    cancelled: count('cancelled'),
    overallProgress: total === 0 ? 0 : Math.round((completedProgress + inFlightProgress) / total),
  };
}

/** The shot a queued job refers to (for the driver to execute). */
export function shotForJob(snapshot: OrchestratorSnapshot, job: ShotJob) {
  return snapshot.plan.shots.find((s) => s.id === job.shotId) ?? null;
}

/** Run loop helper: given a snapshot and driver, advance one step.
 *  In demo mode with the no-op driver, this surfaces the no-provider error
 *  on the first queued job without fabricating progress. Real drivers are
 *  introduced later; the loop is the same. */
export async function advanceOnce(
  snapshot: OrchestratorSnapshot,
  driver: OrchestrationDriver,
): Promise<OrchestratorSnapshot> {
  // Poll in-flight generating jobs.
  let next = snapshot;
  for (const job of next.jobs) {
    if (job.state !== 'generating' || !job.handle) continue;
    try {
      const status = await driver.pollJob(job.handle);
      if (status.state === 'generating') {
        next = setProgress(next, job.id, status.progress);
      } else if (status.state === 'completed') {
        next = markCompleted(next, job.id, status.result);
      } else {
        next = markFailed(next, job.id, status.error);
      }
    } catch (err) {
      next = markFailed(next, job.id, err instanceof Error ? err.message : String(err));
    }
  }

  // Start queued jobs.
  for (const job of next.jobs) {
    if (job.state !== 'queued') continue;
    const shot = shotForJob(next, job);
    if (!shot) continue;
    try {
      const handle = await driver.startJob(shot, next.plan.capabilities);
      next = markGenerating(next, job.id, handle);
    } catch (err) {
      next = markFailed(next, job.id, err instanceof Error ? err.message : String(err));
    }
  }

  // Requeue retrying jobs.
  next = requeueRetrying(next);
  // Refill the queue from pending.
  next = enqueueNext(next);
  return next;
}
