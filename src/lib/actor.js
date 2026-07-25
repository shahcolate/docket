// Who wrote this record entry?
//
// When one human ran one agent, the record's `loop` field was enough. At
// autonomy levels 4–5 that stops being true: several agents work the same
// repo in parallel worktrees, and at merge time "what was this allowed to do,
// and what did it do?" needs a subject. That subject is the `by` field.
//
// HONESTY NOTE, and it matters: `by` is SELF-REPORTED. It is evidence about
// provenance, not an authentication claim — a process that can append to the
// record can append any `by` it likes. What the hash chain guarantees is that
// the attribution cannot be changed *after the fact* without breaking the
// chain: whoever wrote the entry is stuck with what they claimed at the time.
// That is the same promise as the rest of the record, stated plainly.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Best-effort agent detection from the harness's own environment. First match
// wins. These are signals the tools set for themselves — we only read them.
// Adding a row here is the intended way to teach docket a new agent; a wrong
// guess is a mislabeled entry, so keep each signal specific to one tool.
export const AGENT_SIGNALS = [
  ['claude-code', (e) => e.CLAUDECODE || e.CLAUDE_CODE],
  ['cursor', (e) => e.CURSOR_AGENT || e.CURSOR_TRACE_ID],
  ['gemini-cli', (e) => e.GEMINI_CLI],
  ['codex', (e) => e.CODEX_SANDBOX || e.CODEX_HOME],
  ['aider', (e) => e.AIDER_MODEL],
  ['github-actions', (e) => e.GITHUB_ACTIONS],
];

const MAX_LEN = 64;

// One field, one shape: short, single-line, greppable. A record you can't
// `grep` is a database, and this is deliberately not one.
export function normalizeActor(value) {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
  return clean || null;
}

export function detectAgent(env = process.env) {
  for (const [name, signal] of AGENT_SIGNALS) {
    if (signal(env)) return name;
  }
  return null;
}

function username() {
  try {
    return os.userInfo().username;
  } catch {
    return 'unknown';
  }
}

// Find the git directory for `cwd`, following the `gitdir:` pointer that a
// linked worktree leaves in its `.git` FILE. Returns null outside a repo.
function findGitDir(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    const dotGit = path.join(dir, '.git');
    try {
      const stat = fs.statSync(dotGit);
      if (stat.isDirectory()) return dotGit;
      if (stat.isFile()) {
        const m = fs.readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)$/m);
        if (m) return path.resolve(dir, m[1].trim());
        return null;
      }
    } catch {
      // not here — keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Resolving the git dir walks the tree; re-reading HEAD is two syscalls. Cache
// the walk, never the branch — a long-lived MCP server outlives a checkout.
const gitDirCache = new Map();

export function gitContext(cwd = process.cwd()) {
  const key = path.resolve(cwd);
  if (!gitDirCache.has(key)) gitDirCache.set(key, findGitDir(key));
  const gitDir = gitDirCache.get(key);
  if (!gitDir) return {};
  const out = {};
  try {
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    // Detached HEAD is still an answer — the short sha says where you were.
    out.branch = ref ? ref[1].trim() : head.slice(0, 12);
  } catch {
    // a repo mid-clone or mid-rebase has no readable HEAD; attribution
    // degrades to just `by` rather than failing the write
  }
  // A linked worktree lives at <gitdir>/worktrees/<name>; the main checkout
  // has no worktree name to report, and inventing one would be noise.
  const parts = gitDir.split(path.sep);
  const i = parts.lastIndexOf('worktrees');
  if (i !== -1 && parts[i + 1]) out.worktree = parts[i + 1];
  return out;
}

// The attribution fields for one record entry. Precedence is explicit intent
// first: `--by` beats the environment, the environment beats a guess, and a
// guess beats nothing. Every field is omitted when it has no honest value —
// a record should not carry placeholders that read like facts.
export function resolveActor({ by, session, env = process.env, cwd = process.cwd() } = {}) {
  const actor = {
    by:
      normalizeActor(by) ||
      normalizeActor(env.DOCKET_BY) ||
      detectAgent(env) ||
      `user:${username()}`,
  };
  const git = gitContext(cwd);
  if (git.branch) actor.branch = git.branch;
  if (git.worktree) actor.worktree = git.worktree;
  const sess = normalizeActor(session) || normalizeActor(env.DOCKET_SESSION);
  if (sess) actor.session = sess;
  return actor;
}
