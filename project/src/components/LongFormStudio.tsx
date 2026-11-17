// Long-Form Studio: the orchestration UI for automatic multi-shot film
// production from one submission. This component is provider-independent:
// it builds a ProductionPlan, runs the orchestrator state machine, persists
// snapshots to Supabase (so films resume after refresh), and exposes
// Start/Pause/Resume/Cancel controls.
//
// With no provider connected (the default), the no-op driver is used. It
// does NOT fabricate success: starting the run moves jobs to failed with a
// clear "no provider connected" message. The plan, state machine, controls,
// and persistence all work today; only clip production needs a provider.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Clapperboard, Film, Play, Pause, X, Loader, CheckCircle2, Clock,
  RefreshCw, AlertTriangle, ListChecks, ChevronRight, Square,
} from 'lucide-react';
import { cn, formatDuration } from '@/lib/utils';
import {
  buildProductionPlan, detectSourceKind,
} from '@/lib/orchestration/plan-builder';
import {
  initOrchestrator, advanceOnce, pause, cancel, skipJob,
  getStats, createNoOpDriver, enqueueNext,
  type OrchestrationDriver,
} from '@/lib/orchestration/orchestrator';
import type {
  OrchestratorSnapshot, ProductionPlan, JobState, OrchestratorStatus,
} from '@/lib/orchestration/types';
import {
  loadSnapshotByProject, saveSnapshot, deleteSnapshot,
} from '@/lib/orchestration/persistence';

const NO_OP_DRIVER: OrchestrationDriver = createNoOpDriver();

const JOB_STATE_META: Record<JobState, { label: string; icon: typeof Clock; color: string }> = {
  pending: { label: 'Pending', icon: Clock, color: 'text-fg-subtle' },
  queued: { label: 'Queued', icon: Clock, color: 'text-warning' },
  generating: { label: 'Generating', icon: Loader, color: 'text-primary' },
  completed: { label: 'Completed', icon: CheckCircle2, color: 'text-success' },
  failed: { label: 'Failed', icon: X, color: 'text-error' },
  retrying: { label: 'Retrying', icon: RefreshCw, color: 'text-warning' },
  skipped: { label: 'Skipped', icon: ChevronRight, color: 'text-fg-faint' },
  cancelled: { label: 'Cancelled', icon: Square, color: 'text-fg-faint' },
};

const STATUS_BADGE: Record<OrchestratorStatus, string> = {
  idle: 'bg-border-strong/60 text-fg-muted border-border/40',
  planning: 'bg-info/15 text-info border-info/20',
  ready: 'bg-border-strong/60 text-fg-muted border-border/40',
  running: 'bg-success/15 text-success border-success/20',
  paused: 'bg-warning/15 text-warning border-warning/20',
  completed: 'bg-success/15 text-success border-success/20',
  failed: 'bg-error/15 text-error border-error/20',
  cancelled: 'bg-border-strong/60 text-fg-muted border-border/40',
};
const STATUS_LABEL: Record<OrchestratorStatus, string> = {
  idle: 'Idle', planning: 'Planning', ready: 'Ready', running: 'Running',
  paused: 'Paused', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
};

const TARGET_DURATIONS = [
  { value: 120, label: '2 min' },
  { value: 600, label: '10 min' },
  { value: 1800, label: '30 min' },
  { value: 3600, label: '1 hour' },
  { value: 7200, label: '2 hours' },
  { value: 0, label: 'Unlimited' },
];

const PER_SHOT_DURATIONS = [5, 8, 10, 15, 20];

interface LongFormStudioProps {
  projectId: string;
  projectName: string;
}

export function LongFormStudio({ projectId, projectName }: LongFormStudioProps) {
  const [snapshot, setSnapshot] = useState<OrchestratorSnapshot | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [targetDuration, setTargetDuration] = useState(600);
  const [perShotSeconds, setPerShotSeconds] = useState(10);
  const [planning, setPlanning] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [loadedPlan, setLoadedPlan] = useState(false);
  const runRef = useRef(false);

  // Load any existing snapshot for this project on mount (resume-after-refresh).
  useEffect(() => {
    let active = true;
    loadSnapshotByProject(projectId)
      .then((snap) => { if (active && snap) { setSnapshot(snap); setSourceText(snap.plan.sourceText); setTargetDuration(snap.plan.targetDurationSeconds); } })
      .catch((err) => { if (active) setPersistError(err.message); })
      .finally(() => { if (active) setLoadedPlan(true); });
    return () => { active = false; };
  }, [projectId]);

  // Persist snapshot to Supabase whenever it changes.
  useEffect(() => {
    if (!snapshot) return;
    saveSnapshot(snapshot).catch((err) => setPersistError(err.message));
  }, [snapshot]);

  // Keep a ref of the latest snapshot so the run loop can read it without
  // re-subscribing on every state change.
  const snapshotRef = useRef<OrchestratorSnapshot | null>(null);
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);

  // Run loop: when status is running, advance periodically.
  const status = snapshot?.status;
  useEffect(() => {
    if (status !== 'running') { runRef.current = false; return; }
    if (runRef.current) return;
    runRef.current = true;
    let stopped = false;
    const tick = async () => {
      while (!stopped) {
        const current = snapshotRef.current;
        if (!current || current.status !== 'running') break;
        const next = await advanceOnce(current, NO_OP_DRIVER);
        if (stopped) break;
        setSnapshot(next);
        await new Promise((r) => setTimeout(r, 1500));
      }
      runRef.current = false;
    };
    tick();
    return () => { stopped = true; };
  }, [status]);

  const handleBuildPlan = useCallback(() => {
    if (!sourceText.trim()) return;
    setPlanning(true);
    const plan = buildProductionPlan({
      projectId,
      title: projectName,
      sourceText,
      targetDurationSeconds: targetDuration,
      defaultShotSeconds: perShotSeconds,
    });
    const snap = initOrchestrator(plan);
    setSnapshot(snap);
    setPlanning(false);
  }, [sourceText, targetDuration, perShotSeconds, projectId, projectName]);

  const handleStart = useCallback(() => {
    setSnapshot((prev) => prev ? { ...enqueueNext({ ...prev, status: 'running' }), updatedAt: new Date().toISOString() } : prev);
  }, []);
  const handlePause = useCallback(() => setSnapshot((prev) => prev ? pause(prev) : prev), []);
  const handleCancel = useCallback(() => setSnapshot((prev) => prev ? cancel(prev) : prev), []);
  const handleSkip = useCallback((jobId: string) => setSnapshot((prev) => prev ? skipJob(prev, jobId) : prev), []);
  const handleDiscard = useCallback(() => {
    if (snapshot) deleteSnapshot(snapshot.plan.id).catch((err) => setPersistError(err.message));
    setSnapshot(null); setSourceText('');
  }, [snapshot]);

  const stats = snapshot ? getStats(snapshot) : null;
  const sourceKind = sourceText ? detectSourceKind(sourceText) : null;
  const isRunning = snapshot?.status === 'running';
  const isPaused = snapshot?.status === 'paused';
  const canStart = snapshot?.status === 'ready' || isPaused;

  if (!loadedPlan) {
    return <div className="p-4 rounded-xl2 bg-surface-2/60 border border-border/40 text-sm text-fg-subtle">Loading production plan…</div>;
  }

  return (
    <div className="space-y-4">
      {/* No-provider banner */}
      <div className="p-4 rounded-xl2 bg-warning/5 border border-warning/20 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm text-warning font-medium">Orchestration ready — no video provider connected</p>
          <p className="text-xs text-fg-muted mt-1 leading-relaxed">
            Planning, the shot-by-shot queue, pause/resume/cancel, retries, and cross-refresh persistence all work now.
            Starting the run will queue shots correctly, but clip production will fail with a clear "no provider" error
            until a provider is connected in Settings. Nothing is simulated as successful.
          </p>
        </div>
      </div>

      {persistError && (
        <div className="p-3 rounded-lg bg-error/5 border border-error/20 flex items-center gap-2 text-xs text-error">
          <AlertTriangle className="w-4 h-4 shrink-0" /> Persistence: {persistError}
        </div>
      )}

      {/* Plan builder */}
      {!snapshot && (
        <div className="bg-surface-2/60 border border-border/40 rounded-xl2 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-primary" />
            <h3 className="text-base font-semibold text-fg">Build a production plan</h3>
          </div>
          <p className="text-xs text-fg-subtle leading-relaxed">
            Paste a complete screenplay (with INT./EXT. scene headings) or a detailed film prompt. The orchestrator
            breaks it into ordered shots with dialogue, location, and continuity notes, then generates them
            automatically once a video provider is connected. Until then, the plan is saved and clip generation stays unavailable.
          </p>
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block uppercase tracking-wider flex items-center gap-2">
              <Clapperboard className="w-3.5 h-3.5" /> Screenplay or film prompt
            </label>
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder={'INT. ARCHIVE ROOM — NIGHT\n\nElena opens the leather journal. A map falls out.\n\nELENA\nIt was here all along.\n\n…or paste a full film prompt describing the story you want produced.'}
              rows={8}
              className="w-full px-3.5 py-2.5 rounded-lg bg-surface-3 border border-border text-fg placeholder-fg-subtle text-sm focus:outline-none focus:border-primary/60 transition-all resize-y font-mono"
            />
            <div className="flex items-center justify-between mt-1.5">
              <p className="text-xs text-fg-faint">{sourceText.length} characters{sourceKind ? ` · detected: ${sourceKind}` : ''}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-fg-muted mb-1.5 block uppercase tracking-wider">Target film length</label>
              <select value={targetDuration} onChange={(e) => setTargetDuration(Number(e.target.value))} className="w-full px-3.5 py-2.5 rounded-lg bg-surface-3 border border-border text-fg text-sm focus:outline-none focus:border-primary/60 transition-all">
                {TARGET_DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-fg-muted mb-1.5 block uppercase tracking-wider">Per-shot duration</label>
              <select value={perShotSeconds} onChange={(e) => setPerShotSeconds(Number(e.target.value))} className="w-full px-3.5 py-2.5 rounded-lg bg-surface-3 border border-border text-fg text-sm focus:outline-none focus:border-primary/60 transition-all">
                {PER_SHOT_DURATIONS.map((d) => <option key={d} value={d}>{d}s</option>)}
              </select>
            </div>
          </div>
          <button
            onClick={handleBuildPlan}
            disabled={!sourceText.trim() || planning}
            className="inline-flex items-center justify-center gap-2 w-full py-3 rounded-lg bg-primary hover:bg-primary-hover text-fg font-medium text-sm transition-all shadow-glow disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {planning ? <Loader className="w-4 h-4 animate-spin" /> : <ListChecks className="w-4 h-4" />}
            {planning ? 'Building plan…' : 'Build production plan'}
          </button>
        </div>
      )}

      {/* Plan overview + controls */}
      {snapshot && stats && (
        <>
          <div className="bg-surface-2/60 border border-border/40 rounded-xl2 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-fg truncate">{snapshot.plan.title}</h3>
                  <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium border', STATUS_BADGE[snapshot.status])}>
                    {STATUS_LABEL[snapshot.status]}
                  </span>
                </div>
                <p className="text-xs text-fg-subtle mt-1">
                  {stats.total} shots · {snapshot.plan.sourceKind} · target {snapshot.plan.targetDurationSeconds === 0 ? 'unlimited' : formatDuration(snapshot.plan.targetDurationSeconds)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {canStart && <button onClick={handleStart} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-hover text-fg font-medium text-sm transition-all shadow-glow"><Play className="w-4 h-4" />{isPaused ? 'Resume' : 'Start'}</button>}
                {isRunning && <button onClick={handlePause} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-surface-hover hover:bg-border-strong text-fg-muted font-medium text-sm transition-all"><Pause className="w-4 h-4" />Pause</button>}
                {(isRunning || isPaused) && <button onClick={handleCancel} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-surface-hover hover:bg-border-strong text-fg-muted font-medium text-sm transition-all"><Square className="w-4 h-4" />Cancel</button>}
                <button onClick={handleDiscard} className="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg bg-surface-hover hover:bg-border-strong text-fg-muted font-medium text-xs transition-all"><X className="w-3.5 h-3.5" />Discard</button>
              </div>
            </div>

            {/* Overall progress */}
            <div>
              <div className="flex items-center justify-between text-xs text-fg-subtle mb-1.5">
                <span>Overall progress</span>
                <span>{stats.completed}/{stats.total} done · {stats.overallProgress}%</span>
              </div>
              <div className="h-2 bg-surface-hover rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary to-primary rounded-full transition-all duration-500" style={{ width: `${stats.overallProgress}%` }} />
              </div>
            </div>

            {/* Stat pills */}
            <div className="flex flex-wrap gap-2 text-xs">
              {([
                ['completed', stats.completed, 'text-success'],
                ['generating', stats.generating, 'text-primary'],
                ['queued', stats.queued, 'text-warning'],
                ['pending', stats.pending, 'text-fg-subtle'],
                ['retrying', stats.retrying, 'text-warning'],
                ['failed', stats.failed, 'text-error'],
                ['skipped', stats.skipped, 'text-fg-faint'],
              ] as const).filter(([, v]) => v > 0).map(([label, v, color]) => (
                <span key={label} className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-full bg-surface-3/60 border border-border/40', color)}>
                  {label} · {v}
                </span>
              ))}
            </div>
          </div>

          {/* Shot list */}
          <div className="bg-surface-2/60 border border-border/40 rounded-xl2 p-5">
            <h3 className="text-sm font-semibold text-fg mb-3 flex items-center gap-2"><Film className="w-4 h-4 text-primary" />Shot queue</h3>
            <div className="space-y-2 max-h-[480px] overflow-y-auto">
              {snapshot.jobs.map((job) => {
                const shot = snapshot.plan.shots.find((s) => s.id === job.shotId);
                if (!shot) return null;
                const meta = JOB_STATE_META[job.state];
                const Icon = meta.icon;
                return (
                  <div key={job.id} className={cn('rounded-lg border p-3 transition-all', job.state === 'generating' ? 'border-primary/40 bg-primary/5' : job.state === 'failed' ? 'border-error/20 bg-error/5' : job.state === 'completed' ? 'border-success/20 bg-success/5' : 'border-border/30 bg-surface-3/40')}>
                    <div className="flex items-start gap-3">
                      <div className={cn('w-8 h-8 rounded flex items-center justify-center shrink-0', job.state === 'completed' ? 'bg-success/10' : job.state === 'generating' ? 'bg-primary/10' : job.state === 'failed' ? 'bg-error/10' : 'bg-surface-hover/60')}>
                        <Icon className={cn('w-4 h-4', meta.color, job.state === 'generating' && 'animate-spin')} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-primary">{shot.label}</span>
                          <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full bg-surface-hover/60', meta.color)}>{meta.label}{job.attempt > 0 ? ` · attempt ${job.attempt}` : ''}</span>
                        </div>
                        <p className="text-xs text-fg-muted line-clamp-2 mt-1">{shot.prompt}</p>
                        {shot.dialogue.length > 0 && <p className="text-[11px] text-fg-faint italic mt-1 line-clamp-1">{shot.dialogue.map((d) => `${d.speaker}: ${d.text}`).join(' · ')}</p>}
                        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-fg-faint">
                          <span>{shot.location}</span><span>·</span>
                          <span>{shot.durationSeconds === 0 ? 'unlimited' : `${shot.durationSeconds}s`}</span>
                          {job.lastError && <><span>·</span><span className="text-error/70 truncate max-w-[200px]">{job.lastError}</span></>}
                        </div>
                        {job.state === 'generating' && <div className="h-1 bg-surface-hover rounded-full overflow-hidden mt-2"><div className="h-full bg-primary rounded-full transition-all" style={{ width: `${job.progress}%` }} /></div>}
                      </div>
                      {(job.state === 'failed' || job.state === 'pending' || job.state === 'retrying') && (
                        <button onClick={() => handleSkip(job.id)} className="text-[10px] text-fg-faint hover:text-fg transition-colors shrink-0">Skip</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export type { ProductionPlan };
