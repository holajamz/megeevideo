// Screenplay analysis types.
//
// These types describe the structured output of a screenplay analysis
// pipeline. The pipeline is provider-independent: a deterministic parser
// produces the structure today, and an AI provider can be connected later
// to produce richer analysis (prop detection, wardrobe continuity, etc.)
// without changing these interfaces.

export type TimeOfDay = 'day' | 'night' | 'dawn' | 'dusk' | 'evening' | 'morning' | 'continuous' | 'unknown';

export type SceneInterior = 'interior' | 'exterior' | 'mixed';

export interface ParsedDialogue {
  speaker: string;
  text: string;
  isVoiceover: boolean;
  parenthetical?: string;
}

export interface ParsedScene {
  number: number;
  heading: string;
  location: string;
  interior: SceneInterior;
  timeOfDay: TimeOfDay;
  actionLines: string[];
  dialogue: ParsedDialogue[];
  transitions: string[];
  rawText: string;
  startLine: number;
  endLine: number;
}

export interface ParsedCharacter {
  name: string;
  appearances: { sceneNumber: number; speaks: boolean }[];
  lineCount: number;
}

export interface ParsedProp {
  name: string;
  scenes: number[];
}

export interface ScreenplayAnalysis {
  scenes: ParsedScene[];
  characters: ParsedCharacter[];
  props: ParsedProp[];
  locations: { name: string; scenes: number[] }[];
  totalLines: number;
  sourceText: string;
}

export type CameraAngle =
  | 'wide-shot' | 'medium-shot' | 'close-up' | 'extreme-close-up'
  | 'over-shoulder' | 'aerial' | 'low-angle' | 'high-angle' | 'dutch-angle';

export type CameraMovement =
  | 'static' | 'pan' | 'tilt' | 'dolly' | 'tracking'
  | 'handheld' | 'crane' | 'zoom' | 'steadicam';

export type Lighting = 'natural' | 'low-key' | 'high-key' | 'neon' | 'candlelight' | 'practical' | 'mixed';

export interface PlannedShotBreakdown {
  shotNumber: number;
  shotLabel: string;
  purpose: string;
  description: string;
  cameraAngle: CameraAngle;
  cameraMovement: CameraMovement;
  lighting: Lighting;
  blockingNotes: string;
  dialogue: string;
  speaker: string | null;
  characterIds: string[];
  characterNames: string[];
  durationSeconds: number;
  continuityNotes: string;
  soundCues: string;
  actingInstructions: string;
}

export interface SceneBreakdown {
  sceneNumber: number;
  heading: string;
  title: string;
  location: string;
  timeOfDay: TimeOfDay;
  interior: SceneInterior;
  description: string;
  scriptContent: string;
  estimatedDurationSeconds: number;
  shots: PlannedShotBreakdown[];
  characterNames: string[];
}

export interface ProductionBreakdown {
  scenes: SceneBreakdown[];
  characters: ParsedCharacter[];
  sourceText: string;
  totalShots: number;
  estimatedTotalDurationSeconds: number;
}

export interface CharacterMatch {
  screenplayName: string;
  characterId: string | null;
  characterName: string | null;
  matched: boolean;
}

export interface AnalysisResult {
  analysis: ScreenplayAnalysis;
  breakdown: ProductionBreakdown;
  characterMatches: CharacterMatch[];
  usedAI: boolean;
  warnings: string[];
}

export interface ScreenplayAnalyzer {
  analyze(
    sourceText: string,
    options: AnalyzeOptions,
  ): Promise<AnalysisResult>;
}

export interface AnalyzeOptions {
  projectId: string;
  existingCharacters: { id: string; name: string }[];
  defaultShotSeconds: number;
}
