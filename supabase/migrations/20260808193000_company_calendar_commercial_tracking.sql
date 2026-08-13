-- Calendário geral por empresa, anexos, parceiros e acompanhamento comercial.

alter table public.companies
  add column if not exists responsible_email text,
  add column if not exists relationship_type text not null default 'cliente';

alter table public.companies drop constraint if exists companies_relationship_type_check;
alter table public.companies
  add constraint companies_relationship_type_check
  check (relationship_type in ('cliente', 'lead'));

create index if not exists companies_relationship_status_idx
  on public.companies (relationship_type, status, created_at desc);

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('super_admin', 'socio', 'colaborador', 'empresa_cliente', 'parceiro'));

alter table public.partners
  add column if not exists profile_id uuid references public.profiles(id) on delete set null;

create unique index if not exists partners_profile_uidx
  on public.partners (profile_id) where profile_id is not null;

alter table public.agency_tasks
  add column if not exists partner_id uuid references public.partners(id) on delete set null;

create index if not exists agency_tasks_partner_due_idx
  on public.agency_tasks (partner_id, due_date) where partner_id is not null;

alter table public.contracts
  add column if not exists recurrence text not null default 'sem_recorrencia';

alter table public.contracts drop constraint if exists contracts_recurrence_check;
alter table public.contracts
  add constraint contracts_recurrence_check
  check (recurrence in ('sem_recorrencia', 'mensal', 'trimestral', 'semestral', 'anual', 'personalizada'));

create table if not exists public.task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.agency_tasks(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  file_url text not null unique,
  original_file_url text not null,
  file_name text not null,
  file_type text not null,
  file_size bigint not null check (file_size >= 0),
  mime_type text not null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists task_files_task_idx on public.task_files (task_id, created_at);
create index if not exists task_files_company_idx on public.task_files (company_id, task_id);

create table if not exists public.contract_files (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  file_url text not null unique,
  original_file_url text not null,
  file_name text not null,
  file_type text not null,
  file_size bigint not null check (file_size >= 0),
  mime_type text not null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists contract_files_contract_idx on public.contract_files (contract_id, created_at);

create or replace function private.current_partner_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pa.id
  from public.partners pa
  join public.profiles p on p.id = pa.profile_id
  where p.auth_user_id = (select auth.uid())
    and p.is_active = true
    and p.role = 'parceiro'
  limit 1
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
          and (
            coalesce((p.permissions ->> 'view_companies')::boolean, false)
            or coalesce((p.permissions ->> 'manage_content')::boolean, false)
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
    where t.id = p_task_id
      and (
        private.is_agency_user()
        or (t.company_id is not null and private.has_company_access(t.company_id))
        or t.partner_id = private.current_partner_id()
      )
  )
$$;

create or replace function private.storage_task_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  parts text[];
begin
  parts := string_to_array(p_name, '/');
  if array_length(parts, 1) < 5 or parts[1] <> 'companies' or parts[3] <> 'tasks' then
    return null;
  end if;
  begin
    return parts[4]::uuid;
  exception when invalid_text_representation then
    return null;
  end;
end;
$$;

create or replace function private.storage_contract_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  parts text[];
begin
  parts := string_to_array(p_name, '/');
  if array_length(parts, 1) < 3 or parts[1] <> 'contracts' then
    return null;
  end if;
  begin
    return parts[2]::uuid;
  exception when invalid_text_representation then
    return null;
  end;
end;
$$;

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
        select 1 from public.contract_files cf
        where cf.file_url = p_name or cf.original_file_url = p_name
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
    when private.storage_task_id(p_name) is not null
      then private.can_view_task(private.storage_task_id(p_name))
    when private.storage_contract_id(p_name) is not null
      then private.can_manage_agency()
    when private.storage_company_id(p_name) is not null
      then private.can_manage_content(private.storage_company_id(p_name))
    else false
  end
$$;

grant execute on function private.current_partner_id() to authenticated;
grant execute on function private.can_view_task(uuid) to authenticated;
grant execute on function private.storage_task_id(text) to authenticated;
grant execute on function private.storage_contract_id(text) to authenticated;
grant execute on function private.can_upload_storage_object(text) to authenticated;

alter table public.task_files enable row level security;
alter table public.contract_files enable row level security;

drop policy if exists partners_all on public.partners;
drop policy if exists partners_manage on public.partners;
drop policy if exists partners_self_select on public.partners;
create policy partners_manage on public.partners for all to authenticated
using (private.can_manage_agency()) with check (private.can_manage_agency());
create policy partners_self_select on public.partners for select to authenticated
using (profile_id = private.current_profile_id());

drop policy if exists agency_tasks_select on public.agency_tasks;
create policy agency_tasks_select on public.agency_tasks for select to authenticated
using (private.can_view_task(id));

drop policy if exists task_files_select on public.task_files;
drop policy if exists task_files_insert on public.task_files;
drop policy if exists task_files_delete on public.task_files;
create policy task_files_select on public.task_files for select to authenticated
using (private.can_view_task(task_id));
create policy task_files_insert on public.task_files for insert to authenticated
with check (
  private.can_view_task(task_id)
  and exists (
    select 1 from public.agency_tasks t
    where t.id = task_id and t.company_id = company_id
  )
);
create policy task_files_delete on public.task_files for delete to authenticated
using (uploaded_by = private.current_profile_id() or private.is_agency_user());

drop policy if exists contract_files_manage on public.contract_files;
create policy contract_files_manage on public.contract_files for all to authenticated
using (private.can_manage_agency()) with check (private.can_manage_agency());

grant select, insert, delete on public.task_files to authenticated;
grant select, insert, update, delete on public.contract_files to authenticated;

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

create or replace function public.admin_set_company_commercial_fields(
  p_creator_auth_user_id uuid,
  p_company_id uuid,
  p_responsible_email text,
  p_relationship_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_id uuid;
begin
  select id into v_creator_id
  from public.profiles
  where auth_user_id = p_creator_auth_user_id
    and is_active = true
    and role in ('super_admin', 'socio');
  if v_creator_id is null then
    raise exception 'Apenas o administrador principal ou um sócio pode editar o acompanhamento comercial.' using errcode = '42501';
  end if;
  if p_relationship_type not in ('cliente', 'lead') then
    raise exception 'Classificação comercial inválida.';
  end if;
  update public.companies
  set responsible_email = nullif(lower(trim(p_responsible_email)), ''),
      relationship_type = p_relationship_type
  where id = p_company_id;
  if not found then raise exception 'Empresa não encontrada.'; end if;
  return p_company_id;
end;
$$;

revoke all on function public.admin_set_company_commercial_fields(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_company_commercial_fields(uuid, uuid, text, text) to service_role;

create or replace function public.admin_link_partner_profile(
  p_creator_auth_user_id uuid,
  p_profile_id uuid,
  p_partner_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_id uuid;
begin
  select id into v_creator_id from public.profiles
  where auth_user_id = p_creator_auth_user_id and is_active = true and role = 'super_admin';
  if v_creator_id is null then
    raise exception 'Apenas o administrador principal pode vincular parceiros.' using errcode = '42501';
  end if;
  update public.partners set profile_id = null where profile_id = p_profile_id;
  update public.partners set profile_id = p_profile_id where id = p_partner_id;
  if not found then raise exception 'Parceiro não encontrado.'; end if;
  return p_partner_id;
end;
$$;

revoke all on function public.admin_link_partner_profile(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_link_partner_profile(uuid, uuid, uuid) to service_role;

-- Permite que o perfil Parceiro seja criado e editado pelo fluxo administrativo existente.
create or replace function public.admin_create_profile_records(
  p_creator_auth_user_id uuid,
  p_auth_user_id uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_role text,
  p_company_id uuid,
  p_permissions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_id uuid;
  v_profile_id uuid;
begin
  select id into v_creator_id from public.profiles
  where auth_user_id = p_creator_auth_user_id and is_active = true and role = 'super_admin';
  if v_creator_id is null then
    raise exception 'Apenas o administrador principal pode criar acessos.' using errcode = '42501';
  end if;
  if p_role not in ('socio', 'colaborador', 'empresa_cliente', 'parceiro') then
    raise exception 'Tipo de usuário inválido.';
  end if;
  if p_role = 'empresa_cliente' and p_company_id is null then
    raise exception 'Selecione a empresa deste cliente.';
  end if;
  insert into public.profiles (auth_user_id, name, email, phone, role, permissions)
  values (p_auth_user_id, trim(p_name), lower(trim(p_email)), nullif(trim(p_phone), ''), p_role, coalesce(p_permissions, '{}'::jsonb))
  returning id into v_profile_id;
  if p_role = 'empresa_cliente' then
    insert into public.company_users (company_id, profile_id, role_in_company, permissions)
    values (p_company_id, v_profile_id, 'cliente', '{"review_content":true,"download_files":true}'::jsonb);
  end if;
  insert into public.audit_logs (profile_id, company_id, action, entity_type, entity_id, metadata)
  values (v_creator_id, p_company_id, 'criacao_login', 'profile', v_profile_id::text, jsonb_build_object('role', p_role));
  return v_profile_id;
end;
$$;

create or replace function public.admin_update_profile_records(
  p_creator_auth_user_id uuid,
  p_profile_id uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_role text,
  p_company_id uuid,
  p_permissions jsonb,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_id uuid;
begin
  select id into v_creator_id from public.profiles
  where auth_user_id = p_creator_auth_user_id and is_active = true and role = 'super_admin';
  if v_creator_id is null then
    raise exception 'Apenas o administrador principal pode editar acessos.' using errcode = '42501';
  end if;
  if p_role not in ('socio', 'colaborador', 'empresa_cliente', 'parceiro') then
    raise exception 'Tipo de usuário inválido.';
  end if;
  if p_role = 'empresa_cliente' and p_company_id is null then
    raise exception 'Selecione a empresa deste cliente.';
  end if;
  update public.profiles
  set name = trim(p_name), email = lower(trim(p_email)), phone = nullif(trim(p_phone), ''),
      role = p_role, permissions = coalesce(p_permissions, '{}'::jsonb), is_active = p_is_active
  where id = p_profile_id and role <> 'super_admin';
  if not found then raise exception 'Acesso não encontrado ou protegido.'; end if;
  delete from public.company_users where profile_id = p_profile_id;
  if p_role = 'empresa_cliente' then
    insert into public.company_users (company_id, profile_id, role_in_company, permissions)
    values (p_company_id, p_profile_id, 'cliente', '{"review_content":true,"download_files":true}'::jsonb);
  end if;
  if p_role <> 'parceiro' then
    update public.partners set profile_id = null where profile_id = p_profile_id;
  end if;
  insert into public.audit_logs (profile_id, company_id, action, entity_type, entity_id, metadata)
  values (v_creator_id, p_company_id, 'edicao_acesso', 'profile', p_profile_id::text, jsonb_build_object('role', p_role, 'is_active', p_is_active));
  return p_profile_id;
end;
$$;
