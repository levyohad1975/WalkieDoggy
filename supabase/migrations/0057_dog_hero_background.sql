-- Family-shared Home hero scene. This is presentation metadata only; dog
-- updates remain guarded by the existing family-admin RLS policy.
alter table public.dogs
  add column if not exists hero_background_id text;
