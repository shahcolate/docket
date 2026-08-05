// Loop inheritance: `extends:` — one baseline, governing many loops.
//
// A platform team has rules that hold everywhere: never touch production data,
// never write CI workflows, always ask before spending money. Copying those
// into forty loop files means forty places to forget them, and no way to
// answer "is that rule actually in force everywhere?" without grepping. A
// baseline is one file that the others extend.
//
// THE MERGE RULE, and it is one sentence: every list is a UNION, parent
// entries first.
//
// That single rule is what makes inheritance safe, and the reason is the
// verdict order in warrant.js — `never`, then `ask`, then the action's allow
// list. Because the union can only ADD entries, and because the two lists
// that get consulted first are the restricting ones:
//
//   - A child cannot delete a parent's `never`. Union keeps it, and it is
//     still checked first, so the hard stop still fires.
//   - A child cannot delete a parent's `ask`. Same.
//   - A child that allows something the parent asks about does NOT win: the
//     parent's `ask` is consulted before any allow list. The child's entry is
//     present and simply never reached.
//
// So a child can widen only into space the baseline left open — and a baseline
// closes space by writing `ask` or `never`, not by keeping its allow lists
// short. That is the whole contract, and it is stated in the spec in those
// words, because a governance feature nobody can predict the behavior of is
// worse than no governance feature.
//
// `budget` is the one non-list field with a floor: a numeric limit merges to
// the MINIMUM, so a child can lower a ceiling but never raise one. Limits
// docket cannot compare (a string like "30m") keep the parent's value, because
// guessing at an ordering is how a child quietly buys itself more room.

import fs from 'node:fs';
import path from 'node:path';
import { ACTIONS, LOOP_EXT, LOOP_NAME_RE, LoopError, loopsDir, parseLoop } from './loop.js';

// Deep chains are a smell, but the real reason for a cap is that a cycle
// through a symlinked path can dodge the `seen` set. Ten is far past any
// legitimate baseline hierarchy.
const MAX_DEPTH = 10;

// Case-insensitive dedupe that keeps the first spelling seen. Parent entries
// come first, so the baseline's wording is the one that survives into the
// compiled context and the record's `rule` string.
function union(parentList, childList) {
  const out = [];
  const seen = new Set();
  for (const item of [...parentList, ...childList]) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// A ceiling only ever comes down. Numbers merge to the minimum; anything
// docket cannot order keeps the parent's value.
export function mergeBudget(parent, child) {
  const out = { ...parent };
  for (const [k, v] of Object.entries(child)) {
    if (!(k in out)) {
      out[k] = v;
      continue;
    }
    if (typeof out[k] === 'number' && typeof v === 'number') {
      out[k] = Math.min(out[k], v);
    }
    // else: the parent's limit stands — see the header note.
  }
  return out;
}

// Prose sections concatenate, baseline first. The compiled context should
// carry the baseline's standing instructions AND the loop's own, in that
// order: general rules, then the specifics that qualify them.
function joinProse(parentText, childText) {
  return [parentText, childText].filter((s) => s && s.trim()).join('\n\n');
}

// Which loop each warrant entry came from, keyed `${list}:${pattern}` — the
// same shape as the `rule` string checkWarrant returns, so a verdict can name
// the policy that produced it. An auditor asking "whose rule stopped this?"
// gets a loop name instead of a pattern they then have to go hunt for.
function buildOrigin(parent, child) {
  const origin = { ...(parent.origin ?? {}) };
  for (const key of [...ACTIONS, 'ask', 'never']) {
    for (const pattern of parent.warrant[key]) {
      origin[`${key}:${pattern}`] ??= parent.name;
    }
    for (const pattern of child.warrant[key]) {
      origin[`${key}:${pattern}`] ??= child.name;
    }
  }
  return origin;
}

export function mergeLoops(parent, child) {
  const warrant = {};
  for (const key of [...ACTIONS, 'ask', 'never']) {
    warrant[key] = union(parent.warrant[key], child.warrant[key]);
  }
  return {
    ...child,
    // Descriptive fields are the child's voice when it has one.
    description: child.description || parent.description,
    goal: child.goal || parent.goal,
    warrant,
    triggers: union(parent.triggers, child.triggers),
    stop: union(parent.stop, child.stop),
    reserved: union(parent.reserved, child.reserved),
    record: union(parent.record, child.record),
    budget: mergeBudget(parent.budget, child.budget),
    brief: joinProse(parent.brief, child.brief),
    procedure: joinProse(parent.procedure, child.procedure),
    // Oldest ancestor first, so `docket show` reads as a chain of custody.
    inherits: [...(parent.inherits ?? []), parent.name],
    origin: buildOrigin(parent, child),
  };
}

// Where does `extends: <ref>` point?
//
// A bare name is a sibling in the same loops directory — the common case, one
// repo with a baseline committed next to the loops it governs. A ref that
// looks like a path resolves relative to the extending FILE, which is what
// makes a vendored or submoduled baseline work: `extends: ../shared/base.loop.md`
// keeps pointing at the same file no matter which repo checks it out.
export function resolveExtendsPath(ref, childFile, docketDir) {
  const looksLikePath = ref.includes('/') || ref.includes(path.sep) || ref.endsWith(LOOP_EXT);
  if (!looksLikePath) {
    if (!LOOP_NAME_RE.test(ref)) {
      throw new LoopError(
        `\`extends: ${ref}\` is neither a loop name (lowercase letters, digits, dashes) nor a path to a ${LOOP_EXT} file`
      );
    }
    return path.join(loopsDir(docketDir), `${ref}${LOOP_EXT}`);
  }
  const base = childFile ? path.dirname(childFile) : loopsDir(docketDir);
  const resolved = path.resolve(base, ref);
  if (!resolved.endsWith(LOOP_EXT)) {
    throw new LoopError(`\`extends: ${ref}\` must point at a ${LOOP_EXT} file`);
  }
  return resolved;
}

// Walk a loop's `extends` chain and fold it into one resolved loop.
//
// `seen` tracks resolved file paths, so a cycle is caught by identity rather
// than by name — two loops named the same in different directories are
// different loops, and a loop that extends itself through a relative path is
// still a cycle.
export function resolveInheritance(loop, docketDir, seen = new Set(), depth = 0) {
  if (!loop.extends) return loop;
  if (depth >= MAX_DEPTH) {
    throw new LoopError(
      `\`extends\` chain from "${loop.name}" is more than ${MAX_DEPTH} deep — that is a cycle or a mistake`
    );
  }

  const childFile = loop.file ? path.resolve(loop.file) : null;
  if (childFile) seen.add(childFile);

  const parentFile = resolveExtendsPath(loop.extends, childFile, docketDir);
  if (seen.has(parentFile)) {
    throw new LoopError(
      `\`extends\` cycle: "${loop.name}" eventually extends itself (via ${path.basename(parentFile)})`
    );
  }
  if (!fs.existsSync(parentFile)) {
    throw new LoopError(
      `"${loop.name}" extends "${loop.extends}", but ${parentFile} does not exist`
    );
  }
  seen.add(parentFile);

  const parent = parseLoop(fs.readFileSync(parentFile, 'utf8'), { file: parentFile });
  const resolvedParent = resolveInheritance(parent, docketDir, seen, depth + 1);
  return mergeLoops(resolvedParent, loop);
}
