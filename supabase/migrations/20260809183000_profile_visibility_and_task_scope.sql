-- Keep each operational profile inside its assigned scope.
create or replace function private.is_agency_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = (select auth.uid())
      and p.is_active = true
      and p.role in ('super_admin', 'socio')
  )
$$;

create or replace function private.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = (select auth.uid())
      and p.is_active = true
      and p.role in ('super_admin', 'socio')
  )
$$;

create or replace function private.has_company_access(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = (select auth.uid())
      and p.is_active = true
      and (
        p.role in ('super_admin', 'socio')
        or (
          p.role = 'colaborador'
          and exists (
            select 1
            from public.agency_tasks t
            where t.company_id = p_company_id
              and t.assigned_to = p.id
          )
        )
        or (
          p.role = 'empresa_cliente'
          and exists (
            select 1
            from public.company_users cu
            join public.companies c on c.id = cu.company_id
            where cu.profile_id = p.id
              and cu.company_id = p_company_id
              and c.status <> 'bloqueado'
          )
        )
        or (
          p.role = 'parceiro'
          and exists (
            select 1
            from public.partners pa
            join public.agency_tasks t on t.partner_id = pa.id
            where pa.profile_id = p.id
              and t.company_id = p_company_id
          )
        )
      )
  )
$$;

create or replace function private.can_view_post(p_company_id uuid, p_status text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = (select auth.uid())
      and p.is_active = true
      and (
        p.role in ('super_admin', 'socio')
        or (
          p.role = 'empresa_cliente'
          and p_status <> 'rascunho'
          and private.has_company_access(p_company_id)
        )
      )
  )
$$;

create or replace function private.can_view_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.agency_tasks t
    join public.profiles p
      on p.auth_user_id = (select auth.uid())
     and p.is_active = true
    where t.id = p_task_id
      and (
        p.role in ('super_admin', 'socio')
        or (p.role = 'colaborador' and t.assigned_to = p.id)
        or (
          p.role = 'empresa_cliente'
          and t.company_id is not null
          and exists (
            select 1
            from public.company_users cu
            join public.companies c on c.id = cu.company_id
            where cu.profile_id = p.id
              and cu.company_id = t.company_id
              and c.status <> 'bloqueado'
          )
        )
        or (
          p.role = 'parceiro'
          and exists (
            select 1
            from public.partners pa
            where pa.profile_id = p.id
              and pa.id = t.partner_id
          )
        )
      )
  )
$$;

create or replace function private.can_attach_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_view_task(p_task_id)
    and exists (
      select 1
      from public.profiles p
      where p.auth_user_id = (select auth.uid())
        and p.is_active = true
        and p.role in ('super_admin', 'socio', 'empresa_cliente', 'parceiro')
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
    when private.storage_task_id(p_name) is not null
      then private.can_attach_task(private.storage_task_id(p_name))
    when private.storage_contract_id(p_name) is not null
      then private.can_manage_agency()
    when private.storage_company_id(p_name) is not null
      then private.can_manage_content(private.storage_company_id(p_name))
    else false
  end
$$;

grant execute on function private.is_agency_user() to authenticated;
grant execute on function private.has_permission(text) to authenticated;
grant execute on function private.has_company_access(uuid) to authenticated;
grant execute on function private.can_view_post(uuid, text) to authenticated;
grant execute on function private.can_view_task(uuid) to authenticated;
grant execute on function private.can_attach_task(uuid) to authenticated;
grant execute on function private.can_upload_storage_object(text) to authenticated;

drop policy if exists agency_tasks_select on public.agency_tasks;
drop policy if exists agency_tasks_insert on public.agency_tasks;
drop policy if exists agency_tasks_update on public.agency_tasks;
drop policy if exists agency_tasks_delete on public.agency_tasks;

create policy agency_tasks_select on public.agency_tasks for select to authenticated
using (private.can_view_task(id));
create policy agency_tasks_insert on public.agency_tasks for insert to authenticated
with check (private.can_manage_agency());
create policy agency_tasks_update on public.agency_tasks for update to authenticated
using (private.can_manage_agency()) with check (private.can_manage_agency());
create policy agency_tasks_delete on public.agency_tasks for delete to authenticated
using (private.can_manage_agency());

drop policy if exists task_files_select on public.task_files;
drop policy if exists task_files_insert on public.task_files;
drop policy if exists task_files_delete on public.task_files;

create policy task_files_select on public.task_files for select to authenticated
using (private.can_view_task(task_id));
create policy task_files_insert on public.task_files for insert to authenticated
with check (
  private.can_attach_task(task_id)
  and exists (
    select 1
    from public.agency_tasks t
    where t.id = task_id
      and t.company_id = company_id
  )
);
create policy task_files_delete on public.task_files for delete to authenticated
using (
  private.can_manage_agency()
  or (
    uploaded_by = private.current_profile_id()
    and private.can_attach_task(task_id)
  )
);

drop policy if exists oriva_storage_insert on storage.objects;
drop policy if exists oriva_storage_update on storage.objects;
drop policy if exists oriva_storage_delete on storage.objects;

create policy oriva_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'oriva-files' and private.can_upload_storage_object(name));
create policy oriva_storage_update on storage.objects for update to authenticated
using (
  bucket_id = 'oriva-files'
  and (
    private.can_manage_agency()
    or (owner_id = (select auth.uid())::text and private.can_upload_storage_object(name))
  )
)
with check (
  bucket_id = 'oriva-files'
  and (
    private.can_manage_agency()
    or (owner_id = (select auth.uid())::text and private.can_upload_storage_object(name))
  )
);
create policy oriva_storage_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'oriva-files'
  and (
    private.can_manage_agency()
    or (owner_id = (select auth.uid())::text and private.can_upload_storage_object(name))
  )
);
