create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into private.platform_settings (key, value)
values ('owner_email', to_jsonb('ramonvalnei3@gmail.com'::text))
on conflict (key) do update set value = excluded.value, updated_at = now();

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  role text not null check (role in ('super_admin', 'socio', 'colaborador', 'empresa_cliente')),
  permissions jsonb not null default '{}'::jsonb,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_lower_uidx on public.profiles (lower(email));
create index profiles_role_active_idx on public.profiles (role, is_active);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trade_name text,
  document text,
  email text not null,
  phone text,
  whatsapp text,
  logo_url text,
  segment text,
  services text,
  responsible text,
  status text not null default 'ativo' check (status in ('ativo', 'pausado', 'bloqueado', 'encerrado')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index companies_document_uidx on public.companies (document) where document is not null and document <> '';
create index companies_status_name_idx on public.companies (status, name);

create table public.company_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_in_company text not null default 'cliente',
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, profile_id)
);

create unique index company_users_profile_uidx on public.company_users (profile_id);
create index company_users_company_idx on public.company_users (company_id, profile_id);

create table public.scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  content_type text not null check (content_type in ('post', 'carrossel', 'stories', 'reels', 'video', 'arte', 'campanha', 'outro')),
  social_network text not null check (social_network in ('instagram', 'tiktok', 'facebook', 'linkedin', 'youtube_shorts', 'outra')),
  scheduled_date date not null,
  scheduled_time time not null,
  caption text not null default '',
  internal_notes text not null default '',
  client_notes text not null default '',
  status text not null default 'rascunho' check (status in ('rascunho', 'programado', 'aguardando_aprovacao', 'aprovado', 'revisao_solicitada', 'publicado')),
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  client_feedback text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scheduled_posts_company_date_idx on public.scheduled_posts (company_id, scheduled_date, scheduled_time);
create index scheduled_posts_company_status_date_idx on public.scheduled_posts (company_id, status, scheduled_date);
create index scheduled_posts_assigned_idx on public.scheduled_posts (assigned_to, scheduled_date) where assigned_to is not null;

create table public.post_files (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.scheduled_posts(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  file_url text not null,
  original_file_url text not null,
  file_name text not null,
  file_type text not null,
  file_size bigint not null check (file_size >= 0),
  mime_type text not null,
  order_index integer not null default 0 check (order_index >= 0),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index post_files_post_order_idx on public.post_files (post_id, order_index);
create index post_files_company_idx on public.post_files (company_id, post_id);
create index post_files_file_url_idx on public.post_files (file_url);
create unique index post_files_post_file_url_uidx on public.post_files (post_id, file_url);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.scheduled_posts(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  comment text not null check (length(trim(comment)) > 0),
  comment_type text not null default 'comentario' check (comment_type in ('comentario', 'solicitacao_alteracao', 'aprovacao', 'observacao_interna')),
  created_at timestamptz not null default now()
);

create index post_comments_post_created_idx on public.post_comments (post_id, created_at);
create index post_comments_company_idx on public.post_comments (company_id, created_at);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  profile_id uuid references public.profiles(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_profile_created_idx on public.audit_logs (profile_id, created_at desc);
create index audit_logs_company_created_idx on public.audit_logs (company_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

create table public.backup_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'processando' check (status in ('processando', 'concluido', 'falhou')),
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

create index backup_snapshots_created_at_idx on public.backup_snapshots (created_at desc);
create index backup_snapshots_created_by_idx on public.backup_snapshots (created_by, created_at desc);

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_name text not null default '',
  email text not null default '',
  phone text not null default '',
  specialty text not null default '',
  average_value_cents bigint not null default 0 check (average_value_cents >= 0),
  open_demands integer not null default 0 check (open_demands >= 0),
  status text not null default 'ativo' check (status in ('ativo', 'pausado', 'inativo')),
  notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index partners_status_name_idx on public.partners (status, name);

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  party_type text not null check (party_type in ('empresa', 'parceiro', 'outro')),
  party_name text not null,
  related_id uuid,
  start_date date not null,
  end_date date,
  value_cents bigint not null default 0 check (value_cents >= 0),
  status text not null default 'ativo' check (status in ('rascunho', 'ativo', 'renovar', 'encerrado', 'cancelado')),
  notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contracts_status_end_idx on public.contracts (status, end_date);

create table public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('receber', 'pagar')),
  category text not null,
  description text not null,
  party_name text not null default '',
  company_id uuid references public.companies(id) on delete set null,
  amount_cents bigint not null check (amount_cents >= 0),
  due_date date not null,
  paid_date date,
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'atrasado', 'cancelado')),
  recurrence text not null default 'unico' check (recurrence in ('unico', 'mensal', 'quinzenal', 'semanal', 'anual')),
  notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index financial_entries_due_status_idx on public.financial_entries (due_date, status);
create index financial_entries_company_idx on public.financial_entries (company_id, due_date) where company_id is not null;

create table public.agency_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  company_id uuid references public.companies(id) on delete set null,
  task_type text not null default 'outro',
  assigned_to uuid references public.profiles(id) on delete set null,
  due_date date not null,
  priority text not null default 'media' check (priority in ('baixa', 'media', 'alta', 'urgente')),
  status text not null default 'pendente' check (status in ('pendente', 'em_andamento', 'atrasado', 'concluido')),
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agency_tasks_due_status_idx on public.agency_tasks (due_date, status);
create index agency_tasks_company_idx on public.agency_tasks (company_id, due_date) where company_id is not null;
create index agency_tasks_assigned_idx on public.agency_tasks (assigned_to, due_date) where assigned_to is not null;
create index companies_created_by_idx on public.companies (created_by) where created_by is not null;
create index scheduled_posts_created_by_idx on public.scheduled_posts (created_by) where created_by is not null;
create index scheduled_posts_approved_by_idx on public.scheduled_posts (approved_by) where approved_by is not null;
create index post_files_uploaded_by_idx on public.post_files (uploaded_by) where uploaded_by is not null;
create index post_comments_profile_idx on public.post_comments (profile_id) where profile_id is not null;
create index partners_created_by_idx on public.partners (created_by) where created_by is not null;
create index contracts_created_by_idx on public.contracts (created_by) where created_by is not null;
create index financial_entries_created_by_idx on public.financial_entries (created_by) where created_by is not null;
create index agency_tasks_created_by_idx on public.agency_tasks (created_by) where created_by is not null;

create table public.lead_details (
  company_id uuid primary key references public.companies(id) on delete cascade,
  stage text not null default 'novo' check (stage in ('novo', 'contato_realizado', 'proposta_enviada', 'negociacao', 'ganho', 'perdido')),
  source text,
  owner_profile_id uuid references public.profiles(id) on delete set null,
  next_follow_up_at timestamptz,
  last_contact_at timestamptz,
  notes text not null default '',
  lost_reason text,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lead_details_stage_follow_up_idx on public.lead_details (stage, next_follow_up_at);
create index lead_details_owner_follow_up_idx on public.lead_details (owner_profile_id, next_follow_up_at) where owner_profile_id is not null;

create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  activity_type text not null default 'nota' check (activity_type in ('cadastro', 'ligacao', 'whatsapp', 'email', 'reuniao', 'nota', 'mudanca_etapa')),
  description text not null,
  previous_stage text check (previous_stage is null or previous_stage in ('novo', 'contato_realizado', 'proposta_enviada', 'negociacao', 'ganho', 'perdido')),
  new_stage text check (new_stage is null or new_stage in ('novo', 'contato_realizado', 'proposta_enviada', 'negociacao', 'ganho', 'perdido')),
  contact_at timestamptz not null default now(),
  next_follow_up_at timestamptz,
  created_at timestamptz not null default now()
);

create index lead_activities_company_created_idx on public.lead_activities (company_id, created_at desc);
create index lead_activities_profile_created_idx on public.lead_activities (profile_id, created_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger companies_set_updated_at before update on public.companies for each row execute function private.set_updated_at();
create trigger company_users_set_updated_at before update on public.company_users for each row execute function private.set_updated_at();
create trigger scheduled_posts_set_updated_at before update on public.scheduled_posts for each row execute function private.set_updated_at();
create trigger partners_set_updated_at before update on public.partners for each row execute function private.set_updated_at();
create trigger contracts_set_updated_at before update on public.contracts for each row execute function private.set_updated_at();
create trigger financial_entries_set_updated_at before update on public.financial_entries for each row execute function private.set_updated_at();
create trigger agency_tasks_set_updated_at before update on public.agency_tasks for each row execute function private.set_updated_at();
create trigger lead_details_set_updated_at before update on public.lead_details for each row execute function private.set_updated_at();
create trigger backup_snapshots_set_updated_at before update on public.backup_snapshots for each row execute function private.set_updated_at();

create or replace function private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = (select auth.uid())
    and p.is_active = true
  limit 1
$$;

create or replace function private.is_agency_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.auth_user_id = (select auth.uid())
      and p.is_active = true
      and p.role in ('super_admin', 'socio')
  )
$$;

create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.auth_user_id = (select auth.uid())
      and p.is_active = true
      and p.role = 'super_admin'
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
    select 1 from public.profiles p
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
            select 1 from public.agency_tasks t
            where t.company_id = p_company_id and t.assigned_to = p.id
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
      )
  )
$$;

create or replace function private.can_manage_company(p_company_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission('manage_companies')
$$;

create or replace function private.can_manage_content(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission('manage_content')
$$;

create or replace function private.can_manage_agency()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission('manage_agency')
$$;

create or replace function private.can_view_post(p_company_id uuid, p_status text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.auth_user_id = (select auth.uid())
      and p.is_active = true
      and (
        p.role in ('super_admin', 'socio')
        or (p.role = 'empresa_cliente' and p_status <> 'rascunho' and private.has_company_access(p_company_id))
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
            where cu.profile_id = p.id
              and cu.company_id = t.company_id
          )
        )
      )
  )
$$;

create or replace function private.storage_company_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  parts text[];
begin
  parts := string_to_array(p_name, '/');
  if array_length(parts, 1) < 3 or parts[1] <> 'companies' then
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
    when p_name like 'backups/%' then private.is_super_admin()
    when private.storage_company_id(p_name) is not null
      then private.can_manage_content(private.storage_company_id(p_name))
    else false
  end
$$;

grant usage on schema private to authenticated;
grant execute on function private.current_profile_id() to authenticated;
grant execute on function private.is_agency_user() to authenticated;
grant execute on function private.is_super_admin() to authenticated;
grant execute on function private.has_permission(text) to authenticated;
grant execute on function private.has_company_access(uuid) to authenticated;
grant execute on function private.can_manage_company(uuid) to authenticated;
grant execute on function private.can_manage_content(uuid) to authenticated;
grant execute on function private.can_manage_agency() to authenticated;
grant execute on function private.can_view_post(uuid, text) to authenticated;
grant execute on function private.can_view_task(uuid) to authenticated;
grant execute on function private.storage_company_id(text) to authenticated;
grant execute on function private.can_view_storage_object(text) to authenticated;
grant execute on function private.can_upload_storage_object(text) to authenticated;

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_users enable row level security;
alter table public.scheduled_posts enable row level security;
alter table public.post_files enable row level security;
alter table public.post_comments enable row level security;
alter table public.audit_logs enable row level security;
alter table public.partners enable row level security;
alter table public.contracts enable row level security;
alter table public.financial_entries enable row level security;
alter table public.agency_tasks enable row level security;
alter table public.lead_details enable row level security;
alter table public.lead_activities enable row level security;
alter table public.backup_snapshots enable row level security;

create policy profiles_select on public.profiles for select to authenticated
using (auth_user_id = (select auth.uid()) or private.is_agency_user());

create policy companies_select on public.companies for select to authenticated
using (private.has_company_access(id));
create policy companies_insert on public.companies for insert to authenticated
with check (private.can_manage_company(id));
create policy companies_update on public.companies for update to authenticated
using (private.can_manage_company(id)) with check (private.can_manage_company(id));
create policy companies_delete on public.companies for delete to authenticated
using (private.is_super_admin());

create policy company_users_select on public.company_users for select to authenticated
using (profile_id = private.current_profile_id() or private.is_agency_user());

create policy scheduled_posts_select on public.scheduled_posts for select to authenticated
using (private.can_manage_agency() or private.can_view_post_item(id));
create policy scheduled_posts_insert on public.scheduled_posts for insert to authenticated
with check (private.can_manage_content(company_id));
create policy scheduled_posts_update on public.scheduled_posts for update to authenticated
using (private.can_manage_content(company_id)) with check (private.can_manage_content(company_id));
create policy scheduled_posts_delete on public.scheduled_posts for delete to authenticated
using (private.can_manage_content(company_id));

create policy post_files_select on public.post_files for select to authenticated
using (exists (
  select 1 from public.scheduled_posts sp
  where sp.id = post_id and private.can_view_post(sp.company_id, sp.status)
));
create policy post_files_insert on public.post_files for insert to authenticated
with check (
  private.can_attach_post(post_id)
  and exists (
    select 1 from public.scheduled_posts sp
    where sp.id = post_files.post_id
      and sp.company_id = post_files.company_id
  )
);
create policy post_files_update on public.post_files for update to authenticated
using (private.can_manage_content(company_id)) with check (private.can_manage_content(company_id));
create policy post_files_delete on public.post_files for delete to authenticated
using (private.can_manage_content(company_id));

create policy post_comments_select on public.post_comments for select to authenticated
using (
  private.has_company_access(company_id)
  and (private.is_agency_user() or comment_type <> 'observacao_interna')
);
create policy post_comments_insert on public.post_comments for insert to authenticated
with check (
  profile_id = private.current_profile_id()
  and private.has_company_access(company_id)
  and exists (select 1 from public.scheduled_posts sp where sp.id = post_id and sp.company_id = company_id)
  and (private.is_agency_user() or comment_type in ('comentario', 'solicitacao_alteracao', 'aprovacao'))
);

create policy audit_logs_select on public.audit_logs for select to authenticated
using (private.is_agency_user());
create policy audit_logs_backup_insert on public.audit_logs for insert to authenticated
with check (
  private.is_super_admin()
  and profile_id = private.current_profile_id()
  and company_id is null
  and action = 'backup_gerado'
  and entity_type = 'backup_snapshot'
);

create policy partners_all on public.partners for all to authenticated
using (private.can_manage_agency()) with check (private.can_manage_agency());
create policy contracts_all on public.contracts for all to authenticated
using (private.can_manage_agency()) with check (private.can_manage_agency());
create policy financial_entries_all on public.financial_entries for all to authenticated
using (private.can_manage_agency()) with check (private.can_manage_agency());
create policy agency_tasks_select on public.agency_tasks for select to authenticated
using (private.can_manage_agency() or private.can_view_task(id));
create policy agency_tasks_insert on public.agency_tasks for insert to authenticated
with check (private.can_manage_agency());
create policy agency_tasks_update on public.agency_tasks for update to authenticated
using (private.can_manage_agency()) with check (private.can_manage_agency());
create policy agency_tasks_delete on public.agency_tasks for delete to authenticated
using (private.can_manage_agency());

create policy lead_details_select on public.lead_details for select to authenticated
using (private.can_manage_company(company_id));
create policy lead_details_insert on public.lead_details for insert to authenticated
with check (private.can_manage_company(company_id));
create policy lead_details_update on public.lead_details for update to authenticated
using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
create policy lead_details_delete on public.lead_details for delete to authenticated
using (private.can_manage_company(company_id));

create policy lead_activities_select on public.lead_activities for select to authenticated
using (private.can_manage_company(company_id));
create policy lead_activities_insert on public.lead_activities for insert to authenticated
with check (private.can_manage_company(company_id) and profile_id = private.current_profile_id());

create policy backup_snapshots_select on public.backup_snapshots for select to authenticated
using (private.is_super_admin());
create policy backup_snapshots_insert on public.backup_snapshots for insert to authenticated
with check (private.is_super_admin() and created_by = private.current_profile_id());
create policy backup_snapshots_update on public.backup_snapshots for update to authenticated
using (private.is_super_admin() and created_by = private.current_profile_id())
with check (private.is_super_admin() and created_by = private.current_profile_id());

grant usage on schema public to authenticated;
grant select on public.profiles, public.company_users, public.audit_logs to authenticated;
grant insert on public.audit_logs to authenticated;
grant select, insert, update, delete on public.companies, public.scheduled_posts, public.post_files, public.post_comments, public.partners, public.contracts, public.financial_entries, public.agency_tasks to authenticated;
grant select, insert, update, delete on public.lead_details to authenticated;
grant select, insert on public.lead_activities to authenticated;
grant select, insert, update on public.backup_snapshots to authenticated;
grant usage, select on sequence public.audit_logs_id_seq to authenticated;
revoke all on all tables in schema public from anon;

create or replace function public.admin_bootstrap_owner_records(
  p_auth_user_id uuid,
  p_email text,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_email text;
  v_profile_id uuid;
begin
  select value #>> '{}' into v_expected_email
  from private.platform_settings where key = 'owner_email';

  if lower(trim(p_email)) <> lower(trim(v_expected_email)) then
    raise exception 'E-mail não autorizado para configurar o proprietário.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where role = 'super_admin') then
    raise exception 'O proprietário já foi configurado.' using errcode = '23505';
  end if;

  insert into public.profiles (auth_user_id, name, email, role, permissions)
  values (p_auth_user_id, trim(p_name), lower(trim(p_email)), 'super_admin', '{"manage_companies":true,"manage_content":true,"manage_agency":true,"manage_users":true}'::jsonb)
  returning id into v_profile_id;

  insert into public.audit_logs (profile_id, action, entity_type, entity_id, metadata)
  values (v_profile_id, 'criacao_login_proprietario', 'profile', v_profile_id::text, '{}'::jsonb);
  return v_profile_id;
end;
$$;

create or replace function public.admin_create_company_records(
  p_creator_auth_user_id uuid,
  p_client_auth_user_id uuid,
  p_name text,
  p_trade_name text,
  p_document text,
  p_email text,
  p_phone text,
  p_whatsapp text,
  p_segment text,
  p_services text,
  p_responsible text,
  p_client_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator public.profiles%rowtype;
  v_company_id uuid;
  v_client_profile_id uuid;
begin
  select * into v_creator from public.profiles
  where auth_user_id = p_creator_auth_user_id and is_active = true and role in ('super_admin', 'socio');
  if v_creator.id is null then
    raise exception 'Apenas o administrador principal ou um sócio pode cadastrar empresas com login.' using errcode = '42501';
  end if;

  insert into public.companies (name, trade_name, document, email, phone, whatsapp, segment, services, responsible, created_by)
  values (trim(p_name), nullif(trim(p_trade_name), ''), nullif(trim(p_document), ''), lower(trim(p_email)), nullif(trim(p_phone), ''), nullif(trim(p_whatsapp), ''), nullif(trim(p_segment), ''), nullif(trim(p_services), ''), nullif(trim(p_responsible), ''), v_creator.id)
  returning id into v_company_id;

  insert into public.profiles (auth_user_id, name, email, role, permissions)
  values (p_client_auth_user_id, trim(p_client_name), lower(trim(p_email)), 'empresa_cliente', '{}'::jsonb)
  returning id into v_client_profile_id;

  insert into public.company_users (company_id, profile_id, role_in_company, permissions)
  values (v_company_id, v_client_profile_id, 'administrador_cliente', '{"review_content":true,"download_files":true}'::jsonb);

  insert into public.audit_logs (profile_id, company_id, action, entity_type, entity_id, metadata)
  values (v_creator.id, v_company_id, 'criacao_empresa_e_login', 'company', v_company_id::text, jsonb_build_object('client_profile_id', v_client_profile_id));

  return jsonb_build_object('company_id', v_company_id, 'profile_id', v_client_profile_id);
end;
$$;

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
  if p_role not in ('socio', 'colaborador', 'empresa_cliente') then
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

create or replace function public.admin_update_company_records(
  p_creator_auth_user_id uuid,
  p_company_id uuid,
  p_name text,
  p_trade_name text,
  p_document text,
  p_email text,
  p_phone text,
  p_whatsapp text,
  p_segment text,
  p_services text,
  p_responsible text,
  p_status text,
  p_client_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_id uuid;
  v_client_profile_id uuid;
begin
  select id into v_creator_id from public.profiles
  where auth_user_id = p_creator_auth_user_id and is_active = true and role in ('super_admin', 'socio');
  if v_creator_id is null then
    raise exception 'Apenas o administrador principal ou um sócio pode editar empresas e acessos.' using errcode = '42501';
  end if;
  if p_status not in ('ativo', 'pausado', 'bloqueado', 'encerrado') then
    raise exception 'Status de empresa inválido.';
  end if;

  select cu.profile_id into v_client_profile_id
  from public.company_users cu
  join public.profiles p on p.id = cu.profile_id and p.role = 'empresa_cliente'
  where cu.company_id = p_company_id
  order by cu.created_at
  limit 1;

  update public.companies
  set name = trim(p_name), trade_name = nullif(trim(p_trade_name), ''), document = nullif(trim(p_document), ''),
      email = lower(trim(p_email)), phone = nullif(trim(p_phone), ''), whatsapp = nullif(trim(p_whatsapp), ''),
      segment = nullif(trim(p_segment), ''), services = nullif(trim(p_services), ''), responsible = nullif(trim(p_responsible), ''), status = p_status
  where id = p_company_id;

  if not found then raise exception 'Empresa não encontrada.'; end if;
  if v_client_profile_id is not null then
    update public.profiles set name = trim(p_client_name), email = lower(trim(p_email)) where id = v_client_profile_id;
  end if;

  insert into public.audit_logs (profile_id, company_id, action, entity_type, entity_id, metadata)
  values (v_creator_id, p_company_id, 'edicao_empresa', 'company', p_company_id::text, jsonb_build_object('status', p_status));
  return v_client_profile_id;
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
  if p_role not in ('socio', 'colaborador', 'empresa_cliente') then
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

  insert into public.audit_logs (profile_id, company_id, action, entity_type, entity_id, metadata)
  values (v_creator_id, p_company_id, 'edicao_acesso', 'profile', p_profile_id::text, jsonb_build_object('role', p_role, 'is_active', p_is_active));
  return p_profile_id;
end;
$$;

revoke all on function public.admin_bootstrap_owner_records(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_create_company_records(uuid, uuid, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_create_profile_records(uuid, uuid, text, text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_update_company_records(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_update_profile_records(uuid, uuid, text, text, text, text, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.admin_bootstrap_owner_records(uuid, text, text) to service_role;
grant execute on function public.admin_create_company_records(uuid, uuid, text, text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.admin_create_profile_records(uuid, uuid, text, text, text, text, uuid, jsonb) to service_role;
grant execute on function public.admin_update_company_records(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.admin_update_profile_records(uuid, uuid, text, text, text, text, uuid, jsonb, boolean) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('oriva-files', 'oriva-files', false, 2147483648, array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','video/mp4','video/quicktime','video/webm','video/x-m4v','application/pdf','application/zip','application/json'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy oriva_storage_select on storage.objects for select to authenticated
using (
  bucket_id = 'oriva-files'
  and (private.can_upload_storage_object(name) or private.can_view_storage_object(name))
);
create policy oriva_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'oriva-files' and private.can_upload_storage_object(name));
create policy oriva_storage_update on storage.objects for update to authenticated
using (bucket_id = 'oriva-files' and private.can_upload_storage_object(name))
with check (bucket_id = 'oriva-files' and private.can_upload_storage_object(name));
create policy oriva_storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'oriva-files' and private.can_upload_storage_object(name));

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_profile_id uuid;
  v_company_id uuid;
begin
  v_profile_id := private.current_profile_id();
  if v_profile_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name = 'companies' then
    v_company_id := (v_row ->> 'id')::uuid;
  elsif (v_row ->> 'company_id') is not null then
    v_company_id := (v_row ->> 'company_id')::uuid;
  end if;
  insert into public.audit_logs (profile_id, company_id, action, entity_type, entity_id, metadata)
  values (v_profile_id, v_company_id, lower(tg_op), tg_table_name, v_row ->> 'id', jsonb_build_object('status', v_row -> 'status'));
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create trigger companies_audit after insert or update or delete on public.companies for each row execute function private.audit_row_change();
create trigger scheduled_posts_audit after insert or update or delete on public.scheduled_posts for each row execute function private.audit_row_change();
create trigger post_files_audit after insert or update or delete on public.post_files for each row execute function private.audit_row_change();
create trigger post_comments_audit after insert or update or delete on public.post_comments for each row execute function private.audit_row_change();
create trigger partners_audit after insert or update or delete on public.partners for each row execute function private.audit_row_change();
create trigger contracts_audit after insert or update or delete on public.contracts for each row execute function private.audit_row_change();
create trigger financial_entries_audit after insert or update or delete on public.financial_entries for each row execute function private.audit_row_change();
create trigger agency_tasks_audit after insert or update or delete on public.agency_tasks for each row execute function private.audit_row_change();

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.audit_row_change() from public, anon, authenticated;
revoke all on table private.platform_settings from public, anon, authenticated;
