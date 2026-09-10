# Walkie Doggy Link — Project Engineering Brain

## 1. Project authority and evidence standard

`AGENTS.md` is the highest authority for repository operations, security, approvals, testing, Git, migrations, deployment, and production actions. Current code, `package.json`, configuration, schema, and migrations are the source of project technical facts; older narrative documents may be historical. Engineering Core supplies reusable methodology only and never overrides project authority. Do not turn unverified runtime or production state into fact.

## 2. Current stack, package versions, and targets

- Expo `^57.0.0`; React Native `0.86.3`; React and React DOM `19.2.3`.
- TypeScript `~6.0.3`, strict mode; Jest `^29.7.0` with `jest-expo ~57.0.5`.
- React Navigation 7 bottom tabs; Zustand `^4.5.5`.
- AsyncStorage `2.2.0`; NetInfo `12.0.1`; Supabase JS `^2.45.4`.
- `expo-notifications ~57.0.17`; image picker, clipboard, safe-area, SVG, and React Native Web are present.
- Targets are iOS, Android, and web. Expo configuration is portrait-oriented, enables iPad support, and sets web output to `single`.

## 3. Repository architecture and dependency direction

Screens, components, and navigation call Zustand stores and pure `src/logic` helpers. Stores use the `Repository` interface rather than talking directly to AsyncStorage or Supabase. The app-wide repository is `OfflineFirstRepository`, combining `LocalRepository` (AsyncStorage), `SyncQueue` (deferred remote work), and an optional `SupabaseRepository`. `App.tsx` coordinates hydration, family/profile gates, guarded foreground synchronization, notification setup, and system-admin entry. Supabase Realtime reloads family, schedule, and request state but supplements screen loads and foreground reconciliation rather than replacing them.

## 4. Domain model and persistence entities

The family is the shared tenant boundary. Verified entities include families, users/family profiles, family auth membership, dogs, schedule rules, dated schedule entries, walks, notification settings/state, swap requests, time-change requests, audit records, user presence, impersonation/profile-session records, push tokens, and web-push subscriptions. Walks are `pending`, `done`, or `skipped`; they retain responsibility, actual completion, details, unplanned status, and swap attribution. Removed profiles are soft-deleted to preserve history.

## 5. Authentication, authorization, roles, RLS, and trust boundaries

In configured Supabase mode, the device has an anonymous auth session and claims a family-member profile through server RPCs. Family membership, invite flows, profile reclaim/PIN flows, admin/member roles, permissions, impersonation, and system-admin access are server-enforced through RLS and RPCs. Family Admin and System Admin are distinct roles. Client visibility, local role state, hidden controls, and navigation are not authorization boundaries. Profile claiming, family membership, RLS, `SECURITY DEFINER` functions, audit logic, migrations, and notification security are security-sensitive.

## 6. Offline-first repository and SyncQueue contract

Ordinary supported repository writes are local-first and may be queued for remote synchronization. Queue entries are tagged with the claimed profile; replay refuses untagged legacy work or work owned by another currently claimed profile, protecting audit attribution. Retryable failures remain queued; known permanent conflicts are recorded without blocking unrelated later work. Unsafe legacy member-deletion queue entries are quarantined rather than replayed. Sensitive server-authoritative actions, including member deletion and approval/authorization flows, intentionally do not rely on unsafe offline replay. Foreground order is: queue flush, authoritative schedule reload, request reload, notification reconciliation only after fresh schedule data, then presence/claim revalidation.

## 7. Notifications and remote-delivery architecture

Native/local reminders use lazily loaded `expo-notifications`, deterministic identifiers, reconciliation, and Android channel `walk-reminders`. Remote Expo Push uses registered device tokens; Web Push uses browser subscriptions and the service worker. A device-specific active remote-channel check suppresses local reminder duplication only for that device; failure falls back to local reminders. Valid native reminder opens can trigger an in-app reminder presentation. Request push is sent through a server-validated Edge Function after the server-side request action succeeds. A separate reminder-scheduler Edge Function is intended for cron-triggered remote reminder delivery.

## 8. Supabase schema, migrations, RPCs, Edge Functions, and manual test artifacts

`supabase/schema.sql` is a baseline/new-project schema artifact; `supabase/migrations/` is incremental history. Migration files span `0001` through `0031`, covering family management, roles, requests, profile sessions, Web Push, timezone, permission overrides, system administration, reminder scheduling, history/statistics enforcement, invite detail preview, and admin walk operations. Two different files use migration prefix `0019` (`request_result_read_state` and `request_result_seen_state`); confirm deployed migration history before planning database work. Edge Functions are `send-request-push` and `send-walk-reminders`. Manual SQL/ACL test artifacts cover claims, profiles, requests, impersonation, roles, invites, system-admin identity, and admin mutual swaps.

## 9. Runtime configuration and environment-variable names only

The client uses public Supabase configuration through `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Edge Functions read Supabase service configuration plus VAPID and cron-related environment variables. Never record values, tokens, endpoints, private keys, or secrets in this document.

## 10. Build, test, development, and deployment commands

Verified package scripts: `npm run typecheck` (or `npx tsc --noEmit`), `npm test -- --runInBand`, `npm start`, `npm run android`, `npm run ios`, and `npm run web`. The repository has no package scripts for export/build deployment, EAS deployment, migration application, or Edge Function deployment. Historical/manual commands in older documents are not current package-script authority.

Claude Code cloud has been verified against the GitHub repository to install dependencies and run the full local validation suite without requiring production secrets.

## 11. Security-sensitive and production-change rules

Never edit an already-applied migration; create a new migration for database changes. Production Supabase migrations, EAS/Expo or store deployment, Git push, destructive work, and production-data actions require explicit user approval. Preserve Hebrew RTL behavior, offline-first architecture, SyncQueue audit protections, and native notifications when changing Web Push. Inspect the diff before local commits and never include unrelated user work.

## 12. Current documentation reliability / known stale records

`package.json` is current for versions and scripts. `README.md` still describes Expo SDK 54, React Native 0.81.x, and React 19.1, which disagree with current package versions. `PROJECT_STATUS.md` and `MANIFEST.txt` are historical delivery records, especially around earlier migration `0016`; they are not deployed-state authority. Project-owned design documents govern approved product/brand/visual direction within their scope, while engineering evidence governs technical truth.

## 13. Verified decisions, constraints, and unresolved evidence gaps

Verified constraints: the repository abstraction is mandatory for app data access; Realtime is supplemental; remote notification recipient routing/content is server-determined; local UI success is not proof of remote synchronization; and permanent queue conflicts must remain visible rather than silently replayed.

**UNKNOWN / REQUIRES LIVE VERIFICATION:** migrations applied in each Supabase environment, effective `0019` migration state, live schema/RLS/RPC/function state, Edge Function deployment state, environment/secret availability, VAPID/cron/scheduler configuration, actual push delivery, EAS/store/hosting workflows outside the repository, real-device/offline/concurrency behavior, and production deployment state.

## 14. Engineering–Creative handoff boundaries

Engineering owns runtime behavior, data, offline/sync, authorization, RLS/RPCs, migrations, notification delivery/security, validation, and production controls. Creative owns approved product/brand/mascot/asset/visual direction, responsive/RTL presentation, animation, and visual QA. Joint review is required for visible permission, loading/error/offline/conflict states, notification presentation, accessibility/RTL/responsive behavior, asset integration, device behavior, performance-affecting UI, and release readiness. Creative documentation never overrides `AGENTS.md` engineering/safety authority.

## 15. Local Git-state caution / preservation of unrelated work

At this document's creation, unrelated user changes exist in `src/data/offlineFirstRepository.ts` and `src/data/syncQueue.ts`. Preserve them: do not reset, clean, modify, stage, or include them in a documentation-only commit unless separately authorized.
