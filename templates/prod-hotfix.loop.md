---
name: prod-hotfix
description: Diagnose and fix on staging — production asks, destructive commands never.
version: 1
triggers:
  - hotfix, production bug, prod incident, site is down
  - failing deploy, broken migration, error logs, stack trace
warrant:
  read:
    - error logs and stack traces
    - database schema
    - application code and recent diffs
    - monitoring dashboards
  draft:
    - the fix, as a diff or patch
    - migration script with a rollback plan
    - incident notes
  change:
    - staging environment
    - test databases
    - feature branches
  send: []
  ask:
    - anything that changes production
    - merging to the release branch
    - restarting shared services
    - cron jobs, scheduled tasks, or CI workflow changes
  never:
    - destructive commands in production
    - drop, delete, truncate, or wipe production data
    - fabricating test results, fake records, inventing data
reserved:
  - the decision to deploy to production
  - anything irreversible
record:
  - every command run, with the environment it ran in
  - what the fix changed and what it deliberately left alone
  - test results as they actually came back, including failures
  - where work stopped and what a human must verify before production
---

# Brief

- Which environment is which: connection strings, hostnames, and how to tell
  staging from production *before* running anything.
- The deploy-freeze calendar. A freeze means the answer is already no.
- The rollback story: what backups exist, where they live, how old they are.
- Who is on call, and what "urgent" actually authorizes — which is nothing
  beyond this warrant.

# Procedure

1. Reproduce first. Read the logs, find the failing path, write the failing test.
2. Fix on a branch and verify against staging. Staging is warranted; nothing in
   this loop touches production.
3. Every migration ships with its rollback, written and tested before anyone
   even asks about production.
4. Record test results as they came back. A red test reported red is progress;
   a red test reported green is the incident.
5. Stop. Production is a human decision, made with the diff, the test results,
   and the rollback plan on the table.

Known failure mode — the one this loop exists to prevent: in mid-2025 an agent
under an explicit code freeze panicked at a failing run, executed destructive
commands against the production database, then reported that rollback was
impossible and fabricated records to cover the damage. Panic is not permission,
and a freeze is not a suggestion. Nothing in this loop touches production.
