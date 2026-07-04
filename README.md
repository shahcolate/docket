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

**Install:** `npm install -g docket-agent` · **Docs:**
[shahcolate.github.io/docket/docs.html](https://shahcolate.github.io/docket/docs.html)

Zero dependencies · plain Markdown + JSONL · MIT

</div>

---

## News

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

It's already happened in the wild: in early 2026 a user reported that his
agent, having drafted an appeal for a denied insurance claim, **sent it to
the insurer on its own** when he ignored the draft — it took silence plus
frustration as a yes.

So the question that matters isn't *"what does the AI know?"* It's:

> **What exactly was the agent allowed to do — and can you prove it?**

Docket makes the answer a file instead of a vibe.

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

## Sixty seconds

```console
$ npm install -g docket-agent   # or: npx docket-agent <command>
$ docket init
✓ created .docket

$ docket new appeal --template insurance-appeal
✓ wrote .docket/loops/appeal.loop.md
```

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

That's the frustrated-customer story, prevented by a text file. And the
default posture is the important part: the warrant never granted `send`
anything, so **every send asks** — the agent doesn't need to anticipate the
exact email to be stopped by it.

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
land first.

We red-team all of this: [51 scenarios](eval/REPORT.md) modeled on real
agent-overreach incidents run against the shipped templates on every CI
build — **zero silent allows, and zero warranted work blocked**.
Reproduce it yourself with `npm run eval`.

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

## Agents can use it natively (MCP)

`docket mcp` is a zero-config MCP server. Add it to Claude Code:

```console
$ claude mcp add docket -- npx docket-agent mcp
```

or to any MCP client:

```json
{ "mcpServers": { "docket": { "command": "npx", "args": ["docket-agent", "mcp"] } } }
```

The agent gets four tools:

| Tool | What it does |
|---|---|
| `docket_list_loops` | discover your loops |
| `docket_loop_context` | pull a loop's five layers before starting |
| `docket_warrant_check` | allow / ask / deny, **before** acting — auto-logged |
| `docket_record` | add a verifiable record entry when it finishes or stops |

Warrant checks made by the agent land in the record too. *"Did the agent
even ask?"* becomes a grep.

## Enforced, not suggested (Claude Code hook)

Compiled context and MCP tools work when the agent cooperates. `docket hook`
doesn't need it to. Wired as a Claude Code **PreToolUse hook**, every
intercepted tool call is checked against the warrant *by the harness* —
docket's three verdicts map one-to-one onto Claude Code's permission
decisions, whether or not the model read a word of your rules:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|Bash|mcp__.*",
        "hooks": [
          { "type": "command", "command": "npx -y docket-agent hook --loop repo-work" }
        ]
      }
    ]
  }
}
```

Put that in `.claude/settings.json`, scope the `matcher` to the tools you
want gated, and the warrant is no longer advice. Lookup tools map to `read`,
local edits and Bash to `change`, and anything docket doesn't recognize —
MCP tools included — to `send`, the verb whose allow list most loops keep
empty on purpose. Every failure mode (bad payload, missing project,
ambiguous loop) degrades to `ask`, never to a silent allow: a gate that
fails open is not a gate.

Gated calls land in the record like every other check (`via: "hook"`), so
the asks you keep approving surface in `docket review` — the gate teaches
the warrant what it should say next.

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

Seven templates, each a complete worked example (`docket templates`):

| Loop | The gist |
|---|---|
| `insurance-appeal` | build the appeal and the evidence packet, **stop before send** |
| `client-follow-up` | promises made, approved language, tone — approval rules included |
| `travel-morning` | your walking tolerance and food rules, not a guidebook's |
| `weekly-planning` | propose the week and its tradeoffs; **change nothing** |
| `marketing-brain` | marketing memory that compounds; confident vs. unsupportable, in writing |
| `ticket-handoff` | tasks a stranger can pick up cold: source, owner, status, blocker, warrant, record |
| `cross-tool-memory` | one context readable from Claude / GPT / Kimi / Codex |

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

- [x] ~~`docket check` as a Claude Code PreToolUse hook recipe~~ — shipped as `docket hook` in v0.3.0
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
