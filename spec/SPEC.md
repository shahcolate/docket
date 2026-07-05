# The Loop File Spec — v0.1

Status: draft. Breaking changes possible until v1.0; the `version` field in
frontmatter exists so files can survive them.

## Why a spec

An agent's permissions shouldn't live in a prompt someone improvised at 11pm.
A loop file is a small, human-writable document that answers, in order:

1. What must the agent **know** before it starts?
2. How is this work **supposed to be done**?
3. What may it do **without asking**?
4. Where does it have to **stop**?
5. What **evidence** must it leave behind?

Unwritten answers get guessed at. Written answers can be enforced — checked,
compiled, and audited by tools.


## File format

A loop is a single file, `<name>.loop.md`, stored in `.docket/loops/`. It is
Markdown with YAML frontmatter:

```markdown
---
name: insurance-appeal
description: Build the appeal, cite the policy — stop before send.
version: 1
warrant:
  read:
    - policy documents
  draft:
    - appeal letter
  change: []
  send: []
  ask:
    - anything addressed to the insurer
  never:
    - accepting or rejecting a settlement
reserved:
  - signing and sending
record:
  - every policy clause cited
  - where the draft stopped
---

# Brief

Prose. What the agent must know before it starts.

# Procedure

Prose. How this job is done properly.
```

Prose layers (brief, procedure) live in the Markdown body because humans
write and diff prose well. Machine layers (warrant, record, reserved) live
in frontmatter because tools enforce structure well.

### Frontmatter fields

| Field | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | yes | `[a-z0-9][a-z0-9-]*`; must match the filename |
| `description` | string | no | one line, shown in listings and compiled context |
| `version` | number | no | spec version, default `1` |
| `goal` | string | no | the outcome the loop is trying to reach (not an activity) |
| `warrant` | map | no | see below |
| `triggers` | list of strings | no | phrases that mark a task as this loop's job; used only for routing (see below) |
| `stop` | list of strings | no | conditions under which the run is done; the agent halts at any of them |
| `budget` | map of scalars | no | ceiling on the run (`tokens`, `attempts`, `parallelism`, `time`, …) |
| `reserved` | list of strings | no | what stays with the human, always |
| `record` | list of strings | no | what the agent must report when it finishes or stops |

### The loop as an agent contract

A run that matters should be preceded by a contract: what it's for, what it
may do, when to stop, what it must prove. A loop file *is* that contract, and
the frontmatter fields map onto it directly:

| Contract question | Loop field |
|---|---|
| What outcome? | `goal` |
| What may it do / where must it ask / what's forbidden? | `warrant` (read/draft/change/send, `ask`, `never`) |
| When does it stop? | `stop` |
| What stays human? | `reserved` |
| What must it prove? | `record` |
| What's the ceiling on the run? | `budget` |

`goal`, `stop`, and `budget` are **descriptive** — they are compiled into the
agent's context so it knows its own contract, but docket does not execute, so
it cannot *enforce* a token budget or evaluate a stopping condition itself.
Enforcement of *actions* is the warrant's job (checked outside the model, and
optionally gated by the hook); `stop`/`budget` bound the *run*, and belong to
whatever harness runs the agent. Writing them down is what makes an autonomy
level defensible — the agent, the human, and any reviewer see the same
contract.

### Body sections

Headings (`#`, `##`, or `###`) named exactly `Brief` or `Procedure`
(case-insensitive) open the prose layers. Every other line — subheadings,
other headings, comments inside fenced code blocks — is **content** and
belongs to the open section. Prose the human wrote is never silently dropped
from the compiled context.

`name` must match the filename (`<name>.loop.md`) and parsers must reject a
mismatch — otherwise record entries get attributed to a loop that cannot be loaded.
Parsers must also reject a `version` they don't understand rather than
silently misreading a newer format.

### YAML subset

Frontmatter is parsed by a deliberately small YAML subset: nested maps, lists
of scalars, quoted/unquoted scalars, booleans, numbers, `null`, `[]`, and `#`
comments. No anchors, no multi-line scalars, no flow collections, no lists of
maps. A grammar small enough to audit is part of the security posture.

## The warrant

Four verbs, in escalating order of consequence:

| Verb | Meaning |
|---|---|
| `read` | look at it |
| `draft` | produce it, but it goes nowhere on its own |
| `change` | mutate state that stays inside the sandbox |
| `send` | consequences leave the sandbox: email, publish, file, deploy, pay |

### Deferred consequences

An action classifies by where its consequences **eventually land**, not where
the bytes land first. A send with a timer on it is a `send`, whatever the
tool call looks like at the moment it happens. Scheduling an email, queueing
a post, creating an automation, planting anything that executes later — a git
hook, a CI workflow, a cron job, a shell startup file — all carry their
consequences past the moment of approval, and past the session itself. This
escape is real, not hypothetical: a red-team pass on an agent sandbox found
the agent could plant a git hook in a submodule that would have executed on
the host days after the session ended. The sandbox was secure; the escape was
scheduled.

The verdict algorithm already contains the novel cases — an unanticipated
deferred action is unlisted, and unlisted means ask (rule 4 below). But loop
authors should pre-decide the common vectors explicitly: put scheduling and
automation on the `ask` or `never` list of any loop whose `send` list is
empty on purpose. The shipped templates do (`scheduled or automated sending`,
`git hooks, CI workflows, or scheduled jobs`), and the scheduled-escape
family in the [red-team suite](../eval/REPORT.md) holds them to it.

Plus two cross-cutting lists:

- `ask` — always requires human approval, whatever the verb.
- `never` — does not happen, even with approval. A `never` is the human
  pre-deciding under calm conditions what no amount of in-the-moment
  persuasion may undo.

### The verdict algorithm

Given a loop, an action (one of the four verbs), and a target (a plain-language
description of what the action touches), the verdict is the **first** rule
that matches:

1. target matches an entry in `never` → **deny**
2. target matches an entry in `ask` → **ask**
3. target matches an entry in the action's own list → **allow**
4. otherwise → **ask**

Rule 4 is the heart of the spec: **unlisted means ask. Silence is never
permission.** An agent that encounters something the loop's author didn't
anticipate has, by construction, encountered something that needs a human.

### Pattern matching

All matching is case-insensitive, and it is **asymmetric by design**:
`ask`/`never` patterns match fuzzily in both directions, allow patterns match
strictly. A phrasing difference may cause an unnecessary ask; it must never
cause an accidental allow.

Shared rules:

- A pattern containing `*` is a glob over the entire target (author-explicit,
  both modes).
- Commas, ` or `, and ` and ` split a pattern into alternatives, each tried
  separately — natural-language lists (`secrets, tokens, or passwords`) are
  lists. The Oxford comma is absorbed: the last alternative is `passwords`,
  never `or passwords`.
- *Content words* exclude filler (`a`, `the`, `anything`, `to`, `of`, …).
  Words compare under light candidate-set stemming (possessive `'s`, and
  `-s`/`-es`/`-ed`/`-ing` when enough of the word remains), so `quotes`
  matches `quote` and `contacting` matches `contact`.
- An alternative whose words are all filler (`anything`) matches **every**
  target — its plain meaning.

Per alternative:

- **Cautious mode** (`ask`, `never`): matches on substring in either
  direction, or content-word subset in either direction. Ambiguity escalates
  to the human.
- **Strict mode** (allow lists): the target must *cover* the pattern —
  contain it as a substring, or contain every one of its content words. The
  reverse never allows: the target `email` does not match the allow entry
  `status email to the team`.

Known limitation: a target that embeds an allowed phrase plus extra intent
(`status email to the team and also wire funds`) still covers the pattern.
The check is a pre-action gate for cooperative agents, not a parser of
compound intent — `ask` and `never` lists screen every target first, so list
the consequences you fear there.

Write `ask`/`never` patterns short and broad (`contacting the insurer`), and
allow-list patterns as concrete nouns (`appeal letter`). When a check that
should have matched falls through, the verdict is still `ask` (rule 4) — the
system degrades toward the human, never away.

### Exit codes

`docket check` exits `0` for allow, `2` for ask, `3` for deny (and `1` for
usage errors), so shells, hooks, and CI can gate on the warrant directly.

## Routing: which loop covers this task?

With more than a handful of loops, the agent should not hold every brief and
procedure in context — it holds an index and pulls one loop at a time (see
*Compiled context* below). Something then has to answer "which one?", and it
must be deterministic: `docket match "<task>"` / the `docket_match_loop` MCP
tool.

Scoring is lexical, integer-weighted, and reuses the warrant's cautious
matcher (patterns split into alternatives; content words compare under
stemming):

| Signal | Weight | Notes |
|---|---|---|
| loop `name`, read as a phrase (dashes as spaces) | +5 | qualifies on its own |
| each matching `triggers` entry | +4 | qualifies on its own |
| each matching warrant pattern (any list) | +1 | capped at +3 per loop |
| each distinct content word shared with `description` | +1 | capped at +3 per loop |

Candidates need a score of **3** or more; they rank by score, then name, and
implementations should return a short list (default 3) for the agent — or the
human — to make the final pick from.

Two rules matter more than the weights:

- **The asymmetry principle inverts at routing time.** The warrant matches
  allow-entries strictly because a false allow is an incident. Routing
  matches generously because a false candidate costs one extra index line —
  and a routing miss is still caught downstream by the warrant.
- **Retrieval fails closed.** When nothing clears the bar, the answer is not
  "best guess" — it is *no loop covers this task, ask the human*. `docket
  match` exits `2` (the same exit as an `ask` verdict) so hooks can gate on
  it; `0` means matched, `1` a usage error.

Routing is advisory and read-only: a match is not an action, so it is not
written to the record. The warrant checks that follow are.

## The record

The record is the audit half of the trust story: *what did the agent see,
do, leave alone, and where did it stop?*

Storage: `.docket/record.jsonl`, one JSON object per line, append-only.

```json
{"seq":3,"ts":"2026-07-03T10:15:00.000Z","loop":"insurance-appeal","kind":"check","action":"send","target":"appeal email to insurer","verdict":"ask","rule":"ask: anything addressed to the insurer","prev":"sha256:…","hash":"sha256:…"}
```

Three kinds today:

- `check` — a warrant check, recorded automatically with its verdict. The
  question "did the agent even ask?" becomes answerable.
- `note` — a work entry with any of: `saw`, `did`, `skipped`, `stopped`,
  `note`.
- `amend` — a human-approved warrant widening (`action`, `added`, `asks`),
  written by `docket review`. Rule changes are evidence too.

### The hash chain

Each entry commits to the previous one:

```
hash = "sha256:" + SHA256( prev + "\n" + canonical(entry minus hash) )
```

where `canonical` is JSON with lexicographically sorted keys, and `prev` is the
previous entry's `hash` (the literal string `GENESIS` for entry 1). `seq` must
increase by exactly 1.

`docket record verify` recomputes the chain. Any edit, deletion, insertion,
or reordering **inside** the log breaks it at a specific entry. One case the
chain alone cannot see: truncating the tail leaves a valid shorter chain.
That's why `verify` prints the current head hash — pin it somewhere the log
can't reach (a password manager, a commit message, another machine) and check
with `docket record verify --head <hash>`, which reports likely truncation
when the heads disagree. The chain doesn't stop tampering — it's a plain
file — it makes tampering **visible**, which is what an audit trail is for.
(Cryptographically signing the head is on the roadmap.)

### Derived metrics

Because every check carries its verdict, the record is enough to report an
agent's **autonomy posture** without collecting anything new. `docket metrics`
derives it: the auto-approve / ask / deny split, the longest unattended run
(consecutive `allow` checks with no human stop between them), a proxy for
actions-per-intervention (checks ÷ asks+denies), amendment count, and a
per-loop and per-channel breakdown. Every number is exact from the hash chain
except proxies, which must be labeled as such — the record can measure actions
and their verdicts, not wall-clock or human intent.

## Review

`docket review` clusters repeated default-ask checks from the record and
proposes the corresponding warrant additions. Implementations must not apply
proposals without explicit human approval, must never propose targets that
match the loop's `ask` or `never` lists, and must append an `amend` entry to
the record for every applied change.

## Compiled context

Loops are the source of truth; assistant-specific files are build artifacts.
`docket compile` renders loops into a fenced block:

```
<!-- docket:begin — generated by `docket compile`, do not edit by hand -->
…
<!-- docket:end -->
```

and (with `--write`) inserts or replaces that block in the target file:

| Target | File |
|---|---|
| `claude` | `CLAUDE.md` |
| `agents` | `AGENTS.md` (ChatGPT/Codex, Zed, …) |
| `gemini` | `GEMINI.md` (Gemini CLI) |
| `cursor` | `.cursor/rules/docket.mdc` |
| `raw` | stdout |

Content outside the markers is never touched. Because every target renders
from the same loops, moving to a new tool is a recompile, not a re-teach.

### The index: rules scale on disk, not in context

The full render puts every brief and procedure in the agent's context on
every turn — O(loops × loop size), which crowds out the actual work as loops
accumulate. `docket compile --index` renders the same managed block in
**tiers** instead:

- **Tier 0 — protocol** (invariant with loop count): find the loop, load it,
  check the warrant before acting, ask when nothing covers the task.
- **Tier 1 — index**: one line per loop — name, description, triggers. The
  routing table.
- **Tier 2 — the active loop**: loaded on demand via `docket compile --loop
  <name>` or `docket_loop_context`, only for the task at hand.

Enforcement never needed residency at all: the warrant check runs outside the
model, and its verdict text carries the one matched rule into the
conversation exactly when it becomes relevant. The index and the full render
use the same markers, so switching modes replaces the block rather than
stacking a second one. `docket compile` prints a token estimate and suggests
`--index` when the full render grows past a few thousand tokens.

## MCP tools

`docket mcp` serves five tools over stdio (newline-delimited JSON-RPC,
protocol `2024-11-05`). MCP hosts often spawn servers with a cwd far from
your project, so the server resolves its project from `--dir <path>` (or
`DOCKET_DIR`), falling back to walking up from cwd — and it always answers
`initialize`, reporting a missing project as a tool error instead of dying
before the handshake.

| Tool | Purpose |
|---|---|
| `docket_list_loops` | discover the loops |
| `docket_match_loop` | route a task to the loop that covers it (ranked, fail-closed) |
| `docket_loop_context` | fetch a loop's five layers before starting work |
| `docket_warrant_check` | get an allow/ask/deny verdict **before** acting; auto-recorded as a `check` entry |
| `docket_record` | append a `note` entry to the record |

## The harness hook

Compiled context and MCP tools are cooperative surfaces — they work when the
agent consults them. `docket hook` is the structural one: wired as a Claude
Code **PreToolUse hook**, it gates every intercepted tool call through the
warrant whether or not the model read anything.

The contract:

- **stdin** — the PreToolUse payload: `{"tool_name": "...", "tool_input":
  {...}, "cwd": "..."}`.
- **stdout** — `{"hookSpecificOutput": {"hookEventName": "PreToolUse",
  "permissionDecision": "allow"|"ask"|"deny", "permissionDecisionReason":
  "..."}}`. The three verdicts map one-to-one onto the harness's decisions.
- **exit code** — always `0`; the decision travels in the JSON.

Tool names map to warrant verbs: lookup tools (`Read`, `Glob`, `Grep`,
`WebFetch`, `WebSearch`, …) are `read`; local mutations (`Write`, `Edit`,
`NotebookEdit`, `Bash`) are `change`; **everything else — MCP tools, unknown
tools — is `send`**, the verb whose allow list is most often empty on
purpose. The target is the tool name plus its most human-meaningful input
(command, file path, URL), so `ask`/`never` patterns and author-explicit
globs match what a human would say the call touches.

Implementations must **fail toward ask, never open**: a malformed payload, a
missing `.docket`, an ambiguous loop (pass `--loop <name>` when more than one
exists) all yield an `ask` decision with the reason, not an allow. Every
gated call is appended to the record as a `check` entry (`via: "hook"`).

## What this spec refuses to do

- **No secrets in loop files.** Loops are meant to be committed and shared.
- **No execution.** A loop describes and constrains work; it is not a workflow
  engine. The agent you already use does the work.
- **No lock-in.** Everything is plain text in your repo. Deleting docket loses
  you nothing but the tooling.
