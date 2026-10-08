# Walkie Doggy Autonomy V2

This directory is the machine-readable control-plane foundation for Issue #50.

## Authority

`policy.json` defines autonomous actions, human gates, failure recovery and completion rules. `state.json` records durable implementation/runtime state. Existing `AGENTS.md`, security rules and Production restrictions remain authoritative; V2 may strengthen but never weaken them.

## Core invariants

1. No evidence = not completed.
2. A routine technical failure enters AUTO_REPAIR before human escalation.
3. A blocked task does not stop independent READY work.
4. Repeated failure must change strategy rather than blindly repeat.
5. Medium/high-risk work requires independent verification.
6. Production-affecting or irreversible actions remain explicit human gates.
7. Owner notifications are reserved for genuine decisions/approval gates and milestone completion.

## V1 compatibility

`EXECUTION_STATE.md` remains the current RC execution ledger during migration. V2 components must reconcile it with `.agentic/state.json` until the structured scheduler becomes authoritative. Conflicts must fail closed and create durable diagnostic evidence rather than silently choosing a state.

## Definition of fully operational V2

Autonomy V2 is not complete merely because this directory exists. Issue #50 milestones A-F must be implemented and an end-to-end rehearsal must demonstrate autonomous recovery from representative injected failures without crossing Production gates.
