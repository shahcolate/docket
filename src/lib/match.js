// Loop routing: which loop covers this task?
//
// Rules scale on disk, not in context — the agent holds a one-line-per-loop
// index and pulls one loop at a time, so something has to answer "which one?"
// deterministically. Scoring is lexical and integer-weighted, reusing the
// warrant's cautious matcher.
//
// The warrant's asymmetry principle inverts at routing time. Over-retrieval
// costs one extra index line pulled into context; under-retrieval just means
// the agent works without its procedure — and the warrant check still catches
// the miss downstream. So matching is generous. But when NOTHING clears the
// bar, the answer is not "best guess": it is "no loop covers this — ask".
// Retrieval fails closed, exactly like the warrant.

import { matchPattern, contentWords, sameWord } from './warrant.js';
import { ACTIONS } from './loop.js';

// Integer weights, most author-intentional signal first. A name or trigger
// hit qualifies a loop on its own; description overlap and warrant-target
// hits must accumulate to MIN_SCORE, so one shared word ("email") never
// routes on its own.
const WEIGHT = { name: 5, trigger: 4, warrant: 1, description: 1 };
const WARRANT_CAP = 3;
const DESCRIPTION_CAP = 3;
export const MIN_SCORE = 3;

// Distinct content words of `a` that also appear (under stemming) in `b`.
function overlapCount(a, b) {
  const aWords = [...new Set(contentWords(a.toLowerCase()))];
  const bWords = contentWords(b.toLowerCase());
  return aWords.filter((aw) => bWords.some((bw) => sameWord(aw, bw))).length;
}

export function scoreLoop(loop, intent) {
  const hits = [];
  let score = 0;

  // The loop's own name, read as a phrase ("insurance-appeal" → "insurance appeal").
  if (matchPattern(loop.name.replace(/-/g, ' '), intent)) {
    score += WEIGHT.name;
    hits.push({ field: 'name', pattern: loop.name });
  }

  // Triggers are the author saying "tasks like this are mine" — the loudest
  // routing signal a loop file can carry.
  for (const trigger of loop.triggers) {
    if (matchPattern(trigger, intent)) {
      score += WEIGHT.trigger;
      hits.push({ field: 'trigger', pattern: trigger });
    }
  }

  // Warrant targets are routing evidence too: a loop that names "denial
  // letter" under read probably owns tasks about denial letters. Capped so a
  // long warrant can't outshout an explicit trigger on another loop.
  let warrantHits = 0;
  for (const key of [...ACTIONS, 'ask', 'never']) {
    for (const pattern of loop.warrant[key]) {
      if (warrantHits >= WARRANT_CAP) break;
      if (matchPattern(pattern, intent)) {
        warrantHits += 1;
        score += WEIGHT.warrant;
        hits.push({ field: `warrant.${key}`, pattern });
      }
    }
  }

  const shared = overlapCount(intent, loop.description);
  if (shared > 0) {
    score += Math.min(shared, DESCRIPTION_CAP) * WEIGHT.description;
    hits.push({
      field: 'description',
      pattern: `${shared} shared word${shared === 1 ? '' : 's'}`,
    });
  }

  return { score, hits };
}

// Rank loops against an intent; only candidates at or above MIN_SCORE count.
// Deterministic: score descending, then name — same intent, same ranking.
export function matchLoops(loops, intent, { limit = 3 } = {}) {
  return loops
    .map((loop) => ({ loop, ...scoreLoop(loop, intent) }))
    .filter((c) => c.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.loop.name.localeCompare(b.loop.name))
    .slice(0, limit);
}
