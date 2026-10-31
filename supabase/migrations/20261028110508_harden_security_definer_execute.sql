-- SECURITY DEFINER functions execute with their owner's privileges. PostgreSQL
-- grants EXECUTE to PUBLIC by default, which exposes new public-schema RPCs to
-- Supabase's anon role unless each definition remembers to revoke that grant.
--
-- The app's onboarding obtains an Auth session before it invokes a database
-- RPC. Anonymous Auth sessions likewise use the authenticated Postgres role.
-- This migration therefore denies pre-session/anon RPC access, retains direct
-- service_role grants from earlier migrations, and restores authenticated
-- execution only for RPC names used by the shipped client.

do $$
declare
  target_function regprocedure;
begin
  for target_function in
    select p.oid::regprocedure
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format('revoke all on function %s from public, anon', target_function);
  end loop;
end;
$$;

do $$
declare
  target_function regprocedure;
  client_rpc_names constant text[] := array[
    'acknowledge_walk_lifecycle_notifications_v11',
    'acquire_walk_gps_ownership_v11',
    'admin_delete_family_member',
    'admin_delete_schedule_rule',
    'admin_list_audit_log',
    'admin_list_family_activity',
    'admin_remove_unused_dog',
    'admin_reschedule_walk',
    'admin_swap_walks',
    'am_i_system_admin',
    'append_walk_gps_route_v11',
    'approve_swap_request',
    'approve_time_change_request',
    'begin_impersonation',
    'begin_system_admin_observer',
    'chat_clear_conversation_for_me',
    'chat_clear_family_conversation_for_everyone',
    'chat_delete_message',
    'chat_delete_messages',
    'chat_list_conversations',
    'chat_mark_read',
    'chat_open_direct_conversation',
    'chat_open_family_conversation',
    'chat_send_image_message',
    'chat_send_message',
    'chat_set_notifications_muted',
    'claim_family_profile',
    'claim_family_profile_with_pin',
    'clear_member_permission_override',
    'create_family',
    'create_family_invite',
    'create_swap_request',
    'create_time_change_request',
    'current_family_is_qa',
    'current_family_role',
    'delete_schedule_entry_idempotent',
    'delete_schedule_rule_idempotent',
    'end_impersonation',
    'end_system_admin_observer',
    'enter_qa_sandbox',
    'exit_qa_sandbox',
    'find_family_by_invite_code',
    'finish_walk',
    'finish_walk_v11',
    'finish_walk_v12',
    'get_last_resolved_walk',
    'get_my_family_onboarding_status',
    'has_active_remote_push_channel',
    'heartbeat_walk_gps_ownership_v11',
    'inspect_family_invite',
    'inspect_family_invite_detail',
    'join_family',
    'list_family_invites',
    'list_history_walks',
    'list_statistics_walks',
    'mark_my_request_results_seen',
    'qa_reset_data',
    'qa_reset_full',
    'redeem_family_invite',
    'regenerate_invite_code',
    'reject_swap_request',
    'reject_time_change_request',
    'release_walk_gps_ownership_v11',
    'resolve_duplicate_active_walks_v12',
    'revoke_family_invite',
    'save_walk_gps_reconstruction_v1',
    'set_member_permission_override',
    'set_member_role',
    'set_profile_pin',
    'start_spontaneous_walk_v11',
    'start_walk',
    'start_walk_v11',
    'system_admin_begin_family_deletion',
    'system_admin_enter_test_family',
    'system_admin_exit_test_family',
    'system_admin_family_deletion_impact',
    'system_admin_finalize_family_deletion',
    'system_admin_get_active_test_family',
    'system_admin_get_family_detail',
    'system_admin_list_chat_families',
    'system_admin_list_duplicate_walk_authorizations',
    'system_admin_list_email_delivery_log',
    'system_admin_list_families_v2',
    'system_admin_list_family_chats',
    'system_admin_list_family_deletion_storage_objects',
    'system_admin_list_global_audit',
    'system_admin_list_test_families',
    'system_admin_read_chat_messages',
    'system_admin_resolve_authorized_duplicate_walks_v12',
    'system_admin_set_family_approval',
    'system_admin_switch_test_family',
    'touch_last_seen',
    'upsert_push_token',
    'upsert_web_push_subscription',
    'walk_lifecycle_server_capabilities',
    'was_family_permanently_deleted',
    'whoami'
  ];
begin
  for target_function in
    select p.oid::regprocedure
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname = any(client_rpc_names)
  loop
    execute format('grant execute on function %s to authenticated', target_function);
  end loop;
end;
$$;

-- The client calls only the confirmation-gated overload.  Do not grant the
-- historical zero-argument reset merely because it shares the same name.
grant execute on function public.admin_reset_family_activity(boolean) to authenticated;
