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
-- If a secret with that name already exists (re-running this on a project
-- that did this before), skip the statement above — this migration's own
-- cron-registration step is itself safe to re-run (see IDEMPOTENCY below)
-- and does not touch Vault at all once the name already resolves.
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
-- pattern: `create extension if not exists` for pg_cron/pg_net (already
-- created by 0025, repeated here defensively, same as 0091's own repeat),
-- and a named job created only if a job of that name does not already
-- exist. Re-running this migration on a project where the job is already
-- registered is a safe no-op, identical in spirit to every other
-- `if not exists` guard already used throughout this schema.
--
-- SCOPE — Staging only, per this batch's explicit approval boundary. This
-- file is NOT applied here; it is prepared for review and is only ever
-- applied to a database by an explicit, separate `supabase db push` (or
-- equivalent) approval, same as every other migration in this repository.
-- ----------------------------------------------------------------------------

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
begin
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
