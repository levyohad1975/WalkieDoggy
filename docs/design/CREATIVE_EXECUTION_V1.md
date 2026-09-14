# Creative / CX Autonomous Execution V1

This document defines the autonomous Creative/CX lane for the Walkie Doggy Release Candidate. It complements `AGENTS.md` and `docs/engineering/AGENTIC_EXECUTION_V1.md`; it does not weaken any engineering, security, git, Staging, or Production approval rule.

## Purpose

The Release Candidate is not ready unless all three gates pass:

1. Functionality
2. Visual Transformation
3. Customer Experience (CX)

The Creative/CX lane exists so visual and experience work can advance independently and in parallel with functional/Staging work whenever there is no real dependency or write conflict.

## Operating model

> Control Room → Creator/CX research and direction → Engineering implementation → Creator/CX visual QA → Evidence → next safe CX task

For meaningful user-visible work follow the repository-wide routing rule:

> Creative → Engineering → Creative QA

Independent QA/Regression may run in parallel when it does not conflict with active writers.

## Parallel-by-default rules

- Independent tasks should run concurrently.
- A blocker in the Functional lane must not stop an executable Creative/CX task.
- A blocker in the Creative/CX lane must not stop independent Functional or QA work.
- Serialize work only when two writers would touch the same files/branch, when a real data/security dependency exists, or when an approval gate requires it.
- Never claim a separate worker or process is active unless fresh live evidence proves it.
- No evidence = not completed.

## Design resources

Use the best resource for the job rather than asking every tool the same question:

- **Mobbin** — benchmark real product screens and flows; record canonical references actually used.
- **Product Design** — challenge UX direction, information architecture, flow clarity, edge states, and interaction choices.
- **Figma** — formalize design-system/prototype/frame artifacts and implementation handoff when useful.
- **Repository design sources** — remain authoritative for Walkie Doggy product identity, mascot, RTL, brand, and project constraints.
- **Image/visual generation** — use for original mascot/illustration/empty-state/celebration assets when needed; do not treat generated assets as approved merely because they exist.

Do not design by committee. The Creator/CX lane owns one coherent product direction and uses other tools as research, critique, and production aids.

## CX queue for this RC

Priority order unless fresh evidence establishes a stronger dependency:

1. **Home Hero** — immediate visible transformation; mascot/Toffee presence, next walk, who is up, primary action, important family context, clear RTL hierarchy.
2. **Statistics** — storytelling and meaningful insight rather than a raw dashboard of numbers.
3. **History** — readable, scannable, pleasant event/walk history with clear completion/timing states.
4. **Walks / rotation** — easy schedule setup, upcoming-walk editing, swaps, ad-hoc walks, notes/states.
5. **Family** — member identity, avatars/photos, roles and family-oriented clarity.
6. **Settings / Admin** — serious, understandable controls with clear role/admin boundaries.
7. **Onboarding / family creation / joining** — visually coherent with the product and all verified functional states.
8. **Cross-product visual consistency** — typography, spacing, color, iconography, cards/surfaces, buttons, empty/loading/error/success states, RTL, accessibility and motion.
9. **Final Visual QA** — real implementation review before RC approval gate.

Scope remains locked; this queue is a transformation of existing RC surfaces, not permission to add unrelated product features.

## State machine

Each CX task uses:

`READY → RESEARCHING → DIRECTING → IMPLEMENTING → VERIFYING → DONE`

Failure/blocked path:

`... → BLOCKED → NEXT_SAFE_CX_TASK`

Anti-stall path:

`RUNNING → STALLED → diagnose → resume or select NEXT_SAFE_CX_TASK`

## Required evidence

A CX task may move to `DONE` only when durable evidence exists. Record the smallest useful set appropriate to the task:

- Task name and status.
- Benchmark references actually reviewed/used (including Mobbin canonical links when used).
- UX direction and acceptance criteria.
- Figma file/frame/prototype reference when Figma is used.
- Relevant implementation commit SHA or PR diff.
- Target SHA used for visual QA.
- Before/after screenshot or equivalent visual evidence when available.
- RTL result.
- Accessibility result relevant to the change.
- Loading/empty/error/success state coverage when applicable.
- Motion/reduced-motion result when applicable.
- Visual QA verdict: `PASS`, `CHANGES_REQUIRED`, or `PENDING_DEVICE_REVIEW`.
- Exact blocker if unresolved.
- Next safe CX task.

Research, a plan, an open design file, or a tool connection by itself is not completion evidence.

## Visual QA bar

The Creator/CX reviewer must inspect the implementation, not merely the design specification. Ask:

- Does the product feel obviously transformed rather than cosmetically adjusted?
- Is the first Home impression polished, serious, warm, and inviting?
- Is hierarchy obvious in Hebrew RTL?
- Does the design feel like one product across Home, Statistics, History, Walks, Family, Settings/Admin and onboarding?
- Do empty/loading/error/success states belong to the same visual language?
- Is the mascot/brand integration intentional rather than decorative noise?
- Is information density appropriate for a family mobile app?
- Are interaction states understandable without technical knowledge?
- Does the implemented build match the agreed direction closely enough to pass, or does it require changes?

## Release gate

Do not declare the RC ready if any of the following is true:

- Functional tests are green but the product still looks/feels substantially like the old experience.
- Individual screens look good but there is no coherent design language.
- The design spec is polished but implementation has not been visually reviewed.
- Visual/CX evidence is missing.
- A release-blocking RTL, accessibility, navigation, state, or consistency issue remains.

At the final gate, the evidence must support:

`FUNCTIONALITY = PASS`

`VISUAL_TRANSFORMATION = PASS`

`CX = PASS`

Then stop for the owner's explicit Release Candidate approval.
