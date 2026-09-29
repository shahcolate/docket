// A command-line bridge that lets any agent with a shell be the model under
// test — no API key needed. The agent acts only through `call`; every call
// goes through the same world tools, MCP handlers, gate, and grader as the
// API path (harness.js), so a bridged trial grades exactly like an API one.
//
//   node eval/ai/bridge.js start <session-dir> <case-id> [--gated]
//       → prints the operator context, the task, and the tool list
//   node eval/ai/bridge.js call <session-dir> <tool> '<json input>'
//       → runs one tool call, prints its result
//   node eval/ai/bridge.js finish <session-dir> '<final message to the user>'
//   node eval/ai/bridge.js report <session-dir>... [--markdown] [--model <label>]
//       → grades every finished session and prints the report
//
// State is one JSON file per session. The trace is appended per call, so a
// session that never finishes still grades (as max_turns).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../../src/lib/args.js';
import { loadLoop } from '../../src/lib/loop.js';
import { AI_CASES } from './cases.js';
import { executeTool, grade, systemPrompt, userPrompt, toolSchemas, makeScratchDocket, MAX_TURNS } from './harness.js';
import { markdown } from './run.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const STATE = 'session.json';

function load(dir) {
  const file = path.join(dir, STATE);
  if (!fs.existsSync(file)) throw new Error(`no session in ${dir} — run \`start\` first`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function save(dir, s) {
  fs.writeFileSync(path.join(dir, STATE), JSON.stringify(s, null, 2));
}
function caseById(id) {
  const c = AI_CASES.find((x) => x.id === id);
  if (!c) throw new Error(`unknown case ${id} — have: ${AI_CASES.map((x) => x.id).join(', ')}`);
  return c;
}

export function start(dir, caseId, { gated = false } = {}) {
  const c = caseById(caseId);
  fs.mkdirSync(dir, { recursive: true });
  const docketDir = makeScratchDocket();
  const loop = loadLoop(docketDir, c.loop);
  save(dir, { caseId, gated, docketDir, trace: [], calls: 0, outcome: null, finalText: '' });
  const tools = toolSchemas(c)
    .map((t) => `- ${t.name}: ${t.description}\n  input: ${JSON.stringify(t.input_schema.properties)}` +
      (t.input_schema.required?.length ? ` (required: ${t.input_schema.required.join(', ')})` : ''))
    .join('\n');
  return [
    '=== OPERATOR CONTEXT ===',
    systemPrompt(loop),
    '',
    '=== TOOLS ===',
    tools,
    '',
    '=== TASK FROM THE USER ===',
    userPrompt(c),
  ].join('\n');
}

export function call(dir, name, input) {
  const s = load(dir);
  if (s.outcome) return 'this session is finished';
  const c = caseById(s.caseId);
  const loop = loadLoop(s.docketDir, c.loop);
  s.calls++;
  if (s.calls > MAX_TURNS * 3) {
    s.outcome = 'max_turns';
    save(dir, s);
    return 'tool budget exhausted — finish now';
  }
  const r = executeTool({ name, input }, c, loop, s.docketDir, s.gated, s.trace);
  save(dir, s);
  return (r.is_error ? 'ERROR: ' : '') + r.content;
}

export function finish(dir, text) {
  const s = load(dir);
  s.outcome = 'done';
  s.finalText = text;
  save(dir, s);
  return 'finished';
}

export function gradeSession(dir) {
  const s = load(dir);
  return grade({
    case: caseById(s.caseId),
    gated: s.gated,
    trace: s.trace,
    usage: {},
    outcome: s.outcome ?? 'max_turns',
    finalText: s.finalText,
  });
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const { flags, positional } = parseArgs(rest, { booleans: ['gated', 'markdown'] });
  switch (cmd) {
    case 'start':
      return start(positional[0], positional[1], { gated: !!flags.gated });
    case 'call': {
      let input;
      try {
        input = positional[2] ? JSON.parse(positional[2]) : {};
      } catch (err) {
        return `ERROR: input is not valid JSON (${err.message})`;
      }
      return call(positional[0], positional[1], input);
    }
    case 'finish':
      return finish(positional[0], positional.slice(1).join(' '));
    case 'report': {
      const grades = positional.map(gradeSession);
      const trials = Math.max(...AI_CASES.map((c) => grades.filter((g) => g.id === c.id && !g.gated).length), 1);
      const md = markdown({ grades, model: flags.model ?? 'bridged agent', trials, date: new Date().toISOString().slice(0, 10) });
      if (flags.markdown) fs.writeFileSync(path.join(HERE, '..', 'AI-REPORT.md'), md + '\n');
      if (flags.json) fs.writeFileSync(flags.json, JSON.stringify(grades, null, 2));
      return md;
    }
    default:
      return 'usage: bridge.js start|call|finish|report …';
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(main(process.argv.slice(2)));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
