-- Family-shared Home scene. This migration is intentionally committed only;
-- it is not applied by the client or by this change set.
alter table public.dogs
  add column if not exists photo_cutout_url text,
  add column if not exists hero_background_id text;
