# Contributing to docket

Thanks for looking under the hood. The whole project is deliberately small —
zero dependencies, a short spec, plain files — and it should stay that way.
That makes contributing unusually easy: there is no build step, no toolchain,
and nothing to configure.

## Setup

```console
$ git clone https://github.com/shahcolate/docket && cd docket
$ npm test        # full suite, node >= 18, nothing else
$ npm run eval    # regenerate the red-team report (eval/REPORT.md)
```

If `npm test` passes, your environment is done.

## The best first contributions

**1. Break the matcher.** The warrant engine claims *zero silent allows*
across [42 red-team scenarios](eval/REPORT.md). The most valuable
contribution docket can receive is scenario #43 — a phrasing that gets an
`ALLOW` it shouldn't. Open a
[red-team scenario issue](https://github.com/shahcolate/docket/issues/new?template=red_team_scenario.yml)
with the loop file and the command; if it finds a hole, the scenario is
added to `eval/scenarios.js` credited to you, and the fix ships with it.

**2. A new starter template.** Templates in [`templates/`](templates/) are
complete worked examples — a real recurring task with a brief, procedure,
warrant, record, and reserved list that make sense together. Good templates
come from jobs you actually delegate. Propose one with the
[template proposal issue](https://github.com/shahcolate/docket/issues/new?template=loop_template.yml)
or send the `.loop.md` directly as a PR.

**3. An adapter.** `docket compile` targets live in
[`src/lib/compile.js`](src/lib/compile.js). A new target
(another assistant's context-file format) is a well-bounded PR: one render
function, one test, one README line.

**4. Argue about the spec.** [`spec/SPEC.md`](spec/SPEC.md) is short on
purpose. Issues that argue about the verdict algorithm
(never → ask → allow-list → default-ask) or the matching semantics are the
best kind — the asymmetry guarantee ("a phrasing difference can cause an
unnecessary ask, never an accidental allow") is the invariant everything
else defends.

## Ground rules

- **Zero dependencies is a hard rule.** PRs that add a package will be
  declined regardless of how good the package is. The tool that holds an
  agent's permissions must have a supply chain you can read in an afternoon.
- **Tests come with the change.** `node --test`, no framework. New verdict
  behavior needs a red-team scenario, not just a unit test.
- **The record format is load-bearing.** Anything touching hashing,
  chaining, or verification needs a spec update in the same PR.
- **Keep the English and Chinese READMEs in step.** If you change
  `README.md` in a way that changes meaning, update `README.zh.md` too (or
  say in the PR that it needs a translation pass).

## Releases

Versioning is semver. `npm run eval` must report zero silent allows before
any release — the claim in the README is regenerated, not asserted.
