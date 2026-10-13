# Agentic Staging access

This document defines the minimum non-Production access used by the Agentic Staging
readiness workflow.

## Isolation model

- GitHub Environment: `staging`
- Approved Supabase project ref: `czbxhsoxyawprqehkfit`
- Secrets are scoped only to the Staging verification job.
- Claude and the repository-writing Agentic job do not receive these secrets.
- The initial gate performs a read-only Supabase Auth health request.
- Production deploys, migrations, data writes, RLS changes, secret changes, and
  credential rotation remain prohibited without explicit owner approval.

## Required Environment secrets

Configure these under GitHub repository Settings → Environments → staging:

- `SUPABASE_STAGING_URL` — must be exactly
  `https://czbxhsoxyawprqehkfit.supabase.co`
- `SUPABASE_STAGING_ANON_KEY` — the publishable/anonymous key for this Staging
  project

Do not add a service-role key, database password, Supabase personal access token, or
Resend API key for the readiness gate. Those credentials are broader than required
for the current read-only check.

## Current capability

After the two Environment secrets are configured, the workflow can verify that the
approved Staging Auth endpoint is reachable. This is a prerequisite, not evidence of
complete E2E.

Live family creation, approval/rejection, email delivery, webhook handling, invite
and second-member join require reviewed test harnesses and explicit non-Production
mutation boundaries before they may be automated.
