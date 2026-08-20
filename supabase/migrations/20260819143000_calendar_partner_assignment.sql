-- Separate internal and partner assignments in the content calendar.

alter table public.scheduled_posts
  add column if not exists partner_id uuid references public.partners(id) on delete set null;

create index if not exists scheduled_posts_partner_date_idx
  on public.scheduled_posts (partner_id, scheduled_date)
  where partner_id is not null;

-- Preserve access for posts that used the old shared assignment field.
update public.scheduled_posts sp
set partner_id = pa.id,
    assigned_to = null
from public.partners pa
join public.profiles p on p.id = pa.profile_id and p.role = 'parceiro'
where sp.partner_id is null
  and sp.assigned_to = pa.profile_id;

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
      )
  )
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
          p.role = 'parceiro'
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
          p.role = 'parceiro'
          and exists (
            select 1 from public.partners pa
            where pa.profile_id = p.id and pa.id = sp.partner_id
          )
        )
      )
  )
$$;

create or replace function private.can_attach_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_update_assigned_post(p_post_id)
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
  elsif actor_role = 'parceiro' and exists (
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

create or replace function public.create_scheduled_posts_batch(
  p_company_id uuid,
  p_posts jsonb,
  p_files jsonb default '[]'::jsonb
)
returns setof public.scheduled_posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_post_ids uuid[];
  v_post_count integer;
  v_file_count integer;
begin
  v_profile_id := private.current_profile_id();

  if v_profile_id is null or not private.can_manage_content(p_company_id) then
    raise exception 'Somente a agência pode criar conteúdos.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.companies c
    where c.id = p_company_id
      and coalesce(c.relationship_type, 'cliente') <> 'lead'
      and c.status <> 'bloqueado'
  ) then
    raise exception 'Empresa não encontrada ou indisponível para conteúdos.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_posts) <> 'array' then
    raise exception 'A lista de conteúdos é inválida.' using errcode = '22023';
  end if;

  v_post_count := jsonb_array_length(p_posts);
  if v_post_count < 1 or v_post_count > 31 then
    raise exception 'Cadastre entre 1 e 31 datas por vez.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_posts) as p(
      title text,
      content_type text,
      social_network text,
      scheduled_date date,
      scheduled_time time,
      caption text,
      internal_notes text,
      client_notes text,
      status text,
      assigned_to uuid,
      partner_id uuid
    )
    where nullif(btrim(p.title), '') is null
       or p.scheduled_date is null
       or p.scheduled_time is null
       or p.content_type not in ('post', 'carrossel', 'stories', 'reels', 'video', 'arte', 'campanha', 'outro')
       or p.social_network not in ('instagram', 'tiktok', 'facebook', 'linkedin', 'youtube_shorts', 'outra')
       or p.status not in ('rascunho', 'programado', 'aguardando_aprovacao', 'aprovado', 'revisao_solicitada', 'publicado')
       or (
         p.assigned_to is not null
         and not exists (
           select 1 from public.profiles assignee
           where assignee.id = p.assigned_to
             and assignee.is_active = true
             and assignee.role in ('super_admin', 'socio', 'colaborador')
         )
       )
       or (
         p.partner_id is not null
         and not exists (
           select 1
           from public.partners pa
           join public.profiles partner_profile on partner_profile.id = pa.profile_id
           where pa.id = p.partner_id
             and pa.status = 'ativo'
             and partner_profile.is_active = true
             and partner_profile.role = 'parceiro'
         )
       )
  ) then
    raise exception 'Um ou mais conteúdos possuem dados ou responsáveis inválidos.' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array' then
    raise exception 'A lista de arquivos é inválida.' using errcode = '22023';
  end if;

  v_file_count := jsonb_array_length(coalesce(p_files, '[]'::jsonb));
  if v_file_count > 20 then
    raise exception 'Envie no máximo 20 arquivos por conteúdo.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_files, '[]'::jsonb)) as f(
      file_url text,
      original_file_url text,
      file_name text,
      file_type text,
      file_size bigint,
      mime_type text,
      order_index integer
    )
    where nullif(btrim(f.file_name), '') is null
       or nullif(btrim(f.file_url), '') is null
       or f.file_url <> f.original_file_url
       or f.file_url not like ('companies/' || p_company_id::text || '/posts/bulk-%/original/%')
       or f.file_url like '%..%'
       or f.file_size is null
       or f.file_size < 1
       or f.file_size > 2147483648
       or f.order_index is null
       or f.order_index < 0
       or not (
         coalesce(f.mime_type, '') like 'image/%'
         or coalesce(f.mime_type, '') like 'video/%'
         or f.mime_type = 'application/pdf'
       )
  ) then
    raise exception 'Um ou mais arquivos enviados são inválidos.' using errcode = '22023';
  end if;

  with inserted as (
    insert into public.scheduled_posts (
      company_id,
      title,
      content_type,
      social_network,
      scheduled_date,
      scheduled_time,
      caption,
      internal_notes,
      client_notes,
      status,
      assigned_to,
      partner_id,
      created_by
    )
    select
      p_company_id,
      btrim(p.title),
      p.content_type,
      p.social_network,
      p.scheduled_date,
      p.scheduled_time,
      coalesce(p.caption, ''),
      coalesce(p.internal_notes, ''),
      coalesce(p.client_notes, ''),
      p.status,
      p.assigned_to,
      p.partner_id,
      v_profile_id
    from jsonb_to_recordset(p_posts) as p(
      title text,
      content_type text,
      social_network text,
      scheduled_date date,
      scheduled_time time,
      caption text,
      internal_notes text,
      client_notes text,
      status text,
      assigned_to uuid,
      partner_id uuid
    )
    returning id
  )
  select array_agg(i.id) into v_post_ids from inserted i;

  if v_file_count > 0 then
    insert into public.post_files (
      post_id,
      company_id,
      file_url,
      original_file_url,
      file_name,
      file_type,
      file_size,
      mime_type,
      order_index,
      uploaded_by
    )
    select
      post_id,
      p_company_id,
      f.file_url,
      f.original_file_url,
      f.file_name,
      f.file_type,
      f.file_size,
      f.mime_type,
      f.order_index,
      v_profile_id
    from unnest(v_post_ids) as post_id
    cross join jsonb_to_recordset(p_files) as f(
      file_url text,
      original_file_url text,
      file_name text,
      file_type text,
      file_size bigint,
      mime_type text,
      order_index integer
    );
  end if;

  return query
  select sp.*
  from public.scheduled_posts sp
  where sp.id = any(v_post_ids)
  order by sp.scheduled_date, sp.scheduled_time, sp.created_at;
end;
$$;

grant execute on function private.has_company_access(uuid) to authenticated;
grant execute on function private.can_view_post_item(uuid) to authenticated;
grant execute on function private.can_update_assigned_post(uuid) to authenticated;
grant execute on function private.can_attach_post(uuid) to authenticated;

revoke all on function public.create_scheduled_posts_batch(uuid, jsonb, jsonb) from public;
revoke all on function public.create_scheduled_posts_batch(uuid, jsonb, jsonb) from anon;
grant execute on function public.create_scheduled_posts_batch(uuid, jsonb, jsonb) to authenticated;
