-- DRAFT ONLY — NOT A HOSTED MIGRATION. Do not apply without explicit approval.
-- Requires a coordinated versioned update to finish_walk_v11 and any
-- lifecycle outbox/replay paths before activation. Boolean-only legacy
-- rows must remain distinguishable from newly counted rows.
-- Never backfill '2' from had_pee=true: old data records only yes/no.

ALTER TABLE public.walks
  ADD COLUMN IF NOT EXISTS pee_count integer,
  ADD COLUMN IF NOT EXISTS poop_count integer;

ALTER TABLE public.walks
  ADD CONSTRAINT walks_pee_count_nonnegative CHECK (pee_count IS NULL OR pee_count >= 0),
  ADD CONSTRAINT walks_poop_count_nonnegative CHECK (poop_count IS NULL OR poop_count >= 0);

-- IMPORTANT: before this becomes a real migration, verify:
-- 1. the deployed Staging migration ledger and schema;
-- 2. RPC write authorization and transaction boundaries;
-- 3. RLS, audit triggers, and offline SyncQueue replay semantics;
-- 4. atomic idempotent finish with counts for scheduled and spontaneous walks;
-- 5. legacy boolean fallback and cross-device refresh;
-- 6. null count compatibility in list_history_walks and list_statistics_walks.
