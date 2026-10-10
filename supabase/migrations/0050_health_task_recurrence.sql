-- ============================================================================
-- 0050_health_task_recurrence.sql
--
-- Adds recurrence to health_tasks (0049), which deliberately shipped without
-- it — see 0049's own header for why data model / RLS / screens came first.
-- Per AGENTS.md ("never edit an already-applied migration"), this is a NEW
-- migration rather than an edit to 0049, even though 0049 has itself not yet
-- been applied to any shared Staging/Production database as of this commit.
--
-- Design: a single nullable `recurrence_interval_days` column on
-- health_tasks. When set on a task, completing it (client-side, in
-- healthStore.completeTask — see that file) generates the NEXT occurrence as
-- a NEW row (due_date = this completion's date + recurrence_interval_days,
-- completed_at null, same category/title/notes/responsible_user_id/
-- recurrence_interval_days so the chain continues). This mirrors
-- schedule_rules -> schedule_entries generation in spirit (a recurring
-- definition produces concrete future occurrences) but stays far simpler:
-- no separate "rule" table, no rotation, no day-of-week model — a single
-- fixed-interval-in-days field is enough for the PRD §10 categories
-- (vaccination/parasite-prevention/medication/vet-visit intervals are all
-- naturally "next one N days after this one"), and every occurrence is a
-- real, independently editable/completable health_tasks row rather than a
-- generated projection, so correcting or deleting-by-never-completing one
-- occurrence never requires touching a separate rule definition.
--
-- No RPC needed: health_tasks' INSERT/UPDATE policies (0049) are already
-- open to any family member, exactly like every other write this table
-- supports — generating the next occurrence is just another ordinary
-- insert, not a privileged operation.
-- ============================================================================

alter table health_tasks
  add column if not exists recurrence_interval_days int
    check (recurrence_interval_days is null or recurrence_interval_days > 0);

comment on column health_tasks.recurrence_interval_days is
  'When set, completing this task (client-side) generates the next occurrence due this many days after the completion date. Null = one-off record. See this migration''s header.';
