# docket and sandboxes: four boundaries, one agent

Run your agent in a sandbox. Genuinely, do — Docker Sandboxes, a devcontainer,
a microVM, gVisor, whatever fits. This document is not an argument against
them. It is an argument that a sandbox and a warrant bound *different things*,
that neither substitutes for the other, and that the seam between them is where
the interesting failures live.

## The four boundaries

An agent doing real work crosses four boundaries, and each one is enforced by a
different mechanism with a different failure mode:

| Boundary | Bounds | Enforced by | Fails when |
|---|---|---|---|
| **Isolation** | what the process can physically reach | microVM / container / gVisor | the guest escapes, or the work legitimately needs the host |
| **Egress** | where bytes may go | network allow/deny lists | the destination is allowed but the *content* shouldn't go |
| **Authority** | what the agent was permitted to do | the warrant (`docket check`, hook, interceptor) | nobody wrote the rule down |
| **Evidence** | what actually happened | the hash-chained record | the log dies with the sandbox |

The first two are about *damage*: how far a mistake can physically propagate.
The second two are about *authority and accountability*: whether the action was
permitted at all, and whether you can prove afterward what was done.

Here is the sentence that matters. **A sandbox cannot tell the authorized
email from the unauthorized one.** Both are legitimate HTTPS through the proxy,
to an allowed host, from a process that is behaving exactly as designed. The
egress list sees a permitted destination. The isolation boundary sees a normal
syscall. Only a rule that says *"this loop may draft an appeal but never send
one"* distinguishes them — and only a record shows which one happened.

The converse is just as true, and docket's README says so first: a warrant is
advice to a cooperative process. It does not stop a compromised agent from
calling `rm -rf /` — a sandbox does. Run both. They fail in different
directions, which is the entire reason to have two.

## The seam: consequences that outlive the sandbox

The two layers meet at one specific failure, and it is the one that should
worry you most.

A red-team pass on an agent sandbox found that the agent could plant a git hook
in a submodule that would execute **on the host, days after the session had
ended**. Nothing escaped. No isolation boundary was violated. The sandbox did
its job perfectly and the attack worked anyway, because the payload was not
data leaving the box — it was a *future action* written into a file the host
would later trust.

Isolation is a boundary in space. That attack is a boundary in time.

This is why docket's spec classifies actions by [where their consequences
eventually land](../spec/SPEC.md#deferred-consequences), not where the bytes
land first, why the shipped templates hard-stop `git hooks, CI workflows, or
scheduled jobs`, and why "scheduled escape" is its own family in the
[red-team suite](../eval/REPORT.md). A sandbox has no opinion about next
Tuesday. A warrant does.

## Mount the record, or the evidence dies with the box

A sandbox is *designed* to be disposable. That is its best property and, for
an audit trail, its worst.

If the record is written inside the sandbox's filesystem, then the moment the
sandbox is torn down — which is the normal, intended, happy path — you lose
the answer to "what was the agent allowed to do, and what did it do?" You are
back to reconstructing the session from memory, which is exactly the state
docket exists to get you out of.

So: **mount `.docket` from the host.**

```console
$ docker run --rm -it \
    -v "$PWD:/work" \
    -v "$PWD/.docket:/work/.docket" \
    your-agent-image
```

The rules travel *into* the sandbox — the compiled `CLAUDE.md` / `AGENTS.md`
and the loop files are just repo contents, so the agent inside is under the
same warrant as the agent outside. The evidence travels *out* — every warrant
check and every note lands on the host's hash-chained log, which is still there
when the container is not.

Two properties make this safe to share across parallel sandboxes:

- **Appends are serialized** across processes (an exclusive lock file), so
  three agents in three sandboxes writing at once cannot break the chain and
  raise a tamper alarm nobody caused.
- **Every entry is attributed** — `by`, `branch`, `worktree`, `session` — so at
  merge time you can still tell which sandbox did what. See
  [attribution](../README.md#who-did-what-attribution-for-parallel-agents).

And when the run is over, sign the head:

```console
$ docket record sign
✓ signed the record at 47 entries
```

The signed attestation is portable proof of what the log contained at that
moment — which catches a tail being cut off later, even after the log grows
back. A disposable environment plus a durable, signed record is a much better
combination than either alone.

## Gating the tools, not just the process

Isolation bounds what the *process* can reach. But an agent's most
consequential actions increasingly do not go through the process at all — they
go out over MCP, to a mail server, a ticket tracker, a cloud API, a payments
provider. Those calls leave through a socket the sandbox is entirely happy to
permit.

That is the boundary [`docket intercept`](../README.md#the-gateway-gate-every-mcp-tool-call)
gates. Wired into the Docker MCP Gateway, every `tools/call` from any client to
any server is checked against the warrant before it runs:

```console
$ docker mcp gateway run \
    --interceptor 'before:exec:docket intercept --loop deploy'
```

or, with no Node on the host, as a container:

```console
$ docker mcp gateway run \
    --interceptor 'before:docker:docket-agent intercept --loop deploy'
```

Now all four boundaries are in place at once, and each is doing the job it is
actually good at: the microVM bounds reach, the egress list bounds
destination, the warrant bounds authority, and the record — mounted from the
host, signed at the end — proves what happened.

## What this does not give you

Stating the edges plainly, because a security story that only lists wins is a
marketing document:

- **The interceptor gates the gateway, not the world.** An agent with a shell
  inside the sandbox can still `curl` — that call never touches the gateway, so
  the warrant never sees it. Egress rules and the [PreToolUse
  hook](../README.md#enforced-not-suggested-claude-code-hook) cover that path;
  the interceptor covers the MCP path. Neither covers both.
- **`ask` cannot prompt at the gateway.** There is no human on that connection,
  so an action needing approval is *blocked*, not queued. Tighter than the
  hook, and deliberately so — but it means a gateway-fronted workflow stops
  dead on anything unlisted, rather than waiting for a yes.
- **A mounted record is as durable as the host.** Mounting moves the evidence
  out of the disposable layer; it does not replicate it. If the host is the
  thing you distrust, sign the head and put the attestation somewhere else.
- **`by` is self-reported.** It is provenance, not authentication — a process
  that can write to the record can claim any subject. What the chain guarantees
  is that the claim cannot be *revised* later.
