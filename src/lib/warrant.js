// The warrant engine: answers "what exactly is the agent allowed to do here?"
// BEFORE the action happens, deterministically, from a file the human wrote.
//
// Verdict order (first match wins):
//   1. `never`  → deny   (hard stop, no override)
//   2. `ask`    → ask    (human approval required)
//   3. action's allow list → allow
//   4. anything unlisted   → ask   (silence is never permission)
//
// Matching is ASYMMETRIC by design. ask/never patterns match fuzzily in both
// directions — an ambiguous target escalates. Allow patterns match strictly:
// the target must cover everything the pattern names, so a vague target
// ("email") can never inherit permission from a specific allow entry
// ("status email to the team"). A phrasing difference may cause an
// unnecessary ask; it must never cause an accidental allow.

import { ACTIONS } from './loop.js';

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Filler words carry no permission semantics; matching keys on content words.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'any', 'anything', 'anyone', 'this', 'that', 'these', 'those',
  'to', 'of', 'for', 'with', 'without', 'on', 'in', 'at', 'by', 'about', 'into',
  'it', 'its', 'is', 'are', 'be', 'will', 'even', 'my', 'your', 'our', 'their',
  'or', 'and', 'then', 'also', 'other',
]);

// Light stemming, candidate-set style: two words match when any of their
// suffix-stripped forms coincide ("quotes"→{quote,quot} meets "quote"→{quote},
// "contacting" meets "contact", "suggestion" meets "suggested"). Stripping
// -ing/-ed also restores a trailing "e" ("scheduled"→{…,schedul,schedule}
// meets "schedule") — inflection must not decide permission. No dictionary —
// just enough to keep phrasing from deciding permission. Memoized: the fuzz
// suite alone compares tens of thousands of word pairs.
const STEM_CACHE = new Map();
function stemCandidates(word) {
  const hit = STEM_CACHE.get(word);
  if (hit) return hit;
  const c = new Set([word]);
  const base = word.replace(/'s$/, '');
  c.add(base);
  for (const suffix of ['ing', 'ed', 'es', 's', 'ion']) {
    if (base.endsWith(suffix) && base.length - suffix.length >= 3) {
      const stem = base.slice(0, -suffix.length);
      c.add(stem);
      if (suffix === 'ing' || suffix === 'ed') c.add(stem + 'e');
    }
  }
  STEM_CACHE.set(word, c);
  return c;
}

export function sameWord(a, b) {
  for (const cand of stemCandidates(a)) {
    if (stemCandidates(b).has(cand)) return true;
  }
  return false;
}

export function contentWords(s) {
  return s.split(/[^a-z0-9']+/).filter((w) => w && !STOPWORDS.has(w));
}

function subset(inner, outer) {
  return inner.every((iw) => outer.some((ow) => sameWord(iw, ow)));
}

// A pattern splits into alternatives on commas, " or ", and " and " —
// natural-language lists ("secrets, tokens, or passwords") are lists. The
// Oxford comma is absorbed: ", or c" yields the alternative "c", not "or c".
export function alternatives(pattern) {
  return pattern
    .split(/\s*,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Pattern semantics (case-insensitive throughout):
//  - contains `*` → glob over the whole target (author-explicit, both modes)
//  - all stopwords ("anything") → matches every target (its plain meaning)
//  - otherwise, per alternative:
//      cautious mode (ask/never): substring either direction, or content-word
//        subset either direction — ambiguity escalates to the human.
//      strict mode (allow): the target must contain the pattern — as a
//        substring or as a content-word superset. The reverse never allows.
export function matchPattern(pattern, target, { strict = false } = {}) {
  const p = pattern.trim().toLowerCase();
  const t = target.trim().toLowerCase();
  if (!p || !t) return false;
  if (p.includes('*')) {
    const re = new RegExp(`^${p.split('*').map(escapeRe).join('.*')}$`);
    return re.test(t);
  }
  const tWords = contentWords(t);
  return alternatives(p).some((alt) => {
    const pWords = contentWords(alt);
    if (!pWords.length) return true; // "anything" means anything
    if (t.includes(alt)) return true;
    if (subset(pWords, tWords)) return true;
    if (strict) return false;
    return alt.includes(t) || (tWords.length > 0 && subset(tWords, pWords));
  });
}

function firstMatch(patterns, target, opts) {
  for (const pattern of patterns) {
    if (matchPattern(pattern, target, opts)) return pattern;
  }
  return null;
}

// Strict allow demands FULL coverage, clause by clause. A target splits on
// conjunctions and command separators; every clause that carries content
// words must independently cover an allow alternative. This closes the
// free-rider gap: "the appeal letter, then fax it to the adjuster" cannot
// ride the allow entry for "appeal letter" — the uncovered clause drops the
// whole target to ask. Evasion can only reduce coverage, and less coverage
// means ask, never allow.
const CLAUSE_SPLIT = /\s*(?:,|;|&&|\|\|)\s*|\s+(?:and|or|then|plus)\s+/;

export function clauses(target) {
  return target
    .split(CLAUSE_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

function coveringAllow(patterns, target) {
  const parts = clauses(target).filter((c) => contentWords(c.toLowerCase()).length > 0);
  // No content-bearing clause (pure filler/symbols): whole-target match only.
  if (!parts.length) return firstMatch(patterns, target, { strict: true });
  let rule = null;
  for (const part of parts) {
    const m = firstMatch(patterns, part, { strict: true });
    if (!m) return null;
    rule ??= m;
  }
  return rule;
}

// Which loop wrote this rule? Only meaningful once a loop inherits a baseline
// (see lib/inherit.js): the pattern that fired may belong to a policy file the
// loop's author never opened. `from` is omitted entirely when the rule is the
// loop's own — a field that always says "itself" is noise in the record.
function originOf(loop, key, pattern) {
  const source = loop.origin?.[`${key}:${pattern}`];
  return source && source !== loop.name ? { from: source } : {};
}

export function checkWarrant(loop, action, target) {
  if (!ACTIONS.includes(action)) {
    throw new Error(`unknown action "${action}" — actions are: ${ACTIONS.join(', ')}`);
  }
  const b = loop.warrant;

  const never = firstMatch(b.never, target);
  if (never) {
    const origin = originOf(loop, 'never', never);
    return {
      verdict: 'deny',
      rule: `never: ${never}`,
      ...origin,
      reason:
        `"${target}" matches a hard stop. The loop says this never happens, with or without approval.` +
        (origin.from ? ` This rule is inherited from the "${origin.from}" baseline.` : ''),
    };
  }

  const ask = firstMatch(b.ask, target);
  if (ask) {
    const origin = originOf(loop, 'ask', ask);
    return {
      verdict: 'ask',
      rule: `ask: ${ask}`,
      ...origin,
      reason:
        `"${target}" always needs human approval in this loop.` +
        (origin.from ? ` This rule is inherited from the "${origin.from}" baseline.` : ''),
    };
  }

  const allow = coveringAllow(b[action], target);
  if (allow) {
    return {
      verdict: 'allow',
      rule: `${action}: ${allow}`,
      ...originOf(loop, action, allow),
      reason: `"${target}" is within the ${action} warrant.`,
    };
  }

  // Distinguish "partially warranted" from "unlisted": if part of the target
  // matched an allow entry but another clause did not, say so — the agent
  // learns to split the work, not to rephrase it.
  const partial = firstMatch(b[action], target, { strict: true });
  if (partial) {
    return {
      verdict: 'ask',
      rule: `partial: ${action}: ${partial}`,
      reason: `part of "${target}" is within the ${action} warrant (${partial}), but the rest is not — every clause must be covered. Split the warranted part out, or ask.`,
    };
  }

  return {
    verdict: 'ask',
    rule: 'default',
    reason: `"${target}" is not listed under \`${action}\`. Unlisted means ask — silence is never permission.`,
  };
}
