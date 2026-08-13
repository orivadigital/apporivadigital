-- Superadministrators can create private, downloadable data snapshots.
create table if not exists public.backup_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'processando'
    check (status in ('processando', 'concluido', 'falhou')),
  format text not null default 'json' check (format = 'json'),
  storage_path text unique,
  file_name text,
  file_size bigint check (file_size is null or file_size >= 0),
  record_count integer check (record_count is null or record_count >= 0),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists backup_snapshots_created_at_idx
  on public.backup_snapshots (created_at desc);
create index if not exists backup_snapshots_created_by_idx
  on public.backup_snapshots (created_by, created_at desc);

drop trigger if exists backup_snapshots_set_updated_at on public.backup_snapshots;
create trigger backup_snapshots_set_updated_at
before update on public.backup_snapshots
for each row execute function private.set_updated_at();

alter table public.backup_snapshots enable row level security;

drop policy if exists backup_snapshots_select on public.backup_snapshots;
drop policy if exists backup_snapshots_insert on public.backup_snapshots;
drop policy if exists backup_snapshots_update on public.backup_snapshots;

create policy backup_snapshots_select on public.backup_snapshots
for select to authenticated
using (private.is_super_admin());

create policy backup_snapshots_insert on public.backup_snapshots
for insert to authenticated
with check (
  private.is_super_admin()
  and created_by = private.current_profile_id()
);

create policy backup_snapshots_update on public.backup_snapshots
for update to authenticated
using (
  private.is_super_admin()
  and created_by = private.current_profile_id()
)
with check (
  private.is_super_admin()
  and created_by = private.current_profile_id()
);

grant select, insert, update on public.backup_snapshots to authenticated;

drop policy if exists audit_logs_backup_insert on public.audit_logs;
create policy audit_logs_backup_insert on public.audit_logs
for insert to authenticated
with check (
  private.is_super_admin()
  and profile_id = private.current_profile_id()
  and company_id is null
  and action = 'backup_gerado'
  and entity_type = 'backup_snapshot'
);
grant insert on public.audit_logs to authenticated;

-- A backup is not attached to a company. Its entire path is reserved for the
-- superadministrator and is never visible to socios, collaborators or clients.
create or replace function private.can_view_storage_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.post_files pf
      join public.scheduled_posts sp on sp.id = pf.post_id
      where (pf.file_url = p_name or pf.original_file_url = p_name)
        and private.can_view_post(sp.company_id, sp.status)
    )
    or exists (
      select 1
      from public.task_files tf
      where (tf.file_url = p_name or tf.original_file_url = p_name)
        and private.can_view_task(tf.task_id)
    )
    or (
      private.can_manage_agency()
      and exists (
        select 1
        from public.contract_files cf
        where cf.file_url = p_name or cf.original_file_url = p_name
      )
    )
    or (
      private.is_super_admin()
      and exists (
        select 1
        from public.backup_snapshots bs
        where bs.storage_path = p_name
          and bs.status = 'concluido'
      )
    )
$$;

create or replace function private.can_upload_storage_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_name like 'backups/%'
      then private.is_super_admin()
    when private.storage_task_id(p_name) is not null
      then private.can_attach_task(private.storage_task_id(p_name))
    when private.storage_contract_id(p_name) is not null
      then private.can_manage_agency()
    when private.storage_company_id(p_name) is not null
      then private.can_manage_content(private.storage_company_id(p_name))
    else false
  end
$$;

grant execute on function private.can_view_storage_object(text) to authenticated;
grant execute on function private.can_upload_storage_object(text) to authenticated;

update storage.buckets
set allowed_mime_types = case
  when allowed_mime_types is null then null
  when 'application/json' = any(allowed_mime_types) then allowed_mime_types
  else array_append(allowed_mime_types, 'application/json')
end
where id = 'oriva-files';

drop policy if exists oriva_storage_select on storage.objects;
drop policy if exists oriva_storage_insert on storage.objects;
drop policy if exists oriva_storage_update on storage.objects;
drop policy if exists oriva_storage_delete on storage.objects;

create policy oriva_storage_select on storage.objects for select to authenticated
using (bucket_id = 'oriva-files' and private.can_view_storage_object(name));
create policy oriva_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'oriva-files' and private.can_upload_storage_object(name));
create policy oriva_storage_update on storage.objects for update to authenticated
using (bucket_id = 'oriva-files' and private.can_upload_storage_object(name))
with check (bucket_id = 'oriva-files' and private.can_upload_storage_object(name));
create policy oriva_storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'oriva-files' and private.can_upload_storage_object(name));
