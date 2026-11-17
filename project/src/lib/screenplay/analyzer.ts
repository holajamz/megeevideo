// Screenplay analyzer: orchestrates the analysis pipeline.
//
// The deterministic analyzer parses the screenplay, plans shots, and
// matches characters using the modules above. It does NOT call any AI
// API — it is a rule-based system that honestly reports `usedAI: false`.
//
// An AI-based analyzer can be connected later by implementing the
// ScreenplayAnalyzer interface and swapping the implementation. The
// interface is designed so the same AnalysisResult shape is produced
// regardless of whether a deterministic parser or an AI provider did
// the work.

import { parseScreenplay } from './parser';
import { planBreakdown } from './shot-planner';
import { matchCharacters } from './character-matcher';
import type { ScreenplayAnalyzer, AnalysisResult, AnalyzeOptions } from './types';

export class DeterministicAnalyzer implements ScreenplayAnalyzer {
  async analyze(
    sourceText: string,
    options: AnalyzeOptions,
  ): Promise<AnalysisResult> {
    const analysis = parseScreenplay(sourceText);
    const breakdown = planBreakdown(analysis);

    const allNames = analysis.characters.map((c) => c.name);
    const characterMatches = matchCharacters(allNames, options.existingCharacters);

    const warnings: string[] = [];
    if (analysis.scenes.length === 0) {
      warnings.push('No scenes were detected. The input may not follow standard screenplay formatting (INT./EXT. scene headings).');
    }
    const unmatched = characterMatches.filter((m) => !m.matched);
    if (unmatched.length > 0) {
      warnings.push(`${unmatched.length} character(s) from the screenplay did not match existing character records. They will be listed for manual assignment.`);
    }

    return {
      analysis,
      breakdown,
      characterMatches,
      usedAI: false,
      warnings,
    };
  }
}

export { type ScreenplayAnalyzer, type AnalysisResult, type AnalyzeOptions } from './types';
