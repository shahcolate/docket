// `docket hook claude` — the warrant as a Claude Code PreToolUse hook.
//
// The compiled context makes the rules known; the MCP tools make checking
// cheap; this makes it MECHANICAL. Claude Code pipes every matched tool call
// here as JSON before it runs; docket answers in the hook protocol:
//
//   deny  → the call is blocked, the reason goes back to the model
//   ask   → Claude Code prompts the human before running the call
//   allow → we stay SILENT (exit 0, no output)
//
// Silence on allow is deliberate: emitting an "allow" decision would bypass
// Claude Code's own permission prompts. Docket must only ever tighten the
// gate, never loosen it — a docket allow means "the warrant has no
// objection", not "skip the other locks".
//
// Failure posture follows configuration intent. A bare `docket hook claude`
// is safe to wire globally: outside a docket project, or when no loop routes,
// it costs nothing (exit 0, silent). But once the config expresses intent to
// gate — `--loop <name>` or `--strict` — every failure mode fails CLOSED to
// ask: a bad payload, a missing project, a misnamed loop. A gate you asked
// for that fails open is not a gate.

import { parseArgs } from '../lib/args.js';
import { findDocketDir, listLoops, loadLoop, loopExists, loopNames } from '../lib/loop.js';
import { checkWarrant } from '../lib/warrant.js';
import { matchLoops } from '../lib/match.js';
import { recordCheck } from '../lib/record.js';

// Verbs for the tools Claude Code ships. Anything not listed — Bash, MCP
// tools, tools that don't exist yet — is treated as `send`, the most
// consequential verb: its allow list is the one loop authors keep shortest,
// so unknown tools fall toward ask, never toward allow.
const ACTION_FOR_TOOL = {
  Read: 'read',
  Glob: 'read',
  Grep: 'read',
  LS: 'read',
  NotebookRead: 'read',
  WebFetch: 'read',
  WebSearch: 'read',
  TodoRead: 'read',
  Write: 'change',
  Edit: 'change',
  MultiEdit: 'change',
  NotebookEdit: 'change',
  TodoWrite: 'change',
};
const DEFAULT_ACTION = 'send';

// The warrant matches plain words, so give it the most human part of the
// tool input — the command, the path, the url — prefixed with the tool name.
export function describeTarget(toolName, input) {
  const detail =
    input && typeof input === 'object'
      ? [input.command, input.file_path, input.url, input.path, input.pattern, input.query, input.description]
          .find((v) => typeof v === 'string' && v.trim())
      : null;
  const text = detail ?? (input && typeof input === 'object' ? JSON.stringify(input) : '');
  return `${toolName}${text ? `: ${text}` : ''}`.slice(0, 300);
}

function emitDecision(verdict, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: verdict,
        permissionDecisionReason: reason,
      },
    }) + '\n'
  );
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

// Exit codes follow the hook contract, not the warrant's: the DECISION rides
// in the JSON on stdout. Exit 1 is "misconfigured" — Claude Code shows the
// human our stderr without blocking the call — and is only used when the
// config expressed no gating intent.
export async function cmdHook(argv) {
  const { flags, positional } = parseArgs(argv, { booleans: ['strict'] });
  if (positional[0] !== 'claude') {
    console.error('usage: docket hook claude [--loop <name>] [--strict] [--dir <project>]');
    return 1;
  }
  // --loop or --strict means the user asked for a gate: from here on,
  // failures block (ask) instead of passing through.
  const gated = Boolean(flags.loop) || Boolean(flags.strict);
  const failClosed = (why) => {
    console.error(`docket hook: ${why}`);
    if (gated) {
      emitDecision('ask', `docket hook is misconfigured (${why}) — failing closed. A human must approve this call.`);
      return 0;
    }
    return 1;
  };

  let event;
  try {
    event = JSON.parse(await readStdin());
  } catch {
    return failClosed('stdin was not hook JSON — wire this command under hooks.PreToolUse');
  }
  if (event.hook_event_name && event.hook_event_name !== 'PreToolUse') return 0;
  const toolName = typeof event.tool_name === 'string' ? event.tool_name : '';
  if (!toolName) return 0;

  // `DOCKET_DIR=` (set but empty) must not shadow the payload's cwd.
  const startDir = flags.dir ?? (process.env.DOCKET_DIR || undefined) ?? event.cwd ?? process.cwd();
  const docketDir = findDocketDir(startDir);
  if (!docketDir) {
    // Only consequential when the config asked for a gate: a global hook in
    // a project that doesn't use docket should cost nothing.
    if (gated) return failClosed(`no .docket directory found from ${startDir}`);
    return 0;
  }

  const action = ACTION_FOR_TOOL[toolName] ?? DEFAULT_ACTION;
  const target = describeTarget(toolName, event.tool_input);

  // Loading a loop can throw: bad frontmatter, a baseline that `extends`
  // points at and isn't there, an inheritance cycle. An uncaught throw exits
  // 1, and exit 1 is Claude Code's NON-blocking error — stderr is shown and
  // the tool runs. For a gated hook that is a fail-open, and the whole point
  // of `--loop`/`--strict` is that there isn't one. Catch it and gate.
  let loop;
  try {
    if (flags.loop) {
      if (!loopExists(docketDir, flags.loop)) {
        return failClosed(
          `no loop named "${flags.loop}" — have: ${loopNames(docketDir).join(', ') || '(none)'}`
        );
      }
      loop = loadLoop(docketDir, flags.loop);
    } else {
      // No loop pinned in the config: route on the target. A routed loop
      // governs; no route means no loop claims this call — pass through to
      // Claude Code's own permissions (or ask, under --strict).
      const [candidate] = matchLoops(listLoops(docketDir), target, { limit: 1 });
      if (!candidate) {
        if (flags.strict) {
          emitDecision(
            'ask',
            `docket: no loop covers "${target}" and this project runs hooks in strict mode — a human must approve work outside the loops.`
          );
        }
        return 0;
      }
      loop = candidate.loop;
    }
  } catch (err) {
    return failClosed(`could not load the loops — ${err.message}`);
  }

  const result = checkWarrant(loop, action, target);

  // Emit the decision BEFORE recording. The record is evidence; the decision
  // is the gate. If appending evidence fails (read-only .docket, full disk, a
  // concurrent partial write), a deny must still reach the harness — a lost
  // record is a bug, a lost deny is a breach.
  if (result.verdict === 'deny') {
    emitDecision('deny', `docket loop "${loop.name}" (${result.rule}): ${result.reason}`);
  } else if (result.verdict === 'ask') {
    emitDecision('ask', `docket loop "${loop.name}" (${result.rule}): ${result.reason}`);
  }
  try {
    // The harness hands us the session id — the one attribution docket never
    // has to guess. Two agents in two worktrees become two subjects at merge.
    recordCheck(
      docketDir,
      loop.name,
      action,
      target,
      result,
      { via: 'hook', tool: toolName },
      { by: flags.by, session: event.session_id, cwd: startDir }
    );
  } catch (err) {
    console.error(`docket hook: decision emitted but record append failed — ${err.message}`);
  }
  return 0;
}
