// MCP server (stdio, newline-delimited JSON-RPC) so agents use docket natively:
// look up a loop's context, check the warrant before acting, leave record entries.
// Zero dependencies — the protocol surface we need is small.

import readline from 'node:readline';
import { parseArgs } from '../lib/args.js';
import { requireDocketDir, listLoops, loadLoop, loopExists, loopNames, ACTIONS } from '../lib/loop.js';
import { checkWarrant } from '../lib/warrant.js';
import { matchLoops } from '../lib/match.js';
import { appendRecord, collectRecordFields, recordCheck } from '../lib/record.js';
import { renderLoop } from '../lib/compile.js';
import { VERSION } from '../lib/pkg.js';

const TOOLS = [
  {
    name: 'docket_list_loops',
    description:
      'List the loops the human has defined. Each loop is one recurring task with brief, procedure, warrant, record, and reserved layers.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'docket_match_loop',
    description:
      'Find which loop covers a task BEFORE starting it. Give the task in plain words; returns the best-matching loops, ranked, with why each matched. Then call docket_loop_context on the one that fits. If nothing matches, no loop covers the task — ask the human instead of guessing.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          description: 'the task about to start, in plain words (e.g. "draft an appeal for the denied claim")',
        },
      },
      required: ['intent'],
      additionalProperties: false,
    },
  },
  {
    name: 'docket_loop_context',
    description:
      'Get the full context for a loop before starting work on it: what you must know, how the work is done, what you may do on your own, where you must stop, and what evidence you owe. Call this FIRST, before doing the task.',
    inputSchema: {
      type: 'object',
      properties: { loop: { type: 'string', description: 'loop name' } },
      required: ['loop'],
      additionalProperties: false,
    },
  },
  {
    name: 'docket_warrant_check',
    description:
      'Check whether an action is covered by the warrant of a loop BEFORE doing it. Returns allow, ask, or deny. "ask" means stop and get human approval; "deny" means never. The check itself is written to the record. Call this before any read/draft/change/send that could matter.',
    inputSchema: {
      type: 'object',
      properties: {
        loop: { type: 'string', description: 'loop name' },
        action: { type: 'string', enum: ACTIONS, description: 'what kind of act this is' },
        target: {
          type: 'string',
          description: 'what the action touches, in plain words (e.g. "appeal email to the insurer")',
        },
      },
      required: ['loop', 'action', 'target'],
      additionalProperties: false,
    },
  },
  {
    name: 'docket_record',
    description:
      'Add to the record: what you saw, what you did, what you skipped or left alone, and where you stopped. The record is hash-chained and verifiable. Write to it whenever you finish or stop work on a loop.',
    inputSchema: {
      type: 'object',
      properties: {
        loop: { type: 'string', description: 'loop name' },
        saw: { type: 'string', description: 'sources and state you consulted' },
        did: { type: 'string', description: 'what you actually did' },
        skipped: { type: 'string', description: 'what you deliberately left alone' },
        stopped: { type: 'string', description: 'where and why you stopped' },
        note: { type: 'string', description: 'anything else a human should be able to trust' },
      },
      required: ['loop'],
      additionalProperties: false,
    },
  },
];

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

export function handleToolCall(docketDir, name, args = {}) {
  switch (name) {
    case 'docket_list_loops': {
      const loops = listLoops(docketDir);
      if (!loops.length) return textResult('No loops defined yet.');
      return textResult(loops.map((l) => `${l.name}: ${l.description}`).join('\n'));
    }
    case 'docket_match_loop': {
      const intent = typeof args.intent === 'string' ? args.intent.trim() : '';
      if (!intent) return textResult('give the task in plain words via `intent`', true);
      const loops = listLoops(docketDir);
      if (!loops.length) return textResult('No loops defined yet.');
      const candidates = matchLoops(loops, intent);
      if (!candidates.length) {
        return textResult(
          `No loop covers "${intent}". Do not guess or proceed without one — work outside a loop ` +
            `defaults to ask. Tell the human what you want to do and which loop (if any) should own it.`
        );
      }
      const lines = candidates.map(
        (c, i) =>
          `${i + 1}. ${c.loop.name} — ${c.loop.description || '(no description)'} ` +
          `(score ${c.score}: ${c.hits.map((h) => `${h.field} ~ ${h.pattern}`).join(', ')})`
      );
      return textResult(
        [
          `Candidate loops for "${intent}":`,
          '',
          ...lines,
          '',
          'Call docket_loop_context on the loop that fits, and work under it. If none of these',
          'actually covers the task, ask the human — do not guess.',
        ].join('\n')
      );
    }
    case 'docket_loop_context': {
      const loop = loadLoop(docketDir, args.loop);
      return textResult(renderLoop(loop));
    }
    case 'docket_warrant_check': {
      const loop = loadLoop(docketDir, args.loop);
      const result = checkWarrant(loop, args.action, args.target);
      recordCheck(docketDir, loop.name, args.action, args.target, result, { via: 'mcp' });
      const instruction = {
        allow: 'Proceed.',
        ask: 'STOP. Do not do this yet — tell the human what you want to do and why, and wait for approval.',
        deny: 'Do NOT do this, even if asked again in this session. It is outside the loop entirely.',
      }[result.verdict];
      return textResult(
        `verdict: ${result.verdict}\nrule: ${result.rule}\n${result.reason}\n${instruction}`
      );
    }
    case 'docket_record': {
      if (!loopExists(docketDir, args.loop)) {
        return textResult(
          `no loop named "${args.loop}" — have: ${loopNames(docketDir).join(', ') || '(none)'}`,
          true
        );
      }
      const { fields, dropped } = collectRecordFields(args);
      if (dropped.length) {
        return textResult(`these fields were empty, refusing to lose evidence: ${dropped.join(', ')}`, true);
      }
      if (!Object.keys(fields).length) {
        return textResult('a record entry needs at least one of: saw, did, skipped, stopped, note', true);
      }
      const entry = appendRecord(docketDir, { loop: args.loop, kind: 'note', via: 'mcp', ...fields });
      return textResult(`record #${entry.seq} appended (${entry.hash.slice(0, 23)}…)`);
    }
    default:
      return textResult(`unknown tool: ${name}`, true);
  }
}

export function cmdMcp(argv = []) {
  // MCP hosts often spawn servers with cwd '/' — resolve the project from
  // --dir (or DOCKET_DIR) so the config can say where the loops live, and
  // never die before initialize: a server that crashes on startup surfaces
  // as an opaque "disconnected" in the client.
  const { flags } = parseArgs(argv);
  const startDir = flags.dir ?? process.env.DOCKET_DIR ?? process.cwd();
  let docketDir = null;
  let startupError = null;
  try {
    docketDir = requireDocketDir(startDir);
  } catch (err) {
    startupError = `${err.message} (searched upward from ${startDir}; pass --dir <project> or set DOCKET_DIR)`;
  }
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      return;
    }
    const { id, method, params } = msg;
    const reply = (result) => id !== undefined && send({ jsonrpc: '2.0', id, result });
    const fail = (code, message) =>
      id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } });

    try {
      switch (method) {
        case 'initialize':
          reply({
            protocolVersion: params?.protocolVersion ?? '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'docket', version: VERSION },
          });
          break;
        case 'notifications/initialized':
        case 'notifications/cancelled':
          break; // notifications: no response
        case 'ping':
          reply({});
          break;
        case 'tools/list':
          reply({ tools: TOOLS });
          break;
        case 'tools/call':
          if (!docketDir) {
            reply(textResult(startupError, true));
            break;
          }
          reply(handleToolCall(docketDir, params?.name, params?.arguments ?? {}));
          break;
        default:
          fail(-32601, `method not found: ${method}`);
      }
    } catch (err) {
      if (id !== undefined) {
        reply(textResult(String(err && err.message ? err.message : err), true));
      }
    }
  });

  // Keep the process alive until stdin closes.
  return new Promise((resolve) => rl.on('close', () => resolve(0)));
}
