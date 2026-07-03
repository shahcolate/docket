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
]);

// Light stemming, candidate-set style: two words match when any of their
// suffix-stripped forms coincide ("quotes"→{quote,quot} meets "quote"→{quote},
// "contacting" meets "contact"). No dictionary — just enough to keep
// phrasing from deciding permission.
function stemCandidates(word) {
  const c = new Set([word]);
  const base = word.replace(/'s$/, '');
  c.add(base);
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (base.endsWith(suffix) && base.length - suffix.length >= 3) {
      c.add(base.slice(0, -suffix.length));
    }
  }
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
// natural-language lists ("secrets, tokens, or passwords") are lists.
function alternatives(pattern) {
  return pattern
    .split(/\s*,\s*|\s+or\s+|\s+and\s+/)
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

export function checkWarrant(loop, action, target) {
  if (!ACTIONS.includes(action)) {
    throw new Error(`unknown action "${action}" — actions are: ${ACTIONS.join(', ')}`);
  }
  const b = loop.warrant;

  const never = firstMatch(b.never, target);
  if (never) {
    return {
      verdict: 'deny',
      rule: `never: ${never}`,
      reason: `"${target}" matches a hard stop. The loop says this never happens, with or without approval.`,
    };
  }

  const ask = firstMatch(b.ask, target);
  if (ask) {
    return {
      verdict: 'ask',
      rule: `ask: ${ask}`,
      reason: `"${target}" always needs human approval in this loop.`,
    };
  }

  const allow = firstMatch(b[action], target, { strict: true });
  if (allow) {
    return {
      verdict: 'allow',
      rule: `${action}: ${allow}`,
      reason: `"${target}" is within the ${action} warrant.`,
    };
  }

  return {
    verdict: 'ask',
    rule: 'default',
    reason: `"${target}" is not listed under \`${action}\`. Unlisted means ask — silence is never permission.`,
  };
}
