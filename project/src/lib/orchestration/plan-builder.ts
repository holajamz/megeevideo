import type {
  PlannedShot, ProductionPlan, DialogueLine,
  ProviderCapabilities, TransitionType, ShotJobResult,
} from './types';

let planIdCounter = 0;
const planId = () => `plan-${Date.now()}-${++planIdCounter}`;

let shotIdCounter = 0;
const shotId = () => `shot-${String(++shotIdCounter).padStart(3, '0')}`;

const SCENE_HEADING_RE = /^(INT\.|EXT\.|INT\.\/EXT\.|INT\/EXT\.)\s+(.+)$/i;
const TRANSITION_RE = /^(CUT TO:|FADE TO:|FADE IN:|FADE OUT\.|SMASH CUT:|DISSOLVE TO:)/i;

export function detectSourceKind(text: string): 'screenplay' | 'prompt' {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const headingCount = lines.filter((l) => SCENE_HEADING_RE.test(l)).length;
  return headingCount >= 1 ? 'screenplay' : 'prompt';
}

interface ParsedScene {
  number: number;
  heading: string;
  location: string;
  timeOfDay: string;
  actionLines: string[];
  dialogue: DialogueLine[];
}

function parseScreenplay(text: string): ParsedScene[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const scenes: ParsedScene[] = [];
  let current: ParsedScene | null = null;
  let lastSpeaker = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line) { i++; continue; }

    const headingMatch = line.match(SCENE_HEADING_RE);
    if (headingMatch) {
      if (current) scenes.push(current);
      const rest = headingMatch[2];
      const dashIdx = rest.lastIndexOf(' - ');
      const location = dashIdx > 0 ? rest.slice(0, dashIdx).trim() : rest.trim();
      const timeOfDay = dashIdx > 0 ? rest.slice(dashIdx + 3).trim() : 'day';
      current = {
        number: scenes.length + 1,
        heading: line,
        location, timeOfDay,
        actionLines: [],
        dialogue: [],
      };
      i++;
      continue;
    }

    if (TRANSITION_RE.test(line)) { i++; continue; }

    if (current) {
      const isSpeaker =
        line.length <= 40 &&
        line === line.toUpperCase() &&
        /[A-Z]/.test(line) &&
        !line.endsWith('.') &&
        lines[i + 1] && lines[i + 1].trim() &&
        !SCENE_HEADING_RE.test(lines[i + 1].trim());

      if (isSpeaker) {
        lastSpeaker = line;
        i++;
        const dialogueText: string[] = [];
        while (i < lines.length) {
          const d = lines[i];
          if (!d || SCENE_HEADING_RE.test(d) || TRANSITION_RE.test(d)) break;
          dialogueText.push(d);
          i++;
        }
        const text = dialogueText.join(' ').trim();
        if (text) current.dialogue.push({ speaker: lastSpeaker, text });
        continue;
      }
      current.actionLines.push(line);
    }
    i++;
  }
  if (current) scenes.push(current);
  return scenes;
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
}

const WORDS_PER_SECOND = 2.5;

function segmentPrompt(text: string, shotCount: number, perShotSeconds: number): PlannedShot[] {
  const sentences = splitSentences(text);
  const shots: PlannedShot[] = [];
  if (sentences.length === 0) return shots;
  const per = Math.max(1, Math.ceil(sentences.length / shotCount));
  for (let s = 0; s < shotCount; s++) {
    const bucket = sentences.slice(s * per, (s + 1) * per);
    if (bucket.length === 0) break;
    shots.push(buildShot(s + 1, 1, bucket.join(' '), [], [], 'Unknown', perShotSeconds));
  }
  return shots;
}

function buildShot(
  order: number, sceneNumber: number, prompt: string,
  dialogue: DialogueLine[], characterIds: string[], location: string,
  durationSeconds: number, transitionIn?: TransitionType,
): PlannedShot {
  return {
    id: shotId(), order, sceneNumber,
    label: `Scene ${sceneNumber}, Shot ${String.fromCharCode(65 + ((order - 1) % 26))}`,
    prompt, dialogue, characterIds, location,
    referenceImageUrls: [], durationSeconds, transitionIn,
  };
}

export interface BuildPlanInput {
  projectId: string;
  title: string;
  sourceText: string;
  targetDurationSeconds: number;
  defaultShotSeconds: number;
  capabilities?: ProviderCapabilities;
}

export function buildProductionPlan(input: BuildPlanInput): ProductionPlan {
  const caps = input.capabilities ?? {
    supportsExtension: false,
    supportsReferenceImages: false,
    supportsPreviousClipContext: false,
    supportsContinuationPrompt: false,
    maxClipSeconds: 20,
    maxConcurrentJobs: 1,
    supportsWholeScreenplay: false,
  };
  const sourceKind = detectSourceKind(input.sourceText);
  const now = new Date().toISOString();
  const shots: PlannedShot[] = [];

  if (sourceKind === 'screenplay') {
    const scenes = parseScreenplay(input.sourceText);
    let order = 1;
    for (const scene of scenes) {
      const beats = scene.actionLines.length > 0 ? scene.actionLines : [scene.heading];
      const dialoguePerBeat = new Map<number, DialogueLine[]>();
      if (scene.dialogue.length > 0) dialoguePerBeat.set(0, scene.dialogue);

      beats.forEach((beat, beatIdx) => {
        const prompt = [beat, ...(dialoguePerBeat.get(beatIdx) ?? []).map((d) => `${d.speaker}: ${d.text}`)].join(' ');
        const duration = Math.min(input.defaultShotSeconds, caps.maxClipSeconds);
        shots.push(buildShot(order, scene.number, prompt, dialoguePerBeat.get(beatIdx) ?? [], [], scene.location, duration, order > 1 ? 'cut' : undefined));
        order++;
      });
    }
  } else {
    const perShot = Math.min(input.defaultShotSeconds, caps.maxClipSeconds);
    const shotCount = input.targetDurationSeconds > 0
      ? Math.max(1, Math.ceil(input.targetDurationSeconds / perShot))
      : Math.max(1, Math.ceil(input.sourceText.split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND / perShot));
    shots.push(...segmentPrompt(input.sourceText, shotCount, perShot));
  }

  return {
    id: planId(), projectId: input.projectId, title: input.title,
    sourceText: input.sourceText, sourceKind,
    targetDurationSeconds: input.targetDurationSeconds,
    shots, globalContinuityNotes: '', capabilities: caps,
    createdAt: now, updatedAt: now,
  };
}

export function estimateRuntime(jobs: ShotJobResult[]): number {
  return jobs.reduce((s, r) => s + r.durationSeconds, 0);
}
