<div align="center">

# docket

**The permission layer — and the paper trail — for AI agents.**

Before your agent acts, it checks a one-page rule file you wrote: allow, ask,
or deny. After, it leaves a tamper-evident record. Anything you didn't write
down, the agent must ask about. Plain Markdown in your repo; works with
Claude, Codex, Cursor, and any MCP client.

Zero dependencies · plain Markdown + JSONL · MIT

</div>

---

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

We red-team this claim: [42 scenarios](eval/REPORT.md) modeled on real
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

- [ ] Signed record heads (attest the chain tip, share the attestation)
- [ ] `docket check` as a Claude Code PreToolUse hook recipe
- [ ] Loop inheritance (`extends:`) for team baselines
- [ ] Record export → human-readable work summaries
- [ ] Adapters: OpenAI custom instructions, Gemini, Windsurf

## Contributing

The spec is deliberately small — issues that argue about the warrant
algorithm are the best kind. `npm test` runs the whole suite with zero
setup.

MIT © docket contributors

---

<div align="center">

*Models come and go. Your context shouldn't.*

</div>
