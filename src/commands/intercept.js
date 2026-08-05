// `docket intercept` — the warrant as a Docker MCP Gateway interceptor.
//
// The Claude Code hook (`docket hook claude`) gates one harness. This gates
// the OTHER side of the connection: every `tools/call` that any MCP client
// makes through the gateway, to any server in the catalog. Same warrant, same
// record, no vendor in the middle.
//
// The gateway's contract (docker/mcp-gateway, pkg/interceptors):
//
//   --interceptor before:exec:<shell command>
//   --interceptor before:docker:<image> [args]
//
//   stdin   the marshalled tool-call request: {"params":{"name":…,"arguments":{…}}}
//   stdout  EMPTY        → the call proceeds to the real tool
//           a CallToolResult JSON → that result is returned to the client and
//                                   THE TOOL IS NEVER CALLED
//   stderr  shown in the gateway's logs
//
// So "allow" is silence and "block" is a result — the same shape as the
// Claude hook, where allow is silence and a decision is JSON. Silence on
// allow is load-bearing for the same reason it is there: docket's verdict is
// "the warrant has no objection", not "skip the gateway's other checks"
// (block-secrets, OAuth, whatever else is in the chain).
//
// ONE HONEST DIFFERENCE, and it is the whole reason this file needs a
// comment. A gateway has no human in the loop. `ask` at a Claude Code hook
// prompts a person who can approve; at the gateway there is nobody to
// prompt, so `ask` DEGRADES TO BLOCK — the call does not run, and the
// message says a human must approve it out of band. That is strictly
// tighter than the hook, which is the only direction docket is ever allowed
// to degrade. It is not a prompt, and this file will not pretend it is one.
//
// Exit status is 0 for every decision. The gateway runs us with cmd.Output():
// a non-zero exit is an *error*, which aborts the tool call with "executing
// interceptor: …" and no explanation the model can act on. Blocking with a
// proper CallToolResult says why, on the record, in words.

import { parseArgs } from '../lib/args.js';
import { ACTIONS, findDocketDir, listLoops, loadLoop, loopExists, loopNames } from '../lib/loop.js';
import { checkWarrant } from '../lib/warrant.js';
import { matchLoops } from '../lib/match.js';
import { recordCheck } from '../lib/record.js';

// Every tool behind the gateway is a third-party tool docket has never seen:
// arbitrary servers from a catalog, named by their authors. There is no table
// to look them up in and no honest way to infer a verb from a name — a tool
// called `search_and_purge` reads like a read. So the default is `send`, the
// most consequential verb, whose allow list is the one loop authors keep
// shortest on purpose. Unknown tools fall toward ask, never toward allow.
//
// `--action` overrides it for a gateway you know fronts only read-only
// servers. That is a real widening and the help text says so.
const DEFAULT_ACTION = 'send';

// Argument keys whose values usually carry the human meaning of a call.
// Ordered most-specific-first; they lead the target so the warrant's patterns
// meet the part a person would recognize.
const SALIENT_KEYS = [
  'command', 'cmd', 'script', 'query', 'q', 'url', 'uri', 'path', 'file', 'file_path',
  'repo', 'repository', 'branch', 'channel', 'to', 'recipient', 'subject', 'title',
  'name', 'message', 'body', 'text', 'content', 'prompt', 'sql', 'pattern',
];

// Collect the string-ish leaves of the arguments object, salient keys first,
// then everything else in key order. Depth-limited: MCP arguments are a JSON
// object of the server's choosing, and an unbounded walk over a hostile
// payload is a denial-of-service on our own gate.
export function argumentStrings(args, depth = 0) {
  if (depth > 3 || args === null || args === undefined) return [];
  if (typeof args === 'string') return [args];
  if (typeof args === 'number' || typeof args === 'boolean') return [String(args)];
  if (Array.isArray(args)) return args.flatMap((v) => argumentStrings(v, depth + 1));
  if (typeof args !== 'object') return [];
  const keys = Object.keys(args);
  const ordered = [
    ...SALIENT_KEYS.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !SALIENT_KEYS.includes(k)).sort(),
  ];
  return ordered.flatMap((k) => argumentStrings(args[k], depth + 1));
}

// The target the warrant sees: the tool's name, then everything the caller
// put in its arguments.
//
// Including ALL the arguments rather than picking one is deliberate, and it
// is safe in one direction only — which happens to be the direction we need.
// More text means more content words; more content words can only ADD matches
// against `ask`/`never` (which match fuzzily) and can only REMOVE matches
// against `allow` (which requires every clause of the target to be covered).
// A bigger target can turn an allow into an ask. It can never turn an ask
// into an allow.
export function describeCall(toolName, args) {
  const parts = argumentStrings(args)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const seen = new Set();
  const unique = parts.filter((p) => !seen.has(p) && seen.add(p));
  return `${toolName}${unique.length ? `: ${unique.join(' ')}` : ''}`.slice(0, 500);
}

// The gateway marshals its request struct, so the tool name lives at
// `params.name`. Accept the bare `{name, arguments}` shape too: the `http`
// interceptor type posts the same payload to a server that may re-serialize
// it, and a gate that only understands one spelling of its input is a gate
// that fails open on the other.
export function parseCall(payload) {
  const p = payload && typeof payload === 'object' ? (payload.params ?? payload) : null;
  if (!p || typeof p !== 'object') return null;
  const name = typeof p.name === 'string' ? p.name.trim() : '';
  if (!name) return null;
  return { name, arguments: p.arguments ?? p.args ?? {} };
}

// A CallToolResult the gateway will hand straight back to the client. The
// `type: "text"` discriminator is required — the gateway unmarshals this into
// the MCP SDK's Content interface, which dispatches on it and errors without.
export function blockResult(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

function emitBlock(text) {
  process.stdout.write(JSON.stringify(blockResult(text)) + '\n');
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

export async function cmdIntercept(argv) {
  const { flags } = parseArgs(argv, { booleans: ['strict'] });

  if (flags.action !== undefined && !ACTIONS.includes(flags.action)) {
    console.error(
      `docket intercept: --action must be one of ${ACTIONS.join(', ')} (got "${flags.action}")`
    );
    return 1;
  }
  const action = flags.action ?? DEFAULT_ACTION;

  // Same rule as the hook: naming a loop or asking for strict mode is the
  // user expressing intent to gate. Before that, a bare interceptor wired
  // globally must cost nothing outside a docket project.
  const gated = Boolean(flags.loop) || Boolean(flags.strict);
  const failClosed = (why) => {
    console.error(`docket intercept: ${why}`);
    if (gated) {
      emitBlock(
        `docket blocked this tool call: the gate is misconfigured (${why}). ` +
          'A gate that fails open is not a gate, so the call did not run. ' +
          'Fix the interceptor configuration, or ask a human to run this action directly.'
      );
    }
    return 0;
  };

  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return failClosed('stdin was not a tool-call request — wire this with --interceptor before:exec:');
  }

  const call = parseCall(payload);
  if (!call) return failClosed('the payload carried no tool name');

  const startDir = flags.dir ?? (process.env.DOCKET_DIR || undefined) ?? process.cwd();
  const docketDir = findDocketDir(startDir);
  if (!docketDir) {
    // A bare `docket intercept` may be wired into a gateway that also serves
    // projects which don't use docket. Staying silent there is the point of
    // the ungated mode — and logging a line per tool call would drown the
    // gateway's own output in noise nobody asked for.
    if (!gated) return 0;
    return failClosed(`no .docket directory found from ${startDir}`);
  }

  const target = describeCall(call.name, call.arguments);

  let loop;
  if (flags.loop) {
    if (!loopExists(docketDir, flags.loop)) {
      return failClosed(
        `no loop named "${flags.loop}" — have: ${loopNames(docketDir).join(', ') || '(none)'}`
      );
    }
    loop = loadLoop(docketDir, flags.loop);
  } else {
    const [candidate] = matchLoops(listLoops(docketDir), target, { limit: 1 });
    if (!candidate) {
      if (flags.strict) {
        emitBlock(
          `docket blocked "${call.name}": no loop covers this call, and this gateway runs in strict mode. ` +
            'Work outside the loops needs a human. Write a loop that covers it, or have a person run it directly.'
        );
      }
      return 0;
    }
    loop = candidate.loop;
  }

  const result = checkWarrant(loop, action, target);

  // Emit the decision BEFORE recording, for the same reason the hook does: a
  // lost record is a bug, a lost block is a breach.
  if (result.verdict === 'deny') {
    emitBlock(
      `docket DENIED "${call.name}" under loop "${loop.name}" (${result.rule}). ${result.reason} ` +
        'This is a hard stop: it does not happen with or without approval. Do not retry it by another route.'
    );
  } else if (result.verdict === 'ask') {
    emitBlock(
      `docket did not run "${call.name}" under loop "${loop.name}" (${result.rule}). ${result.reason} ` +
        'The gateway has no way to prompt a human, so an action that needs approval is not run at all. ' +
        'Ask the person you are working for to approve it, or to add it to the loop\'s warrant.'
    );
  }

  try {
    recordCheck(
      docketDir,
      loop.name,
      action,
      target,
      result,
      { via: 'gateway', tool: call.name, ...(flags.server ? { server: flags.server } : {}) },
      { by: flags.by, cwd: startDir }
    );
  } catch (err) {
    console.error(`docket intercept: decision emitted but record append failed — ${err.message}`);
  }
  return 0;
}
