# Launch copy

Assets for launching docket. Keep claims tied to `eval/REPORT.md` numbers —
everything here must stay reproducible by `npm test && npm run eval`.

## The ten-second version (say this first, to anyone)

AI agents now act on your behalf — send the email, move the meeting, change
the record. Docket is the permission layer and the paper trail: before an
agent acts it checks a one-page rule file you wrote (allow / ask / deny —
anything unwritten means ask), and after, it leaves a tamper-evident record
of what it did. Works with the AI tools you already use.

---

## Show HN

**Title:**
Show HN: Docket – plain-file warrants and records for AI agents

**Body:**

Agents stopped failing in chat and started failing in your inbox. When a
model misreads you now, you don't get a wrong paragraph back — you get a sent
email, a filed ticket, a changed record. There's a widely shared story from
January of an agent that, when its owner ignored a drafted insurance appeal,
took the silence as a yes and sent it to the insurer itself.

Docket is a zero-dependency CLI + file format that makes an agent's
permissions a file instead of a vibe, and its work auditable instead of
asserted.

You define loops — one recurring task per Markdown file, five layers: what
the agent must know, how the work is done, what it may read/draft/change/send
on its own, what stays human, and what evidence it owes when it stops —
brief, procedure, warrant, record, reserved.

Then:

- `docket check <loop> send "appeal email to the insurer"` → ALLOW / ASK /
  DENY, deterministically, with the rule that fired. Anything unlisted → ASK.
  Exit codes 0/2/3 so hooks and CI can gate on it.
- Every check and every piece of finished work lands in a hash-chained JSONL
  record. `docket record verify` catches any edit, deletion, or
  reordering; `--head` pins against tail truncation. "Did the agent even
  ask?" becomes a grep.
- `docket compile` renders your loops into CLAUDE.md, AGENTS.md, GEMINI.md,
  or Cursor rules from one source of truth — the same rules govern Claude,
  ChatGPT/Codex, Gemini, Cursor, OpenClaw, and Hermes. Moving to a new tool
  is a recompile, not a re-teach.
- `docket review` mines the record for actions the agent kept asking about
  and proposes the exact rule updates — a human approves each one, and the
  approval is logged too. The rules iterate; the agent never widens its own
  permissions.
- `docket mcp` exposes it all to agents natively (warrant checks the agent
  makes land in the record too).
- `docket hook` turns the warrant into a Claude Code PreToolUse gate:
  allow/ask/deny applied by the harness on every intercepted tool call —
  enforced, not suggested — and every failure mode degrades to ask, never
  to a silent allow.

Zero dependencies, node >= 18, MIT. We red-team the warrant engine in CI:
51 scenarios modeled on real agent-overreach incidents, zero silent allows,
zero warranted work blocked — and the matcher is asymmetric by
construction, so a phrasing difference can cause an unnecessary ask but
never an accidental allow. `npm run eval` regenerates the report.

Install: npm i -g docket-agent · Docs: https://shahcolate.github.io/docket/docs.html

I'd especially love argument about the verdict algorithm (never → ask →
allow-list → default-ask) and what belongs in v1 of the spec.

---

## One-liner variants

- The permission layer — and the paper trail — for AI agents.
- Your agent's permissions shouldn't be a vibe in a prompt. Docket makes them
  a file — checked before it acts, on the record after.
- Everyone is shipping agent memory. Nobody is shipping the other half:
  proof of what the agent was allowed to do, and proof of what it did.
- Brief the agent. Warrant the actions. Keep the record.

## Tweet / post thread

1/ Agents stopped being wrong in chat and started being wrong in your inbox.
The new failure mode isn't a bad answer — it's a sent email nobody approved.

2/ More memory doesn't fix that. Every lab ships memory. The missing layer
is permission: what exactly was the agent allowed to do — and can you prove
it?

3/ docket: one Markdown file per recurring task. Its five layers: brief,
procedure, warrant, record, reserved — what it must know, how the work is
done, what it may do, what it must prove, what stays human.

4/ `docket check appeal send "appeal email to the insurer"` → ASK.
Deterministic. Logged. Exit code 2, so your hooks can enforce it.
Anything unlisted → ask. Silence is never permission.

5/ The record is hash-chained JSONL. Edit one character of history and
`docket record verify` names the exact entry. A record you can quietly
rewrite is not a record.

6/ And it's portable: loops compile to CLAUDE.md, AGENTS.md, GEMINI.md,
Cursor rules — Claude, ChatGPT, Gemini, Cursor, OpenClaw, and Hermes under
one warrant. A model switch is a recompile, not a re-teach.

7/ The rules iterate themselves: docket review finds what the agent kept
asking about and proposes the exact amendments. You approve; the approval
is logged. The agent never widens its own permissions.

8/ Zero dependencies. Plain files. MIT. Red-teamed in CI: 51 scenarios,
zero silent allows.
npm i -g docket-agent · github.com/shahcolate/docket

## The pitch in one paragraph (for directories / newsletters)

When an AI agent guesses wrong today, you don't get a bad draft back — you
get a bad action with your name on it. Docket makes agent autonomy governed
and auditable. You write one page of plain-English rules per recurring task:
what the agent must know, how the job is done, what it may do alone, what
stays human. Before acting, the agent gets a deterministic verdict — allow,
ask, or deny; anything not written down defaults to ask. After acting, it
leaves a hash-chained record of what it saw, did, and where it stopped —
evidence you can hand to a client or a compliance review. The rules and the
record are plain files in your repo, compiled to Claude, ChatGPT/Codex,
Gemini, Cursor, OpenClaw, and Hermes from one source, so there's no platform
to adopt and no vendor to be locked into. And it improves with use: docket
review turns repeated asks into proposed rule updates a human approves.
Zero dependencies, MIT.

## Who hears what

- **Executive**: agent risk becomes governed (written, versioned, reviewable
  permissions) and auditable (tamper-evident action log) — without betting
  on a single AI vendor.
- **Product builder**: a file format + CLI, not a platform. Deterministic
  verdicts with exit codes you can gate CI and hooks on, a JSONL audit chain,
  an MCP server, zero dependencies.
- **Individual**: your agent stops guessing what you meant. It drafts the
  fight; it never sends without you.

## Business value framing (for the deck / sales page)

- **Risk**: agent overreach is an incident class now (unauthorized outbound
  email, calendar changes, invented commitments). Docket is the pre-action
  gate + post-action audit trail: measured zero silent allows across a
  51-scenario red-team suite, reproducible with `npm run eval`.
- **Cost**: context is rebuilt per-tool and per-chat today. One set of loop
  files compiled to every assistant removes the rebuild tax and the vendor
  lock-in.
- **Trust**: a hash-chained record turns "what did the agent do while I was
  out?" into an auditable artifact you can hand to a client, a manager, or a
  compliance review.
- **Adoption cost**: zero dependencies, plain Markdown in the repo you already
  have, no new service to run. Delete it and you keep all your files.
