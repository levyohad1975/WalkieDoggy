# Walkie Doggy — Agent Instructions

Codex is the primary maintenance and development agent for Walkie Doggy. These instructions apply throughout this repository.

## Project context

Walkie Doggy is an Expo/React Native/TypeScript family dog-walking application using Supabase. It supports Hebrew RTL and uses an offline-first repository and SyncQueue.

Important flows include family creation and joining, profile claiming, family administration, schedules, walks, swaps, reminders, history, native notifications, and Web Push.

## Creative and design work

For meaningful work involving UI, UX, visual design, responsive layout, branding, mascot, graphics/assets, icons, typography/colors, animation, onboarding presentation, email visual design, or visual QA, first read the relevant project-owned design knowledge:

1. `docs/design/CREATIVE_AGENT_CHARTER.md`
2. `docs/design/PRODUCT_CONTEXT.md`
3. `docs/design/BRAND_BIBLE.md`
4. `docs/design/EXTERNAL_DESIGN_SOURCES.md` when the work requires external design research, current platform guidance, accessibility standards, framework/platform capabilities, store requirements, or other time-sensitive professional guidance.
5. `docs/design/MASCOT_SPEC.md` when mascot, mascot-derived assets, icons, celebrations, or animation are involved
6. Any relevant future document in `docs/design/` when present (for example `DESIGN_SYSTEM.md`, `RESPONSIVE_RULES.md`, `UX_PRINCIPLES.md`, `ANIMATION_GUIDELINES.md`, `EMAIL_DESIGN.md`, or `VISUAL_QA_CHECKLIST.md`).

For current or evolving design/platform questions, follow `EXTERNAL_DESIGN_SOURCES.md`: prefer current primary/official sources, distinguish normative/official guidance from research and inspiration, and do not rely only on model memory.

These documents govern visual/product direction within their scope. They never override this file: `AGENTS.md` remains authoritative for repository operations, engineering safety, security, authentication/authorization, Supabase/RLS, migrations, notifications, destructive operations, testing, commits, push, deployment, and production actions.

The Creative Director may inspect code/assets, create design documentation, prepare presentation-layer changes, and perform visual QA. Work that crosses into business logic, authentication/authorization, Supabase/RLS, migrations, notification security, destructive operations, or production actions must follow the existing engineering/security rules and obtain any required approval.

## Creative and engineering routing

For every meaningful task, classify it before editing as Engineering, Creative, or Joint. Users may describe the desired outcome normally; perform this routing internally. Read only the relevant Core, Brain, and project-owned sources, then inspect current code, assets, and evidence before assuming project facts. Current repository evidence overrides stale documentation, and prior-project memory is never project truth.

- **Engineering:** For bugs, architecture, data/state/repository logic, authentication/authorization, RLS/RPC/security, migrations/database work, sync/offline/reliability, notification delivery/security, performance, tests/build/tooling, or release engineering, use `engineering-core` and read the relevant parts of `docs/engineering/PROJECT_ENGINEERING_BRAIN.md`.
- **Creative:** For visual design, UX flow, layout, responsive behavior, typography, brand, mascot, graphics/assets, animation/motion, visual accessibility, or user-facing copy/content design, use `creative-director-core` and the applicable design sources listed above.
- **Joint:** For meaningful user-visible product changes requiring implementation, use Creative → Engineering → Creative QA: Creative defines intent, states, interaction, responsive/accessibility/motion requirements, and acceptance criteria; Engineering inspects implementation, data, and security constraints, implements safely, and performs technical validation; Creative performs final visual/UX QA against the agreed intent.

For auth, permissions, onboarding identity, database-backed workflows, notification security, system administration, migrations, and other security-sensitive user-visible work, Engineering leads technical architecture and security while Creative contributes experience and presentation. Client/UI behavior never substitutes for server-side authorization. If a conflict affects security, data integrity, authorization, or production safety, `AGENTS.md` and Engineering authority prevail; surface the conflict rather than guessing. If evidence is insufficient or a security/production boundary is crossed, stop and follow the applicable existing approval rules.

## Working rules

1. Work only inside this repository.
2. Inspect relevant existing code before making changes.
3. Preserve existing user changes. Never discard or overwrite unrelated uncommitted work.
4. Make the smallest safe change that solves the requested task.
5. Preserve Hebrew RTL behavior.
6. Preserve the offline-first architecture and SyncQueue security and audit protections.
7. Treat authentication, family membership, profile claiming, RLS, SECURITY DEFINER functions, audit logic, and Supabase migrations as security-sensitive.
8. Never edit an already-applied Supabase migration. Create a new migration when a database change is required.
9. Do not apply Supabase production migrations without explicit user approval.
10. Do not deploy to EAS/Expo production, App Store, Google Play, or another production environment without explicit user approval.
11. Do not git push without explicit user approval.
12. Local file edits, diagnostic commands, typechecking, tests, git status/diff, and local commits are allowed without asking for approval when needed to complete a requested development task. Honor any task-specific restrictions, including instructions not to commit.
13. After code changes, always run both commands:

    ```sh
    npx tsc --noEmit
    npm test -- --runInBand
    ```

14. If tests fail because of the change, diagnose and fix them when safe rather than immediately asking the user to run commands.
15. Before a local commit, inspect git diff and ensure unrelated user changes are not included.
16. Never delete or reset uncommitted user work.
17. Keep native Expo notifications intact when working on Web Push.
18. For risky or ambiguous production/security changes, stop and explain what approval is needed.

## Completion report

At the end of every development task, report:

- What changed.
- Files changed.
- Validation/tests run and their results. Clearly state any checks that could not run and why.
- Remaining risks or unresolved issues.
- Whether any production action still requires approval.
