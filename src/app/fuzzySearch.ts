/** Small, dependency-free fuzzy ranking for local navigation surfaces. */

export interface FuzzySearchCandidate<T> {
  value: T;
  texts: readonly string[];
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

function textScore(text: string, term: string): number | null {
  if (!text || !term) return null;
  if (text === term) return 1_200;
  if (text.startsWith(term)) {
    return 1_000 - Math.min(120, text.length - term.length);
  }

  const containedAt = text.indexOf(term);
  if (containedAt >= 0) {
    return (
      800 -
      Math.min(180, containedAt * 4) -
      Math.min(80, text.length - term.length)
    );
  }

  let cursor = 0;
  let start = -1;
  let gaps = 0;
  let adjacent = 0;
  let previous = -1;
  for (const character of term) {
    const found = text.indexOf(character, cursor);
    if (found < 0) return null;
    if (start < 0) start = found;
    if (previous >= 0) {
      const gap = found - previous - 1;
      gaps += gap;
      if (gap === 0) adjacent += 1;
    }
    previous = found;
    cursor = found + character.length;
  }

  return (
    420 -
    Math.min(160, start * 3) -
    Math.min(220, gaps * 8) +
    adjacent * 12
  );
}

export function fuzzySearch<T>(
  query: string,
  candidates: readonly FuzzySearchCandidate<T>[],
  limit = 10,
): T[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0 || limit <= 0) return [];

  return candidates
    .map((candidate, order) => {
      const texts = candidate.texts.map(normalize).filter(Boolean);
      let score = 0;
      for (const term of terms) {
        let best: number | null = null;
        texts.forEach((text, index) => {
          const match = textScore(text, term);
          if (match === null) return;
          const weighted = match + Math.max(0, 36 - index * 8);
          best = best === null ? weighted : Math.max(best, weighted);
        });
        if (best === null) return null;
        score += best;
      }
      return { value: candidate.value, score, order };
    })
    .filter(
      (result): result is { value: T; score: number; order: number } =>
        result !== null,
    )
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, limit)
    .map((result) => result.value);
}
