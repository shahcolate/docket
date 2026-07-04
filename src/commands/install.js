// `docket install` — make docket ambient in a repo with one command.
//
// Two layers of "runs whenever an agent touches the repo", set up together:
//   1. Context   — compile the loops into every agent's context file
//                  (CLAUDE.md, AGENTS.md, GEMINI.md, Cursor rules). Read
//                  automatically at session start; zero setup for anyone who
//                  clones. This is the ambient, cooperative layer.
//   2. Enforcement — a Claude Code PreToolUse hook in .claude/settings.json,
//                  so the warrant gates tool calls mechanically. Plus a
//                  .mcp.json so any MCP client gets the native tools.
//
// Everything it writes is committable and merge-safe: the compiled files keep
// their managed block, and the JSON configs are merged (never clobbered) and
// idempotent, so re-running install after adding a loop just refreshes.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from '../lib/args.js';
import { findDocketDir, loopsDir, listLoops } from '../lib/loop.js';
import { compileToFile, TARGETS } from '../lib/compile.js';
import { cmdInit } from './init.js';
import { bold, cyan, dim, green, yellow } from '../lib/ui.js';

const CONTEXT_TARGETS = ['claude', 'agents', 'gemini', 'cursor'];
// Consequential tools only — reads are cheap to let through, and matching
// every call would spawn a check per read. Bash/MCP/edits are where the
// warrant earns its keep; unknown tools map to `send` and fall toward ask.
const DEFAULT_MATCHER = 'Bash|Write|Edit|MultiEdit|NotebookEdit|mcp__.*';

// Read strict JSON (settings.json / .mcp.json are JSON, not the loop YAML).
// A parse failure must abort — we never clobber a file we can't understand.
function readJson(file, label) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('not a JSON object');
    }
    return value;
  } catch (err) {
    throw new Error(
      `${label} exists but isn't valid JSON (${err.message}) — fix or move it, then re-run \`docket install\`. Refusing to overwrite it.`
    );
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

// Add (or refresh) our PreToolUse hook without disturbing other hooks.
// Idempotent: any existing docket hook entry is replaced, not duplicated.
function mergeHook(settings, command, matcher) {
  const hooks = (settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {});
  const pre = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
  const isDocket = (entry) =>
    Array.isArray(entry?.hooks) &&
    entry.hooks.some((h) => typeof h?.command === 'string' && /docket(-agent)?\s+hook/.test(h.command));
  const kept = pre.filter((entry) => !isDocket(entry));
  kept.push({ matcher, hooks: [{ type: 'command', command }] });
  return { ...settings, hooks: { ...hooks, PreToolUse: kept } };
}

function mergeMcp(config) {
  const servers = config.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {};
  return {
    ...config,
    mcpServers: { ...servers, docket: { command: 'npx', args: ['-y', 'docket-agent', 'mcp'] } },
  };
}

export function cmdInstall(argv) {
  const { flags } = parseArgs(argv, { booleans: ['no-hook', 'no-mcp', 'strict', 'index', 'quiet'] });
  const root = path.resolve(flags.dir ?? process.cwd());

  // 1. Ensure the project exists.
  if (!findDocketDir(root) || !fs.existsSync(path.join(root, '.docket'))) {
    const code = cmdInit(['--dir', root, '--quiet']);
    if (code !== 0) return code;
  }
  const docketDir = path.join(root, '.docket');

  const targets = (flags.targets ? String(flags.targets).split(',') : CONTEXT_TARGETS)
    .map((t) => t.trim())
    .filter(Boolean);
  for (const t of targets) {
    if (!TARGETS[t] || !TARGETS[t].file) {
      console.error(`docket: unknown context target "${t}" — choose from: ${CONTEXT_TARGETS.join(', ')}`);
      return 1;
    }
  }

  const written = [];
  const notes = [];

  // 2. Compile the ambient context — the layer every agent reads for free.
  const loops = listLoops(docketDir);
  if (loops.length) {
    for (const t of targets) {
      const file = compileToFile(root, t, loops, { index: flags.index });
      written.push(path.relative(root, file));
    }
  } else {
    notes.push(
      `no loops yet — skipped compiling context. Create one (${cyan('docket new <name>')}), then re-run ${cyan('docket install')}.`
    );
  }

  // 3. Enforcement hook (Claude Code). Pass-through by default: no --loop
  //    routes each call by content and stays silent when no loop claims it;
  //    --loop pins one loop, --strict asks on anything no loop covers.
  if (!flags['no-hook']) {
    const parts = ['npx', '-y', 'docket-agent', 'hook', 'claude'];
    if (flags.loop) parts.push('--loop', String(flags.loop));
    if (flags.strict) parts.push('--strict');
    const settingsFile = path.join(root, '.claude', 'settings.json');
    const merged = mergeHook(readJson(settingsFile, '.claude/settings.json'), parts.join(' '), flags.matcher ?? DEFAULT_MATCHER);
    writeJson(settingsFile, merged);
    written.push(path.relative(root, settingsFile));
  }

  // 4. Native tools for any MCP client.
  if (!flags['no-mcp']) {
    const mcpFile = path.join(root, '.mcp.json');
    writeJson(mcpFile, mergeMcp(readJson(mcpFile, '.mcp.json')));
    written.push(path.relative(root, mcpFile));
  }

  if (flags.quiet) {
    written.forEach((f) => console.log(f));
    return 0;
  }

  console.log(green('✓') + ` docket installed into ${path.relative(process.cwd(), root) || '.'}`);
  console.log('\n' + bold('Wrote / updated:'));
  for (const f of written) console.log(`  ${f}`);
  for (const n of notes) console.log('\n' + yellow('note: ') + n);

  console.log('\n' + bold('What this does:'));
  console.log('  · Context files are read automatically by each agent at session start —');
  console.log('    anyone who clones is under the warrant, no setup on their end.');
  if (!flags['no-hook']) {
    console.log('  · The PreToolUse hook gates tool calls in Claude Code: deny blocks, ask');
    console.log('    prompts you, allow stays silent. Claude Code asks each collaborator to');
    console.log('    approve the hook once (a cloned repo can\'t silently run commands).');
    if (!flags.loop && !flags.strict) {
      console.log(dim('    Posture: pass-through — silent on work no loop covers.'));
    }
  }

  console.log('\n' + bold('Commit it so it travels with the repo:'));
  console.log('  ' + cyan(`git add .docket ${written.filter((f) => !f.startsWith('.docket')).join(' ')}`));
  console.log('  ' + cyan('git commit -m "Add docket: warrant + record for agents in this repo"'));
  return 0;
}
