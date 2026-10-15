# Walk Lifecycle v1.1 Staging Activation Checklist

This checklist describes a future, separately approved activation. The feature branch currently contains no Vercel configuration change, hosted migration, RPC invocation, or deployment.

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

- Approve the branch-scoped Preview variables and the custom-domain branch reassignment as Vercel configuration changes.
- Separately approve the reviewed duplicate-resolution and v1.1 migrations for the Staging Supabase ref `czbxhsoxyawprqehkfit`, then approve the three-record authenticated Family Admin resolution action.
- Approve the Staging application and lifecycle Edge Function deployment after migration verification.
- Keep Production untouched. Never use a service-role key in the app or impersonate a Family Admin JWT.

## P0 2026-10-15 — real-iPhone PGRST202 and corrected activation order

### What happened

- `staging.walkielink.co.il` is a manually pinned alias (updated 2026-10-14) to `walkie-doggy` deployment `dpl_8sZtGRZkMieb1HbV3jRxfjSjxJxz`, feature-branch SHA `9ca218b`. The domain's own Git-branch setting still says `fix/urgent-master-batch-20260925`; a new deployment of that branch can re-point the hostname. The next pin must be deliberate and SHA-verified.
- That build is a v1.1 client. Staging Supabase (`czbxhsoxyawprqehkfit`) has `20261013070000_walk_duplicate_resolution_v12` but not `20261013074334_walk_lifecycle_gps_v11`, because v1.1 fails closed on unresolved duplicate active walks. The client chose v1.1 RPCs only because the methods existed in code, so every start returned PGRST202 for `public.start_walk_v11`.

### Fix on this branch

- `20261015090000_walk_lifecycle_capabilities_v11.sql` adds `public.walk_lifecycle_server_capabilities()` (read-only, SECURITY INVOKER, `authenticated` only). It reports any missing v1.1 RPC signature, EXECUTE/SELECT grant, table, column or the one-active-walk index.
- The client probes it before any v1.1 lifecycle write and fails closed with an explicit Hebrew message (`WL11-SERVER` / `WL11-OFFLINE`) before creating local provisional state or outbox intents. It never falls back to legacy `start_walk()`/`finish_walk()`.
- A failed start discards the provisional GPS watch (`cancelTracking`) instead of persisting it.
- GPS history reads tolerate a pre-v1.1 server (missing `walk_gps_ownership`) instead of silently falling back to device-only data.

### Activation order (Staging only; approved 2026-10-15)

The Family Admin of the blocking family (f806158f…, dog 62c6b367…) is not available, so the duplicates are resolved by a verified System Admin through `20261013073000_system_admin_duplicate_walk_repair_v12.sql`, which applies the same marker-only resolution with an owner-approved, single-use, expiring authorization and a system audit row.

1. Run `supabase/manual_tests/walk_lifecycle_v11_staging_preflight_readonly.sql`. Section F must list exactly `088a73c5-0dd9-47fd-9bd1-fb44bc739eb3` and `2a495898-6936-487c-8da9-5fcaeb3b0b60` for that family/dog, both `in_progress`, unresolved.
2. From a checkout of the deployed SHA: `supabase link --project-ref czbxhsoxyawprqehkfit`, `supabase migration list`, then `supabase db push --dry-run`. Pending must be exactly `20261013073000`, `20261013074334`, `20261015090000`.
3. `supabase db push`. Expected: `20261013073000` applies (and seeds the one authorization); `20261013074334` then stops at its duplicate gate and rolls back atomically. Nothing else changes.
4. Re-run the preflight; section I must show the authorization with `unresolved=2`.
5. As a verified System Admin on `staging.walkielink.co.il` (not observing or impersonating): System Admin screen → "תחזוקת Staging — טיולים פעילים כפולים" → "סמן ככפילויות (ללא מחיקה)" → "אישור סופי". Record the audit group id shown.
6. Re-run the preflight; section E must be empty and section I must show the authorization consumed.
7. `supabase db push` again: applies `20261013074334` then `20261015090000`.
8. Run `supabase/manual_tests/walk_lifecycle_v11_staging_post_activation_verify_readonly.sql`; every row must be `ok = true` (35 checks).
9. Real-iPhone acceptance.

Until step 7 the app shows the `WL11-SERVER` message on Start/Finish instead of PGRST202; nothing is written.
