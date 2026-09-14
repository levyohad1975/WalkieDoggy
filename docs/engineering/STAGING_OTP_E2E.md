# Staging OTP E2E executor

Purpose: provide a non-Production execution path for real email OTP verification without exposing Staging credentials to the Claude worker.

## GitHub Environment

Use the existing GitHub Environment named `staging` and configure only non-Production values:

- `SUPABASE_STAGING_URL`
- `SUPABASE_STAGING_ANON_KEY`
- `STAGING_OTP_TEST_EMAIL`
- `STAGING_OTP_MAILBOX_TOKEN`
- `STAGING_OTP_MAILOSAUR_SERVER_ID`

The mailbox values are for an isolated automated test inbox. The workflow does not need Production credentials, a service-role key, database write credentials, or deployment permissions.

## Evidence contract

A successful run must prove, in one workflow execution:

1. Supabase Staging accepted an OTP request for the isolated test inbox.
2. The OTP email actually arrived in that inbox.
3. A six-digit OTP was extracted only inside the runner and never printed.
4. Supabase Staging accepted the OTP and returned an authenticated session.
5. The workflow emitted `STAGING_OTP_E2E_OK` and completed successfully.

A green repository CI run is not equivalent to this evidence.

## Safety

- The workflow refuses `main` as the target branch.
- It is bound to GitHub Environment `staging`.
- It has `contents: read` only.
- It performs no Production deploy, migration, secret change, merge, or destructive action.
- OTP and mailbox credentials are never printed.

After this gate is proven, extend the same staging executor to family creation persistence, join artifacts, and second-member join rather than giving the general-purpose Claude worker direct Staging credentials.
