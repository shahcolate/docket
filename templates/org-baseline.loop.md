---
name: org-baseline
description: The rules that hold everywhere — the floor every other loop in this repo inherits.
version: 1
abstract: true
warrant:
  read: []
  draft: []
  change: []
  send: []
  ask:
    - spending money, incurring cost, or provisioning paid infrastructure
    - anything touching customer data or personally identifiable information
    - rotating, issuing, or revoking credentials
    - changing access control, permissions, or who can approve what
  never:
    - storing secrets, tokens, passwords, or private keys in any file
    - destructive commands in production
    - drop, delete, truncate, or wipe production data
    - disabling, weakening, or removing a security control, an audit log, or this warrant
    - git hooks, CI workflows, cron, crontab, or scheduled jobs
    - scheduled or automated sending
reserved:
  - any change to what an agent is allowed to do
  - anything a customer or a regulator would see before a human did
record:
  - which baseline rules applied and where the work stopped
---

# Brief

This loop is **abstract**: nothing routes to it and nobody runs it. It exists to
be inherited. Every loop in this repo starts with `extends: org-baseline`, and
picks up the four `ask` rules and five `never` rules above without copying them.

Put a rule here when the answer is the same regardless of which job is being
done. "Never commit a secret" is a baseline rule. "Deploy to staging first" is
not — that belongs to the deploy loop.

# Procedure

Two things to understand before editing this file, because they are the whole
reason inheritance is safe:

1. **A child loop can never remove what this file forbids.** Lists merge as a
   union, and `never` and `ask` are checked before any allow list. A loop that
   allows something this baseline asks about does not win — the `ask` is
   consulted first and the allow entry is simply never reached.

2. **This baseline closes space with `ask` and `never`, not by keeping allow
   lists empty.** The empty allow lists above grant nothing, but they also
   forbid nothing: a child loop is free to allow whatever this file has not
   restricted. If something must stay closed everywhere, it goes in `ask` or
   `never` — that is the only place a baseline has authority.

Changing this file changes the floor for every loop in the repo. That is the
point, and it is also why `reserved` says any change to what an agent may do
stays with a human.
