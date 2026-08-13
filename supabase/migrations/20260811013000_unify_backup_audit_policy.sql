-- Keep a single permissive INSERT policy for backup-related audit events.
-- This avoids evaluating two equivalent superadministrator policies per row.
drop policy if exists audit_logs_backup_insert on public.audit_logs;
drop policy if exists audit_logs_backup_restore_insert on public.audit_logs;

create policy audit_logs_backup_actions_insert on public.audit_logs
for insert to authenticated
with check (
  private.is_super_admin()
  and profile_id = private.current_profile_id()
  and company_id is null
  and (
    (action = 'backup_gerado' and entity_type = 'backup_snapshot')
    or
    (action = 'backup_restaurado' and entity_type = 'backup_restore_run')
  )
);

grant insert on public.audit_logs to authenticated;

notify pgrst, 'reload schema';
