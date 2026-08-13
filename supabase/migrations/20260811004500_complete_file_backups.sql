-- Complete snapshots preserve database records, chat messages and immutable copies
-- of every original object in the private Storage bucket.
alter table public.backup_snapshots
  drop constraint if exists backup_snapshots_format_check;
alter table public.backup_snapshots
  add constraint backup_snapshots_format_check
  check (format in ('json', 'completo'));

alter table public.backup_snapshots
  add column if not exists archive_file_name text,
  add column if not exists storage_file_count integer not null default 0
    check (storage_file_count >= 0),
  add column if not exists storage_file_size bigint not null default 0
    check (storage_file_size >= 0),
  add column if not exists total_size bigint not null default 0
    check (total_size >= 0);

update public.backup_snapshots
set total_size = coalesce(file_size, 0)
where total_size = 0 and file_size is not null;

create table if not exists public.backup_snapshot_files (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.backup_snapshots(id) on delete cascade,
  original_path text not null check (char_length(btrim(original_path)) > 0 and original_path not like 'backups/%'),
  backup_path text not null unique check (backup_path like 'backups/%'),
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  file_size bigint not null default 0 check (file_size >= 0),
  original_created_at timestamptz,
  original_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (snapshot_id, original_path)
);

create index if not exists backup_snapshot_files_snapshot_idx
  on public.backup_snapshot_files (snapshot_id, original_path);

alter table public.backup_snapshot_files enable row level security;

drop policy if exists backup_snapshot_files_select on public.backup_snapshot_files;
drop policy if exists backup_snapshot_files_insert on public.backup_snapshot_files;
drop policy if exists backup_snapshot_files_delete on public.backup_snapshot_files;

create policy backup_snapshot_files_select on public.backup_snapshot_files
for select to authenticated
using (private.is_super_admin());

create policy backup_snapshot_files_insert on public.backup_snapshot_files
for insert to authenticated
with check (
  private.is_super_admin()
  and exists (
    select 1
    from public.backup_snapshots bs
    where bs.id = snapshot_id
      and bs.created_by = private.current_profile_id()
  )
  and backup_path like (
    'backups/' || private.current_profile_id()::text || '/' || snapshot_id::text || '/files/%'
  )
);

create policy backup_snapshot_files_delete on public.backup_snapshot_files
for delete to authenticated
using (
  private.is_super_admin()
  and exists (
    select 1
    from public.backup_snapshots bs
    where bs.id = snapshot_id
      and bs.created_by = private.current_profile_id()
  )
);

revoke all on public.backup_snapshot_files from anon, authenticated;
grant select, insert, delete on public.backup_snapshot_files to authenticated;

-- The superadministrator needs bucket-wide read access to inventory and copy
-- orphaned as well as referenced files. Other roles keep their existing scope.
create or replace function private.can_view_storage_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.is_super_admin()
    or exists (
      select 1
      from public.post_files pf
      where (pf.file_url = p_name or pf.original_file_url = p_name)
        and private.can_view_post_item(pf.post_id)
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
        select 1 from public.contract_files cf
        where cf.file_url = p_name or cf.original_file_url = p_name
      )
    )
$$;

grant execute on function private.can_view_storage_object(text) to authenticated;

comment on table public.backup_snapshot_files is
  'Immutable inventory mapping every original Storage object to its complete backup copy.';
