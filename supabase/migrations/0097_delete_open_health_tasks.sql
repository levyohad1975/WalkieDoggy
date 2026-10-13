-- Allow family members to delete only OPEN health/grooming tasks entered by mistake.
-- Completed records remain immutable family health history.
drop policy if exists "delete open health tasks in own family" on health_tasks;
create policy "delete open health tasks in own family" on health_tasks
  for delete
  using (
    family_id = current_family_id()
    and completed_at is null
  );
