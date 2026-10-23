# Production Bootstrap Readiness

**Status:** BLOCKED AT THE PRODUCTION APPROVAL GATE
**Scope:** \`zxolmnkevbtorxmcyvnz\` only; no Production mutation is authorized by this document.

This is an evidence-backed, fail-closed runbook for turning the existing
Supabase project into a clean Walkie Doggy Link Production environment without
copying legacy Dog Walk Family data or any Staging family data. It deliberately
does not contain a destructive migration or an automatic deployment command.

## Verified inventory (2026-10-23)

| Surface | Verified state | Consequence |
| --- | --- | --- |
| Repository | 104 SQL migration files, plus \`supabase/schema.sql\` | The repository history is **not** a direct empty-database replay chain. |
| Staging (\`czbxhsoxyawprqehkfit\`) | 80 migration-ledger rows; 49 public tables, all with RLS; 186 public functions; 53 policies; 229 triggers | Current application reference environment. |
| Staging Storage | \`family-photos\` (public), \`chat-attachments\` (private, 5 MiB, image MIME allow-list) | Both buckets must exist before a Production application is made reachable. |
| Staging Edge Functions | 10 active functions | Production currently has only two legacy functions and must be explicitly promoted after a database bootstrap. |
| Production (\`zxolmnkevbtorxmcyvnz\`) | No migration-ledger rows; 24 public tables (all RLS enabled), 78 public functions, 32 policies, 17 triggers | It is a legacy schema, not an empty/current Walkie Doggy Link database. |
| Production legacy archive | \`legacy_archive_20261023\` with 26 tables | This is not an independently verified external backup and must not be treated as one. |
| Production Storage | Only \`family-photos\` | The required private chat-attachments bucket is absent. |
| Vercel \`walkie-doggy\` | No live Production deployment; no \`walkielink.co.il\` project-domain mapping; latest branch preview is READY | DNS and Production routing must remain untouched until the final gate. |

## Migration reconciliation

\`schema.sql\` is a target snapshot, not migration \`0000\` in ordinary project
history. Historical migrations rely on tables it supplies and overlap some of
its policies/functions. In addition, two version prefixes are intentionally
duplicated: \`0019\` (one committed file is empty) and \`0103\` (two bodies).
Migration \`0025\` also has a function-definition ordering constraint for an
empty replay.

The checked-in Integration Full-Chain Supabase Rehearsal handles those facts
only in its disposable checkout:

1. Seeds \`schema.sql\` as an ephemeral baseline.
2. Generates temporary policy/function guards.
3. Removes the empty \`0019\` entry, combines \`0103\`, and reorders \`0025\` only
   for the rehearsal copy.
4. Starts an isolated Docker Supabase stack, applies the complete final chain,
   and runs the RLS, Storage, chat, family-deletion, walk-lifecycle and GPS
   rehearsals.

The workflow succeeded at repository commit \`50879dce430c48c3332e093a4a6717c69da3b7b1\`
(run \`39924801896\`). The transformations are deliberately not committed as
Production SQL and do not alter Staging ledger history.

## Required pre-cutover evidence

All items below must be complete before any destructive Production operation.

1. **Independent legacy backup.** From a controlled machine with the
   Production database connection string, create separate roles, schema and
   data dumps using the official \`supabase db dump\` workflow. Export Storage
   objects and an object manifest separately. Store all artifacts outside the
   Supabase project, encrypted, with SHA-256 hashes and a manifest containing
   filenames, byte sizes, hashes and creation time.
2. **Restore rehearsal.** Restore those dumps to a disposable local PostgreSQL
   environment (never to Staging or Production), compare the dump manifest and
   table/object counts, and retain the successful restore log. A dump without a
   successful restore is not an acceptable backup.
3. **Immutable clean-bootstrap artifact.** Build the schema from a fresh
   isolated Supabase Docker stack using the Full-Chain rehearsal procedure;
   generate and review a schema/policy/function/trigger/bucket manifest from
   that successful database. The artifact must be pinned to the exact Git SHA
   being released.
4. **Production secrets/configuration review.** Confirm, without exposing
   values, the Production Supabase URL and publishable key, VAPID public key,
   Edge Function secrets (email provider, webhook verification, cron and push
   credentials), Auth URLs/redirects, and sender-domain configuration. These
   values must refer to Production—not Staging—and branch-scoped Preview
   variables must not be promoted as Production configuration.
5. **Security remediation decision.** Review the live Supabase advisors. Both
   projects currently report mutable \`search_path\`, SECURITY DEFINER execution
   exposure, anonymous-auth policies and leaked-password protection disabled.
   Production additionally reports legacy-archive findings. Do not waive these
   as a group: record the owner/authorization review for each Production-facing
   finding before go-live.

## Authorized cutover sequence (requires separate Production approval)

1. Freeze the exact Git SHA; rerun CI and the Integration Full-Chain rehearsal.
2. Verify the independent backup and its successful restore evidence.
3. Put the application into an explicit maintenance window; no public DNS
   change yet.
4. Apply the reviewed clean-bootstrap artifact to Production. This is a
   destructive schema replacement, not \`supabase db push\` against the legacy
   project. Do not import legacy/public/archive data, Staging users, test
   families or SyncQueue data.
5. Record only the clean-bootstrap migration provenance required for future
   forward migrations; never fabricate the historical Staging ledger.
6. Create/verify the two Storage buckets and policies, then deploy the ten
   repository Edge Functions with the reviewed Production-only secrets.
7. Run authenticated Production smoke tests using a new synthetic family only:
   Auth, onboarding, family membership, scheduled and spontaneous walks,
   chat, notification registration, GPS lifecycle and deletion isolation.
8. Verify production RLS, function/trigger/policy counts and Storage settings
   against the immutable artifact. Verify notifications/email separately.
9. Configure the Production Vercel variables, attach \`walkielink.co.il\`,
   verify HTTPS and deployment protection, deploy the pinned SHA, then perform
   browser and real-device acceptance checks.
10. Only after all checks pass, end maintenance and publish the production
    readiness record.

## Explicitly prohibited before approval

- Dropping, truncating, renaming or moving Production schemas/tables/data.
- Restoring, resetting or applying migrations to Production.
- Deploying/replacing Production Edge Functions, secrets or Vercel variables.
- Attaching or switching \`walkielink.co.il\` DNS.
- Replaying the 531 quarantined SyncQueue operations.
- Copying legacy or Staging family/application data into the clean environment.

## Current blockers

1. An independent legacy backup plus a successful restore rehearsal has not
   been produced. The current execution environment has no Docker daemon,
   Postgres client or database connection credentials, so it cannot safely
   create or validate the required external dump.
2. A final immutable clean-bootstrap artifact has not been reviewed for the
   exact Production release SHA. The existing CI rehearsal validates the
   source chain but intentionally does not emit a deployable destructive SQL
   artifact.
3. Production domain binding is absent from the Vercel project, and the
   separate \`walkie-doggy-staging\` project could not be inspected through the
   current Vercel permission scope.
4. Production security/performance advisor findings require explicit review;
   they cannot be silently dismissed during a bootstrap.
