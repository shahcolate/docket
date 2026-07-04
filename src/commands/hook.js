// `docket hook` — the warrant as a Claude Code PreToolUse gate.
//
// Claude Code pipes every intercepted tool call to this command as JSON on
// stdin; we answer with a permissionDecision the harness enforces. This is
// the structural half of the story: the compiled context tells the agent the
// rules, the hook makes real-world authority actually unreachable when the
// warrant says no — whether or not the model read anything.
//
// The contract (documented in spec/SPEC.md):
//   stdin   {"tool_name": "...", "tool_input": {...}, "cwd": "..."}
//   stdout  {"hookSpecificOutput": {"hookEventName": "PreToolUse",
//            "permissionDecision": "allow"|"ask"|"deny", ...}}
//   exit    always 0 — the decision travels in the JSON, and every failure
//           mode (bad payload, missing project, ambiguous loop) degrades to
//           "ask", never to a silent allow. A gate that fails open is not
//           a gate.

import { parseArgs } from '../lib/args.js';
import { requireDocketDir, loadLoop, loopNames } from '../lib/loop.js';
import { checkWarrant } from '../lib/warrant.js';
import { recordCheck } from '../lib/record.js';

// Claude Code tool names → warrant verbs. Lookups are reads; local edits are
// changes; Bash is a change too — its command text is screened by the loop's
// ask/never lists first, and an unlisted command falls to ask like anything
// else. Every tool NOT in this table (MCP tools, new tools, anything that
// might leave the machine) is treated as `send`, the most consequence-laden
// verb — its allow list is the one most loops keep empty on purpose.
const TOOL_ACTIONS = {
  Read: 'read',
  Glob: 'read',
  Grep: 'read',
  LS: 'read',
  NotebookRead: 'read',
  WebFetch: 'read',
  WebSearch: 'read',
  Write: 'change',
  Edit: 'change',
  MultiEdit: 'change',
  NotebookEdit: 'change',
  Bash: 'change',
};

// The most human-meaningful detail of the tool input, in priority order —
// this is what the warrant patterns match against, so a file path or a
// command beats a JSON blob.
const DETAIL_KEYS = ['command', 'file_path', 'notebook_path', 'path', 'url', 'pattern', 'query', 'prompt', 'description'];

export function describeToolInput(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  for (const key of DETAIL_KEYS) {
    const v = toolInput[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const s = JSON.stringify(toolInput);
  return s === '{}' ? '' : s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

function decide(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }) + '\n'
  );
  return 0;
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

export async function cmdHook(argv) {
  const { flags } = parseArgs(argv, { booleans: ['no-record'] });

  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return decide('ask', 'docket hook: could not parse the PreToolUse payload from stdin — gating this call to the human.');
  }
  const toolName = payload?.tool_name;
  if (typeof toolName !== 'string' || !toolName) {
    return decide('ask', 'docket hook: payload has no tool_name — gating this call to the human.');
  }

  let docketDir;
  try {
    docketDir = requireDocketDir(flags.dir ?? process.env.DOCKET_DIR ?? payload.cwd ?? process.cwd());
  } catch (err) {
    return decide('ask', `docket hook: ${err.message} — gating this call to the human.`);
  }

  let loopName = flags.loop;
  if (!loopName) {
    const names = loopNames(docketDir);
    if (names.length === 1) {
      loopName = names[0];
    } else {
      return decide(
        'ask',
        `docket hook: ${names.length === 0 ? 'no loops defined' : `${names.length} loops defined (${names.join(', ')})`} — pass --loop <name> in the hook command. Gating this call to the human.`
      );
    }
  }

  let loop;
  try {
    loop = loadLoop(docketDir, loopName);
  } catch (err) {
    return decide('ask', `docket hook: ${err.message} — gating this call to the human.`);
  }

  const action = TOOL_ACTIONS[toolName] ?? 'send';
  const detail = describeToolInput(payload.tool_input);
  const target = detail ? `${toolName}: ${detail}` : toolName;
  const result = checkWarrant(loop, action, target);

  // The gate is evidence too: every intercepted call lands in the record.
  if (!flags['no-record']) {
    recordCheck(docketDir, loop.name, action, target, result, { via: 'hook', tool: toolName });
  }

  return decide(
    result.verdict,
    `docket: ${result.reason} · rule: ${result.rule} · loop: ${loop.name}`
  );
}
