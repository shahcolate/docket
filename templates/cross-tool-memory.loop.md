---
name: cross-tool-memory
description: One context you own, readable from Claude, GPT, Kimi, or Codex — a model switch is a recompile, not a re-teach.
version: 1
triggers:
  - update the shared memory, remember this across tools
  - regenerate CLAUDE.md, AGENTS.md, or rules files
warrant:
  read:
    - the loops in this .docket directory
    - CLAUDE.md, AGENTS.md, and rules files
  draft:
    - updates to loop brief sections
    - compiled context blocks
  change:
    - CLAUDE.md, AGENTS.md, and other compiled context files via docket compile
  send: []
  ask:
    - rewriting a loop's warrant or reserved sections
    - deleting anything from memory
  never:
    - storing secrets, tokens, or passwords in any loop file
    - git hooks, CI workflows, or scheduled jobs
    - hooks, workflows, cron, crontab, or startup scripts
reserved:
  - what gets remembered at all — memory is curation, not accumulation
  - any change to what an agent is allowed to do
record:
  - what was added to memory and its source
  - what was pruned and why
  - which context files were regenerated
---

# Brief

- The context lives here, in plain files, in your repo — not inside any one
  assistant's opaque memory feature. The assistants are interchangeable; this
  directory is not.
- Which tools are in play (Claude Code, Cursor, Codex, a local model) and which
  compiled file each one reads.
- The curation standard: memory holds things that change future answers —
  decisions, preferences, constraints, standards. Not transcripts.

# Procedure

1. After significant work in any tool, harvest: what was decided, what preference
   was expressed, what standard emerged? One line each, into the right loop's
   Brief section.
2. Prune as often as you add. Memory that grows without curation becomes noise
   with a table of contents.
3. Warrant and reserved-list changes are never harvested automatically — a human
   relaxing a rule once in conversation is not the rule changing.
4. Run `docket compile --target claude --write` and `--target agents --write` so
   every tool reads the same brain. The generated blocks are disposable; the loops
   are the source of truth.
5. When switching models, carry nothing by hand. If the new tool starts cold,
   something belongs in a loop file that isn't there yet — fix the file, not the chat.

Failure mode: letting one tool's built-in memory become the real memory. The moment
that happens, your context has a landlord.

Second failure mode — the scheduled escape: "helpfully" wiring the recompile into a
git hook, a CI workflow, or a cron job. Code planted now that runs later executes
past every approval this loop provides; keeping the compile a human-invoked command
is the point, not an inefficiency.
