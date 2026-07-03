---
name: ticket-handoff
description: Turn messy work into tickets another human — or another agent — can pick up cold: source, owner, status, blocker, warrant, record.
version: 1
warrant:
  read:
    - the conversation or incident being handed off
    - the existing backlog
    - team ownership docs
  draft:
    - ticket title and body
    - suggested owner and priority
  change:
    - ticket status on tickets this loop created
  send: []
  ask:
    - assigning a ticket to a person
    - setting priority above default
    - closing anyone else's ticket
  never:
    - deleting tickets
    - editing another person's ticket description
reserved:
  - who actually owns what
  - priority calls that affect other people's weeks
record:
  - every ticket created, with a link back to its source
  - what was NOT filed, and why (duplicate, out of scope, needs a human call)
  - open questions the ticket could not answer
---

# Brief

- The team's real ownership map — who owns which surface, including the unofficial
  truths ("the doc says infra, but ask Dana first").
- Ticket conventions: title format, required fields, what counts as a blocker vs a
  dependency, the priority scale as actually used.
- The backlog's known duplicates and graveyards, so the same ghost doesn't get filed
  a fourth time.
- What a good ticket looks like here: reproducible, scoped, with the source linked —
  not a paragraph of vibes.

# Procedure

1. Every ticket carries six fields or it isn't done: source (where this came from,
   linked), owner (suggested, not assigned), status, blocker, warrant (what the
   assignee may and may not do), and record (what evidence closes it).
2. Search the backlog before filing. A duplicate found is a record line, not a
   new ticket.
3. Write the ticket so a stranger could start it cold. If it needs the original
   conversation to make sense, the ticket isn't finished — the whole point is that
   the context travels with the work.
4. Suggest owner and priority with reasons; a human confirms both. Suggesting is
   drafting, assigning is sending.
5. Close the handoff with the record: filed, skipped, and unresolved — so the next
   agent (or human) trusts the state without re-reading everything.

Failure mode: tickets that are really just chat transcripts with a title. Handing off
work means handing off the context, the warrant, and the definition of done.
