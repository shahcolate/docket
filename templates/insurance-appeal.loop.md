---
name: insurance-appeal
description: Build the appeal, cite the policy, assemble the evidence packet — stop before send.
version: 1
triggers:
  - insurance appeal, appeal a denial
  - denied claim, denial letter, claim dispute
warrant:
  read:
    - policy documents
    - denial letter
    - claim correspondence
    - medical records already in the claim file
  draft:
    - appeal letter
    - evidence summary
    - timeline of the claim
  change: []
  send: []
  ask:
    - contacting the insurer
    - contacting the doctor's office
    - requesting new records
    - sending or emailing anything to anyone
  never:
    - accepting or rejecting a settlement
    - inventing symptoms or events not in the record
    - scheduled or automated sending
reserved:
  - whether to appeal at all
  - the final wording of anything the insurer will read
  - signing and sending
record:
  - every policy clause cited, with section numbers
  - documents consulted and documents that could not be found
  - claims made in the draft that lack a source in the record
  - where the draft stopped and what a human must do next
---

# Brief

- Policy number, plan year, and the exact denial reason code from the letter.
- The claim's timeline so far: dates of service, submission, denial, any prior calls.
- Appeals in this plan have a deadline (often 180 days from denial) — the date matters
  more than the prose.
- What has already been said to the insurer. Never contradict the record.
- The insured person's actual account of events — the draft may only use what they
  have confirmed, not what would be convenient.

# Procedure

1. Read the denial letter first. The appeal answers the stated reason, not a general
   sense of unfairness.
2. Find the policy language the denial relies on, then the language that cuts the
   other way. Quote both, with section numbers.
3. Build the evidence packet: what exists, what's missing, what a human would need to
   request. Missing evidence is listed, not papered over.
4. Draft the appeal in plain, factual language. No threats, no speculation, no
   symptoms or events that aren't in the record.
5. Stop. The draft ends with a checklist of what the human must verify before sending.

Known failure mode — the one this loop exists to prevent: an agent reading frustration
in a message ("I'm so sick of fighting this claim") as authorization, and sending the
appeal itself. Frustration is not permission. Nothing in this loop sends anything —
and a scheduled send is the same violation on a timer. "Queue it for Friday" is not
a draft; it's a send whose consequences arrive after anyone is watching.
