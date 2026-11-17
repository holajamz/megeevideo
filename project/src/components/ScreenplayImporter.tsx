// ScreenplayImporter: the full screenplay-to-production-plan workflow.
//
// Steps:
//   1. Submit — paste a complete screenplay
//   2. Analyze — deterministic parser extracts scenes, characters, dialogue
//   3. Review Scenes — browse detected scenes, edit boundaries/titles
//   4. Review Shots — browse auto-planned shots, edit camera/lighting/dialogue
//   5. Approve — save everything to Supabase via the repository layer
//
// The analyzer is deterministic (no AI). An AI provider can be connected
// later by swapping the analyzer implementation. The component clearly
// labels what is rule-based and what would benefit from AI.

import { useCallback, useState } from 'react';
import {
  FileText, Loader, AlertTriangle, CheckCircle2, Film, Users,
  ChevronRight, ChevronDown, Camera, Sun, Clock, ArrowLeft,
  ArrowRight, Clapperboard, MapPin, Edit3, Save, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DeterministicAnalyzer } from '@/lib/screenplay/analyzer';
import type {
  AnalysisResult, SceneBreakdown, PlannedShotBreakdown,
  CharacterMatch, CameraAngle, CameraMovement, Lighting,
} from '@/lib/screenplay/types';
import { saveBreakdown } from '@/lib/screenplay/persistence';

type Step = 'input' | 'analyzing' | 'scenes' | 'shots' | 'approving' | 'done';

const STEP_FLOW: { id: Step; label: string }[] = [
  { id: 'input', label: 'Submit' },
  { id: 'scenes', label: 'Review Scenes' },
  { id: 'shots', label: 'Review Shots' },
  { id: 'done', label: 'Approve' },
];

const CAMERA_ANGLES: CameraAngle[] = [
  'wide-shot', 'medium-shot', 'close-up', 'extreme-close-up',
  'over-shoulder', 'aerial', 'low-angle', 'high-angle', 'dutch-angle',
];

const CAMERA_MOVEMENTS: CameraMovement[] = [
  'static', 'pan', 'tilt', 'dolly', 'tracking',
  'handheld', 'crane', 'zoom', 'steadicam',
];

const LIGHTING_OPTIONS: Lighting[] = [
  'natural', 'low-key', 'high-key', 'neon',
  'candlelight', 'practical', 'mixed',
];

interface ScreenplayImporterProps {
  projectId: string;
  projectName: string;
  existingCharacters: { id: string; name: string }[];
  onSaved: () => void;
  onCancel: () => void;
}

export function ScreenplayImporter({
  projectId,
  projectName,
  existingCharacters,
  onSaved,
  onCancel,
}: ScreenplayImporterProps) {
  const [step, setStep] = useState<Step>('input');
  const [sourceText, setSourceText] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [expandedScene, setExpandedScene] = useState<number | null>(0);
  const [editingScene, setEditingScene] = useState<number | null>(null);
  const [editingShot, setEditingShot] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<{ scenes: number; shots: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Mutable copies of the breakdown for editing
  const [scenes, setScenes] = useState<SceneBreakdown[]>([]);
  const [matches, setMatches] = useState<CharacterMatch[]>([]);

  const analyzer = new DeterministicAnalyzer();

  const handleAnalyze = useCallback(async () => {
    if (!sourceText.trim()) return;
    setStep('analyzing');
    try {
      const res = await analyzer.analyze(sourceText, {
        projectId,
        existingCharacters,
        defaultShotSeconds: 10,
      });
      setResult(res);
      setScenes(res.breakdown.scenes);
      setMatches(res.characterMatches);
      setStep('scenes');
    } catch {
      setStep('input');
      setSaveError('Analysis failed. Please check your screenplay format and try again.');
    }
  }, [sourceText, projectId, existingCharacters, analyzer]);

  const updateScene = (idx: number, patch: Partial<SceneBreakdown>) => {
    setScenes((prev) => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

  const updateShot = (sceneIdx: number, shotIdx: number, patch: Partial<PlannedShotBreakdown>) => {
    setScenes((prev) => prev.map((s, i) => {
      if (i !== sceneIdx) return s;
      return {
        ...s,
        shots: s.shots.map((sh, j) => j === shotIdx ? { ...sh, ...patch } : sh),
      };
    }));
  };

  const updateMatch = (name: string, characterId: string | null) => {
    setMatches((prev) => prev.map((m) =>
      m.screenplayName === name
        ? { ...m, characterId, characterName: characterId ? existingCharacters.find((c) => c.id === characterId)?.name ?? null : null, matched: characterId !== null }
        : m,
    ));
  };

  const handleApprove = useCallback(async () => {
    if (!result) return;
    setIsSaving(true);
    setStep('shots');
    setSaveError(null);
    try {
      const breakdown = { ...result.breakdown, scenes };
      const res = await saveBreakdown(projectId, breakdown, matches);
      if (res.errors.length > 0) {
        setSaveError(`${res.errors.length} error(s) occurred during save. ${res.errors[0]}`);
      }
      setSaveResult({ scenes: res.scenesCreated, shots: res.shotsCreated });
      setStep('done');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save the production plan.');
      setStep('shots');
    } finally {
      setIsSaving(false);
    }
  }, [result, scenes, matches, projectId]);

  const stepIndex = STEP_FLOW.findIndex((s) => s.id === step);

  // ─── Input Step ───
  if (step === 'input' || step === 'analyzing') {
    return (
      <div className="space-y-4">
        <StepIndicator currentIndex={0} />
        <div className="bg-surface-2/60 border border-border/40 rounded-xl2 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            <h3 className="text-base font-semibold text-fg">Submit your screenplay</h3>
          </div>
          <p className="text-xs text-fg-subtle leading-relaxed">
            Paste a complete screenplay with standard formatting (INT./EXT. scene headings, character names in ALL CAPS,
            dialogue blocks, and transitions). The parser preserves your original text and does not truncate long scripts.
            Analysis is deterministic — it identifies scenes, characters, dialogue, voiceovers, and locations using
            formatting rules, not AI. An AI planning provider can be connected later for richer creative decisions.
          </p>
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block uppercase tracking-wider flex items-center gap-2">
              <Clapperboard className="w-3.5 h-3.5" /> Screenplay text
            </label>
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder={'INT. ARCHIVE ROOM — NIGHT\n\nElena opens the leather journal. A map falls out.\n\nELENA\nIt was here all along.\n\nMARCUS (O.S.)\nWhat did you find?\n\nELENA\n(V.O.)\nI knew this moment would change everything.\n\nCUT TO:\n\nEXT. DESERT HIGHWAY — DAWN\n\nA dust-covered truck pulls off the road.'}
              rows={12}
              className="w-full px-3.5 py-2.5 rounded-lg bg-surface-3 border border-border text-fg placeholder-fg-subtle text-sm focus:outline-none focus:border-primary/60 transition-all resize-y font-mono"
            />
            <p className="text-xs text-fg-faint mt-1.5">
              {sourceText.length.toLocaleString()} characters · {sourceText.split(/\r?\n/).filter(Boolean).length} lines
            </p>
          </div>
          {saveError && (
            <div className="p-3 rounded-lg bg-error/5 border border-error/20 flex items-center gap-2 text-xs text-error">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {saveError}
            </div>
          )}
          <div className="flex items-center justify-between gap-3 pt-2">
            <button onClick={onCancel} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-surface-hover hover:bg-border-strong text-fg-muted font-medium text-sm transition-all">
              <X className="w-4 h-4" /> Cancel
            </button>
            <button
              onClick={handleAnalyze}
              disabled={!sourceText.trim() || step === 'analyzing'}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-hover text-fg font-medium text-sm transition-all shadow-glow disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {step === 'analyzing' ? <Loader className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {step === 'analyzing' ? 'Analyzing…' : 'Analyze Screenplay'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Loading guard ───
  if (!result) return null;

  // ─── Done Step ───
  if (step === 'done') {
    return (
      <div className="space-y-4">
        <StepIndicator currentIndex={3} />
        <div className="bg-surface-2/60 border border-border/40 rounded-xl2 p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-success" />
          </div>
          <h3 className="text-lg font-semibold text-fg">Production plan saved</h3>
          <p className="text-sm text-fg-subtle max-w-md mx-auto">
            {saveResult?.scenes ?? 0} scenes and {saveResult?.shots ?? 0} shots have been saved to
            "{projectName}". You can edit them further in the Film Director view.
          </p>
          {saveError && (
            <div className="p-3 rounded-lg bg-warning/5 border border-warning/20 flex items-center gap-2 text-xs text-warning max-w-md mx-auto">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {saveError}
            </div>
          )}
          <button onClick={onSaved} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-hover text-fg font-medium text-sm transition-all shadow-glow">
            <Film className="w-4 h-4" /> Go to Film Director
          </button>
        </div>
      </div>
    );
  }

  // ─── Scenes / Shots Review Steps ───
  const totalShots = scenes.reduce((s, sc) => s + sc.shots.length, 0);

  return (
    <div className="space-y-4">
        {/* Step indicator */}
        <div className="flex items-center justify-between">
          <StepIndicator currentIndex={stepIndex} />
          <button onClick={onCancel} className="text-xs text-fg-subtle hover:text-fg transition-colors">Cancel import</button>
        </div>

        {/* AI disclaimer */}
        <div className="p-3 rounded-lg bg-info/5 border border-info/20 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-info shrink-0 mt-0.5" />
          <p className="text-xs text-fg-muted leading-relaxed">
            Analysis was produced by a deterministic parser, not an AI model. Scene detection, character identification,
            and shot planning use formatting rules and cinematographic heuristics. An AI planning provider can be
            connected later for richer creative analysis (subtext, emotional beats, prop continuity).
          </p>
        </div>

        {/* Warnings */}
        {result.warnings.length > 0 && (
          <div className="space-y-1.5">
            {result.warnings.map((w, i) => (
              <div key={i} className="p-2.5 rounded-lg bg-warning/5 border border-warning/20 flex items-center gap-2 text-xs text-warning">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {w}
              </div>
            ))}
          </div>
        )}

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-surface-2/60 border border-border/40 rounded-xl2 p-3.5">
            <div className="flex items-center gap-2 mb-1"><Film className="w-4 h-4 text-primary" /><span className="text-xs text-fg-subtle uppercase tracking-wider">Scenes</span></div>
            <p className="text-xl font-bold text-fg">{scenes.length}</p>
          </div>
          <div className="bg-surface-2/60 border border-border/40 rounded-xl2 p-3.5">
            <div className="flex items-center gap-2 mb-1"><Camera className="w-4 h-4 text-primary" /><span className="text-xs text-fg-subtle uppercase tracking-wider">Shots</span></div>
            <p className="text-xl font-bold text-fg">{totalShots}</p>
          </div>
          <div className="bg-surface-2/60 border border-border/40 rounded-xl2 p-3.5">
            <div className="flex items-center gap-2 mb-1"><Users className="w-4 h-4 text-primary" /><span className="text-xs text-fg-subtle uppercase tracking-wider">Characters</span></div>
            <p className="text-xl font-bold text-fg">{result.analysis.characters.length}</p>
          </div>
        </div>

        {/* Character matching */}
        {matches.length > 0 && (
          <div className="bg-surface-2/60 border border-border/40 rounded-xl2 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              <h4 className="text-sm font-semibold text-fg">Character assignments</h4>
            </div>
            <p className="text-xs text-fg-subtle">Link screenplay characters to your existing character records. Unmatched characters can be assigned manually.</p>
            <div className="space-y-2">
              {matches.map((m) => (
                <div key={m.screenplayName} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-sm text-fg font-medium">{m.screenplayName}</span>
                  <div className="flex items-center gap-2">
                    {m.matched ? (
                      <Badge variant="success">Matched</Badge>
                    ) : (
                      <Badge variant="default">No match</Badge>
                    )}
                    <select
                      value={m.characterId ?? ''}
                      onChange={(e) => updateMatch(m.screenplayName, e.target.value || null)}
                      className="px-2.5 py-1.5 rounded-lg bg-surface-3 border border-border text-fg text-xs focus:outline-none focus:border-primary/60 transition-all"
                    >
                      <option value="">Not linked</option>
                      {existingCharacters.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Scene/Shot list */}
        <div className="space-y-2">
          {scenes.map((scene, sIdx) => {
            const isExpanded = expandedScene === sIdx;
            const isEditingScene = editingScene === sIdx;
            return (
              <div key={sIdx} className="bg-surface-2/60 border border-border/40 rounded-xl2 overflow-hidden">
                {/* Scene header */}
                <div
                  onClick={() => setExpandedScene(isExpanded ? null : sIdx)}
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-surface-hover/20 transition-colors"
                >
                  {isExpanded ? <ChevronDown className="w-5 h-5 text-fg-subtle" /> : <ChevronRight className="w-5 h-5 text-fg-subtle" />}
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-primary">{scene.sceneNumber}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-fg">{scene.title}</h4>
                    <p className="text-xs text-fg-subtle truncate mt-0.5">{scene.heading}</p>
                  </div>
                  <div className="hidden sm:flex items-center gap-3 text-xs text-fg-subtle">
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{scene.location}</span>
                    <span className="flex items-center gap-1"><Sun className="w-3 h-3" />{scene.timeOfDay}</span>
                    <span className="flex items-center gap-1"><Camera className="w-3 h-3" />{scene.shots.length} shots</span>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />~{scene.estimatedDurationSeconds}s</span>
                  </div>
                </div>

                {/* Expanded scene */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3">
                    {/* Scene edit */}
                    {isEditingScene ? (
                      <div className="space-y-2 p-3 rounded-lg bg-surface-3/40 border border-border/30">
                        <div className="grid grid-cols-2 gap-2">
                          <LabeledInput label="Title" value={scene.title} onChange={(v) => updateScene(sIdx, { title: v })} />
                          <LabeledInput label="Location" value={scene.location} onChange={(v) => updateScene(sIdx, { location: v })} />
                        </div>
                        <LabeledTextarea label="Description" value={scene.description} onChange={(v) => updateScene(sIdx, { description: v })} />
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setEditingScene(null)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-fg text-xs font-medium transition-all">
                            <Save className="w-3 h-3" /> Done
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs text-fg-muted leading-relaxed flex-1">{scene.description}</p>
                        <button onClick={() => setEditingScene(sIdx)} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] text-fg-faint hover:text-fg transition-colors shrink-0">
                          <Edit3 className="w-3 h-3" /> Edit
                        </button>
                      </div>
                    )}

                    {/* Character list */}
                    {scene.characterNames.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] text-fg-faint uppercase tracking-wider">Characters:</span>
                        {scene.characterNames.map((name) => {
                          const match = matches.find((m) => m.screenplayName === name);
                          return (
                            <span key={name} className={cn('text-[10px] px-2 py-0.5 rounded-full', match?.matched ? 'bg-success/10 text-success' : 'bg-surface-hover/60 text-fg-subtle')}>
                              {name}{match?.matched ? ` → ${match.characterName}` : ''}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Shot list */}
                    {step === 'shots' && (
                      <div className="space-y-2 pt-1">
                        <div className="text-[10px] text-fg-faint uppercase tracking-wider">Shots</div>
                        {scene.shots.map((shot, shIdx) => {
                          const shotKey = `${sIdx}-${shIdx}`;
                          const isEditingShot = editingShot === shotKey;
                          return (
                            <div key={shIdx} className="rounded-lg border border-border/30 bg-surface-3/40 p-3">
                              {isEditingShot ? (
                                <ShotEditor
                                  shot={shot}
                                  onSave={(patch) => { updateShot(sIdx, shIdx, patch); setEditingShot(null); }}
                                  onCancel={() => setEditingShot(null)}
                                />
                              ) : (
                                <div className="flex items-start gap-3">
                                  <div className="w-7 h-7 rounded bg-surface-hover/60 flex items-center justify-center shrink-0">
                                    <span className="text-xs font-bold text-primary">{shot.shotLabel}</span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs text-fg font-medium">{shot.purpose}</p>
                                    <p className="text-xs text-fg-muted line-clamp-2 mt-0.5">{shot.description}</p>
                                    {shot.dialogue && <p className="text-[11px] text-fg-faint italic mt-1 line-clamp-1">"{shot.dialogue}" — {shot.speaker}</p>}
                                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                      <MiniBadge icon={Camera} label={shot.cameraAngle} />
                                      <MiniBadge icon={Film} label={shot.cameraMovement} />
                                      <MiniBadge icon={Sun} label={shot.lighting} />
                                      <MiniBadge icon={Clock} label={`${shot.durationSeconds}s`} />
                                    </div>
                                  </div>
                                  <button onClick={() => setEditingShot(shotKey)} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] text-fg-faint hover:text-fg transition-colors shrink-0">
                                    <Edit3 className="w-3 h-3" /> Edit
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            onClick={() => setStep(step === 'shots' ? 'scenes' : 'input')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-surface-hover hover:bg-border-strong text-fg-muted font-medium text-sm transition-all"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="flex items-center gap-2">
            {step === 'scenes' && (
              <button
                onClick={() => setStep('shots')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-hover text-fg font-medium text-sm transition-all shadow-glow"
              >
                Review Shots <ArrowRight className="w-4 h-4" />
              </button>
            )}
            {step === 'shots' && (
              <button
                onClick={handleApprove}
                disabled={isSaving}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-hover text-fg font-medium text-sm transition-all shadow-glow disabled:opacity-50"
              >
                {isSaving ? <Loader className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {isSaving ? 'Saving…' : 'Approve & Save Plan'}
              </button>
            )}
          </div>
        </div>

        {saveError && (
          <div className="p-3 rounded-lg bg-error/5 border border-error/20 flex items-center gap-2 text-xs text-error">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {saveError}
          </div>
        )}
    </div>
  );
}

// ─── Sub-components ───

function StepIndicator({ currentIndex }: { currentIndex: number }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {STEP_FLOW.map((s, i) => (
        <div key={s.id} className="flex items-center gap-1.5">
          {i > 0 && <div className={cn('w-6 h-px', i <= currentIndex ? 'bg-primary' : 'bg-border')} />}
          <span className={cn('font-medium', i < currentIndex ? 'text-success' : i === currentIndex ? 'text-primary' : 'text-fg-faint')}>
            {i < currentIndex && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function Badge({ children, variant = 'default' }: { children: React.ReactNode; variant?: string }) {
  const v: Record<string, string> = {
    default: 'bg-border-strong/60 text-fg-muted',
    success: 'bg-success/15 text-success',
  };
  return <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium', v[variant])}>{children}</span>;
}

function MiniBadge({ icon: Icon, label }: { icon: typeof Camera; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-surface-hover/60 text-[10px] text-fg-subtle">
      <Icon className="w-2.5 h-2.5" /> {label.replace(/-/g, ' ')}
    </span>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[10px] font-medium text-fg-muted mb-1 block uppercase tracking-wider">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.5 py-1.5 rounded-lg bg-surface-3 border border-border text-fg text-xs focus:outline-none focus:border-primary/60 transition-all"
      />
    </div>
  );
}

function LabeledTextarea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[10px] font-medium text-fg-muted mb-1 block uppercase tracking-wider">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full px-2.5 py-1.5 rounded-lg bg-surface-3 border border-border text-fg text-xs focus:outline-none focus:border-primary/60 transition-all resize-y"
      />
    </div>
  );
}

function LabeledSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[10px] font-medium text-fg-muted mb-1 block uppercase tracking-wider">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.5 py-1.5 rounded-lg bg-surface-3 border border-border text-fg text-xs focus:outline-none focus:border-primary/60 transition-all"
      >
        {options.map((o) => <option key={o} value={o}>{o.replace(/-/g, ' ')}</option>)}
      </select>
    </div>
  );
}

function ShotEditor({
  shot,
  onSave,
  onCancel,
}: {
  shot: PlannedShotBreakdown;
  onSave: (patch: Partial<PlannedShotBreakdown>) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(shot);

  return (
    <div className="space-y-2.5">
      <LabeledTextarea label="Description" value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} />
      <div className="grid grid-cols-3 gap-2">
        <LabeledSelect label="Camera Angle" value={draft.cameraAngle} options={CAMERA_ANGLES} onChange={(v) => setDraft({ ...draft, cameraAngle: v as CameraAngle })} />
        <LabeledSelect label="Movement" value={draft.cameraMovement} options={CAMERA_MOVEMENTS} onChange={(v) => setDraft({ ...draft, cameraMovement: v as CameraMovement })} />
        <LabeledSelect label="Lighting" value={draft.lighting} options={LIGHTING_OPTIONS} onChange={(v) => setDraft({ ...draft, lighting: v as Lighting })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <LabeledInput label="Dialogue" value={draft.dialogue} onChange={(v) => setDraft({ ...draft, dialogue: v })} />
        <LabeledInput label="Speaker" value={draft.speaker ?? ''} onChange={(v) => setDraft({ ...draft, speaker: v || null })} />
      </div>
      <LabeledTextarea label="Continuity Notes" value={draft.continuityNotes} onChange={(v) => setDraft({ ...draft, continuityNotes: v })} />
      <LabeledTextarea label="Acting Instructions" value={draft.actingInstructions} onChange={(v) => setDraft({ ...draft, actingInstructions: v })} />
      <div className="grid grid-cols-2 gap-2">
        <LabeledInput label="Duration (s)" value={String(draft.durationSeconds)} onChange={(v) => setDraft({ ...draft, durationSeconds: Number(v) || 5 })} />
        <LabeledInput label="Sound Cues" value={draft.soundCues} onChange={(v) => setDraft({ ...draft, soundCues: v })} />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-hover hover:bg-border-strong text-fg-muted text-xs font-medium transition-all">
          <X className="w-3 h-3" /> Cancel
        </button>
        <button onClick={() => onSave(draft)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-fg text-xs font-medium transition-all">
          <Save className="w-3 h-3" /> Save
        </button>
      </div>
    </div>
  );
}
