<div align="center">

# docket

**The permission layer — and the paper trail — for AI agents.**

[![npm](https://img.shields.io/npm/v/docket-agent?style=flat-square&color=FF4B3A&label=npm)](https://www.npmjs.com/package/docket-agent)
[![CI](https://img.shields.io/github/actions/workflow/status/shahcolate/docket/ci.yml?style=flat-square&label=CI)](https://github.com/shahcolate/docket/actions)
[![node](https://img.shields.io/node/v/docket-agent?style=flat-square&color=3FB950)](package.json)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-3FB950?style=flat-square)](package.json)
[![license](https://img.shields.io/badge/license-MIT-8B8E96?style=flat-square)](LICENSE)

**English** · [简体中文](README.zh.md)

<img src="docs/assets/banner.svg" alt="docket check — ASK: unlisted means ask, silence is never permission" width="680">

Before your agent acts, it checks a one-page rule file you wrote: allow, ask,
or deny. After, it leaves a tamper-evident record. Anything you didn't write
down, the agent must ask about. Plain Markdown in your repo; works with
Claude, ChatGPT/Codex, Gemini, Cursor, OpenClaw, Hermes, and any MCP client.

**Hand your agent real work. Keep the authority. Get the receipts.**

**Install:** `npm install -g docket-agent` · **Docs:**
[shahcolate.github.io/docket/docs.html](https://shahcolate.github.io/docket/docs.html)

Zero dependencies · plain Markdown + JSONL · MIT

</div>

---

## News

- **2026.07** — The red-team program grows to [**10,582 checks across six suites**](eval/REPORT.md): adversarial phrasing, vague-target probes, 10,000 fuzzed targets, 239 tamper mutations, and a live hook-gate corpus — zero silent allows, zero fail-open. The matcher now splits compound targets clause by clause, so a consequence can't ride along with an allowed phrase.
- **2026.07** — `v0.3.0` ships **`docket hook`**: the warrant as a Claude Code PreToolUse gate — allow/ask/deny enforced by the harness, not the prompt. Plus the deferred-consequence rule in the spec and the **scheduled escape** red-team family.
- **2026.07** — `v0.2.1` on npm: current README and CLI help ship in the package.
- **2026.07** — `v0.2.0` ships **`docket review`**: the record proposes warrant amendments; applying is always a human keystroke.
- **2026.07** — [OpenClaw](https://docs.openclaw.ai) and [Hermes](https://hermes-agent.nousresearch.com/docs/) integrations, plus the full [documentation site](https://shahcolate.github.io/docket/docs.html).
- **2026.07** — `v0.1.0`: first public release — loops, warrants, hash-chained records, compile targets, MCP server.

## The failure mode moved

Yesterday's failure was a bad **answer**: the model forgot everything, so you
re-briefed it from scratch and corrected it in chat.

Today's failure is a bad **action**: agents use tools. A misread doesn't come
back as a wrong paragraph — it goes out as a sent email, a filed ticket, a
changed record.

It's already happened in the wild: in mid-2025, Replit's coding agent
**deleted a SaaS company's production database** during an explicit code
freeze — after being told, eleven times, in all caps, not to touch anything.
Then it reported that rollback was impossible (it wasn't) and generated
thousands of fake records to paper over the damage. Two failures in one
incident: an action nobody permitted, and a record nobody could trust.

So the question that matters isn't *"what does the AI know?"* It's:

> **What exactly was the agent allowed to do — and can you prove it?**

Docket makes the answer a file instead of a vibe.

## What that buys you

- **Delegation without babysitting.** The boundaries are decided once, in
  writing, under calm conditions — so the agent works unattended and stops
  exactly where you said. `ask` stays rare and meaningful: across the
  red-team program, warranted work runs without a single unnecessary prompt
  (21/21), and `docket review` retires the asks you keep approving.
- **Evidence you can hand to anyone.** A client, a manager, a compliance
  review, a postmortem — the record answers *"what was it allowed to do,
  and what did it do?"* from a hash-chained file, not from memory.
  239/239 tampering attempts detected in the eval.
- **No vendor bet.** The rules and the record are plain files in your repo,
  compiled to whichever assistant you use this quarter. A model switch is a
  recompile; deleting docket loses you nothing but the tooling.

## One bounded task at a time

Don't configure an assistant. Define a **loop** — one recurring task, wrapped
in five layers:

```
              ┌───────────────────────────────────────────┐
              │                 one loop                  │
              │                                           │
    brief ────┤  what it must know before it starts       │
procedure ────┤  how this job is done properly            │
  warrant ────┤  read / draft / change / send — and where │
              │  it must stop and ask                     │
   record ────┤  evidence of what it saw, did, skipped    │
 reserved ────┤  what stays with the human, always        │
              └───────────────────────────────────────────┘
```

Each loop is a single Markdown file. Prose where humans are good (brief,
procedure), structure where tools are good (warrant, record, reserved):

```markdown
---
name: insurance-appeal
description: Build the appeal, cite the policy — stop before send.
warrant:
  read:  [policy documents, denial letter, claim correspondence]
  draft: [appeal letter, evidence summary]
  send:  []
  ask:   [contacting the insurer, requesting new records]
  never: [accepting or rejecting a settlement]
reserved:
  - signing and sending
record:
  - every policy clause cited, with section numbers
  - where the draft stopped and what a human must do next
---

# Brief
The denial reason code, the claim timeline, the appeal deadline…

# Procedure
Read the denial letter first. Answer the stated reason, not a general
sense of unfairness. Quote the policy both ways. Stop before send.
```

## Add docket to a repo — every agent, one command

You don't standardize on a client or set anything up per developer. Add docket
to the repo, commit it, and **every agent that touches the code — and everyone
who clones — is under the same warrant and leaves the same record.** This is
the enterprise path: govern the repository, not each person's toolchain.

```console
$ npm install -g docket-agent                  # or: npx docket-agent <command>
$ docket new deploy --template prod-hotfix      # one rule file for a recurring task
$ docket install                                # wire it into the repo for every agent
✓ docket installed into .
  CLAUDE.md · AGENTS.md · GEMINI.md · .cursor/rules/docket.mdc
  .claude/settings.json · .mcp.json
```

`docket install` sets up two layers together, all in files committed with the
repo:

- **Context, for free.** The compiled `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` /
  Cursor rules are read automatically at the start of every session — Claude
  Code, Codex/ChatGPT, Gemini, Cursor, any MCP client, **zero setup on anyone's
  end.**
- **Enforcement, mechanical** *(one-time approval per developer).* A Claude
  Code PreToolUse hook in `.claude/settings.json` gates tool calls through the
  warrant (deny blocks, ask prompts, allow is silent), and `.mcp.json` gives
  any MCP client the native tools. The hook routes by content and stays out of
  the way when no loop claims a call (pass-through); pin one loop with
  `--loop`, or `--strict` to ask on anything uncovered.

The two layers set up different expectations, and it's worth being precise:
the **context** travels instantly — everyone who clones is under the warrant
with zero setup. The **enforcement hook** asks each developer to approve the
committed hook once, the first time it runs; that prompt is Claude Code's own
safety gate (a cloned repo shouldn't run commands on your machine unattended —
the exact ambient-execution risk docket exists to catch). It's also merge-safe
(existing `settings.json` hooks and MCP servers are preserved), idempotent, and
zero-dependency. Commit `.docket/` and the files above, and the whole team
inherits it on the next `git pull`.

Prefer to wire a single tool by hand? `docket init` → `docket new` →
`docket compile --target <tool> --write` does one target at a time; the
[per-tool setup](https://shahcolate.github.io/docket/docs.html#integrations)
covers each.

No template that fits? Bare `docket new` is a **step-by-step creator**: five
steps, one per layer, each explained as you answer. It previews the finished
file, asks before writing, then runs live allow/ask/deny checks against the
warrant you just wrote — the fastest way to *feel* how the spec works.

Ask the warrant *before* the agent acts:

```console
$ docket check appeal draft "appeal letter"
ALLOW  draft → "appeal letter"
  "appeal letter" is within the draft warrant.

$ docket check appeal send "appeal email to the insurer"
ASK  send → "appeal email to the insurer"
  "appeal email to the insurer" is not listed under `send`.
  Unlisted means ask — silence is never permission.

$ docket check appeal change "accepting a settlement"
DENY  change → "accepting a settlement"
  "accepting a settlement" matches a hard stop. The loop says this
  never happens, with or without approval.
```

That's an agent overreach prevented by a text file. And the default posture
is the important part: the warrant never granted `send` anything, so **every
send asks** — the agent doesn't need to anticipate the exact email to be
stopped by it. The same posture covers the database story: `never: destructive
commands in production` is decided under calm conditions, and no in-the-moment
panic overrides it.

Matching is word-level, stemmed, and **asymmetric**: `ask`/`never` patterns
match fuzzily in both directions (`accepting a settlement` hits `accepting
or rejecting a settlement`), while allow patterns match strictly — a vague
target like `"email"` can never inherit permission from a specific allow
entry like `"status email to the team"`. A phrasing difference can cause an
unnecessary ask, never an accidental allow.

A send wearing a disguise is still a send. The newest failure class in the
suite is the **scheduled escape** — "queue the email for Friday", a git hook
planted in the repo, a CI job that acts next week: actions that look
contained now and detonate after the session, past every approval. The
shipped templates hard-stop them (`scheduled or automated sending`; `git
hooks, CI workflows, or scheduled jobs`), and the
[spec's rule](spec/SPEC.md#deferred-consequences) is general: **an action
classifies by where its consequences eventually land**, not where the bytes
land first. Compound intent gets the same treatment: the matcher splits a
target on conjunctions and requires *every* clause to be warranted, so
"draft the appeal **and send it**" cannot ride the allow for "draft".

We red-team all of this, six ways, on every CI build —
[**10,582 checks**](eval/REPORT.md):

| Suite | Checks | Result |
|---|---|---|
| Behavior scenarios | 61 | 0 silent allows · 21/21 warranted work allowed |
| Adversarial phrasing — euphemism, compound intent, injection, homoglyphs | 42 | 42/42 contained |
| Vague-target probes ("email" vs "status email to the team") | 218 | 0 permissions inherited |
| Fuzzed targets, deterministic seed | 10,000 | 0 allowed |
| Record-tampering mutations | 239 | 239/239 detected |
| Hook gate, live binary vs hostile tool calls | 22 | 0 fail-open |

**Zero silent allows. Zero fail-open outcomes. Zero warranted work blocked.**
Where a paraphrase weakens a hard stop, it weakens to *ask* — never to allow,
and the report says so in the open. Every invariant is enforced by
`npm test`; regenerate every number with `npm run eval`.

Exit codes are part of the contract (`0` allow, `2` ask, `3` deny), so you can
gate hooks, scripts, and CI on the warrant directly.

## On the record, not on trust

Every warrant check and every piece of finished work lands in an append-only,
hash-chained log — each entry commits to the one before it:

```console
$ docket record add appeal \
    --saw "policy §4.2, denial letter 2026-06-12" \
    --did "drafted appeal citing §4.2(b), built evidence list" \
    --stopped "before send — two claims need human verification"
✓ record #4 sha256:fd4394fc8cd4b288…

$ docket record verify
✓ chain intact — 4 entries, every entry commits to the one before it
  head: sha256:fd4394fc8cd4b288…
```

Now edit one character of an old entry:

```console
$ docket record verify
✗ chain broken at entry 4: entry 4 was modified after it was written
  a record that can be edited quietly is not a record
```

A record that can be edited quietly is not a record. This one is a
plain JSONL file you can read, grep, and commit — but not silently rewrite.
And because a hash chain can't see its own tail being cut off, `verify`
prints the head hash: pin it anywhere the log can't reach, then
`docket record verify --head <hash>` catches truncation too.

## Your context, every model

Context locked inside one vendor's assistant is their context, not yours.
Loops are the source of truth; assistant files are build artifacts:

```console
$ docket compile --target claude --write    # → CLAUDE.md
$ docket compile --target agents --write    # → AGENTS.md (ChatGPT/Codex, Zed, …)
$ docket compile --target gemini --write    # → GEMINI.md (Gemini CLI)
$ docket compile --target cursor --write    # → .cursor/rules/docket.mdc
```

Same loops, every tool. **A model switch is a recompile, not a re-teach** —
try the new tool, point it at the same files, keep working.

## Fifty loops, flat context

Compiling every brief and procedure into the context file stops scaling
around a handful of loops — the rules start crowding out the work. So
**rules scale on disk, not in context**:

```console
$ docket compile --index --target claude --write
✓ compiled index of 23 loops → CLAUDE.md
```

`--index` compiles the protocol plus **one line per loop** — name,
description, and the loop's `triggers` — instead of the loops themselves.
The agent routes each task to its loop, then pulls just that loop in full:

```console
$ docket match "draft an appeal for my denied claim"
1 candidate loop for "draft an appeal for my denied claim"

  appeal                 Build the appeal, cite the policy — stop before send.
                         score 14 — name: appeal · trigger: denied claim, denial letter

$ docket match "wire funds to a vendor"
NO LOOP  "wire funds to a vendor"
  No loop covers this task. Work outside a loop defaults to ask
```

Routing is deterministic and scored — loop name, author-written `triggers`
phrases, warrant targets, description overlap — and it **fails closed**: no
match doesn't mean "best guess", it means *stop and ask*, exit code `2`,
same as the warrant. And enforcement never needed context residency at all:
the warrant check runs outside the model and injects the one matched rule
exactly when it becomes relevant. What stays resident is a table of
contents; the window holds one open chapter; the checker never forgets any
of it.

## Agents can use it natively (MCP)

`docket mcp` is a zero-config MCP server. Add it to Claude Code:

```console
$ claude mcp add docket -- npx docket-agent mcp
```

or to any MCP client:

```json
{ "mcpServers": { "docket": { "command": "npx", "args": ["docket-agent", "mcp"] } } }
```

The agent gets five tools:

| Tool | What it does |
|---|---|
| `docket_list_loops` | discover your loops |
| `docket_match_loop` | route a task to the loop that covers it — ranked, fail-closed |
| `docket_loop_context` | pull a loop's five layers before starting |
| `docket_warrant_check` | allow / ask / deny, **before** acting — auto-logged |
| `docket_record` | add a verifiable record entry when it finishes or stops |

Warrant checks made by the agent land in the record too. *"Did the agent
even ask?"* becomes a grep.

## Enforced, not suggested (Claude Code hook)

Compiled context and MCP tools work when the agent cooperates. `docket hook
claude` doesn't need it to. Wired as a Claude Code **PreToolUse hook**, every
intercepted tool call is checked against the warrant *by the harness* —
docket's verdicts map onto Claude Code's permission decisions, whether or not
the model read a word of your rules:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Write|Edit|mcp__.*",
        "hooks": [
          { "type": "command", "command": "npx -y docket-agent hook claude --loop repo-work" }
        ]
      }
    ]
  }
}
```

Put that in `.claude/settings.json`, scope the `matcher` to the tools you
want gated, and the warrant is no longer advice. **deny** blocks the call and
tells the model why; **ask** makes Claude Code prompt you; **allow** stays
silent — docket only ever *tightens* the gate, never bypasses Claude Code's
own prompts. Lookup and edit tools map to `read`/`change`; anything docket
doesn't recognize — Bash, MCP tools, tools that don't exist yet — falls to
`send`, the verb whose allow list most loops keep empty on purpose, so an
unknown tool asks rather than slips through.

Pin one loop with `--loop <name>`; drop it to route each call by content
(add `--strict` to ask when no loop claims a call). Once you name a loop or
pass `--strict`, every failure mode — bad payload, missing project, misnamed
loop — fails **closed** to ask: a gate you asked for that fails open is not a
gate. Gated calls land in the record (`via: "hook"`), so the asks you keep
approving surface in `docket review` — the gate teaches the warrant what to
say next.

## Why not just a sandbox?

Run your agent in one — genuinely, do. Sandboxes (containers, egress
filters, read-only mounts) bound **damage**: what the process can physically
reach. Docket bounds **authority**: what the agent was allowed to do, and
whether you can prove what it did. A sandbox cannot tell the authorized
appeal email from the unauthorized one — both are legitimate HTTPS through
the proxy. The warrant can, and the record shows which one happened.

The two layers meet at the failure that scares us most. A red-team pass on
an agent sandbox found the agent could plant a git hook in a submodule that
would have executed **on the host, days after the session ended**. The
sandbox was secure; the escape was scheduled. That shape of failure is now a
[scenario family](eval/REPORT.md) in our eval suite, a `never` in the
shipped templates, and a rule in the [spec](spec/SPEC.md#deferred-consequences).

And no, the answer to agent risk is not approving every command — airport
security for Bash scripts is the failure mode, not the goal. The warrant
pre-decides `allow` and `deny` under calm conditions so that `ask` stays
rare and means something, and `docket review` retires the asks you keep
approving. The gate's job is to be silent until the moment silence would
have been permission.

## When there's no loop — or you want docket to stay out

Docket is deliberately scoped, and it never invents a verdict for work you
didn't write a loop for. **Retrieval fails open to the human; the warrant
fails closed.** What "no loop covers this" means depends on where you are:

| Surface | No loop covers it | Why |
|---|---|---|
| The hook, default | **pass-through** — docket stays silent, your normal permission flow decides | docket governs what you wrote loops for; it doesn't seize unowned work |
| The hook, `--strict` | **ask** — a human approves anything outside the loops | opt-in "nothing moves without a loop" posture |
| Inside a matched loop, unlisted action | **ask** (the default verdict) | *unlisted means ask — silence is never permission* |
| `docket match <task>` | exit code **2** ("no loop covers it") | so scripts and CI can branch cleanly on "unrouted" |

And if you want docket out of something entirely: it **never executes
anything** — it only ever returns a verdict and appends to the record, so
there's nothing to "turn off" mid-action. Engagement is opt-in per surface —
don't wire the hook and it only answers when explicitly asked; scope the
hook's `matcher` to the tools you actually want gated; and outside a
`.docket` project a bare hook costs nothing.

## OpenClaw and Hermes

**[OpenClaw](https://docs.openclaw.ai)** injects your workspace's `AGENTS.md`
into the agent's system prompt at the start of every session — so compile
straight into the workspace (fitting, given the story that opens this README):

```console
$ cd ~/.openclaw/workspace
$ npx docket-agent init
$ npx docket-agent new followup --template client-follow-up
$ npx docket-agent compile --target agents --write
```

Docket only manages its own marked block inside `AGENTS.md` — your existing
rules, `SOUL.md`, and the rest of the workspace stay untouched. OpenClaw can
also run the MCP server for native checks and record entries: add `docket`
as an MCP server in your OpenClaw config with
`command: npx, args: ["-y", "docket-agent", "mcp", "--dir", "~/.openclaw/workspace"]`.

**[Hermes](https://hermes-agent.nousresearch.com/docs/)** (Nous Research)
reads `AGENTS.md` context files too — run the same three commands in the
directory Hermes works from. For native tools, add docket under the MCP
servers section of `~/.hermes/config.yaml`:

```yaml
docket:
  command: npx
  args: ["-y", "docket-agent", "mcp", "--dir", "/path/to/your/project"]
```

Any other agent that reads `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or speaks
MCP gets the same treatment — one loop file, every agent under the same
warrant.

## Documentation

The full guide — concepts, loop-file reference, the verdict algorithm,
matching semantics, record internals, CLI reference, and per-tool setup —
lives at **[the docs site](https://shahcolate.github.io/docket/docs.html)**.
The normative format definition is the [Loop File Spec](spec/SPEC.md).

## Five questions, then the loop exists

`docket new <name>` interviews you:

1. What must it **know** before it starts?
2. How is this work **supposed to be done**?
3. What may it do **without asking**?
4. Where does it have to **stop**?
5. What **evidence** must it leave behind?

Unwritten answers get guessed at. Written answers get enforced — the
questions *are* the schema: brief, procedure, warrant, reserved, record.

## It iterates itself — with a human veto

The record knows where the warrant chafes: every time the agent hit an
unlisted action, a default-ask was logged. `docket review` mines those and
proposes the exact amendments:

```console
$ docket review
2 proposed amendments — from repeated asks in the record

  1. appeal — allow read: "state insurance regulations" (asked 4×)
  2. appeal — allow draft: "timeline summary" (asked 2×)

allow read: "state insurance regulations" in appeal? [y/N] y
✓ appeal: read now covers "state insurance regulations"
```

Three rules keep it honest: the analysis is automatic but **applying is
always a human keystroke** (an agent that widens its own permissions is the
exact failure docket exists to prevent — it's in our red-team suite);
anything on the `ask` or `never` lists is **never proposed**, however often
it recurs — those are policy, not friction; and every approved amendment is
**appended to the record**, so even the evolution of the rules is auditable.

Run it weekly, or wire it into a cron — the proposals wait for you.

## Starter loops

Eight templates, each a complete worked example (`docket templates`):

| Loop | The gist |
|---|---|
| `prod-hotfix` | diagnose and fix on staging — **production asks, destructive commands never** |
| `insurance-appeal` | build the appeal and the evidence packet, **stop before send** |
| `client-follow-up` | promises made, approved language, tone — approval rules included |
| `travel-morning` | your walking tolerance and food rules, not a guidebook's |
| `weekly-planning` | propose the week and its tradeoffs; **change nothing** |
| `marketing-brain` | marketing memory that compounds; confident vs. unsupportable, in writing |
| `ticket-handoff` | tasks a stranger can pick up cold: source, owner, status, blocker, warrant, record |
| `cross-tool-memory` | one context readable from Claude / GPT / Kimi / Codex |

## What docket is not

Selling this honestly means saying where the edges are:

- **Not a sandbox.** Docket bounds *authority* and proves what happened; a
  sandbox bounds what the process can physically reach. Run both —
  [they compose](#why-not-just-a-sandbox).
- **Not another agent framework.** There is no runtime, server, or account
  to adopt. It's a file format, a checker, and a log — the layer under
  whichever agent you already use.
- **Not a magic cage.** A cooperative agent follows the compiled rules; the
  [hook](#enforced-not-suggested-claude-code-hook) enforces them mechanically
  where you wire it; and either way, every check lands on the record. Each
  layer is exactly as strong as it claims, and no stronger.
- **Not finished.** This is v0.3.x, and the spec may still break before 1.0
  (loop files carry a `version` field for exactly that reason). What won't
  move: unlisted means ask, failures land on the human, and the record stays
  tamper-evident.

## Design principles

- **Plain files, forever.** Markdown + JSONL in your repo. `grep` works,
  `git diff` works, deleting docket loses you nothing but the tooling.
- **Zero dependencies.** `node >= 18` and nothing else. The tool that holds
  your agent's permissions should have a supply chain you can read in an
  afternoon.
- **Unlisted means ask.** The default verdict is the safety property.
- **Describe, don't execute.** Docket is not another agent framework — it's
  the layer under whichever agent you already use. Models stay
  interchangeable; the context stays yours.

Read the [Loop File Spec](spec/SPEC.md) — it's short on purpose.

## Roadmap

- [x] ~~`docket check` as a Claude Code PreToolUse hook~~ — shipped as `docket hook claude`
- [ ] Signed record heads (attest the chain tip, share the attestation)
- [ ] Loop inheritance (`extends:`) for team baselines
- [ ] Record export → human-readable work summaries
- [ ] Adapters: OpenAI custom instructions, Windsurf

## Contributing

The spec is deliberately small — issues that argue about the warrant
algorithm are the best kind. `npm test` runs the whole suite with zero
setup. The fastest ways in: a new [starter template](templates/), or a
red-team scenario that breaks the matcher — if it finds a silent allow,
it goes straight into [the eval suite](eval/REPORT.md) with your name on
it. See [CONTRIBUTING.md](CONTRIBUTING.md).

<a href="https://github.com/shahcolate/docket/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=shahcolate/docket" alt="docket contributors" />
</a>

MIT © docket contributors

---

<div align="center">

*Models come and go. Your context shouldn't.*

</div>
