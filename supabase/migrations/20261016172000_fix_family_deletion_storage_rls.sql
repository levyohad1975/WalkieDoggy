-- Keep tombstones private: Storage RLS evaluates a privileged, narrowly scoped predicate.
create or replace function public.can_system_admin_delete_frozen_family_storage_object(p_bucket_id text, p_object_name text)
returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, public, storage
as $$
declare v_family_id uuid;
begin
  if auth.uid() is null or not public.is_verified_system_admin() then return false; end if;
  if p_bucket_id = 'family-photos' then
    begin
      v_family_id := nullif((storage.foldername(p_object_name))[1], '')::uuid;
    exception when invalid_text_representation then return false;
    end;
  elsif p_bucket_id = 'chat-attachments' then
    select c.family_id into v_family_id
    from public.chat_conversations c
    where c.id = (public.chat_attachment_path_parts(p_object_name))[1];
  else
    return false;
  end if;
  return coalesce(exists(
    select 1 from public.family_deletion_tombstones t
    where t.family_id = v_family_id and t.state = 'deleting'
  ), false);
end;
$$;
revoke all on function public.can_system_admin_delete_frozen_family_storage_object(text,text) from public, anon;
grant execute on function public.can_system_admin_delete_frozen_family_storage_object(text,text) to authenticated;
drop policy if exists "System Admin delete family photos during deletion" on storage.objects;
create policy "System Admin delete family photos during deletion" on storage.objects
for delete to authenticated
using (bucket_id = 'family-photos' and public.can_system_admin_delete_frozen_family_storage_object(bucket_id,name));
drop policy if exists "System Admin delete chat attachments during deletion" on storage.objects;
create policy "System Admin delete chat attachments during deletion" on storage.objects
for delete to authenticated
using (bucket_id = 'chat-attachments' and public.can_system_admin_delete_frozen_family_storage_object(bucket_id,name));
