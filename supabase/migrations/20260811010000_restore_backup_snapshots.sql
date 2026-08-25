-- Safe, non-destructive restoration of missing records and original files.
-- Current rows are never deleted or overwritten by this recovery workflow.
create table if not exists public.backup_restore_runs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.backup_snapshots(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'processando'
    check (status in ('processando', 'concluido', 'parcial', 'falhou')),
  records_restored integer not null default 0 check (records_restored >= 0),
  files_restored integer not null default 0 check (files_restored >= 0),
  files_skipped integer not null default 0 check (files_skipped >= 0),
  result jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists backup_restore_runs_snapshot_created_idx
  on public.backup_restore_runs (snapshot_id, created_at desc);
create index if not exists backup_restore_runs_requested_created_idx
  on public.backup_restore_runs (requested_by, created_at desc);
create unique index if not exists backup_restore_runs_one_processing_idx
  on public.backup_restore_runs (status)
  where status = 'processando';

drop trigger if exists backup_restore_runs_set_updated_at on public.backup_restore_runs;
create trigger backup_restore_runs_set_updated_at
before update on public.backup_restore_runs
for each row execute function private.set_updated_at();

alter table public.backup_restore_runs enable row level security;

drop policy if exists backup_restore_runs_select on public.backup_restore_runs;
drop policy if exists backup_restore_runs_insert on public.backup_restore_runs;
drop policy if exists backup_restore_runs_update on public.backup_restore_runs;

create policy backup_restore_runs_select on public.backup_restore_runs
for select to authenticated
using (private.is_super_admin());

create policy backup_restore_runs_insert on public.backup_restore_runs
for insert to authenticated
with check (
  private.is_super_admin()
  and requested_by = private.current_profile_id()
  and exists (
    select 1
    from public.backup_snapshots bs
    where bs.id = snapshot_id
      and bs.status = 'concluido'
      and bs.storage_path is not null
  )
);

create policy backup_restore_runs_update on public.backup_restore_runs
for update to authenticated
using (
  private.is_super_admin()
  and requested_by = private.current_profile_id()
)
with check (
  private.is_super_admin()
  and requested_by = private.current_profile_id()
);

revoke all on public.backup_restore_runs from anon, authenticated;
grant select, insert, update on public.backup_restore_runs to authenticated;

create or replace function private.restore_backup_snapshot_data(
  p_snapshot_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text;
  v_rows jsonb;
  v_columns text;
  v_sql text;
  v_inserted integer := 0;
  v_total integer := 0;
  v_missing_auth integer := 0;
  v_profile_conflicts integer := 0;
  v_tables jsonb := '{}'::jsonb;
  v_table_order constant text[] := array[
    'profiles',
    'companies',
    'partners',
    'company_users',
    'scheduled_posts',
    'post_internal_details',
    'agency_tasks',
    'contracts',
    'financial_entries',
    'lead_details',
    'post_files',
    'post_comments',
    'task_files',
    'contract_files',
    'lead_activities',
    'chat_conversations',
    'chat_messages',
    'audit_logs'
  ];
begin
  if (select auth.uid()) is null or not private.is_super_admin() then
    raise exception using
      errcode = '42501',
      message = 'Apenas o administrador principal pode restaurar backups.';
  end if;

  if not pg_try_advisory_xact_lock(hashtext('oriva_restore_backup')) then
    raise exception using
      errcode = '55006',
      message = 'Outra restauração já está em andamento. Aguarde a conclusão.';
  end if;

  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'O arquivo de dados deste backup é inválido.';
  end if;

  if not exists (
    select 1
    from public.backup_snapshots bs
    where bs.id = p_snapshot_id
      and bs.status = 'concluido'
      and bs.storage_path is not null
  ) then
    raise exception using
      errcode = '22023',
      message = 'Este backup não está disponível para restauração.';
  end if;

  v_rows := coalesce(p_payload -> 'profiles', '[]'::jsonb);
  if jsonb_typeof(v_rows) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'A lista de usuários do backup é inválida.';
  end if;

  select count(*)::integer
  into v_missing_auth
  from jsonb_to_recordset(v_rows) as restored_profile(id uuid, auth_user_id uuid)
  where not exists (select 1 from public.profiles p where p.id = restored_profile.id)
    and not exists (select 1 from auth.users au where au.id = restored_profile.auth_user_id);

  if v_missing_auth > 0 then
    raise exception using
      errcode = '23503',
      message = format(
        'Não foi possível restaurar: %s login(s) do backup não existem mais no Supabase Auth.',
        v_missing_auth
      );
  end if;

  select count(*)::integer
  into v_profile_conflicts
  from jsonb_to_recordset(v_rows) as restored_profile(id uuid, auth_user_id uuid)
  join public.profiles current_profile
    on current_profile.auth_user_id = restored_profile.auth_user_id
   and current_profile.id <> restored_profile.id
  where not exists (select 1 from public.profiles p where p.id = restored_profile.id);

  if v_profile_conflicts > 0 then
    raise exception using
      errcode = '23505',
      message = 'Existe um login vinculado a um perfil diferente. A restauração foi cancelada para proteger os dados.';
  end if;

  foreach v_table in array v_table_order loop
    v_rows := coalesce(p_payload -> v_table, '[]'::jsonb);
    if jsonb_typeof(v_rows) is distinct from 'array' then
      raise exception using
        errcode = '22023',
        message = format('A seção %s do backup é inválida.', v_table);
    end if;

    if jsonb_array_length(v_rows) = 0 then
      v_tables := jsonb_set(v_tables, array[v_table], '0'::jsonb, true);
      continue;
    end if;

    select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position)
    into v_columns
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = v_table
      and c.is_generated = 'NEVER'
      and (c.is_identity = 'NO' or v_table = 'audit_logs')
      and exists (
        select 1
        from jsonb_array_elements(v_rows) item
        where item ? c.column_name
      );

    if v_columns is null then
      raise exception using
        errcode = '22023',
        message = format('A seção %s não possui colunas válidas.', v_table);
    end if;

    v_sql := format(
      'insert into public.%1$I (%2$s) %3$s select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) on conflict do nothing',
      v_table,
      v_columns,
      case when v_table = 'audit_logs' then 'overriding system value' else '' end
    );
    execute v_sql using v_rows;
    get diagnostics v_inserted = row_count;
    v_total := v_total + v_inserted;
    v_tables := jsonb_set(v_tables, array[v_table], to_jsonb(v_inserted), true);
  end loop;

  if coalesce((v_tables ->> 'audit_logs')::integer, 0) > 0 then
    perform setval(
      pg_get_serial_sequence('public.audit_logs', 'id'),
      greatest((select coalesce(max(id), 1) from public.audit_logs), 1),
      true
    );
  end if;

  return jsonb_build_object(
    'mode', 'somente_ausentes',
    'recordsRestored', v_total,
    'tables', v_tables
  );
end;
$$;

revoke all on function private.restore_backup_snapshot_data(uuid, jsonb) from public, anon, authenticated;
grant execute on function private.restore_backup_snapshot_data(uuid, jsonb) to authenticated;

create or replace function public.restore_backup_snapshot(
  p_snapshot_id uuid,
  p_payload jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.restore_backup_snapshot_data(p_snapshot_id, p_payload)
$$;

revoke all on function public.restore_backup_snapshot(uuid, jsonb) from public, anon;
grant execute on function public.restore_backup_snapshot(uuid, jsonb) to authenticated;

drop policy if exists audit_logs_backup_restore_insert on public.audit_logs;
create policy audit_logs_backup_restore_insert on public.audit_logs
for insert to authenticated
with check (
  private.is_super_admin()
  and profile_id = private.current_profile_id()
  and company_id is null
  and action = 'backup_restaurado'
  and entity_type = 'backup_restore_run'
);

grant insert on public.audit_logs to authenticated;

comment on table public.backup_restore_runs is
  'History of safe recovery runs. Restores only missing records and files without overwriting current data.';
comment on function public.restore_backup_snapshot(uuid, jsonb) is
  'Restores only missing rows from a validated backup snapshot; restricted internally to the superadministrator.';

notify pgrst, 'reload schema';
