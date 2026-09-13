# Agentic Execution V1

This document defines the execution protocol for autonomous (Claude/Codex)
execution workers operating on this repository's Release Candidate
pipeline. It governs `EXECUTION_STATE.md`, which is the live, single
source of truth for current task, status, evidence, and queue. This
document does not change or weaken any rule in `AGENTS.md` — it adds an
execution/reporting layer on top of it.

Model:

> Owner → Control Room → Claude Execution Worker → GitHub/CI/Staging →
> Evidence → Next Safe Task

## Safety / scope rules (non-negotiable)

- Keep the current Release Candidate scope locked. Do not add backlog
  features.
- Do not merge any PR.
- Do not deploy to Production.
- Do not run Production migrations.
- Do not modify Production data, RLS, secrets, credentials, or
  environment.
- Do not perform purchases, charges, public publishing, or destructive/
  irreversible operations.
- Staging work is allowed only within already-approved non-Production
  boundaries.
- **No evidence = not completed.**
- Never claim work is running unless there is fresh live evidence.
- A blocker on one path must NOT stop execution when another independent
  safe Release Candidate task exists.
- Owner approval is required before any Production-affecting merge,
  deploy, migration, secrets/data change, or another irreversible/
  high-impact action.

## State machine

```
READY → RUNNING → VERIFYING → DONE
```

or, on failure:

```
RUNNING → BLOCKED → NEXT_SAFE_TASK
```

Anti-stall rule: if no fresh execution evidence appears within a
reasonable execution cycle:

```
RUNNING → STALLED → self-diagnose → resume or select NEXT_SAFE_TASK
```

`STALLED` is not a dead end — it is a forced diagnostic checkpoint. A
worker that finds itself `STALLED` must record why, then either resume the
same task with a corrected approach or move to the next safe queue item.
It must never sit in `STALLED` silently.

## Evidence

**Valid evidence** (any one of):

- A commit (with SHA).
- A pushed branch.
- A PR update (diff, comment, or review response).
- A CI/workflow run (with URL and result).
- Test output (suite/test counts and pass/fail).
- A Supabase rehearsal result.
- A Staging E2E result (screenshots, logs, or reproducible steps).
- A reproducible failure/blocker with the exact command/log that produced
  it.

**Invalid evidence** (never sufficient to mark a task `DONE`):

- "Working on it."
- An open PR by itself, with no described change or result.
- An approved task (approval is not execution).
- Monitoring activity (watching CI, waiting for a webhook) with nothing
  produced.
- Plans without execution.

A task only moves to `DONE` when valid evidence exists and is recorded in
`EXECUTION_STATE.md`'s Last Evidence / Last Evidence Timestamp fields.

## Worker loop

For each cycle:

1. Read `AGENTS.md`.
2. Read `EXECUTION_STATE.md`.
3. Verify repo/branch/PR match what `EXECUTION_STATE.md` expects; if not,
   reconcile before proceeding.
4. Select the highest-priority executable task from the Queue that is not
   blocked (or, if the current task is still in progress, continue it).
5. Mark `RUNNING`.
6. Execute.
7. Produce evidence.
8. Mark `VERIFYING`.
9. Verify outcome (tests pass, CI green, screenshots match expectation,
   etc. — whatever the task's own evidence bar is).
10. Mark `DONE` or `BLOCKED`.
11. Update Last Evidence / Last Evidence Timestamp.
12. Select Next Safe Task from the Queue.
13. Continue automatically.

Do not wait for the owner between safe tasks.

**Stop only when:**

- Explicit owner approval is required (a Production-affecting or
  irreversible action per the safety rules above) — set status to
  `WAITING_APPROVAL` and state exactly what approval is needed.
- No safe task exists (the Queue is exhausted or every remaining item is
  blocked with no independent alternative).
- A required credential/access is unavailable and no independent task
  exists to substitute for it.
- The Release Candidate approval gate (end of the Queue in
  `EXECUTION_STATE.md`) is reached.

## Approval gates

Claude (or another execution worker) may autonomously, without asking
first:

- Inspect code.
- Edit code.
- Create branches.
- Run tests.
- Run local/non-production QA.
- Commit.
- Push feature branches.
- Prepare/update PRs.
- Investigate CI.
- Perform already-approved Staging validation.

Owner approval is required before:

- A merge affecting Production.
- A Production deploy.
- A Production migration.
- A Production RLS/data change.
- A significant Production secrets/credentials change.
- A destructive/irreversible action.
- A purchase/charge.
- Public publishing.

When one of these is reached, the worker sets `EXECUTION_STATE.md`'s
Current Task Status to `WAITING_APPROVAL`, fills in Approval Required with
the exact action needed, and stops — it does not proceed past that point
on its own judgment.

## Relationship to AGENTS.md

`AGENTS.md`'s working rules, safety rules, and completion-report
requirements remain fully in force. This document adds a state-tracking
and continuity layer for autonomous multi-cycle execution; it does not
authorize anything `AGENTS.md` forbids (git push still needs the approval
`AGENTS.md` already requires unless the owner has separately authorized
pushing feature branches for this pipeline, as has been the case for the
Release Candidate work tracked here).
