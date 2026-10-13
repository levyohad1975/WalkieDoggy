-- Prevent duplicate active routine rules from creating duplicate future walk occurrences.
-- Existing duplicate data is cleaned separately in Staging after references are reconciled.
create unique index if not exists schedule_rules_active_identity_uidx
on public.schedule_rules (
  family_id,
  dog_id,
  time,
  days_of_week,
  rotation_user_ids,
  rotation_anchor_date
)
where active = true;
