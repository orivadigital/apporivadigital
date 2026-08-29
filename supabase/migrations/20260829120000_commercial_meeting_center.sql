-- Central de reuniões comerciais da Óriva.
-- A disponibilidade do sócio de referência (Luciano) governa os horários reserváveis.

create table public.commercial_schedule_partners (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  display_name text not null,
  google_email text not null,
  sort_order smallint not null check (sort_order between 1 and 20),
  is_reference boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index commercial_schedule_reference_uidx
  on public.commercial_schedule_partners (is_reference)
  where is_reference = true and is_active = true;

create table public.commercial_availability (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.commercial_schedule_partners(profile_id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  timezone text not null default 'America/Sao_Paulo',
  valid_from date,
  valid_until date,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time < end_time),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create index commercial_availability_partner_day_idx
  on public.commercial_availability (profile_id, weekday, start_time, end_time)
  where is_active = true;

create index commercial_availability_created_by_idx
  on public.commercial_availability (created_by);

create table public.commercial_schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.commercial_schedule_partners(profile_id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default '',
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create index commercial_schedule_blocks_partner_range_idx
  on public.commercial_schedule_blocks (profile_id, starts_at, ends_at);

create index commercial_schedule_blocks_created_by_idx
  on public.commercial_schedule_blocks (created_by);

create table public.commercial_meetings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  client_name text not null check (length(trim(client_name)) > 0),
  client_email text not null check (length(trim(client_email)) > 0),
  client_phone text not null default '',
  client_company text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'America/Sao_Paulo',
  status text not null default 'agendada'
    check (status in ('agendada', 'realizada', 'no_show', 'cancelada')),
  result text
    check (result is null or result in ('qualificado', 'desqualificado')),
  client_needs text not null default '',
  service_interest text not null default '',
  budget text not null default '',
  objections text not null default '',
  important_information text not null default '',
  next_step text not null default '',
  closing_notes text not null default '',
  observations text not null default '',
  booked_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  booked_by_name text not null,
  booked_source text not null check (booked_source in ('equipe', 'cliente')),
  google_event_id text,
  google_meet_url text,
  google_sync_status text not null default 'pendente'
    check (google_sync_status in ('pendente', 'sincronizado', 'erro', 'nao_configurado', 'cancelado')),
  google_sync_error text,
  google_synced_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  slot tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  check (starts_at < ends_at),
  check (ends_at <= starts_at + interval '4 hours'),
  check (
    (status = 'realizada' and result in ('qualificado', 'desqualificado'))
    or (status <> 'realizada' and result is null)
  )
);

alter table public.commercial_meetings
  add constraint commercial_meetings_no_overlap
  exclude using gist (slot with &&)
  where (status in ('agendada', 'realizada', 'no_show'));

create unique index commercial_meetings_google_event_uidx
  on public.commercial_meetings (google_event_id)
  where google_event_id is not null;

create index commercial_meetings_start_status_idx
  on public.commercial_meetings (starts_at, status);

create index commercial_meetings_company_start_idx
  on public.commercial_meetings (company_id, starts_at desc)
  where company_id is not null;

create index commercial_meetings_booked_by_idx
  on public.commercial_meetings (booked_by_profile_id, created_at desc);

create table public.commercial_meeting_participants (
  meeting_id uuid not null references public.commercial_meetings(id) on delete cascade,
  profile_id uuid not null references public.commercial_schedule_partners(profile_id) on delete restrict,
  display_name text not null,
  email text not null,
  created_at timestamptz not null default now(),
  primary key (meeting_id, profile_id)
);

create index commercial_meeting_participants_profile_idx
  on public.commercial_meeting_participants (profile_id, meeting_id);

insert into public.commercial_schedule_partners (
  profile_id, display_name, google_email, sort_order, is_reference
)
select p.id, seed.display_name, p.email, seed.sort_order, seed.is_reference
from (
  values
    ('lucianoarsenio.consultoria@gmail.com', 'Luciano Arsenio', 1::smallint, true),
    ('alexandre.t.0108@gmail.com', 'Alexandre Teixeira', 2::smallint, false),
    ('lucasbarcellosdegodoy@gmail.com', 'Lucas Godoy', 3::smallint, false)
) as seed(email, display_name, sort_order, is_reference)
join public.profiles p on lower(p.email) = lower(seed.email) and p.is_active = true
on conflict (profile_id) do update set
  display_name = excluded.display_name,
  google_email = excluded.google_email,
  sort_order = excluded.sort_order,
  is_reference = excluded.is_reference,
  is_active = true,
  updated_at = now();

do $$
begin
  if (select count(*) from public.commercial_schedule_partners where is_active) <> 3
    or (select count(*) from public.commercial_schedule_partners where is_active and is_reference) <> 1 then
    raise exception 'Os três sócios da agenda comercial não foram encontrados nos perfis ativos.';
  end if;
end;
$$;

create trigger commercial_schedule_partners_set_updated_at
before update on public.commercial_schedule_partners
for each row execute function private.set_updated_at();

create trigger commercial_availability_set_updated_at
before update on public.commercial_availability
for each row execute function private.set_updated_at();

create trigger commercial_schedule_blocks_set_updated_at
before update on public.commercial_schedule_blocks
for each row execute function private.set_updated_at();

create trigger commercial_meetings_set_updated_at
before update on public.commercial_meetings
for each row execute function private.set_updated_at();

create or replace function private.is_commercial_agency_user()
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
      and p.role in ('super_admin', 'socio', 'colaborador')
  )
$$;

revoke all on function private.is_commercial_agency_user() from public, anon, authenticated;
grant execute on function private.is_commercial_agency_user() to authenticated;

alter table public.commercial_schedule_partners enable row level security;
alter table public.commercial_availability enable row level security;
alter table public.commercial_schedule_blocks enable row level security;
alter table public.commercial_meetings enable row level security;
alter table public.commercial_meeting_participants enable row level security;

create policy commercial_schedule_partners_select on public.commercial_schedule_partners
for select to authenticated
using ((select private.current_profile_id()) is not null);

create policy commercial_availability_select on public.commercial_availability
for select to authenticated
using ((select private.is_commercial_agency_user()));

create policy commercial_availability_insert on public.commercial_availability
for insert to authenticated
with check (
  (select private.current_profile_id()) = created_by
  and exists (
    select 1 from public.profiles p
    where p.id = (select private.current_profile_id())
      and p.role in ('super_admin', 'socio')
  )
);

create policy commercial_availability_update on public.commercial_availability
for update to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select private.current_profile_id())
      and p.role in ('super_admin', 'socio')
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = (select private.current_profile_id())
      and p.role in ('super_admin', 'socio')
  )
);

create policy commercial_availability_delete on public.commercial_availability
for delete to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select private.current_profile_id())
      and p.role in ('super_admin', 'socio')
  )
);

create policy commercial_schedule_blocks_select on public.commercial_schedule_blocks
for select to authenticated
using ((select private.is_commercial_agency_user()));

create policy commercial_schedule_blocks_delete on public.commercial_schedule_blocks
for delete to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select private.current_profile_id())
      and p.role in ('super_admin', 'socio')
  )
);

create policy commercial_meetings_select on public.commercial_meetings
for select to authenticated
using (
  (select private.is_commercial_agency_user())
  or (
    company_id is not null
    and exists (
      select 1
      from public.company_users cu
      where cu.company_id = commercial_meetings.company_id
        and cu.profile_id = (select private.current_profile_id())
    )
  )
);

create policy commercial_meetings_update on public.commercial_meetings
for update to authenticated
using ((select private.is_commercial_agency_user()))
with check ((select private.is_commercial_agency_user()));

create policy commercial_meeting_participants_select on public.commercial_meeting_participants
for select to authenticated
using (
  exists (
    select 1
    from public.commercial_meetings m
    where m.id = commercial_meeting_participants.meeting_id
  )
);

revoke all on public.commercial_schedule_partners from anon, authenticated;
revoke all on public.commercial_availability from anon, authenticated;
revoke all on public.commercial_schedule_blocks from anon, authenticated;
revoke all on public.commercial_meetings from anon, authenticated;
revoke all on public.commercial_meeting_participants from anon, authenticated;

grant select on public.commercial_schedule_partners to authenticated;
grant select, insert, update, delete on public.commercial_availability to authenticated;
grant select, delete on public.commercial_schedule_blocks to authenticated;
grant select, update on public.commercial_meetings to authenticated;
grant select on public.commercial_meeting_participants to authenticated;

create or replace function public.list_commercial_slots(
  p_from date,
  p_to date,
  p_duration_minutes integer default 60
)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with reference_partner as (
    select sp.profile_id
    from public.commercial_schedule_partners sp
    where sp.is_reference = true and sp.is_active = true
    limit 1
  ),
  requested_days as (
    select day::date
    from generate_series(p_from, p_to, interval '1 day') day
    where p_to >= p_from and p_to <= p_from + 62
  ),
  candidates as (
    select
      slot_start as starts_at,
      slot_start + make_interval(mins => p_duration_minutes) as ends_at,
      rp.profile_id
    from requested_days d
    join reference_partner rp on true
    join public.commercial_availability a
      on a.profile_id = rp.profile_id
     and a.is_active = true
     and a.weekday = extract(dow from d.day)::smallint
     and (a.valid_from is null or d.day >= a.valid_from)
     and (a.valid_until is null or d.day <= a.valid_until)
    cross join lateral generate_series(
      (d.day + a.start_time) at time zone a.timezone,
      ((d.day + a.end_time) at time zone a.timezone) - make_interval(mins => p_duration_minutes),
      interval '30 minutes'
    ) slot_start
    where p_duration_minutes between 15 and 240
  )
  select c.starts_at, c.ends_at
  from candidates c
  where c.starts_at >= now() + interval '15 minutes'
    and not exists (
      select 1 from public.commercial_schedule_blocks b
      where b.profile_id = c.profile_id
        and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(c.starts_at, c.ends_at, '[)')
    )
    and not exists (
      select 1 from public.commercial_meetings m
      where m.status in ('agendada', 'realizada', 'no_show')
        and m.slot && tstzrange(c.starts_at, c.ends_at, '[)')
    )
  order by c.starts_at
$$;

revoke all on function public.list_commercial_slots(date, date, integer) from public, anon;
grant execute on function public.list_commercial_slots(date, date, integer) to authenticated;

create or replace function public.create_commercial_schedule_block(
  p_profile_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_block_id uuid;
begin
  select p.id, p.role into v_actor_id, v_actor_role
  from public.profiles p
  where p.auth_user_id = (select auth.uid()) and p.is_active = true;

  if v_actor_id is null or v_actor_role not in ('super_admin', 'socio') then
    raise exception using errcode = '42501', message = 'Apenas os sócios podem bloquear horários.';
  end if;
  if p_starts_at is null or p_ends_at is null or p_starts_at >= p_ends_at then
    raise exception using errcode = '22023', message = 'Informe o início e o fim do bloqueio.';
  end if;
  if not exists (
    select 1 from public.commercial_schedule_partners sp
    where sp.profile_id = p_profile_id and sp.is_active = true
  ) then
    raise exception using errcode = '22023', message = 'Selecione um sócio da agenda comercial.';
  end if;

  perform pg_advisory_xact_lock(hashtext('oriva_commercial_schedule'));
  insert into public.commercial_schedule_blocks (
    profile_id, starts_at, ends_at, reason, created_by
  ) values (
    p_profile_id, p_starts_at, p_ends_at, trim(coalesce(p_reason, '')), v_actor_id
  ) returning id into v_block_id;

  return v_block_id;
end;
$$;

revoke all on function public.create_commercial_schedule_block(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.create_commercial_schedule_block(uuid, timestamptz, timestamptz, text) to authenticated;

create or replace function public.book_commercial_meeting(
  p_company_id uuid,
  p_client_name text,
  p_client_email text,
  p_client_phone text,
  p_client_company text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_client_needs text default '',
  p_service_interest text default '',
  p_budget text default '',
  p_objections text default '',
  p_important_information text default '',
  p_next_step text default '',
  p_closing_notes text default '',
  p_observations text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_actor_name text;
  v_actor_role text;
  v_company_id uuid := p_company_id;
  v_reference_id uuid;
  v_local_start timestamp;
  v_local_end timestamp;
  v_meeting public.commercial_meetings;
begin
  select p.id, p.name, p.role into v_actor_id, v_actor_name, v_actor_role
  from public.profiles p
  where p.auth_user_id = (select auth.uid()) and p.is_active = true;

  if v_actor_id is null or v_actor_role not in ('super_admin', 'socio', 'colaborador', 'empresa_cliente') then
    raise exception using errcode = '42501', message = 'Seu perfil não pode agendar reuniões comerciais.';
  end if;
  if v_actor_role = 'empresa_cliente' then
    select cu.company_id into v_company_id
    from public.company_users cu
    where cu.profile_id = v_actor_id
    limit 1;
    if v_company_id is null or (p_company_id is not null and p_company_id <> v_company_id) then
      raise exception using errcode = '42501', message = 'Você não possui acesso a esta empresa.';
    end if;
  end if;
  if trim(coalesce(p_client_name, '')) = '' or trim(coalesce(p_client_email, '')) = '' then
    raise exception using errcode = '22023', message = 'Informe o nome e o e-mail do cliente.';
  end if;
  if p_starts_at is null or p_ends_at is null or p_starts_at >= p_ends_at
    or p_ends_at > p_starts_at + interval '4 hours' then
    raise exception using errcode = '22023', message = 'Informe um horário de reunião válido.';
  end if;
  if p_starts_at < now() + interval '15 minutes' then
    raise exception using errcode = '22023', message = 'Escolha um horário futuro com pelo menos 15 minutos de antecedência.';
  end if;

  perform pg_advisory_xact_lock(hashtext('oriva_commercial_schedule'));

  select sp.profile_id into v_reference_id
  from public.commercial_schedule_partners sp
  where sp.is_reference = true and sp.is_active = true
  limit 1;
  if v_reference_id is null then
    raise exception using errcode = '55000', message = 'O sócio de referência da agenda não está configurado.';
  end if;

  v_local_start := p_starts_at at time zone 'America/Sao_Paulo';
  v_local_end := p_ends_at at time zone 'America/Sao_Paulo';
  if v_local_start::date <> v_local_end::date or not exists (
    select 1
    from public.commercial_availability a
    where a.profile_id = v_reference_id
      and a.is_active = true
      and a.weekday = extract(dow from v_local_start)::smallint
      and v_local_start::time >= a.start_time
      and v_local_end::time <= a.end_time
      and (a.valid_from is null or v_local_start::date >= a.valid_from)
      and (a.valid_until is null or v_local_start::date <= a.valid_until)
  ) then
    raise exception using errcode = 'P0001', message = 'Luciano não está disponível neste horário.';
  end if;

  if exists (
    select 1
    from public.commercial_schedule_blocks b
    where b.profile_id = v_reference_id
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    raise exception using errcode = '23P01', message = 'Luciano possui um bloqueio neste horário.';
  end if;
  if exists (
    select 1
    from public.commercial_meetings m
    where m.status in ('agendada', 'realizada', 'no_show')
      and m.slot && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    raise exception using errcode = '23P01', message = 'Este horário acabou de ser reservado. Escolha outro.';
  end if;

  insert into public.commercial_meetings (
    company_id, client_name, client_email, client_phone, client_company,
    starts_at, ends_at, client_needs, service_interest, budget, objections,
    important_information, next_step, closing_notes, observations,
    booked_by_profile_id, booked_by_name, booked_source
  ) values (
    v_company_id, trim(p_client_name), lower(trim(p_client_email)), trim(coalesce(p_client_phone, '')),
    trim(coalesce(p_client_company, '')), p_starts_at, p_ends_at,
    trim(coalesce(p_client_needs, '')), trim(coalesce(p_service_interest, '')),
    trim(coalesce(p_budget, '')), trim(coalesce(p_objections, '')),
    trim(coalesce(p_important_information, '')), trim(coalesce(p_next_step, '')),
    trim(coalesce(p_closing_notes, '')), trim(coalesce(p_observations, '')),
    v_actor_id, v_actor_name, case when v_actor_role = 'empresa_cliente' then 'cliente' else 'equipe' end
  ) returning * into v_meeting;

  insert into public.commercial_meeting_participants (meeting_id, profile_id, display_name, email)
  select v_meeting.id, sp.profile_id, sp.display_name, sp.google_email
  from public.commercial_schedule_partners sp
  where sp.is_active = true;

  insert into public.audit_logs (profile_id, company_id, action, entity_type, entity_id, metadata)
  values (
    v_actor_id, v_company_id, 'reuniao_comercial_agendada', 'commercial_meeting', v_meeting.id::text,
    jsonb_build_object('starts_at', v_meeting.starts_at, 'client_email', v_meeting.client_email)
  );

  return jsonb_build_object(
    'id', v_meeting.id,
    'starts_at', v_meeting.starts_at,
    'ends_at', v_meeting.ends_at,
    'status', v_meeting.status,
    'google_sync_status', v_meeting.google_sync_status
  );
exception
  when exclusion_violation then
    raise exception using errcode = '23P01', message = 'Este horário acabou de ser reservado. Escolha outro.';
end;
$$;

revoke all on function public.book_commercial_meeting(uuid, text, text, text, text, timestamptz, timestamptz, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.book_commercial_meeting(uuid, text, text, text, text, timestamptz, timestamptz, text, text, text, text, text, text, text, text) to authenticated;

create or replace function public.record_commercial_google_sync(
  p_meeting_id uuid,
  p_event_id text,
  p_meet_url text,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_actor_role text;
begin
  select p.id, p.role into v_actor_id, v_actor_role
  from public.profiles p
  where p.auth_user_id = (select auth.uid()) and p.is_active = true;

  if v_actor_id is null or not exists (
    select 1
    from public.commercial_meetings m
    where m.id = p_meeting_id
      and (
        v_actor_role in ('super_admin', 'socio', 'colaborador')
        or m.booked_by_profile_id = v_actor_id
      )
  ) then
    raise exception using errcode = '42501', message = 'Você não pode atualizar a sincronização desta reunião.';
  end if;
  if p_status not in ('sincronizado', 'erro', 'nao_configurado', 'cancelado') then
    raise exception using errcode = '22023', message = 'Situação de sincronização inválida.';
  end if;
  if p_status = 'sincronizado' and (
    trim(coalesce(p_event_id, '')) = ''
    or trim(coalesce(p_meet_url, '')) !~ '^https://meet\.google\.com/[a-z-]+$'
  ) then
    raise exception using errcode = '22023', message = 'O evento ou o link do Google Meet é inválido.';
  end if;

  update public.commercial_meetings
  set google_event_id = nullif(trim(coalesce(p_event_id, '')), ''),
      google_meet_url = nullif(trim(coalesce(p_meet_url, '')), ''),
      google_sync_status = p_status,
      google_sync_error = case when p_status = 'erro' then left(coalesce(p_error, ''), 500) else null end,
      google_synced_at = case when p_status = 'sincronizado' then now() else google_synced_at end
  where id = p_meeting_id;
end;
$$;

revoke all on function public.record_commercial_google_sync(uuid, text, text, text, text) from public, anon;
grant execute on function public.record_commercial_google_sync(uuid, text, text, text, text) to authenticated;

-- Include the meeting center in complete backups and additive restores.
do $migration$
declare
  v_definition text;
  v_updated_definition text;
begin
  select pg_get_functiondef('private.restore_backup_snapshot_data(uuid,jsonb)'::regprocedure)
  into v_definition;

  v_updated_definition := replace(
    v_definition,
    E'''profiles'',\n    ''companies'',\n    ''partners'',\n    ''company_users''',
    E'''profiles'',\n    ''companies'',\n    ''partners'',\n    ''commercial_schedule_partners'',\n    ''company_users'',\n    ''commercial_availability'',\n    ''commercial_schedule_blocks'',\n    ''commercial_meetings'',\n    ''commercial_meeting_participants'''
  );

  if v_updated_definition = v_definition then
    raise exception 'Não foi possível incluir a central de reuniões na restauração de backup.';
  end if;

  execute v_updated_definition;
end;
$migration$;

notify pgrst, 'reload schema';
