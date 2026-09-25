-- ----------------------------------------------------------------------------
-- 0058_dog_photo_cutout_url.sql
--
-- Adds dogs.photo_cutout_url: the best-effort transparent background-removal
-- cutout of dogs.photo_url, produced server-side by the
-- remove-photo-background Edge Function (Hugging Face RMBG-1.4 behind an
-- isolated provider interface — see supabase/functions/
-- remove-photo-background/provider.ts). Purely additive, nullable, no
-- backfill: existing dogs simply have no cutout until their photo is
-- next changed, at which point Home falls back to the raw photo (and
-- ultimately the animated mascot) exactly as it already does today.
--
-- No RLS change needed: dogs' existing row-level security already governs
-- this column the same as photo_url (same table, same policies).
-- ----------------------------------------------------------------------------

alter table public.dogs
  add column if not exists photo_cutout_url text;
