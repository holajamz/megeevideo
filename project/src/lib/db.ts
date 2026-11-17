// Repository layer for all Supabase CRUD operations.
// Centralizes queries so components don't scatter raw Supabase calls.
// Every function returns [data, error] where error is a user-friendly string.

import { supabase } from '@/lib/supabase';

const UNAVAILABLE = 'Account service is not connected, so changes cannot be saved.';

function getClient() {
  if (!supabase) return null;
  return supabase;
}

// ─── Types ───

export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  status: string;
  thumbnail_color: string;
  progress: number;
  duration_seconds: number;
  scene_count: number;
  shot_count: number;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
  genre: string;
  aspect_ratio: string;
  target_duration_seconds: number;
}

export interface CharacterRow {
  id: string;
  user_id: string;
  project_id: string | null;
  name: string;
  role: string;
  description: string;
  wardrobe_notes: string;
  voice_notes: string;
  appearance_notes: string;
  reference_image_count: number;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface SceneRow {
  id: string;
  user_id: string;
  project_id: string;
  scene_number: number;
  title: string;
  location: string;
  time_of_day: string;
  description: string;
  script_content: string;
  status: string;
  duration_seconds: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ShotRow {
  id: string;
  user_id: string;
  scene_id: string;
  project_id: string;
  shot_number: string;
  description: string;
  camera_angle: string;
  camera_movement: string;
  lighting: string;
  duration_seconds: number;
  dialogue: string;
  speaker: string | null;
  character_ids: string[];
  acting_instructions: string;
  sound_cues: string;
  continuity_notes: string;
  status: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProductionJobRow {
  id: string;
  user_id: string;
  project_id: string;
  job_type: string;
  status: string;
  progress: number;
  prompt: string;
  model: string;
  duration_seconds: number;
  aspect_ratio: string;
  error: string | null;
  result_thumbnail_color: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

// ─── Projects ───

export async function fetchProjects(): Promise<[ProjectRow[] | null, string | null]> {
  const sb = getClient();
  if (!sb) return [null, UNAVAILABLE];
  const { data, error } = await sb.from('projects').select('*').order('updated_at', { ascending: false });
  if (error) return [null, 'Your projects could not be loaded.'];
  return [data as ProjectRow[], null];
}

export async function createProject(input: {
  name: string;
  description: string;
  status: string;
  thumbnail_color: string;
  genre?: string;
  aspect_ratio?: string;
  target_duration_seconds?: number;
}): Promise<[ProjectRow | null, string | null]> {
  const sb = getClient();
  if (!sb) return [null, UNAVAILABLE];
  const { data, error } = await sb.from('projects').insert({
    name: input.name,
    description: input.description,
    status: input.status,
    thumbnail_color: input.thumbnail_color,
    genre: input.genre ?? 'Drama',
    aspect_ratio: input.aspect_ratio ?? '2.39:1',
    target_duration_seconds: input.target_duration_seconds ?? 0,
    progress: 0,
    duration_seconds: 0,
    scene_count: 0,
    shot_count: 0,
  }).select().single();
  if (error || !data) return [null, 'The project could not be saved. Please try again.'];
  return [data as ProjectRow, null];
}

export async function updateProject(id: string, patch: Partial<ProjectRow>): Promise<[ProjectRow | null, string | null]> {
  const sb = getClient();
  if (!sb) return [null, UNAVAILABLE];
  const { data, error } = await sb.from('projects').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error || !data) return [null, 'The project could not be updated. Please try again.'];
  return [data as ProjectRow, null];
}

export async function deleteProject(id: string): Promise<string | null> {
  const sb = getClient();
  if (!sb) return UNAVAILABLE;
  const { error } = await sb.from('projects').delete().eq('id', id);
  if (error) return 'The project could not be deleted. Please try again.';
  return null;
}

export async function touchProject(id: string): Promise<void> {
  const sb = getClient();
  if (!sb) return;
  await sb.from('projects').update({ last_opened_at: new Date().toISOString() }).eq('id', id);
}

// ─── Characters ───

export async function fetchCharacters(projectId?: string): Promise<[CharacterRow[] | null, string | null]> {
  const sb = getClient();
  if (!sb) return [null, UNAVAILABLE];
  let q = sb.from('characters').select('*').order('updated_at', { ascending: false });
  if (projectId) q = q.eq('project_id', projectId);
  const { data, error } = await q;
  if (error) return [null, 'Your characters could not be loaded.'];
  return [data as CharacterRow[], null];
}

export async function createCharacter(input: {
  name: string;
  role: string;
  description: string;
  wardrobe_notes: string;
  voice_notes: string;
  appearance_notes?: string;
  color: string;
  project_id?: string | null;
}): Promise<[CharacterRow | null, string | null]> {
  const sb = getClient();
  if (!sb) return [null, UNAVAILABLE];
  const { data, error } = await sb.from('characters').insert({
    name: input.name,
    role: input.role,
    description: input.description,
    wardrobe_notes: input.wardrobe_notes,
    voice_notes: input.voice_notes,
    appearance_notes: input.appearance_notes ?? '',
    color: input.color,
    project_id: input.project_id ?? null,
    reference_image_count: 0,
  }).select().single();
  if (error || !data) return [null, 'The character could not be saved. Please try again.'];
  return [data as CharacterRow, null];
}

export async function updateCharacter(id: string, patch: Partial<CharacterRow>): Promise<[CharacterRow | null, string | null]> {
  const sb = getClient();
  if (!sb) return [null, UNAVAILABLE];
  const { data, error } = await sb.from('characters').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error || !data) return [null, 'The character could not be updated. Please try again.'];
  return [data as CharacterRow, null];
}

export async function deleteCharacter(id: string): Promise<string | null> {
  const sb = getClient();
  if (!sb) return UNAVAILABLE;
  const { error } = await sb.from('characters').delete().eq('id', id);
  if (error) return 'The character could not be deleted. Please try again.';
  return null;
}

// ─── Scenes ───

export async function fetchScenes(projectId: string): Promise<[SceneRow[] | null, string | null]> {
  const sb = getClient();
  if (!sb) return [null, UNAVAILABLE];
  const { data, error } = await sb.from('scenes').select('*').eq('project_id', projectId).order('sort_order', { ascending: true });
  if (error) return [null, 'Scenes could not be loaded.'];
  return [data as SceneRow[], null];
}

export async function createScene(input: {
  project_id: string;
  scene_number: number;
  title: string;
  location?: string;
  description?: string;
  sort_order?: number;
  time_of_day?: string;
  script_content?: string;
  status?: string;
  duration_seconds?: number;
}): Promise<[SceneRow | null, string | null]> {
  const sb = getClient();
  if (!sb) return [null, UNAVAILABLE];
  const { data, error } = await sb.from('scenes').insert({
    project_id: input.project_id,
    scene_number: input.scene_number,
    title: input.title,
    location: input.location ?? '',
    description: input.description ?? '',
    sort_order: input.sort_order ?? 0,
    time_of_day: input.time_of_day ?? 'day',
    script_content: input.script_content ?? '',
    status: input.status ?? 'draft',
    duration_seconds: input.duration_seconds ?? 0,
  }).select().single();
  if (error || !data) return [null, 'The scene could not be saved. Please try again.'];
  return [data as SceneRow, null];
}

export async function updateScene(id: string, patch: Partial<SceneRow>): Promise<[SceneRow | null, string | null]> {
  const sb = getClient();
  if (!sb) return [null, UNAVAILABLE];
  const { data, error } = await sb.from('scenes').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error || !data) return [null, 'The scene could not be updated. Please try again.'];
  return [data as SceneRow, null];
}

export async function deleteScene(id: string): Promise<string | null> {
  const sb = getClient();
  if (!sb) return UNAVAILABLE;
  const { error } = await sb.from('scenes').delete().eq('id', id);
  if (error) return 'The scene could not be deleted. Please try again.';
  return null;
}

// ─── Shots ───

export async function fetchShots(projectId: string): Promise<[ShotRow[] | null, string | null]> {
  const sb = getClient();
  if (!sb) return [null, UNAVAILABLE];
  const { data, error } = await sb.from('shots').select('*').eq('project_id', projectId).order('sort_order', { ascending: true });
  if (error) return [null, 'Shots could not be loaded.'];
  return [data as ShotRow[], null];
}

export async function createShot(input: {
  scene_id: string;
  project_id: string;
  shot_number: string;
  description: string;
  camera_angle?: string;
  camera_movement?: string;
  lighting?: string;
  duration_seconds?: number;
  sort_order?: number;
  dialogue?: string;
  speaker?: string | null;
  character_ids?: string[];
  acting_instructions?: string;
  sound_cues?: string;
  continuity_notes?: string;
  status?: string;
}): Promise<[ShotRow | null, string | null]> {
  const sb = getClient();
  if (!sb) return [null, UNAVAILABLE];
  const { data, error } = await sb.from('shots').insert({
    scene_id: input.scene_id,
    project_id: input.project_id,
    shot_number: input.shot_number,
    description: input.description,
    camera_angle: input.camera_angle ?? 'medium-shot',
    camera_movement: input.camera_movement ?? 'static',
    lighting: input.lighting ?? 'natural',
    duration_seconds: input.duration_seconds ?? 10,
    sort_order: input.sort_order ?? 0,
    dialogue: input.dialogue ?? '',
    speaker: input.speaker ?? null,
    character_ids: input.character_ids ?? [],
    acting_instructions: input.acting_instructions ?? '',
    sound_cues: input.sound_cues ?? '',
    continuity_notes: input.continuity_notes ?? '',
    status: input.status ?? 'planned',
  }).select().single();
  if (error || !data) return [null, 'The shot could not be saved. Please try again.'];
  return [data as ShotRow, null];
}

export async function updateShot(id: string, patch: Partial<ShotRow>): Promise<[ShotRow | null, string | null]> {
  const sb = getClient();
  if (!sb) return [null, UNAVAILABLE];
  const { data, error } = await sb.from('shots').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error || !data) return [null, 'The shot could not be updated. Please try again.'];
  return [data as ShotRow, null];
}

export async function deleteShot(id: string): Promise<string | null> {
  const sb = getClient();
  if (!sb) return UNAVAILABLE;
  const { error } = await sb.from('shots').delete().eq('id', id);
  if (error) return 'The shot could not be deleted. Please try again.';
  return null;
}

// ─── Production Jobs ───

export async function fetchJobs(projectId?: string): Promise<[ProductionJobRow[] | null, string | null]> {
  const sb = getClient();
  if (!sb) return [null, UNAVAILABLE];
  let q = sb.from('production_jobs').select('*').order('created_at', { ascending: false });
  if (projectId) q = q.eq('project_id', projectId);
  const { data, error } = await q;
  if (error) return [null, 'Jobs could not be loaded.'];
  return [data as ProductionJobRow[], null];
}

export async function createJob(input: {
  project_id: string;
  job_type: string;
  prompt: string;
  model?: string;
  duration_seconds?: number;
  aspect_ratio?: string;
}): Promise<[ProductionJobRow | null, string | null]> {
  const sb = getClient();
  if (!sb) return [null, UNAVAILABLE];
  const { data, error } = await sb.from('production_jobs').insert({
    project_id: input.project_id,
    job_type: input.job_type,
    prompt: input.prompt,
    model: input.model ?? '',
    duration_seconds: input.duration_seconds ?? 0,
    aspect_ratio: input.aspect_ratio ?? '2.39:1',
    status: 'queued',
    progress: 0,
  }).select().single();
  if (error || !data) return [null, 'The job could not be created. Please try again.'];
  return [data as ProductionJobRow, null];
}

export async function updateJob(id: string, patch: Partial<ProductionJobRow>): Promise<[ProductionJobRow | null, string | null]> {
  const sb = getClient();
  if (!sb) return [null, UNAVAILABLE];
  const { data, error } = await sb.from('production_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error || !data) return [null, 'The job could not be updated. Please try again.'];
  return [data as ProductionJobRow, null];
}
