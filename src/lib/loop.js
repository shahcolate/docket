// Loop file parsing and validation.
//
// A loop is one recurring task wrapped in five layers:
//   brief     — what the agent must know before it starts   (markdown body)
//   procedure — how this job is done properly               (markdown body)
//   warrant   — what it may read / draft / change / send    (frontmatter)
//   record    — the evidence the agent owes when it stops   (frontmatter)
//   reserved  — what stays with the human, always           (frontmatter)
//
// Plus optional routing metadata:
//   triggers  — phrases that mark a task as this loop's job (frontmatter)

import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from './yaml.js';

export const ACTIONS = ['read', 'draft', 'change', 'send'];
export const VERDICTS = ['allow', 'ask', 'deny'];
export const LOOP_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
export const LOOP_EXT = '.loop.md';
export const SPEC_VERSION = 1;

export class LoopError extends Error {}

export function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    throw new LoopError(
      'loop file must start with a `---` YAML frontmatter block (see spec/SPEC.md)'
    );
  }
  return { frontmatter: m[1], body: m[2] };
}

// Only headings literally named Brief or Procedure delimit sections; every
// other line — subheadings, other sections, comments inside fenced code
// blocks — is content and stays with the section it appears in. Prose the
// human wrote must never be silently dropped from the compiled context.
export function extractSections(body) {
  const sections = {};
  let current = null;
  let inFence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = inFence ? null : line.match(/^#{1,3}\s+(brief|procedure)\s*$/i);
    if (h) {
      current = h[1].toLowerCase();
      sections[current] ??= [];
    } else if (current) {
      sections[current].push(line);
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(sections)) {
    out[k] = v.join('\n').trim();
  }
  return out;
}

// A budget is a small map of scalar limits (tokens, attempts, parallelism,
// time) — the human's cap on how far a run may go before it stops. Scalars
// only, so it stays auditable and never smuggles logic into a limit.
function asScalarMap(value, where) {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new LoopError(`\`${where}\` must be a map of limits (e.g. tokens: 200000)`);
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === null || (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')) {
      throw new LoopError(`\`${where}.${k}\` must be a scalar (a number or a short string)`);
    }
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

function asStringList(value, where) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new LoopError(`\`${where}\` must be a list`);
  }
  return value.map((v) => {
    if (typeof v !== 'string' || !v.trim()) {
      throw new LoopError(`\`${where}\` entries must be non-empty strings`);
    }
    return v.trim();
  });
}

export function parseLoop(text, { file } = {}) {
  const { frontmatter, body } = splitFrontmatter(text);
  let meta;
  try {
    meta = parseYaml(frontmatter);
  } catch (err) {
    throw new LoopError(`${file ? file + ': ' : ''}${err.message}`);
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new LoopError('frontmatter must be a YAML map');
  }
  if (typeof meta.name !== 'string' || !LOOP_NAME_RE.test(meta.name)) {
    throw new LoopError('`name` is required and must be lowercase letters, digits, and dashes');
  }
  if (file) {
    const base = path.basename(file);
    if (base.endsWith(LOOP_EXT) && base !== `${meta.name}${LOOP_EXT}`) {
      throw new LoopError(
        `${base}: frontmatter says \`name: ${meta.name}\` but the file is named ${base} — ` +
          `they must match, or record entries get attributed to a loop that cannot be loaded`
      );
    }
  }
  const version = meta.version ?? SPEC_VERSION;
  if (version !== SPEC_VERSION) {
    throw new LoopError(
      `loop declares version ${version}, but this docket only understands version ${SPEC_VERSION} — upgrade docket`
    );
  }

  const warrantSrc = meta.warrant ?? {};
  if (typeof warrantSrc !== 'object' || Array.isArray(warrantSrc)) {
    throw new LoopError('`warrant` must be a map of action lists');
  }
  const warrant = {};
  for (const action of ACTIONS) {
    warrant[action] = asStringList(warrantSrc[action], `warrant.${action}`);
  }
  warrant.ask = asStringList(warrantSrc.ask, 'warrant.ask');
  warrant.never = asStringList(warrantSrc.never, 'warrant.never');

  for (const key of Object.keys(warrantSrc)) {
    if (![...ACTIONS, 'ask', 'never'].includes(key)) {
      throw new LoopError(
        `warrant.${key} is not a thing — actions are read/draft/change/send, plus ask/never lists`
      );
    }
  }

  const sections = extractSections(body);
  if (meta.goal !== undefined && (typeof meta.goal !== 'string' || !meta.goal.trim())) {
    throw new LoopError('`goal` must be a non-empty string — the outcome the loop is trying to reach');
  }

  const loop = {
    name: meta.name,
    description: typeof meta.description === 'string' ? meta.description : '',
    version,
    // The agent contract: the outcome (goal), what it may do (warrant), when
    // to stop (stop), what stays human (reserved), what it must prove
    // (record), and the ceiling on the run (budget).
    goal: typeof meta.goal === 'string' ? meta.goal.trim() : '',
    warrant,
    triggers: asStringList(meta.triggers, 'triggers'),
    stop: asStringList(meta.stop, 'stop'),
    budget: asScalarMap(meta.budget, 'budget'),
    reserved: asStringList(meta.reserved, 'reserved'),
    record: asStringList(meta.record, 'record'),
    brief: sections.brief ?? '',
    procedure: sections.procedure ?? '',
    file: file ?? null,
  };
  return loop;
}

export function findDocketDir(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, '.docket');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireDocketDir(startDir = process.cwd()) {
  const dir = findDocketDir(startDir);
  if (!dir) {
    throw new LoopError('no .docket directory found — run `docket init` first');
  }
  return dir;
}

export function loopsDir(docketDir) {
  return path.join(docketDir, 'loops');
}

export function loopFile(docketDir, name) {
  return path.join(loopsDir(docketDir), `${name}${LOOP_EXT}`);
}

export function loopNames(docketDir) {
  const dir = loopsDir(docketDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(LOOP_EXT))
    .map((f) => f.slice(0, -LOOP_EXT.length))
    .sort();
}

export function loopExists(docketDir, name) {
  return LOOP_NAME_RE.test(name) && fs.existsSync(loopFile(docketDir, name));
}

export function listLoops(docketDir) {
  const dir = loopsDir(docketDir);
  if (!fs.existsSync(dir)) return [];
  const loops = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.endsWith(LOOP_EXT)) continue;
    const file = path.join(dir, entry);
    loops.push(parseLoop(fs.readFileSync(file, 'utf8'), { file }));
  }
  return loops;
}

export function loadLoop(docketDir, name) {
  const file = loopFile(docketDir, name);
  if (!fs.existsSync(file)) {
    // Names come from filenames, not parses, so one broken sibling loop
    // can't mask the real "no such loop" message.
    const available = loopNames(docketDir);
    throw new LoopError(
      `no loop named "${name}"${available.length ? ` — have: ${available.join(', ')}` : ' — create one with \`docket new\`'}`
    );
  }
  return parseLoop(fs.readFileSync(file, 'utf8'), { file });
}
