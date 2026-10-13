-- Persist the dog Home visual configuration used by the client.
-- Older staging databases predate these fields, causing photo removal and
-- Home background updates to fail when fromDog() writes the full dog row.
alter table public.dogs
  add column if not exists photo_cutout_url text,
  add column if not exists hero_background_id text;
