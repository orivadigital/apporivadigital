-- Funil comercial para leads, com dados internos separados da área do cliente.

create table if not exists public.lead_details (
  company_id uuid primary key references public.companies(id) on delete cascade,
  stage text not null default 'novo'
    check (stage in ('novo', 'contato_realizado', 'proposta_enviada', 'negociacao', 'ganho', 'perdido')),
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

create index if not exists lead_details_stage_follow_up_idx
  on public.lead_details (stage, next_follow_up_at);
create index if not exists lead_details_owner_follow_up_idx
  on public.lead_details (owner_profile_id, next_follow_up_at)
  where owner_profile_id is not null;

create table if not exists public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  activity_type text not null default 'nota'
    check (activity_type in ('cadastro', 'ligacao', 'whatsapp', 'email', 'reuniao', 'nota', 'mudanca_etapa')),
  description text not null,
  previous_stage text,
  new_stage text,
  contact_at timestamptz not null default now(),
  next_follow_up_at timestamptz,
  created_at timestamptz not null default now(),
  check (previous_stage is null or previous_stage in ('novo', 'contato_realizado', 'proposta_enviada', 'negociacao', 'ganho', 'perdido')),
  check (new_stage is null or new_stage in ('novo', 'contato_realizado', 'proposta_enviada', 'negociacao', 'ganho', 'perdido'))
);

create index if not exists lead_activities_company_created_idx
  on public.lead_activities (company_id, created_at desc);
create index if not exists lead_activities_profile_created_idx
  on public.lead_activities (profile_id, created_at desc);

drop trigger if exists lead_details_set_updated_at on public.lead_details;
create trigger lead_details_set_updated_at
before update on public.lead_details
for each row execute function private.set_updated_at();

alter table public.lead_details enable row level security;
alter table public.lead_activities enable row level security;

drop policy if exists lead_details_select on public.lead_details;
drop policy if exists lead_details_insert on public.lead_details;
drop policy if exists lead_details_update on public.lead_details;
drop policy if exists lead_details_delete on public.lead_details;
create policy lead_details_select on public.lead_details for select to authenticated
using (private.can_manage_company(company_id));
create policy lead_details_insert on public.lead_details for insert to authenticated
with check (private.can_manage_company(company_id));
create policy lead_details_update on public.lead_details for update to authenticated
using (private.can_manage_company(company_id))
with check (private.can_manage_company(company_id));
create policy lead_details_delete on public.lead_details for delete to authenticated
using (private.can_manage_company(company_id));

drop policy if exists lead_activities_select on public.lead_activities;
drop policy if exists lead_activities_insert on public.lead_activities;
create policy lead_activities_select on public.lead_activities for select to authenticated
using (private.can_manage_company(company_id));
create policy lead_activities_insert on public.lead_activities for insert to authenticated
with check (
  private.can_manage_company(company_id)
  and profile_id = private.current_profile_id()
);

grant select, insert, update, delete on public.lead_details to authenticated;
grant select, insert on public.lead_activities to authenticated;

