# Verified family onboarding rollout

This document describes repository support added by Issue #3 Batch 2. It is
not evidence that any production change has been applied.

## Delivered repository components

- The app verifies a prospective family admin by email OTP.
- Family creation calls the `create-verified-family` Edge Function.
- Migration `0032_verified_family_onboarding.sql` makes verified creation
  service-role-only, adds active/pending/rejected approval state, makes
  authorization and invite joining fail closed for non-active families, and
  adds a System Admin approval RPC.
- The Edge Function reads `AUTO_APPROVE_NEW_FAMILIES` server-side, creates
  the family idempotently, sends a best-effort welcome email, and sends a
  best-effort system-owner email. Email failure never rolls back an already
  committed family.

## Required Supabase Auth configuration

Email sign-in must be enabled. The email template must display the Supabase
OTP token because the app asks the user to type that code. Rate limits and
allowed redirect/site URLs should be reviewed even though the OTP flow does
not rely on a redirect to complete verification.

Anonymous sign-in remains required for existing join/redeem device flows.
Verified family creation replaces only the creator's anonymous session with
the verified email session; it does not merge or reinterpret family profiles.

## Edge Function environment variables

Values are intentionally not stored in this repository.

| Name | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Project URL supplied by Supabase |
| `SUPABASE_ANON_KEY` | yes | User-scoped token validation |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Calls the service-role-only creation RPC |
| `AUTO_APPROVE_NEW_FAMILIES` | yes | Exactly `true` or `false`; defaults to `true` only when absent |
| `APP_PUBLIC_URL` | yes for welcome links | App link, join link, and QR route |
| `RESEND_API_KEY` | yes for email | Email delivery provider credential |
| `WELCOME_EMAIL_FROM` | yes for email | Verified sender identity |
| `SYSTEM_OWNER_EMAIL` | yes for owner alert | Internal new-family recipient |

## Production safety gate

Migration 0032 revokes the legacy anonymous `create_family` path. Applying
it without the compatible Edge Function and client would stop new-family
creation. Production rollout therefore requires an explicit maintenance
decision and these prechecks:

1. Confirm the live applied migration history, including both `0019`
   filenames.
2. Confirm Email OTP works in the target Supabase project.
3. Configure and test the Edge Function secrets in a non-production project.
4. Deploy the Edge Function and verify its health.
5. Apply migration 0032 and deploy the compatible app as one coordinated
   release.
6. Test active creation with `AUTO_APPROVE_NEW_FAMILIES=true`.
7. Test pending creation and System Admin approval with it set to `false`.
8. Verify welcome/owner delivery, retry behavior, invite blocking while
   pending, and audit entries.

No step above was performed as part of the repository change.

## Rollback boundary

Do not roll back by editing an applied migration. If production rollback is
needed, ship a new reviewed forward migration restoring the previous grants
and authorization behavior, then roll the client back in a coordinated
release. Preserve the onboarding and system audit records.
