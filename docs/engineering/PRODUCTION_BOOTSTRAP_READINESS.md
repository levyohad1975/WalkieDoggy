# Production Bootstrap Readiness

**Status:** NO-GO — BLOCKED BEFORE THE PRODUCTION APPROVAL GATE
**Scope:** `zxolmnkevbtorxmcyvnz` only; no Production mutation is authorized by this document.

This is an evidence-backed, fail-closed runbook for turning the existing
Supabase project into a clean Walkie Doggy Link Production environment without
copying legacy Dog Walk Family data or any Staging family data. It deliberately
does not contain a destructive migration or an automatic deployment command.

## Verified inventory (2026-10-23)

| Surface | Verified state | Consequence |
| --- | --- | --- |
| Repository | 104 SQL migration files, plus `supabase/schema.sql` | The repository history is **not** a direct empty-database replay chain. |
| Staging (`czbxhsoxyawprqehkfit`) | 80 migration-ledger rows; 49 public tables, all with RLS; 186 public functions; 53 policies; 229 triggers | Current application reference environment. |
| Staging Storage | `family-photos` (public), `chat-attachments` (private, 5 MiB, image MIME allow-list) | Both buckets must exist before a Production application is made reachable. |
| Staging Edge Functions | 10 active functions | Production currently has only two legacy functions and must be explicitly promoted after a database bootstrap. |
| Production (`zxolmnkevbtorxmcyvnz`) | No migration-ledger rows; 24 public tables (all RLS enabled), 78 public functions, 32 policies, 17 triggers | It is a legacy schema, not an empty/current Walkie Doggy Link database. |
| Production legacy archive | `legacy_archive_20261023` with 26 tables | This is not an independently verified external backup and must not be treated as one. |
| Production Storage | Only `family-photos` | The required private chat-attachments bucket is absent. |
| Vercel `walkie-doggy` | No live Production deployment; no `walkielink.co.il` project-domain mapping; latest branch preview is READY | DNS and Production routing must remain untouched until the final gate. |

## Final-readiness audit (2026-10-23)

All checks in this section were read-only against hosted services. No Production
data, schema, Auth setting, secret, Edge Function, Vercel variable, DNS record
or deployment was changed.

| Area | Verified result | Go-live consequence |
| --- | --- | --- |
| Production project | Active/healthy, Postgres 17.6; Production API URL exists and it has one enabled legacy anon key and one enabled publishable key | Keys/URL must still be compared under a controlled secret review; values were not retrieved. |
| Edge Functions | Repository has 11 deployable functions; Staging has 10 active; Production has only legacy `send-request-push` and `send-walk-reminders` | Production is missing the current function set. In particular, the client invokes `send-walk-lifecycle-notification`, which is not active in Staging or Production. |
| Function authentication | Production's legacy `send-request-push` has `verify_jwt=false`; current Staging/repository configuration has it enabled. The three intentionally unauthenticated hooks are `send-email`, `email-provider-webhook`, and cron-gated `send-walk-reminders`. | Promote only reviewed source functions after the database bootstrap, with their custom signature/cron checks and Production-only secrets verified. |
| Required Edge Function secret names | Source requires the managed Supabase URL/key plus `WELCOME_EMAIL_FROM`, `SEND_EMAIL_HOOK_SECRET`, `RESEND_WEBHOOK_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `WALK_REMINDER_CRON_SECRET`, `CHAT_CLEANUP_CRON_SECRET`, and `SYSTEM_OWNER_EMAIL` where applicable | Presence and Production-specific values could not be safely enumerated through the available read-only connector. Confirm at the final secret-review gate without disclosing values. |
| Auth | Local config intentionally enables anonymous sign-ins; both hosted advisors report anonymous-auth exposure and leaked-password protection disabled | Anonymous onboarding is an application requirement and must be explicitly accepted with its RLS/RPC boundaries. Enable leaked-password protection and verify Production Auth URLs, redirects, mail sender/domain and hook configuration during cutover. |
| Vercel Production env | Non-decrypting inventory shows Production-scoped Supabase URL, publishable key and VAPID public key entries; branch Preview entries are separately scoped to Staging | Existence is verified, but values were not decrypted, so correct Production targeting is still a blocker. |
| Vercel routing | `walkie-doggy` has no live deployment and only its built-in `.vercel.app` Production domain. `walkielink.co.il` is not mapped. Preview for `a3f10ed` is READY. | Do not attach DNS or promote a deployment before final approval. |

## Security Advisor disposition

The Advisor was rerun on both projects on 2026-10-23. Production currently
reports 9 RLS-enabled/no-policy informational findings, four mutable
`search_path` warnings, 74 anon and 74 authenticated SECURITY DEFINER execute
warnings, anonymous-auth exposure, and leaked-password protection disabled.
Staging reports the analogous categories, including one SECURITY DEFINER
function without a pinned search path.

`20261023110000_harden_function_search_path.sql` is the only justified
source remediation prepared here. It is an idempotent, data-free migration
that pins `pg_catalog, public` on each present reported legacy helper
function. It has **not** been applied to Staging or Production. Broad
`EXECUTE` revocation is not safe without a complete RPC authorization map:
the application deliberately exposes RPCs to anonymous sessions for its
anonymous-family onboarding model, and each function must be reviewed
individually. Tables with RLS but no policy default-deny by design and need a
function-by-function server-access review rather than a blanket policy.

The following risks are therefore not accepted silently and remain cutover
requirements: Production Auth leaked-password protection, anonymous-auth
authorization review, all SECURITY DEFINER grants, and the legacy archive's
advisor findings.

## Deterministic bootstrap evidence artifact

The Integration Full-Chain workflow now emits a 30-day,
`production-bootstrap-evidence-<Git SHA>` artifact after the full isolated
replay and all SQL rehearsals succeed. It contains only a normalized
`public`/`storage` schema dump, catalog and bucket manifests, source file
hashes and checksums — no application rows, Auth users, secrets or Storage
objects. It is deterministic for a pinned source SHA and is explicitly not a
Production apply script. Its first validation must be the CI run for the
commit that adds this workflow step.

## Migration reconciliation

`schema.sql` is a target snapshot, not migration `0000` in ordinary project
history. Historical migrations rely on tables it supplies and overlap some of
its policies/functions. In addition, two version prefixes are intentionally
duplicated: `0019` (one committed file is empty) and `0103` (two bodies).
Migration `0025` also has a function-definition ordering constraint for an
empty replay.

The checked-in Integration Full-Chain Supabase Rehearsal handles those facts
only in its disposable checkout:

1. Seeds `schema.sql` as an ephemeral baseline.
2. Generates temporary policy/function guards.
3. Removes the empty `0019` entry, combines `0103`, and reorders `0025` only
   for the rehearsal copy.
4. Starts an isolated Docker Supabase stack, applies the complete final chain,
   and runs the RLS, Storage, chat, family-deletion, walk-lifecycle and GPS
   rehearsals.

The workflow succeeded at repository commit `50879dce430c48c3332e093a4a6717c69da3b7b1`
(run `39924801896`). The transformations are deliberately not committed as
Production SQL and do not alter Staging ledger history.

## Required pre-cutover evidence

All items below must be complete before any destructive Production operation.

1. **Independent legacy backup.** From a controlled machine with the
   Production database connection string, create separate roles, schema and
   data dumps using the official `supabase db dump` workflow. Export Storage
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
   projects currently report mutable `search_path`, SECURITY DEFINER execution
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
   destructive schema replacement, not `supabase db push` against the legacy
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
9. Configure the Production Vercel variables, attach `walkielink.co.il`,
   verify HTTPS and deployment protection, deploy the pinned SHA, then perform
   browser and real-device acceptance checks.
10. Only after all checks pass, end maintenance and publish the production
    readiness record.

## Explicitly prohibited before approval

- Dropping, truncating, renaming or moving Production schemas/tables/data.
- Restoring, resetting or applying migrations to Production.
- Deploying/replacing Production Edge Functions, secrets or Vercel variables.
- Attaching or switching `walkielink.co.il` DNS.
- Replaying the 531 quarantined SyncQueue operations.
- Copying legacy or Staging family/application data into the clean environment.

## Current blockers

1. An independent legacy backup plus a successful restore rehearsal has not
   been produced. The current execution environment has no Docker daemon,
   Postgres client or database connection credentials, so it cannot safely
   create or validate the required external dump.
2. The new data-free bootstrap evidence artifact still needs its first
   successful CI run for the exact release SHA. It is evidence for the
   reviewed bootstrap procedure, not authorization to apply destructive SQL.
3. Production Edge Functions are incomplete and legacy configuration differs
   from the repository; Production secrets, Auth URLs/redirects/sender and
   Vercel variable values remain unverified by design.
4. Production domain binding is absent from the Vercel project, and the
   separate `walkie-doggy-staging` project could not be inspected through the
   current Vercel permission scope.
5. Production security/performance advisor findings require explicit review;
   they cannot be silently dismissed during a bootstrap.
