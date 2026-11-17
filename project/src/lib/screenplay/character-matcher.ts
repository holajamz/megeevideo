// Character matcher: connects screenplay character names to existing
// character records in the database. Uses fuzzy name matching so
// "ELENA" in a screenplay links to an existing "Elena Vance" record.
// Does NOT invent reference images or claim visual consistency is
// implemented — it only matches names.

import type { CharacterMatch } from './types';

function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/[.]/g, '').replace(/\s+/g, ' ');
}

function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1.0;
  const aFirst = na.split(' ')[0];
  const bFirst = nb.split(' ')[0];
  if (aFirst === bFirst) return 0.8;
  if (aFirst.length > 2 && bFirst.includes(aFirst)) return 0.7;
  if (bFirst.length > 2 && aFirst.includes(bFirst)) return 0.7;
  return 0;
}

export function matchCharacters(
  screenplayNames: string[],
  existing: { id: string; name: string }[],
): CharacterMatch[] {
  return screenplayNames.map((screenplayName) => {
    let best: { id: string; name: string; score: number } | null = null;
    for (const ex of existing) {
      const score = nameSimilarity(screenplayName, ex.name);
      if (score > 0.6 && (!best || score > best.score)) {
        best = { id: ex.id, name: ex.name, score };
      }
    }
    return {
      screenplayName,
      characterId: best?.id ?? null,
      characterName: best?.name ?? null,
      matched: best !== null,
    };
  });
}
