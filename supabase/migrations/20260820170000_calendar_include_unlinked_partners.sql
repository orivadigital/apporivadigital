-- Keep the content calendar partner list aligned with the task form.
-- An active partner can be assigned before a login is linked; RLS grants access
-- only after that partner receives an active partner profile.

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
           where pa.id = p.partner_id
             and pa.status = 'ativo'
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

revoke all on function public.create_scheduled_posts_batch(uuid, jsonb, jsonb) from public;
revoke all on function public.create_scheduled_posts_batch(uuid, jsonb, jsonb) from anon;
grant execute on function public.create_scheduled_posts_batch(uuid, jsonb, jsonb) to authenticated;

