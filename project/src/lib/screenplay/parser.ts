// Deterministic screenplay parser.
//
// This is NOT an AI model. It is a rule-based parser that recognizes
// standard screenplay formatting conventions (Fountain-adjacent):
//   - Scene headings: INT./EXT. LOCATION - TIME
//   - Action/description lines
//   - Character cues (ALL CAPS, centered-ish)
//   - Parentheticals (word)
//   - Dialogue blocks
//   - Transitions (CUT TO:, FADE OUT., etc.)
//   - Voiceover markers (V.O.), off-screen (O.S. / O.S.C.)
//
// It preserves the original text in each scene's rawText so nothing
// is lost. It handles arbitrarily long screenplays — there is no
// truncation or character limit.

import type {
  ParsedScene, ParsedDialogue, ParsedCharacter, ParsedProp,
  ScreenplayAnalysis, TimeOfDay, SceneInterior,
} from './types';

const SCENE_HEADING_RE = /^(INT\.|EXT\.|INT\.\/EXT\.|INT\/EXT\.|I\/E\.)\s+(.+)$/i;
const TRANSITION_RE = /^(CUT TO:|FADE TO:|FADE IN:|FADE OUT\.|SMASH CUT:|DISSOLVE TO:|MATCH CUT:|JUMP CUT:|WIPE TO:|IRIS OUT\.|INTERCUT:)/i;
const PARENTHETICAL_RE = /^\((.+)\)$/;
const VOICEOVER_RE = /\(?(V\.?O\.?|VOICE\s*OVER)\)?$/i;

function parseTimeOfDay(raw: string): TimeOfDay {
  const lower = raw.toLowerCase().trim();
  if (lower === '' || lower === 'later') return 'unknown';
  if (lower === 'continuous' || lower === 'continuous shot') return 'continuous';
  if (lower.includes('night')) return 'night';
  if (lower.includes('dawn')) return 'dawn';
  if (lower.includes('dusk') || lower.includes('sunset') || lower.includes('evening')) return 'evening';
  if (lower.includes('morning') || lower.includes('sunrise')) return 'morning';
  if (lower.includes('day')) return 'day';
  return 'unknown';
}

function parseInterior(raw: string): SceneInterior {
  const lower = raw.toUpperCase();
  if (lower.startsWith('INT.')) return 'interior';
  if (lower.startsWith('EXT.')) return 'exterior';
  return 'mixed';
}

function parseHeading(heading: string): {
  location: string;
  timeOfDay: TimeOfDay;
  interior: SceneInterior;
} {
  const match = heading.match(SCENE_HEADING_RE);
  if (!match) return { location: heading, timeOfDay: 'unknown', interior: 'mixed' };
  const interior = parseInterior(match[1]);
  const rest = match[2];
  const dashIdx = rest.lastIndexOf(' - ');
  const location = dashIdx > 0 ? rest.slice(0, dashIdx).trim() : rest.trim();
  const timeRaw = dashIdx > 0 ? rest.slice(dashIdx + 3).trim() : '';
  return { location, timeOfDay: parseTimeOfDay(timeRaw), interior };
}

function isCharacterCue(line: string, nextLine: string | undefined): boolean {
  if (!line || line.length > 45) return false;
  if (line !== line.toUpperCase()) return false;
  if (!/[A-Z]/.test(line)) return false;
  if (line.endsWith('.')) return false;
  if (SCENE_HEADING_RE.test(line)) return false;
  if (TRANSITION_RE.test(line)) return false;
  if (PARENTHETICAL_RE.test(line)) return false;
  if (nextLine === undefined || nextLine === '') return false;
  return true;
}

function cleanSpeaker(raw: string): string {
  let s = raw.replace(/\(?(V\.?O\.?|O\.?S\.?|O\.?C\.?|CONT'D)\)?\.?$/gi, '').trim();
  s = s.replace(/\s+/g, ' ');
  return s;
}

const COMMON_PROPS = [
  'phone', 'gun', 'knife', 'sword', 'briefcase', 'letter', 'book',
  'map', 'key', 'keys', 'car', 'truck', 'motorcycle', 'boat', 'ring',
  'necklace', 'photograph', 'photo', 'camera', 'laptop', 'computer',
  'newspaper', 'journal', 'diary', 'envelope', 'bottle', 'glass',
  'cup', 'door', 'window', 'mirror', 'clock', 'watch', 'wallet',
  'badge', 'flashlight', 'radio', 'microphone', 'guitar', 'piano',
];

function extractProps(actionLines: string[], sceneNumber: number, props: Map<string, number[]>): void {
  const text = actionLines.join(' ').toLowerCase();
  for (const prop of COMMON_PROPS) {
    const re = new RegExp(`\\b${prop}\\b`, 'gi');
    if (re.test(text)) {
      const arr = props.get(prop) ?? [];
      if (!arr.includes(sceneNumber)) arr.push(sceneNumber);
      props.set(prop, arr);
    }
  }
}

export function parseScreenplay(text: string): ScreenplayAnalysis {
  const lines = text.split(/\r?\n/);
  const trimmedLines = lines.map((l) => l.trim());

  const scenes: ParsedScene[] = [];
  let current: ParsedScene | null = null;
  let currentRawLines: string[] = [];
  let currentStartLine = 0;

  const characterMap = new Map<string, ParsedCharacter>();
  const propsMap = new Map<string, number[]>();
  const locationMap = new Map<string, number[]>();

  function pushScene() {
    if (!current) return;
    current.rawText = currentRawLines.join('\n');
    current.endLine = currentStartLine + currentRawLines.length - 1;

    extractProps(current.actionLines, current.number, propsMap);

    if (!locationMap.has(current.location)) locationMap.set(current.location, []);
    if (!locationMap.get(current.location)!.includes(current.number)) {
      locationMap.get(current.location)!.push(current.number);
    }

    scenes.push(current);
  }

  function trackCharacter(name: string, speaks: boolean, sceneNumber: number) {
    const clean = cleanSpeaker(name);
    if (!clean || clean.length < 2) return;
    const existing = characterMap.get(clean);
    if (existing) {
      existing.lineCount += speaks ? 1 : 0;
      if (!existing.appearances.some((a) => a.sceneNumber === sceneNumber)) {
        existing.appearances.push({ sceneNumber, speaks });
      } else if (speaks) {
        const app = existing.appearances.find((a) => a.sceneNumber === sceneNumber);
        if (app) app.speaks = true;
      }
    } else {
      characterMap.set(clean, {
        name: clean,
        appearances: [{ sceneNumber, speaks }],
        lineCount: speaks ? 1 : 0,
      });
    }
  }

  let i = 0;
  while (i < trimmedLines.length) {
    const line = trimmedLines[i];
    const isEmpty = line === '';

    if (!isEmpty) {
      if (current) {
        currentRawLines.push(lines[i]);
      } else {
        currentRawLines.push(lines[i]);
      }
    } else if (current) {
      currentRawLines.push('');
    }

    if (isEmpty) { i++; continue; }

    const headingMatch = line.match(SCENE_HEADING_RE);
    if (headingMatch) {
      pushScene();
      const meta = parseHeading(line);
      current = {
        number: scenes.length + 1,
        heading: line,
        location: meta.location,
        interior: meta.interior,
        timeOfDay: meta.timeOfDay,
        actionLines: [],
        dialogue: [],
        transitions: [],
        rawText: '',
        startLine: i + 1,
        endLine: i + 1,
      };
      currentRawLines = [lines[i]];
      currentStartLine = i;
      i++;
      continue;
    }

    if (TRANSITION_RE.test(line)) {
      if (current) {
        current.transitions.push(line);
      }
      i++;
      continue;
    }

    if (current) {
      const nextLine = i + 1 < trimmedLines.length ? trimmedLines[i + 1] : undefined;
      if (isCharacterCue(line, nextLine)) {
        const rawSpeaker = line;
        const isVO = VOICEOVER_RE.test(rawSpeaker);
        const speaker = cleanSpeaker(rawSpeaker);

        let parenthetical: string | undefined;
        const dialogueText: string[] = [];
        i++;
        while (i < trimmedLines.length) {
          const d = trimmedLines[i];
          if (d === '' || SCENE_HEADING_RE.test(d) || TRANSITION_RE.test(d)) break;
          if (!parenthetical && PARENTHETICAL_RE.test(d) && dialogueText.length === 0) {
            parenthetical = d.slice(1, -1).trim();
            i++;
            continue;
          }
          if (isCharacterCue(d, trimmedLines[i + 1])) break;
          dialogueText.push(d);
          i++;
        }

        const text = dialogueText.join(' ').trim();
        if (text) {
          const entry: ParsedDialogue = {
            speaker,
            text,
            isVoiceover: isVO,
            parenthetical,
          };
          current.dialogue.push(entry);
          trackCharacter(speaker, true, current.number);
        }
        continue;
      }

      current.actionLines.push(line);
      const charMention = line.match(/^([A-Z][A-Z\s]{1,40})(?:\s+(?:enters|exits|appears|walks|stands|sits))\b/);
      if (charMention) {
        const name = cleanSpeaker(charMention[1].trim());
        trackCharacter(name, false, current.number);
      }
    }

    i++;
  }

  pushScene();

  const characters = Array.from(characterMap.values()).sort((a, b) => b.lineCount - a.lineCount);
  const props: ParsedProp[] = Array.from(propsMap.entries()).map(([name, scenes]) => ({ name, scenes }));
  const locations = Array.from(locationMap.entries()).map(([name, scenes]) => ({ name, scenes }));

  return {
    scenes,
    characters,
    props,
    locations,
    totalLines: lines.length,
    sourceText: text,
  };
}
