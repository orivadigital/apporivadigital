-- Let an active collaborator use the Partner PJ assignment linked to the same
-- profile. Internal ownership remains independent from partner responsibility.

with matching_profiles as (
  select
    pa.id as partner_id,
    p.id as profile_id,
    count(*) over (partition by pa.id) as profiles_for_partner,
    count(*) over (partition by p.id) as partners_for_profile
  from public.partners pa
  join public.profiles p
    on lower(btrim(p.email)) = lower(btrim(pa.email))
   and p.is_active = true
   and p.role in ('colaborador', 'parceiro')
  where pa.profile_id is null
    and pa.status = 'ativo'
    and nullif(btrim(pa.email), '') is not null
    and not exists (
      select 1 from public.partners linked
      where linked.profile_id = p.id
    )
)
update public.partners pa
set profile_id = match.profile_id,
    updated_at = now()
from matching_profiles match
where pa.id = match.partner_id
  and match.profiles_for_partner = 1
  and match.partners_for_profile = 1;

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
            exists (
              select 1 from public.agency_tasks t
              where t.company_id = p_company_id and t.assigned_to = p.id
            )
            or exists (
              select 1 from public.scheduled_posts sp
              where sp.company_id = p_company_id and sp.assigned_to = p.id
            )
          )
        )
        or (
          p.role in ('colaborador', 'parceiro')
          and exists (
            select 1
            from public.partners pa
            where pa.profile_id = p.id
              and (
                exists (
                  select 1 from public.agency_tasks t
                  where t.company_id = p_company_id and t.partner_id = pa.id
                )
                or exists (
                  select 1 from public.scheduled_posts sp
                  where sp.company_id = p_company_id and sp.partner_id = pa.id
                )
              )
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
          p.role in ('colaborador', 'parceiro')
          and exists (
            select 1 from public.partners pa
            where pa.profile_id = p.id and pa.id = t.partner_id
          )
        )
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
      )
  )
$$;

create or replace function private.can_update_assigned_task(p_task_id uuid)
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
          p.role in ('colaborador', 'parceiro')
          and exists (
            select 1 from public.partners pa
            where pa.profile_id = p.id and pa.id = t.partner_id
          )
        )
      )
  )
$$;

create or replace function private.guard_assigned_task_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  actor_role text;
begin
  if (select auth.uid()) is null then return new; end if;

  select p.id, p.role into actor_id, actor_role
  from public.profiles p
  where p.auth_user_id = (select auth.uid()) and p.is_active = true;

  if actor_role in ('super_admin', 'socio') then return new; end if;

  if actor_role = 'colaborador' and old.assigned_to = actor_id then
    null;
  elsif actor_role in ('colaborador', 'parceiro') and exists (
    select 1 from public.partners pa
    where pa.profile_id = actor_id and pa.id = old.partner_id
  ) then
    null;
  else
    raise exception 'Você não pode editar esta demanda.' using errcode = '42501';
  end if;

  if row(new.id, new.title, new.company_id, new.task_type, new.assigned_to, new.partner_id, new.due_date, new.priority, new.created_by, new.created_at)
    is distinct from row(old.id, old.title, old.company_id, old.task_type, old.assigned_to, old.partner_id, old.due_date, old.priority, old.created_by, old.created_at) then
    raise exception 'Colaboradores e parceiros só podem alterar descrição e situação.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function private.can_view_post_item(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.scheduled_posts sp
    join public.profiles p
      on p.auth_user_id = (select auth.uid())
     and p.is_active = true
    where sp.id = p_post_id
      and (
        p.role in ('super_admin', 'socio')
        or (p.role = 'colaborador' and sp.assigned_to = p.id)
        or (
          p.role in ('colaborador', 'parceiro')
          and exists (
            select 1 from public.partners pa
            where pa.profile_id = p.id and pa.id = sp.partner_id
          )
        )
        or (
          p.role = 'empresa_cliente'
          and sp.status <> 'rascunho'
          and exists (
            select 1
            from public.company_users cu
            join public.companies c on c.id = cu.company_id
            where cu.profile_id = p.id
              and cu.company_id = sp.company_id
              and c.status <> 'bloqueado'
          )
        )
      )
  )
$$;

create or replace function private.can_update_assigned_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.scheduled_posts sp
    join public.profiles p
      on p.auth_user_id = (select auth.uid())
     and p.is_active = true
    where sp.id = p_post_id
      and (
        p.role in ('super_admin', 'socio')
        or (p.role = 'colaborador' and sp.assigned_to = p.id)
        or (
          p.role in ('colaborador', 'parceiro')
          and exists (
            select 1 from public.partners pa
            where pa.profile_id = p.id and pa.id = sp.partner_id
          )
        )
      )
  )
$$;

create or replace function private.guard_assigned_post_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  actor_role text;
begin
  if (select auth.uid()) is null then return new; end if;

  select p.id, p.role into actor_id, actor_role
  from public.profiles p
  where p.auth_user_id = (select auth.uid()) and p.is_active = true;

  if actor_role in ('super_admin', 'socio') then return new; end if;

  if actor_role = 'colaborador' and old.assigned_to = actor_id then
    null;
  elsif actor_role in ('colaborador', 'parceiro') and exists (
    select 1 from public.partners pa
    where pa.profile_id = actor_id and pa.id = old.partner_id
  ) then
    null;
  else
    raise exception 'Você não pode editar este conteúdo.' using errcode = '42501';
  end if;

  if row(new.id, new.company_id, new.title, new.content_type, new.social_network, new.scheduled_date, new.scheduled_time, new.internal_notes, new.client_notes, new.assigned_to, new.partner_id, new.created_by, new.approved_by, new.approved_at, new.client_feedback, new.created_at)
    is distinct from row(old.id, old.company_id, old.title, old.content_type, old.social_network, old.scheduled_date, old.scheduled_time, old.internal_notes, old.client_notes, old.assigned_to, old.partner_id, old.created_by, old.approved_by, old.approved_at, old.client_feedback, old.created_at) then
    raise exception 'Colaboradores e parceiros só podem alterar descrição e situação.' using errcode = '42501';
  end if;

  return new;
end;
$$;

grant execute on function private.has_company_access(uuid) to authenticated;
grant execute on function private.can_view_task(uuid) to authenticated;
grant execute on function private.can_update_assigned_task(uuid) to authenticated;
grant execute on function private.can_view_post_item(uuid) to authenticated;
grant execute on function private.can_update_assigned_post(uuid) to authenticated;
