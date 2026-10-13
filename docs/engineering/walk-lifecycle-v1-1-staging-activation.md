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
