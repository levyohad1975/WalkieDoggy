# Walk Lifecycle v1.1 Staging Activation Checklist

## Current checkpoint — 2026-10-15

The authenticated feature-branch Preview for commit `9cf5b3c2677185ed3eaf8e65f9810e7d43c0467a` is `READY` and has the three Staging variables scoped only to Preview deployments from `feat/walk-lifecycle-gps-v1-1` (Staging URL, publishable key, duplicate-maintenance flag). The canonical `staging.walkielink.co.il` domain API returned 403 for the connected Vercel account, so its mapping was not changed. Use the exact Preview URL in the handoff for the authenticated System Admin action; it is a Preview deployment connected to the Staging Supabase project.

Read-only preflight, the 11/11 v1.2 equivalence check, TypeScript, focused tests, and full Jest passed. Migration `20261015100000_system_admin_duplicate_walk_repair_v12` was applied to Staging in its documented ledgered transaction. Its one authorization is present, single-use, and unconsumed. The two listed walks remain `in_progress` with null duplicate markers; no lifecycle/GPS migration or duplicate-resolution RPC has run. The next action is the authenticated System Admin confirmation in the Staging-backed Preview UI. Stop here until that user action has completed.

## Preview environment variables

In Vercel, open the **`walkie-doggy`** project (project ID `prj_NwcNevO8643KEFHke6O66QECB6i5`) and add the following variables with the **Preview** environment selected and **Only for Preview deployments from the `feat/walk-lifecycle-gps-v1-1` branch** scope:

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://czbxhsoxyawprqehkfit.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The Staging project's publishable/anon client key, copied from the authorized Supabase project settings. Never use a service-role key. |
| `EXPO_PUBLIC_STAGING_WALK_DUPLICATE_RESOLUTION` | `true` |

Do not overwrite existing global Preview or Production variables. Keep these variables scoped to the feature branch. Confirm the project and Staging ref before saving; the separate `walkie-doggy-staging` Vercel project is not the target.

## Preview deployment and hostname

1. Confirm PR #150 is still open and its head branch is `feat/walk-lifecycle-gps-v1-1`.
2. Create a **Preview** deployment from the exact reviewed feature-branch SHA. Do not select a target merely named “staging”; verify its deployment target is Preview and its project ID is `prj_NwcNevO8643KEFHke6O66QECB6i5`.
3. In the deployment metadata, verify the branch, exact Git SHA, and that the compiled public Supabase URL is `https://czbxhsoxyawprqehkfit.supabase.co`. Also verify the feature flag is present only in this branch-scoped Preview deployment.
4. After separate approval to reassign the canonical Staging hostname, open **Settings → Domains** for `walkie-doggy`; set `staging.walkielink.co.il` to the feature branch `feat/walk-lifecycle-gps-v1-1` and Preview environment. Do not change Production domains or the Production branch.
5. Verify the domain's effective branch mapping and deployed SHA in Vercel. Smoke-test the exact hostname and confirm the app reports the Staging Supabase project before any data-changing operation.

## Required approval gates

- Branch-scoped Preview variables are present and verified. Changing the canonical Staging hostname still requires Vercel domain access; the current connected account receives 403 and this checklist does not claim the domain was reassigned.
- The approved helper migration is recorded for the Staging Supabase ref `czbxhsoxyawprqehkfit`. The remaining lifecycle/GPS migrations follow only after the authenticated System Admin confirmation has marked the two approved walks.
- Approve the Staging application and lifecycle Edge Function deployment after migration verification.
- Keep Production untouched. Never use a service-role key in the app or impersonate a Family Admin JWT.

## P0 2026-10-15 — real-iPhone PGRST202 and corrected activation order

### What happened

- `staging.walkielink.co.il` is a manually pinned alias (updated 2026-10-14) to `walkie-doggy` deployment `dpl_8sZtGRZkMieb1HbV3jRxfjSjxJxz`, feature-branch SHA `9ca218b`. The domain's own Git-branch setting still says `fix/urgent-master-batch-20260925`; a new deployment of that branch can re-point the hostname. The next pin must be deliberate and SHA-verified.
- That build is a v1.1 client. Staging Supabase (`czbxhsoxyawprqehkfit`) has `20261013164442_walk_duplicate_resolution_v12` but not `20261015100100_walk_lifecycle_gps_v11`, because v1.1 fails closed on unresolved duplicate active walks. The client chose v1.1 RPCs only because the methods existed in code, so every start returned PGRST202 for `public.start_walk_v11`.

### Fix on this branch

- `20261015100200_walk_lifecycle_capabilities_v11.sql` adds `public.walk_lifecycle_server_capabilities()` (read-only, SECURITY INVOKER, `authenticated` only). It reports any missing v1.1 RPC signature, EXECUTE/SELECT grant, table, column or the one-active-walk index.
- The client probes it before any v1.1 lifecycle write and fails closed with an explicit Hebrew message (`WL11-SERVER` / `WL11-OFFLINE`) before creating local provisional state or outbox intents. It never falls back to legacy `start_walk()`/`finish_walk()`.
- A failed start discards the provisional GPS watch (`cancelTracking`) instead of persisting it.
- GPS history reads tolerate a pre-v1.1 server (missing `walk_gps_ownership`) instead of silently falling back to device-only data.

### Migration history reconciliation (2026-10-15)

Staging's ledger records the v1.2 duplicate-resolution migration as `20261013164442` (it was applied through a tool that stamps its own version); the repository called it `20261013070000`. The repository file is now `20261013164442_walk_duplicate_resolution_v12.sql` with byte-identical content (git rename, 100% similarity), so the repository matches what Staging actually ran. The not-yet-applied migrations were renumbered after it so a fresh install keeps dependency order:

| Version | File | Staging |
| --- | --- | --- |
| `20261013164442` | `walk_duplicate_resolution_v12` | applied |
| `20261015100000` | `system_admin_duplicate_walk_repair_v12` | pending |
| `20261015100100` | `walk_lifecycle_gps_v11` (was `20261013074334`) | pending |
| `20261015100200` | `walk_lifecycle_capabilities_v11` (was `20261015090000`) | pending |

No ledger row is edited or deleted. `supabase/manual_tests/walk_duplicate_resolution_v12_deployed_equivalence_readonly.sql` proves the deployed v1.2 objects equal the repository's (11 catalog fingerprints) before anything is built on them.

Pending migrations are applied with `supabase/staging_apply/<file>.sql`, generated by `scripts/staging/build_ledgered_apply.py`. Each runs in one transaction: refuse if already recorded or a predecessor is missing, run the migration body verbatim (a test pins it byte-for-byte to the migration file), then record the repository version and name — exactly what `supabase db push` records. Any failure (e.g. the v1.1 duplicate gate) rolls back schema and ledger together. Do not use a tool that stamps its own version (e.g. an MCP `apply_migration`): it would recreate the drift.

The previous preflight compared deployed migration versions directly to the prefixes of repository filenames. That is invalid for this Staging project: the database has a stamped baseline and historic tool-applied versions. The corrected read-only inventory fingerprints every current Staging ledger row and identifies its repository source as exact, source-diverged, baseline, or ledger-only; it also fingerprints the three pending activation files and permits them only as absent or exact matches. The snapshot does not rewrite any historical migration or hosted ledger row. Historical source-diverged/ledger-only entries remain visible as provenance gaps; the v1.2 deployed-equivalence check and live dependency checks are still mandatory before activation.

### Activation order (Staging only; approved 2026-10-15)

1. Read-only: run `walk_lifecycle_v11_staging_preflight_readonly.sql`. Required: A2 `ledger_drift` is empty; `repo_inventory` contains the 69 currently applied Staging rows plus the three pending activation files, with the pending files absent; A2b reports v1.2 recorded and all three activation migrations unrecorded; E lists only dog `62c6b367…` with 2; F lists exactly `088a73c5-0dd9-47fd-9bd1-fb44bc739eb3` and `2a495898-6936-487c-8da9-5fcaeb3b0b60` in family `f806158f-eee9-4a6e-87be-72c4a3d64f75`; every C `matches_expected` value is true. C evaluates v1.1/repair objects against the applied migration stage, so their expected absence before activation is not treated as drift. Stop on any ledger, trigger, dependency, or duplicate difference.
2. Read-only: run `walk_duplicate_resolution_v12_deployed_equivalence_readonly.sql`. Required: `SUMMARY: 11/11`. A function-body mismatch is real drift: stop.
3. Run `supabase/staging_apply/20261015100000_system_admin_duplicate_walk_repair_v12.sql` as one SQL execution.
4. Re-run the preflight: A2 has no drift, A2b shows the repair authorization migration recorded while v1.1 and capabilities remain unrecorded, C `matches_expected` remains all true, and section I shows one authorization for the two walks with `unresolved=2`, not consumed.
5. As a verified System Admin on the Staging-backed feature Preview (not observing or impersonating): System Admin screen → "תחזוקת Staging — טיולים פעילים כפולים" → "סמן ככפילויות (ללא מחיקה)" → "אישור סופי". Record the audit group id shown. The canonical Staging hostname remains unmapped by this session because Vercel returned 403 for domain access; do not use a different deployment or environment.
6. Re-run the preflight: E empty; I shows the authorization consumed with that group id. Optionally: both walks still `in_progress` with `duplicate_resolution_group_id` = that id; `system_audit_log` has one `system_admin_resolved_duplicate_active_walks` row.
7. Run `supabase/staging_apply/20261015100100_walk_lifecycle_gps_v11.sql`.
8. Run `supabase/staging_apply/20261015100200_walk_lifecycle_capabilities_v11.sql`.
9. Run `walk_lifecycle_v11_staging_post_activation_verify_readonly.sql`: `SUMMARY: 35/35`.
10. Staging smoke and real-iPhone acceptance.

If step 7 is attempted before step 5, it fails at the duplicate gate and writes nothing. If any step is attempted out of order, its guard refuses and writes nothing.

Until step 8 the app shows the `WL11-SERVER` message on Start/Finish instead of PGRST202; nothing is written.
