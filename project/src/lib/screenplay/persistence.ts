// Persistence for screenplay analysis: saves the production breakdown
// into the existing scenes and shots tables through the repository layer.
// Also updates the project's scene_count and shot_count.
//
// This module does NOT create new tables. It reuses the existing scenes,
// shots, and projects tables and the existing createScene / createShot
// repository functions, extending them with the full field set.

import * as db from '@/lib/db';
import type { ProductionBreakdown, CharacterMatch } from './types';

export interface SaveResult {
  scenesCreated: number;
  shotsCreated: number;
  errors: string[];
}

export async function saveBreakdown(
  projectId: string,
  breakdown: ProductionBreakdown,
  characterMatches: CharacterMatch[],
): Promise<SaveResult> {
  const errors: string[] = [];
  let scenesCreated = 0;
  let shotsCreated = 0;

  const matchMap = new Map<string, string | null>();
  for (const m of characterMatches) {
    matchMap.set(m.screenplayName, m.characterId);
  }

  for (const scene of breakdown.scenes) {
    const [sceneRow, sceneErr] = await db.createScene({
      project_id: projectId,
      scene_number: scene.sceneNumber,
      title: scene.title,
      location: scene.location,
      description: scene.description,
      sort_order: scene.sceneNumber - 1,
      time_of_day: scene.timeOfDay,
      script_content: scene.scriptContent,
      status: 'draft',
      duration_seconds: scene.estimatedDurationSeconds,
    });

    if (sceneErr || !sceneRow) {
      errors.push(`Scene ${scene.sceneNumber}: ${sceneErr ?? 'unknown error'}`);
      continue;
    }
    scenesCreated++;

    for (let i = 0; i < scene.shots.length; i++) {
      const shot = scene.shots[i];
      const characterIds = shot.characterNames
        .map((name) => matchMap.get(name))
        .filter((id): id is string => id !== null && id !== undefined);

      const [, shotErr] = await db.createShot({
        scene_id: sceneRow.id,
        project_id: projectId,
        shot_number: `${scene.sceneNumber}${shot.shotLabel}`,
        description: shot.description,
        camera_angle: shot.cameraAngle,
        camera_movement: shot.cameraMovement,
        lighting: shot.lighting,
        duration_seconds: shot.durationSeconds,
        sort_order: i,
        dialogue: shot.dialogue,
        speaker: shot.speaker,
        character_ids: characterIds,
        acting_instructions: shot.actingInstructions,
        sound_cues: shot.soundCues,
        continuity_notes: shot.continuityNotes,
        status: 'planned',
      });

      if (shotErr) {
        errors.push(`Scene ${scene.sceneNumber}, Shot ${shot.shotLabel}: ${shotErr}`);
      } else {
        shotsCreated++;
      }
    }
  }

  if (scenesCreated > 0) {
    await db.updateProject(projectId, {
      scene_count: scenesCreated,
      shot_count: shotsCreated,
      duration_seconds: breakdown.estimatedTotalDurationSeconds,
    });
  }

  return { scenesCreated, shotsCreated, errors };
}
