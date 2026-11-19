-- Two production errors found 2026-11-11 (owner: "תטפל").
--
-- 1) Deleting a family photo (or an unsent chat attachment) failed with
--    "permission denied for table family_deletion_tombstones" (HTTP 400).
--    Production still had the ORIGINAL storage policies from
--    20261016115245_permanent_family_deletion, whose USING clause reads
--    family_deletion_tombstones directly; authenticated cannot read that
--    table, and the error aborts the whole DELETE even for a member's own
--    photo. 20261016172000_fix_family_deletion_storage_rls already moved the
--    check into the SECURITY DEFINER helper
--    can_system_admin_delete_frozen_family_storage_object() — the helper
--    exists in production, but its two policies were never replaced.
--    Recreate them exactly as that migration intended. Effect: a member's
--    failed photo save can clean up the file it just uploaded again.
--
-- 2) get_remote_gps_walk_status() raised "column reference "status" is
--    ambiguous" on every call: its RETURNS TABLE has a column named status
--    and its UPDATE ... WHERE status = 'pending' meant the table column.
--    The admin's Home polled it every 6 s and always got HTTP 400, so the
--    remote GPS status never showed. Same body, with #variable_conflict
--    use_column so unqualified names mean the table columns.

drop policy if exists "System Admin delete family photos during deletion" on storage.objects;
create policy "System Admin delete family photos during deletion" on storage.objects
for delete to authenticated
using (bucket_id = 'family-photos' and public.can_system_admin_delete_frozen_family_storage_object(bucket_id, name));

drop policy if exists "System Admin delete chat attachments during deletion" on storage.objects;
create policy "System Admin delete chat attachments during deletion" on storage.objects
for delete to authenticated
using (bucket_id = 'chat-attachments' and public.can_system_admin_delete_frozen_family_storage_object(bucket_id, name));

create or replace function public.get_remote_gps_walk_status(p_walk_id uuid)
returns table(command_id uuid, status text, failure_reason text, expires_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare f uuid:=current_family_id();a uuid:=real_current_profile_id();
begin
 if f is null or not is_family_admin(f) then raise exception 'admin required'; end if;
 insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action)
  select c.family_id,c.walk_id,a,c.target_user_id,'expired' from remote_gps_commands c
   where c.walk_id=p_walk_id and c.family_id=f and c.status='pending' and c.expires_at<=now();
 update remote_gps_commands set status='expired',failure_reason='expired',acknowledged_at=now()
  where walk_id=p_walk_id and family_id=f and status='pending' and expires_at<=now();
 insert into remote_gps_audit(family_id,walk_id,actor_user_id,target_user_id,action)
  select c.family_id,c.walk_id,a,c.target_user_id,'failed' from remote_gps_commands c
   where c.walk_id=p_walk_id and c.family_id=f and c.status='tracking' and c.acknowledged_at<now()-interval '30 seconds';
 update remote_gps_commands set status='failed',failure_reason='target_inactive',acknowledged_at=now()
  where walk_id=p_walk_id and family_id=f and status='tracking' and acknowledged_at<now()-interval '30 seconds';
 return query select c.id,c.status,c.failure_reason,c.expires_at from remote_gps_commands c
  where c.walk_id=p_walk_id and c.family_id=f order by c.created_at desc limit 1;
end; $function$;
revoke all on function public.get_remote_gps_walk_status(uuid) from public, anon;
grant execute on function public.get_remote_gps_walk_status(uuid) to authenticated;
