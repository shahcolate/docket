// Property suite: permission must be EARNED by covering an allow pattern —
// it is never inherited by vagueness and never granted to noise.
//
// Two generators, both deterministic:
//
//   Vague-target probes — for every allow pattern in every shipped template,
//   every proper subset of its content words (each single word, each
//   leave-one-out set) is tried as a target. A vague target must not inherit
//   the specific entry's permission. ("email" must never inherit from
//   "status email to the team".)
//
//   Fuzzed targets — thousands of seeded word-salad targets built from a
//   vocabulary verified (by the matcher's own stemming) to share no content
//   word with any allow entry. Zero of them may be allowed, across every
//   loop and every verb.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLoop, ACTIONS } from '../src/lib/loop.js';
import { checkWarrant, contentWords, sameWord, alternatives } from '../src/lib/warrant.js';

const ROOT = path.join(fileURLToPath(new URL('.', import.meta.url)), '..');

export function loadTemplateLoops() {
  const loops = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'templates'))) {
    if (!f.endsWith('.loop.md')) continue;
    loops.push(parseLoop(fs.readFileSync(path.join(ROOT, 'templates', f), 'utf8'), { file: f }));
  }
  return loops;
}

// A probe that fully covers a DIFFERENT allow alternative has legitimately
// earned that permission — only coverage-free allows are violations.
function coversSomeAlternative(probeWords, probe, loop, action) {
  for (const pattern of loop.warrant[action]) {
    for (const alt of alternatives(pattern.toLowerCase())) {
      const altWords = contentWords(alt);
      if (!altWords.length) continue;
      if (probe.includes(alt)) return true;
      if (altWords.every((aw) => probeWords.some((pw) => sameWord(aw, pw)))) return true;
    }
  }
  return false;
}

export function runVagueProbes() {
  const loops = loadTemplateLoops();
  let probes = 0;
  const violations = [];
  for (const loop of loops) {
    for (const action of ACTIONS) {
      for (const pattern of loop.warrant[action]) {
        for (const alt of alternatives(pattern.toLowerCase())) {
          const words = contentWords(alt);
          if (words.length < 2) continue; // a single word has no proper subset
          const subsets = words.map((w) => [w]); // each single word
          if (words.length > 2) {
            for (let i = 0; i < words.length; i++) {
              subsets.push(words.filter((_, j) => j !== i)); // each leave-one-out
            }
          }
          for (const subset of subsets) {
            const target = subset.join(' ');
            probes++;
            const { verdict, rule } = checkWarrant(loop, action, target);
            if (verdict === 'allow' && !coversSomeAlternative(subset, target, loop, action)) {
              violations.push({ loop: loop.name, action, target, from: pattern, rule });
            }
          }
        }
      }
    }
  }
  return { probes, violations };
}

// Deterministic LCG — the suite must produce the same targets on every run.
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// Candidate vocabulary: everyday words far from the templates' domains.
// Filtered below through the matcher's own stemming against every allow
// word, so no fuzz target can legitimately cover an allow pattern.
const CANDIDATES = (
  'walrus nebula quasar granite fjord tundra mango sitar oboe ferry ' +
  'lantern pylon comet badger orchid velvet copper krill sonnet gulch ' +
  'yurt zephyr marble falcon juniper anchor barrel cactus dolphin ember ' +
  'glacier hammock igloo jigsaw kettle lagoon meadow nutmeg otter parka ' +
  'quartz raccoon saddle tulip umbrella vulture wagon xylophone yacht zebra ' +
  'harbor island jungle kayak lighthouse mountain ' +
  'urgent quickly please immediately just simply now'
).split(/\s+/);

export function runFuzz({ seed = 20260704, count = 10000 } = {}) {
  const loops = loadTemplateLoops();
  const allowWords = new Set();
  for (const loop of loops) {
    for (const action of ACTIONS) {
      for (const pattern of loop.warrant[action]) {
        for (const w of contentWords(pattern.toLowerCase())) allowWords.add(w);
      }
    }
  }
  const vocab = CANDIDATES.filter((w) => ![...allowWords].some((aw) => sameWord(w, aw)));
  const rand = lcg(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  let allowed = 0;
  const samples = [];
  for (let i = 0; i < count; i++) {
    const len = 2 + Math.floor(rand() * 6);
    const target = Array.from({ length: len }, () => pick(vocab)).join(' ');
    const loop = pick(loops);
    const action = pick(ACTIONS);
    const { verdict } = checkWarrant(loop, action, target);
    if (verdict === 'allow') {
      allowed++;
      if (samples.length < 5) samples.push({ loop: loop.name, action, target });
    }
  }
  return { count, vocabSize: vocab.length, allowed, samples, seed };
}
