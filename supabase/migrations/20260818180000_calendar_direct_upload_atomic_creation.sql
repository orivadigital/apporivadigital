-- Calendar files are uploaded directly to Storage with short-lived signed URLs.
-- These functions then persist posts and file metadata in one database transaction.

create or replace function private.post_belongs_to_company(
  p_post_id uuid,
  p_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.scheduled_posts sp
    where sp.id = p_post_id
      and sp.company_id = p_company_id
  )
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
    select 1
    from public.companies c
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
      assigned_to uuid
    )
    where nullif(btrim(p.title), '') is null
       or p.scheduled_date is null
       or p.scheduled_time is null
       or p.content_type not in ('post', 'carrossel', 'stories', 'reels', 'video', 'arte', 'campanha', 'outro')
       or p.social_network not in ('instagram', 'tiktok', 'facebook', 'linkedin', 'youtube_shorts', 'outra')
       or p.status not in ('rascunho', 'programado', 'aguardando_aprovacao', 'aprovado', 'revisao_solicitada', 'publicado')
  ) then
    raise exception 'Um ou mais conteúdos possuem dados inválidos.' using errcode = '22023';
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
      assigned_to uuid
    )
    returning id
  )
  select array_agg(i.id) into v_post_ids
  from inserted i;

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

create or replace function public.attach_scheduled_post_files(
  p_post_id uuid,
  p_files jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_company_id uuid;
  v_file_count integer;
begin
  v_profile_id := private.current_profile_id();

  select sp.company_id into v_company_id
  from public.scheduled_posts sp
  where sp.id = p_post_id;

  if v_profile_id is null or v_company_id is null then
    raise exception 'Conteúdo não encontrado.' using errcode = '22023';
  end if;

  if not (
    private.can_manage_content(v_company_id)
    or private.can_attach_post(p_post_id)
  ) then
    raise exception 'Você não tem permissão para anexar arquivos a este conteúdo.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_files) <> 'array' then
    raise exception 'A lista de arquivos é inválida.' using errcode = '22023';
  end if;

  v_file_count := jsonb_array_length(p_files);
  if v_file_count < 1 or v_file_count > 20 then
    raise exception 'Envie entre 1 e 20 arquivos por vez.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_files) as f(
      file_url text,
      original_file_url text,
      file_name text,
      file_type text,
      file_size bigint,
      mime_type text,
      order_index integer
    )
    where nullif(btrim(f.file_name), '') is null
       or f.file_url <> f.original_file_url
       or f.file_url not like ('companies/' || v_company_id::text || '/posts/' || p_post_id::text || '/original/%')
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
    p_post_id,
    v_company_id,
    f.file_url,
    f.original_file_url,
    f.file_name,
    f.file_type,
    f.file_size,
    f.mime_type,
    f.order_index,
    v_profile_id
  from jsonb_to_recordset(p_files) as f(
    file_url text,
    original_file_url text,
    file_name text,
    file_type text,
    file_size bigint,
    mime_type text,
    order_index integer
  );

  return v_file_count;
end;
$$;

revoke all on function public.create_scheduled_posts_batch(uuid, jsonb, jsonb) from public;
revoke all on function public.attach_scheduled_post_files(uuid, jsonb) from public;
grant execute on function private.post_belongs_to_company(uuid, uuid) to authenticated;
grant execute on function public.create_scheduled_posts_batch(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.attach_scheduled_post_files(uuid, jsonb) to authenticated;

drop policy if exists post_files_insert on public.post_files;

create policy post_files_insert
on public.post_files
for insert
to authenticated
with check (
  private.post_belongs_to_company(post_id, company_id)
  and (
    private.can_manage_content(company_id)
    or private.can_attach_post(post_id)
  )
);
