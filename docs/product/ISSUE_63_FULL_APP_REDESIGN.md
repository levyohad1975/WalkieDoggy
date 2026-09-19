# Issue #63 — Full App Redesign

Canonical in-repo execution brief mirrored from GitHub Issue #63 so headless Agentic workers do not need GitHub issue/WebFetch access.

## Objective
Start and continuously advance the full Walkie Doggy app redesign without waiting for chat interaction.

## Execution target
Work from the current Web Staging RC context. Use a dedicated safe feature branch; do not merge to main and do not touch Production.

## Scope
Create a coherent mobile-first Hebrew RTL design system and apply it across the actual app surfaces:
- onboarding / create-or-join family
- login / member selection
- Home
- Schedule
- Family
- History
- Statistics
- Settings
- System Admin
- loading, empty, error, success, and modal states

## Required direction
- professional, warm, modern family consumer product
- excellent Hebrew RTL
- consistent typography, spacing, cards, buttons, forms, navigation, iconography, and states
- generic Walkie Doggy brand mascot in onboarding; never hardcode demo dog/family names
- preserve accessibility contracts and Reduce Motion
- replace emoji-style navigation/icon treatment with a coherent production-quality visual language
- keep current functionality intact unless a UI change requires a safe refactor
- architect true mascot animation separately if new paid/credit-consuming assets are required; do not spend credits without owner approval

## Autonomous execution loop
Design system -> implement in safe batches -> typecheck/tests -> CI -> repair -> continue to next screen/state.
Do not stop merely because one batch passes. If blocked, advance an independent safe lane. Produce durable evidence with commits and workflow runs.

## Approval gates
No merge to main, Production deploy/migration/data/RLS/secrets/credential changes, destructive actions, purchases/credit spend, or other owner-gated actions without explicit approval.

## Completion evidence
No evidence = not completed. Completion requires all scoped screens/states implemented, checks green, and staging-ready evidence.

## Worker rule
This file is the authoritative readable mirror of Issue #63 for the headless Worker. Read it before choosing a redesign unit. Do not substitute legacy queue work while an unblocked item in this scope remains.
