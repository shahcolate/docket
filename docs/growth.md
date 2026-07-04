# Growth playbook

What actually makes high-star agent/RAG repos take off, distilled from
studying [RAG-Anything](https://github.com/HKUDS/RAG-Anything) (~22k stars)
and its HKUDS siblings — and what docket copies, what it adapts, and what it
deliberately skips. Companion to [launch.md](launch.md), which holds the
copy; this file holds the machine.

## The secret sauce, itemized

1. **The name is the search term.** "RAG-Anything" *is* the query its
   audience types. Docket's category is "agent permissions / guardrails /
   audit" — we can't rename, so the tagline, GitHub description, and topics
   have to carry the keywords instead (see checklist).
2. **An ecosystem halo.** Every HKUDS repo cross-links the others
   ("Related Projects"), so each launch starts with a warm audience. Docket
   has no sibling repos — the substitute is being *listed in other people's
   ecosystems*: MCP registries, awesome-lists, the OpenClaw/Hermes
   integration docs.
3. **A credibility artifact.** RAG-Anything has an arXiv paper + BibTeX
   citation block. Docket's equivalent is the reproducible red-team report
   (`eval/REPORT.md`, `npm run eval`) — a *falsifiable claim* (zero silent
   allows) beats an unfalsifiable pitch. Lead with it everywhere.
4. **Visible momentum.** A dated News section, release cadence, star-history
   chart, download badges. Momentum signals are compounding: people star
   what looks alive.
5. **A contributor funnel with a low first step.** RAG-Anything grows on
   parser/example contributions; docket's equivalents are **starter
   templates** and **red-team scenarios** ("break the matcher and your name
   ships in the eval suite") — both now have issue templates and
   `good first issue` labels.
6. **Community capture at the top of the README.** Discord/WeChat badges
   above the fold. Requires a channel to exist first (checklist).
7. **Bilingual README.** A large share of stars on agent-tooling repos come
   from the Chinese dev community; RAG-Anything ships English + 中文.
   Docket now ships `README.zh.md`.
8. **Ten-second skimmability.** Logo, badges, one image that shows the
   product. Docket's banner (`docs/assets/banner.svg`) shows an actual
   `ASK` verdict — the product in one frame.

What we deliberately **don't** copy: the neon gradients, typing-animation
GIFs, and emoji-dense section headers. Docket's voice is restrained and
plain-file; a README that looks like a slot machine would undercut the
"supply chain you can read in an afternoon" pitch. Copy the mechanics, keep
the voice.

## Checklist — needs a human (repo settings / accounts)

- [ ] **Rename the default branch to `main`.** It is currently a
  `claude/...` working branch — CI (`.github/workflows/ci.yml`) only
  triggers on pushes to `main`, so the CI badge shows *no status* and
  visitors land on WIP. Settings → Branches → switch default, then
  `git branch -m main` locally. This one is a prerequisite for half the
  items below.
- [ ] **Set GitHub topics**: `ai-agents`, `agent-guardrails`, `mcp`,
  `mcp-server`, `audit-log`, `permissions`, `claude`, `cursor`, `llm`,
  `agent-safety`. Topics are how GitHub Explore and search find the repo.
- [ ] **Set the social preview image** (Settings → General): export
  `docs/assets/banner.svg` to a 1280×640 PNG. This is what every
  Twitter/Slack/Discord unfurl of the repo link shows.
- [ ] **Open a community channel** and badge it in the README header —
  GitHub Discussions is the zero-maintenance option; Discord once there is
  an audience to talk to each other. Badge snippet:
  `[![Discussions](https://img.shields.io/badge/discuss-GitHub%20Discussions-8B8E96?style=flat-square)](…)`
- [ ] **Get listed** (the ecosystem-halo substitute): PR docket into
  `punkpeye/awesome-mcp-servers` and similar MCP registries, awesome-lists
  for Claude/Cursor/agent tooling, and ask OpenClaw and Hermes to link
  docket from their integration/docs pages (we already document them —
  reciprocity is a fair ask).
- [ ] **Launch moments**, in order: Show HN (copy is ready in
  [launch.md](launch.md) — post at 14:00–16:00 UTC on a weekday), then the
  tweet thread, then dev.to/newsletter pitches with the one-paragraph
  version. Don't stagger them by weeks; the compounding works when they
  land in the same few days.
- [ ] **Write the technical report.** The arXiv-equivalent: a post titled
  something like *"Red-teaming an agent permission layer: 51 scenarios,
  zero silent allows"* walking through the asymmetric matcher and the eval
  suite. This is the piece researchers and newsletters can cite.

## Staged social proof — add when the numbers help, not before

Social-proof widgets on a young repo read as *absence* of proof. Add these
at the thresholds, snippets ready:

**Download badge** (once >500/month):

```markdown
[![downloads](https://img.shields.io/npm/dm/docket-agent?style=flat-square&color=8B8E96)](https://www.npmjs.com/package/docket-agent)
```

**Stars badge** (once >200):

```markdown
[![stars](https://img.shields.io/github/stars/shahcolate/docket?style=flat-square&color=FF4B3A)](https://github.com/shahcolate/docket/stargazers)
```

**Star history chart** (once the curve is a curve, ~100+ stars — goes above
the Contributing section):

```markdown
<a href="https://star-history.com/#shahcolate/docket&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=shahcolate/docket&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=shahcolate/docket&type=Date" />
    <img alt="Star history" src="https://api.star-history.com/svg?repos=shahcolate/docket&type=Date" />
  </picture>
</a>
```

## Cadence

The News section only signals momentum if it moves. Rule of thumb from the
repos that grew: something dated lands at least monthly — a release, an
integration, a new template, an eval-suite expansion. Small and real beats
big and stale; update `README.md` **and** `README.zh.md` together.
