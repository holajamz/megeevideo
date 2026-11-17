// Shot planner: generates an editable shot breakdown for each parsed scene.
//
// This is a deterministic heuristic planner, not an AI model. It applies
// cinematographic rules of thumb to assign camera angles, movements,
// lighting, and continuity based on scene content and dialogue patterns.
// An AI planning provider can be connected later to replace or augment
// these heuristics with richer creative decisions.

import type {
  ParsedScene, ParsedDialogue, SceneBreakdown, PlannedShotBreakdown,
  CameraAngle, CameraMovement, Lighting, TimeOfDay, SceneInterior,
  ProductionBreakdown, ScreenplayAnalysis,
} from './types';

const WORDS_PER_SECOND = 2.5;
const MIN_SHOT_SECONDS = 5;
const MAX_SHOT_SECONDS = 20;

function estimateDialogueSeconds(dialogue: ParsedDialogue[]): number {
  const wordCount = dialogue.reduce((s, d) => s + d.text.split(/\s+/).filter(Boolean).length, 0);
  return Math.ceil(wordCount / WORDS_PER_SECOND);
}

function estimateActionSeconds(actionLines: string[]): number {
  const wordCount = actionLines.join(' ').split(/\s+/).filter(Boolean).length;
  return Math.ceil(wordCount / (WORDS_PER_SECOND * 1.5));
}

function timeOfDayLighting(tod: TimeOfDay, interior: SceneInterior): Lighting {
  if (interior === 'exterior') {
    if (tod === 'night') return 'low-key';
    if (tod === 'dawn' || tod === 'dusk' || tod === 'evening') return 'mixed';
    return 'natural';
  }
  if (interior === 'interior') {
    if (tod === 'night') return 'low-key';
    if (tod === 'evening' || tod === 'dusk') return 'practical';
    return 'mixed';
  }
  return 'mixed';
}

function inferLightingFromAction(actionText: string, base: Lighting): Lighting {
  const lower = actionText.toLowerCase();
  if (lower.includes('candle') || lower.includes('firelight') || lower.includes('fire')) return 'candlelight';
  if (lower.includes('neon') || lower.includes('fluorescent')) return 'neon';
  if (lower.includes('dark') || lower.includes('shadow') || lower.includes('barely visible')) return 'low-key';
  if (lower.includes('bright') || lower.includes('sunlight') || lower.includes('well-lit')) return 'high-key';
  return base;
}

function chooseCameraAngle(
  shotType: 'establishing' | 'dialogue' | 'action' | 'reaction' | 'insert',
  dialogue: ParsedDialogue[],
): CameraAngle {
  switch (shotType) {
    case 'establishing': return 'wide-shot';
    case 'dialogue':
      if (dialogue.length >= 2) return 'over-shoulder';
      return 'medium-shot';
    case 'action': return 'low-angle';
    case 'reaction': return 'close-up';
    case 'insert': return 'extreme-close-up';
  }
}

function chooseCameraMovement(
  shotType: 'establishing' | 'dialogue' | 'action' | 'reaction' | 'insert',
  actionText: string,
): CameraMovement {
  if (shotType === 'establishing') return 'static';
  if (shotType === 'action') {
    const lower = actionText.toLowerCase();
    if (lower.includes('runs') || lower.includes('chases') || lower.includes('walks')) return 'tracking';
    if (lower.includes('fight') || lower.includes('struggle') || lower.includes('combat')) return 'handheld';
    return 'dolly';
  }
  if (shotType === 'dialogue') return 'static';
  if (shotType === 'reaction') return 'static';
  return 'static';
}

function clampDuration(seconds: number): number {
  return Math.min(MAX_SHOT_SECONDS, Math.max(MIN_SHOT_SECONDS, seconds));
}

function titleFromHeading(heading: string): string {
  const match = heading.match(/^(?:INT\.|EXT\.|INT\.\/EXT\.|INT\/EXT\.|I\/E\.)\s+(.+)$/i);
  if (!match) return heading;
  const rest = match[1];
  const dashIdx = rest.lastIndexOf(' - ');
  const location = dashIdx > 0 ? rest.slice(0, dashIdx).trim() : rest.trim();
  const words = location.split(/\s+/);
  if (words.length <= 3) return location;
  return words.slice(0, 3).join(' ') + '…';
}

interface ShotSegment {
  type: 'establishing' | 'dialogue' | 'action' | 'reaction' | 'insert';
  description: string;
  dialogue: ParsedDialogue[];
  actionText: string;
}

function segmentScene(scene: ParsedScene): ShotSegment[] {
  const segments: ShotSegment[] = [];

  // Always start with an establishing shot
  if (scene.actionLines.length > 0 || scene.dialogue.length === 0) {
    segments.push({
      type: 'establishing',
      description: scene.actionLines[0] ?? scene.heading,
      dialogue: [],
      actionText: scene.actionLines.slice(0, 3).join(' '),
    });
  }

  // Group dialogue into conversation beats
  for (const d of scene.dialogue) {
    segments.push({
      type: 'dialogue',
      description: d.isVoiceover
        ? `Voiceover: ${d.speaker}`
        : `${d.speaker} speaks`,
      dialogue: [d],
      actionText: '',
    });
  }

  // Action beats between dialogue
  if (scene.actionLines.length > 1) {
    const remainingActions = scene.actionLines.slice(1);
    const midPoint = Math.floor(remainingActions.length / 2);
    if (remainingActions.length > 0) {
      segments.push({
        type: 'action',
        description: remainingActions.slice(0, midPoint + 1).join(' ') || remainingActions[0],
        dialogue: [],
        actionText: remainingActions.slice(0, midPoint + 1).join(' '),
      });
    }
    if (remainingActions.length > midPoint + 1) {
      segments.push({
        type: 'action',
        description: remainingActions.slice(midPoint + 1).join(' '),
        dialogue: [],
        actionText: remainingActions.slice(midPoint + 1).join(' '),
      });
    }
  }

  // Reaction shot if there's emotional dialogue
  const emotionalDialogue = scene.dialogue.filter((d) => {
    const lower = d.text.toLowerCase();
    return lower.includes('!') || lower.includes('?') || d.parenthetical;
  });
  if (emotionalDialogue.length > 0 && segments.length > 1) {
    segments.push({
      type: 'reaction',
      description: `Reaction to ${emotionalDialogue[0].speaker}`,
      dialogue: [],
      actionText: '',
    });
  }

  return segments;
}

function buildShot(
  shotNumber: number,
  segment: ShotSegment,
  scene: ParsedScene,
  prevShot: PlannedShotBreakdown | null,
  characterNames: string[],
): PlannedShotBreakdown {
  const baseLighting = timeOfDayLighting(scene.timeOfDay, scene.interior);
  const lighting = inferLightingFromAction(segment.actionText, baseLighting);
  const cameraAngle = chooseCameraAngle(segment.type, segment.dialogue);
  const cameraMovement = chooseCameraMovement(segment.type, segment.actionText);

  const dialogueText = segment.dialogue.map((d) => d.text).join(' ');
  const speaker = segment.dialogue.length > 0 ? segment.dialogue[0].speaker : null;

  let durationSeconds: number;
  if (segment.type === 'dialogue') {
    durationSeconds = estimateDialogueSeconds(segment.dialogue);
  } else if (segment.type === 'establishing') {
    durationSeconds = 8;
  } else if (segment.type === 'action') {
    durationSeconds = estimateActionSeconds([segment.actionText]);
  } else {
    durationSeconds = 4;
  }
  durationSeconds = clampDuration(durationSeconds);

  const continuityNotes = prevShot
    ? `Maintain continuity from ${prevShot.shotLabel}. Match screen direction and ${prevShot.cameraAngle}.`
    : 'Scene opening — establish environment and character positions.';

  const purposeMap: Record<ShotSegment['type'], string> = {
    establishing: 'Establish the scene location and atmosphere',
    dialogue: `Capture ${speaker ?? 'character'} dialogue`,
    action: 'Show character action or movement',
    reaction: 'Capture emotional reaction',
    insert: 'Highlight a detail or object',
  };

  const blockingNotes = characterNames.length > 0
    ? `${characterNames.join(', ')} ${characterNames.length > 1 ? 'are' : 'is'} positioned within the frame. ${segment.type === 'dialogue' ? `Frame ${speaker} for clear dialogue delivery.` : ''}`
    : 'No specific characters identified in this shot.';

  const soundCues = scene.dialogue.length > 0 && segment.type === 'dialogue'
    ? `Clean dialogue capture for ${speaker}.`
    : scene.interior === 'exterior'
      ? 'Ambient environmental sound.'
      : 'Room tone.';

  const actingInstructions = segment.dialogue.length > 0 && segment.dialogue[0].parenthetical
    ? segment.dialogue[0].parenthetical
    : segment.type === 'reaction'
      ? 'Subtle emotional response — eyes and facial expression.'
      : '';

  return {
    shotNumber,
    shotLabel: `${String.fromCharCode(65 + ((shotNumber - 1) % 26))}`,
    purpose: purposeMap[segment.type],
    description: segment.description,
    cameraAngle,
    cameraMovement,
    lighting,
    blockingNotes,
    dialogue: dialogueText,
    speaker,
    characterIds: [],
    characterNames: speaker ? [speaker] : characterNames,
    durationSeconds,
    continuityNotes,
    soundCues,
    actingInstructions,
  };
}

export function planScene(scene: ParsedScene): SceneBreakdown {
  const segments = segmentScene(scene);
  const characterNames = scene.dialogue.map((d) => d.speaker);
  const uniqueNames = Array.from(new Set(characterNames));

  const shots: PlannedShotBreakdown[] = [];
  let prev: PlannedShotBreakdown | null = null;

  for (let i = 0; i < segments.length; i++) {
    const shot = buildShot(i + 1, segments[i], scene, prev, uniqueNames);
    shots.push(shot);
    prev = shot;
  }

  const dialogueSeconds = estimateDialogueSeconds(scene.dialogue);
  const actionSeconds = estimateActionSeconds(scene.actionLines);
  const estimatedDurationSeconds = dialogueSeconds + actionSeconds + 5;

  return {
    sceneNumber: scene.number,
    heading: scene.heading,
    title: titleFromHeading(scene.heading),
    location: scene.location,
    timeOfDay: scene.timeOfDay,
    interior: scene.interior,
    description: scene.actionLines.slice(0, 2).join(' ') || scene.heading,
    scriptContent: scene.rawText,
    estimatedDurationSeconds,
    shots,
    characterNames: uniqueNames,
  };
}

export function planBreakdown(analysis: ScreenplayAnalysis): ProductionBreakdown {
  const scenes = analysis.scenes.map(planScene);
  const totalShots = scenes.reduce((s, sc) => s + sc.shots.length, 0);
  const estimatedTotalDurationSeconds = scenes.reduce((s, sc) => s + sc.estimatedDurationSeconds, 0);
  return {
    scenes,
    characters: analysis.characters,
    sourceText: analysis.sourceText,
    totalShots,
    estimatedTotalDurationSeconds,
  };
}
