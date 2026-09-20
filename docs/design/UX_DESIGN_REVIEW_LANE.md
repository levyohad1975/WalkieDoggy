# Walkie Doggy — UX / Visual Design Review Lane

Status: ACTIVE
Target baseline: `feat/verified-auth-onboarding-batch-2`
Purpose: run UX/visual review in parallel with RC engineering without blocking safe backend/validation work.

## Sources of truth

The review must use the project's established creative/product sources rather than inventing a second visual language:

- `BRAND_BIBLE.md`
- `MASCOT_SPEC.md`
- `CREATIVE_AGENT_CHARTER.md`
- `PRODUCT_CONTEXT.md`
- `EXTERNAL_DESIGN_SOURCES.md`
- `PROJECT_DNA.md`
- `AGENTS.md`

If a source is not present in the repository, use the project-provided source when available to the orchestrator and record the resulting decision here before implementation.

## Collaboration model

Every user-facing RC screen follows this lane:

1. **Product / UX review** — task clarity, information hierarchy, minimum taps, family context, error/recovery states, accessibility and mobile ergonomics.
2. **Visual / Brand review** — Walkie Doggy brand consistency, typography, spacing, iconography, turquoise/cream palette, mascot use and emotional tone.
3. **RTL / Hebrew review** — Hebrew-first layout, reading order, alignment, directional icons, mixed LTR values, truncation and safe-area behavior.
4. **Engineering implementation** — implement approved decisions without weakening auth, tenant boundaries, offline behavior or RC safety gates.
5. **UX QA gate** — compare implementation against this checklist on iPhone-size and responsive web before declaring the screen visually complete.

## Immediate critical flow

Priority is the first real family onboarding experience:

`Open Walkie Doggy → email → OTP → create family → add dog → invite via code/link/QR → second member joins → home`

Review targets:

- Login / OTP: one obvious primary action; calm recovery/error states; keyboard-safe layout.
- Create family: short, confidence-building form; clear pending/active state where relevant.
- Add dog: dog identity is prominent; family dog must not be confused with the brand mascot.
- Invite: code/link/QR hierarchy must be immediately understandable and share actions explicit.
- Join: clearly identify the family being joined and the resulting role/state.
- Home: next walk and responsible family member are the primary information; secondary controls must not compete.
- Settings / Roles / System Admin: dense management UI may be calmer than Home but must retain the same design system.

## Visual guardrails

- Brand primary turquoise: `#20A7B5`.
- Brand cream: `#FBF8F3`.
- Mascot is the Walkie Doggy brand character, never a representation of the family's actual dog.
- Prefer a warm, family-oriented product feel over generic dashboard styling.
- Avoid decorative complexity that obscures the next action.
- Keep touch targets comfortable on iPhone and avoid edge collisions with safe areas.
- Loading, empty, success, warning and error states are part of the design, not afterthoughts.

## UX acceptance gate

A user-facing screen is not visually complete until all applicable checks pass:

- [ ] Primary action is identifiable within a glance.
- [ ] Hebrew RTL order/alignment is correct.
- [ ] No clipped/overflowing text at phone width.
- [ ] Touch targets and spacing are usable one-handed.
- [ ] Loading/empty/error/success states are designed.
- [ ] Brand palette/typography/components are consistent.
- [ ] Mascot use follows mascot specification.
- [ ] Family dog identity is distinct from mascot identity.
- [ ] Navigation/back behavior is predictable.
- [ ] Screen supports the actual Staging flow rather than demo-only assumptions.
- [ ] Responsive web does not become stretched or lose hierarchy.
- [ ] Engineering tests remain green after implementation.

## External reference policy

External pattern libraries are inspiration, not source of truth. Reference research must be translated into Walkie Doggy's own brand and Hebrew RTL behavior. Do not copy another product's visual identity.

Mobbin was requested as a reference source for this lane. The connected Mobbin tool currently reports that its MCP access requires a paid plan, so the lane must **not** block on it and no purchase is authorized. Continue using the project's existing design sources and other no-cost references when needed.

## Parallelism rule

This lane must not stop Agentic RC engineering. UX/design work and backend/validation work proceed independently. Integrate only bounded, reviewable UI changes; do not mix workflow infrastructure or Production changes into design commits.

## Evidence rule

No screen is marked UX-complete from a written intention alone. Completion requires repository implementation plus visual/device evidence (or an explicitly documented device-validation blocker).
