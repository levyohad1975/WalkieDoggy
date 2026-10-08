-- ----------------------------------------------------------------------------
-- 0105_register_walk_reminder_cron.sql
--
-- P0 notification-delivery repair: migration 0025 built every DB-side piece
-- send-walk-reminders needs (due_walk_reminders(), walk_reminder_context(),
-- the per-recipient exactly-once bookkeeping) but deliberately did NOT
-- register the periodic trigger itself — see 0025's Part 6 header for why
-- (it would require embedding this project's own deployed function URL and
-- a shared secret in version-controlled SQL). That one-time registration
-- step was never actually run against this project: a direct, read-only
-- check of `cron.job` on 2026-10-08 found exactly one active job
-- (`walkie-prune-gps-routes`, migration 0091) and NO job targeting
-- send-walk-reminders at all. That is the confirmed, root-cause explanation
-- for "upcoming/overdue walk reminders never arrive" — every other piece
-- (the SQL functions, the Edge Function itself, the client's registration
-- and local-fallback-suppression logic) was already in place and correct;
-- nothing was ever invoking the sender on a schedule.
--
-- VAULT PREREQUISITE (found 2026-10-08) — a direct, read-only check of
-- `pg_extension` on this project found pg_cron and pg_net installed, but
-- supabase_vault NOT installed (the extension that provisions the `vault`
-- schema `vault.decrypted_secrets` below depends on). This migration now
-- enables it itself (`create extension if not exists supabase_vault;`,
-- same pattern as the pg_cron/pg_net lines already below). If Vault is
-- genuinely unavailable on this project's plan, that statement fails with
-- Postgres's own "extension ... is not available" error and the whole
-- migration aborts — no partial state is left behind, and the fix is to
-- enable Vault for the project (Dashboard → Database → Extensions →
-- supabase_vault) before re-running this file.
--
-- SECRET HANDLING — this migration still embeds no secret value, matching
-- 0025's own policy exactly. WALK_REMINDER_CRON_SECRET already exists as an
-- Edge Function secret (`supabase secrets set`, consumed via
-- `Deno.env.get()` inside send-walk-reminders/index.ts) — but the DATABASE
-- itself cannot read that store; a cron job's `net.http_post` body is plain
-- SQL text, so the same secret VALUE must separately exist inside this
-- project's own Vault (a completely different secret store, encrypted at
-- rest, readable only via the `vault.decrypted_secrets` view used below),
-- under a name this migration only ever REFERENCES, never defines. That is
-- a REQUIRED, MANUAL, one-time prerequisite to running this migration —
-- run once, by hand, by whoever already holds the real secret value (e.g.
-- from `supabase secrets list` / wherever it was originally generated),
-- replacing the placeholder:
--
--   select vault.create_secret(
--     'PASTE_THE_EXACT_WALK_REMINDER_CRON_SECRET_VALUE_HERE',
--     'walk_reminder_cron_secret',
--     'Shared secret this project''s cron job sends as x-cron-secret when invoking send-walk-reminders (migration 0105).'
--   );
--
-- HARD GUARD — if that manual step was skipped, the cron job must NOT be
-- registered: a job created anyway would silently send a null/broken
-- x-cron-secret header on every single invocation forever, which
-- send-walk-reminders's own timing-safe check would correctly reject every
-- time, with nothing in this migration's own output ever surfacing why.
-- The DO block below therefore checks `vault.decrypted_secrets` for the
-- named secret FIRST and raises a clear, actionable exception (naming the
-- missing secret and the exact statement to run) instead of proceeding,
-- rather than registering a job that can never actually authenticate. If a
-- secret with that name already exists (re-running this on a project that
-- did the manual step before), the check passes silently and this
-- migration's own cron-registration step proceeds as normal.
--
-- ENDPOINT — the project ref (czbxhsoxyawprqehkfit, this Staging project)
-- is not a secret; it is the same public ref already documented in
-- docs/engineering/AGENTIC_STAGING_ACCESS.md.
--
-- CADENCE — 0025's own header states the intended cadence: "roughly once a
-- minute ... this function is idempotent and safe to invoke more often,
-- less often, concurrently, or after a long gap." This migration schedules
-- it at that stated cadence, '* * * * *'.
--
-- IDEMPOTENCY — mirrors 0091_enable_gps_retention_cron.sql's own exact
-- pattern: `create extension if not exists` for pg_cron/pg_net/supabase_vault
-- (pg_cron/pg_net already created by 0025, repeated here defensively, same
-- as 0091's own repeat), and a named job created only if a job of that name
-- does not already exist. Re-running this migration on a project where the
-- job is already registered and the secret already exists is a safe
-- no-op, identical in spirit to every other `if not exists` guard already
-- used throughout this schema. Re-running it before the manual secret-
-- creation step is done is a safe, repeatable FAILURE (the hard guard
-- above), never a silent partial success.
--
-- INVOCATION-TIME ACCESS — this migration can only confirm the secret
-- exists at MIGRATION-APPLY time; the cron job itself re-reads
-- `vault.decrypted_secrets` fresh on every single invocation (the
-- subquery is inside the scheduled command, not evaluated once here), so
-- as long as the secret is never deleted/renamed after this migration
-- runs, every future invocation resolves it the same way. send-walk-
-- reminders's own `x-cron-secret` check (supabase/functions/send-walk-
-- reminders/index.ts) is unchanged by this migration and still rejects any
-- request whose header does not match WALK_REMINDER_CRON_SECRET exactly —
-- so a wrong/renamed Vault secret still fails safely (loud 401s in that
-- function's own Staging logs), it just never silently succeeds.
--
-- SCOPE — Staging only, per this batch's explicit approval boundary. This
-- file is NOT applied here; it is prepared for review and is only ever
-- applied to a database by an explicit, separate `supabase db push` (or
-- equivalent) approval, same as every other migration in this repository.
-- ----------------------------------------------------------------------------

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

do $$
declare
  secret_exists boolean;
begin
  select exists (
    select 1 from vault.decrypted_secrets where name = 'walk_reminder_cron_secret'
  ) into secret_exists;

  if not secret_exists then
    raise exception
      'Vault secret "walk_reminder_cron_secret" does not exist yet. Run this once, by hand, with the real WALK_REMINDER_CRON_SECRET value (e.g. from `supabase secrets list`), then re-run this migration: select vault.create_secret(''<the real secret value>'', ''walk_reminder_cron_secret'', ''Shared secret this project''''s cron job sends as x-cron-secret when invoking send-walk-reminders (migration 0105).'');';
  end if;

  if not exists (select 1 from cron.job where jobname = 'walkie-send-walk-reminders') then
    perform cron.schedule(
      'walkie-send-walk-reminders',
      '* * * * *',
      $cron$
      select net.http_post(
        url := 'https://czbxhsoxyawprqehkfit.supabase.co/functions/v1/send-walk-reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'walk_reminder_cron_secret'
          )
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  end if;
end $$;
