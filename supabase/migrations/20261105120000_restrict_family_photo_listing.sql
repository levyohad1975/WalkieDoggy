-- Stop anonymous/cross-family enumeration of the family-photos bucket.
--
-- Security review 2026-11-05 finding S1. The `family-photos` bucket is public
-- (its objects are served through the public download endpoint, which does not
-- consult RLS), but its SELECT policy on storage.objects was
--   (bucket_id = 'family-photos')  for the `public` role.
-- That policy governs the LIST / object-metadata API, so ANY caller — including
-- an unauthenticated one — could enumerate every object in the bucket and read
-- back every family's id (the first path segment) and photo filenames. Today
-- the bucket holds only dog photos, but the same bucket is the upload target
-- for every family image, so the exposure grows with use.
--
-- Fix: scope the SELECT policy to authenticated members of the family that owns
-- the path, mirroring the existing `upload family photos` / `update family
-- photos` / `delete family photos` policies. This removes listing for anonymous
-- and cross-family callers.
--
-- NOT a breaking change for image display: the app only ever reads these images
-- through getPublicUrl() (the public /object/public/ endpoint, which bypasses
-- RLS for a public bucket) and never calls storage .list() on this bucket
-- (verified in src/lib/uploadImage.ts and callers). Uploads are unchanged.
--
-- System Admin access during family deletion continues to run through the
-- separate, verified-system-admin SELECT/DELETE policies, which are untouched.

drop policy if exists "read family photos" on storage.objects;

create policy "read family photos"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'family-photos'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = (public.current_family_id())::text
    and public.active_system_admin_observer_family() is null
  );
