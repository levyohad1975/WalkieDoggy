# Walkie Doggy — Creative/CX Execution State

This file is the durable state/evidence ledger for the autonomous Creative/CX Release Candidate lane.

## Release Gate

- Functionality: `IN_PROGRESS`
- Visual Transformation: `IN_PROGRESS`
- CX: `IN_PROGRESS`
- Final RC approval: `NOT_REACHED`

## Current CX Task

**Task:** Home Hero visual transformation

**Status:** `READY`

**Goal:** Make the first Home impression visibly new, polished, serious, warm and inviting while preserving Hebrew RTL, current product behavior, security boundaries and existing RC scope.

### Required acceptance criteria

- Home immediately communicates the next relevant walk and who is responsible.
- Primary action is obvious without dashboard-like clutter.
- Mascot/Toffee presence is intentional and aligned with the approved mascot-first direction.
- Hebrew RTL hierarchy is clear and compact.
- Important family context is visible without overwhelming the user.
- Empty/loading/error/success states use the same visual language.
- Implementation works with existing data/state contracts; no business/security shortcut is introduced for presentation.
- Visual result is reviewed after implementation, not only specified beforehand.

## Evidence

- Creative execution protocol: `docs/design/CREATIVE_EXECUTION_V1.md`
- Current implementation SHA: `PENDING`
- Target Visual-QA SHA: `PENDING`
- Mobbin benchmark references: `PENDING`
- Product Design critique/artifact: `PENDING`
- Figma file/frame/prototype reference: `PENDING`
- Before/after visual evidence: `PENDING`
- RTL review: `PENDING`
- Accessibility/state review: `PENDING`
- Visual QA verdict: `PENDING`

## Blocker

None recorded. Research/direction may proceed independently of Functional/Staging work. Implementation must be serialized if another writer is editing the same presentation files/branch.

## Next Safe CX Queue

1. Home Hero visual transformation
2. Statistics storytelling redesign
3. History readability redesign
4. Walks / rotation experience
5. Family identity / members / roles
6. Settings / Admin UX
7. Onboarding / family creation / joining visual coherence
8. Cross-product visual consistency pass
9. Final Visual QA on the real implementation

## Per-task Evidence Template

```text
CX TASK:
STATUS:

Research evidence:
- Mobbin/reference:
- Product Design critique:

Direction evidence:
- UX intent:
- Acceptance criteria:
- Figma/frame/prototype:

Implementation evidence:
- Branch/PR:
- Commit SHA:
- Tests/typecheck:

Visual QA evidence:
- Target SHA:
- Before/after:
- RTL:
- Accessibility:
- Empty/loading/error/success states:
- Motion/reduced motion:
- Verdict: PASS | CHANGES_REQUIRED | PENDING_DEVICE_REVIEW

BLOCKER:
NEXT SAFE CX TASK:
OWNER APPROVAL REQUIRED:
```

## Parallel Execution Rule

Functional/Release, Creator/CX and independent QA/Regression lanes advance concurrently whenever they do not share a true dependency or conflicting writer surface. A blocker in one lane does not stop another executable lane. Never record a lane as active without fresh evidence.
