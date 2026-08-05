# The warrant in front of the Docker MCP Gateway

The [Docker MCP Gateway](https://github.com/docker/mcp-gateway) puts one
governed connection between your agents and the MCP servers they use. It
already ships interceptors for the things a gateway should catch generically —
secrets in payloads, OAuth failures. `docket intercept` adds the thing a
gateway cannot know on its own: **whether this particular action was
permitted, for this particular job, by the person accountable for it.**

## The contract

The gateway runs an interceptor as `--interceptor <when>:<type>:<argument>` and
speaks to it over stdio:

- **stdin** — the tool-call request, `{"params":{"name":…,"arguments":{…}}}`
- **stdout, empty** — the gateway calls the real tool
- **stdout, a `CallToolResult`** — the gateway returns *that* and the tool is
  never called
- **stderr** — the gateway's logs

Docket maps its verdicts onto that contract:

| Verdict | What docket writes | What happens |
|---|---|---|
| `allow` | nothing | the tool runs |
| `ask` | a `CallToolResult`, `isError: true` | **blocked** — see below |
| `deny` | a `CallToolResult`, `isError: true` | blocked, with "do not retry by another route" |

**`ask` blocks — it does not ask.** A gateway has no human on the connection to
prompt. At a Claude Code hook, `ask` raises a prompt someone can approve; here
there is nobody to approve it, so the call simply does not run and the message
tells the model to get approval out of band. That is strictly tighter than the
hook, which is the only direction docket is allowed to differ across surfaces —
but it means a gateway-fronted workflow stops dead on anything unlisted, rather
than waiting for a yes. Configure the loop's warrant accordingly.

## Running it

```console
$ docker compose up --build
```

Or wire it into a gateway you already run:

```console
# node on the host
$ docker mcp gateway run --interceptor 'before:exec:docket intercept --loop research'

# no node on the host
$ docker mcp gateway run --interceptor 'before:docker:docket-agent intercept --loop research'
```

Drop `--loop` to route each call to whichever loop covers it, and add
`--strict` to block anything no loop claims. Without either flag the
interceptor is *ungated*: it stays silent outside a docket project and passes
through calls no loop claims, so it is safe to wire globally.

## Verbs

Every tool behind a gateway is a third-party tool docket has never seen, so
there is no honest way to infer a verb from a name — a tool called
`search_and_purge` reads like a read. Everything therefore defaults to `send`,
the verb whose allow list loop authors keep shortest on purpose.

`--action read` overrides that for a gateway you know fronts read-only servers.
It is a real widening: get it wrong and you have handed write-shaped tools the
permissions you wrote for reads.

## What lands on the record

Every gated call, allowed or blocked:

```console
$ docket record log
#12 2026-08-05 11:02Z research allow read → "duckduckgo_search: docker mcp gateway" (read: the web)  ← claude-code @ main
#13 2026-08-05 11:02Z research ask   send → "gmail_send_email: results@example.com"   (default)      ← claude-code @ main
```

`via: "gateway"` distinguishes these from hook-gated and CLI checks, and
`docket review` will surface the asks you keep hitting — the gate teaches the
warrant what to say next.
