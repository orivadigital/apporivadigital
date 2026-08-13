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
        p.role in ('super_admin', 'socio', 'colaborador')
        or (
          p.role = 'empresa_cliente'
          and t.company_id is not null
          and exists (
            select 1 from public.company_users cu
            join public.companies c on c.id = cu.company_id
            where cu.profile_id = p.id
              and cu.company_id = t.company_id
              and c.status <> 'bloqueado'
          )
        )
        or (
          p.role = 'parceiro'
          and exists (
            select 1 from public.partners pa
            where pa.profile_id = p.id
              and pa.id = t.partner_id
          )
        )
      )
  )
$$;
