# Verified family onboarding rollout

This document describes repository support added by Issue #3 Batch 2. It is
not evidence that any production change has been applied.

## Delivered repository components

- The app verifies a prospective family admin by email OTP.
- Family creation calls the `create-verified-family` Edge Function.
- Migration `0032_verified_family_onboarding.sql` is the backward-compatible
  expand phase: it adds approval state and the service-role-only creation and
  System Admin approval RPCs.
- Migration `0033_verified_family_onboarding_cutover.sql` is the contract
  phase: it revokes anonymous creation and makes authorization/invites fail
  closed for non-active families.
- The Edge Function reads `AUTO_APPROVE_NEW_FAMILIES` server-side, creates
  the family idempotently, sends a best-effort welcome email, and sends a
  best-effort system-owner email. Email failure never rolls back an already
  committed family.
- Migration `0034_email_delivery_log.sql` adds `email_delivery_log` (no
  client policies; service-role and a system-admin read RPC only) so every
  welcome/system-owner send attempt is durably recorded with its outcome,
  and the new `email-provider-webhook` Edge Function updates that record as
  the provider reports delivered/bounced/complained/opened events. This
  closes the "email delivery/observability and failure handling" QA theme
  in `docs/qa/QA_RELEASE_GUARDIAN.md` — previously a failed or bounced send
  left no trace beyond the caller-facing `warnings` array.

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
| `RESEND_WEBHOOK_SECRET` | yes for delivery observability | Verifies `email-provider-webhook`'s Svix-style signature; configure a Resend webhook endpoint pointing at that function's URL with this same signing secret |

## Production safety gate

Migration 0033 revokes the legacy anonymous `create_family` path. Migration
0032 is intentionally backward-compatible so the Edge Function and client can
be introduced and verified before cutover. Production rollout therefore uses
these prechecks:

1. Confirm the live applied migration history, including both `0019`
   filenames.
2. Confirm Email OTP works in the target Supabase project.
3. Configure and test the Edge Function secrets in a non-production project.
4. Apply additive migrations 0032 and 0034 in a non-production environment
   (0034 is additive/independent of the 0033 cutover and only adds the
   delivery log, so it can go out with 0032).
5. Deploy the `create-verified-family` and `email-provider-webhook` Edge
   Functions and verify their health.
6. Deploy the compatible client and verify it uses the new function.
7. Apply cutover migration 0033 only after steps 4–6 are healthy.
8. Test active creation with `AUTO_APPROVE_NEW_FAMILIES=true`.
9. Test pending creation and System Admin approval with it set to `false`.
10. Verify welcome/owner delivery, retry behavior, invite blocking while
   pending, and audit entries.
11. Configure a Resend webhook endpoint pointed at `email-provider-webhook`
    with `RESEND_WEBHOOK_SECRET` set, and confirm a real send transitions
    `email_delivery_log` from `sent` to `delivered` (or `bounced`/
    `complained`) via `system_admin_list_email_delivery_log`.

No step above was performed as part of the repository change.

## Rollback boundary

Do not roll back by editing an applied migration. If production rollback is
needed, ship a new reviewed forward migration restoring the previous grants
and authorization behavior, then roll the client back in a coordinated
release. Preserve the onboarding and system audit records.
