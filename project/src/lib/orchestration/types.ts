// Orchestration types for long-form AI film production.
// Provider-independent: describes the plan, jobs, and state machine
// without coupling to any specific generation provider.

export interface PlannedShot {
  id: string;
  order: number;
  sceneNumber: number;
  label: string;
  prompt: string;
  continuationPrompt?: string;
  dialogue: DialogueLine[];
  characterIds: string[];
  location: string;
  cameraAngle?: string;
  cameraMovement?: string;
  lighting?: string;
  continuityNotes?: string;
  referenceImageUrls: string[];
  durationSeconds: number;
  transitionIn?: TransitionType;
}

export interface DialogueLine {
  speaker: string;
  text: string;
  startSeconds?: number;
  endSeconds?: number;
}

export type TransitionType = 'cut' | 'cross-dissolve' | 'fade' | 'wipe' | 'smash-cut';

export interface ProviderCapabilities {
  supportsExtension: boolean;
  supportsReferenceImages: boolean;
  supportsPreviousClipContext: boolean;
  supportsContinuationPrompt: boolean;
  maxClipSeconds: number;
  maxConcurrentJobs: number;
  supportsWholeScreenplay: boolean;
}

export const NO_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  supportsExtension: false,
  supportsReferenceImages: false,
  supportsPreviousClipContext: false,
  supportsContinuationPrompt: false,
  maxClipSeconds: 20,
  maxConcurrentJobs: 1,
  supportsWholeScreenplay: false,
};

export type JobState =
  | 'pending' | 'queued' | 'generating' | 'completed'
  | 'failed' | 'retrying' | 'skipped' | 'cancelled';

export type OrchestratorStatus =
  | 'idle' | 'planning' | 'ready' | 'running'
  | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface ShotJob {
  id: string;
  shotId: string;
  projectId: string;
  state: JobState;
  progress: number;
  attempt: number;
  maxAttempts: number;
  lastError?: string;
  handle?: { providerJobId: string };
  createdAt: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  result?: ShotJobResult;
}

export interface ShotJobResult {
  clipRef: string;
  durationSeconds: number;
  aspectRatio: string;
}

export interface ProductionPlan {
  id: string;
  projectId: string;
  title: string;
  sourceText: string;
  sourceKind: 'screenplay' | 'prompt';
  targetDurationSeconds: number;
  shots: PlannedShot[];
  globalContinuityNotes: string;
  capabilities: ProviderCapabilities;
  createdAt: string;
  updatedAt: string;
}

export interface OrchestratorSnapshot {
  plan: ProductionPlan;
  jobs: ShotJob[];
  status: OrchestratorStatus;
  nextShotIndex: number;
  updatedAt: string;
}
