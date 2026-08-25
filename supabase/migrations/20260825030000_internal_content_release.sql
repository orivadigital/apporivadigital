-- Separate agency-only production material from the snapshot released to clients.
-- Existing published content remains visible; existing drafts remain internal.

alter table public.scheduled_posts
  add column if not exists client_released_at timestamptz,
  add column if not exists client_released_by uuid references public.profiles(id) on delete set null;

create table if not exists public.post_internal_details (
  post_id uuid primary key references public.scheduled_posts(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  working_caption text not null default '',
  working_client_notes text not null default '',
  internal_references text not null default '',
  internal_notes text not null default '',
  validated_at timestamptz,
  validated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A previous internal-workspace rollout used this table with fewer columns.
-- Add the new snapshot fields in place so those notes remain untouched.
alter table public.post_internal_details
  add column if not exists working_caption text not null default '',
  add column if not exists working_client_notes text not null default '',
  add column if not exists internal_references text not null default '',
  add column if not exists validated_at timestamptz,
  add column if not exists validated_by uuid references public.profiles(id) on delete set null;

alter table public.post_files
  add column if not exists file_scope text not null default 'internal_draft';

alter table public.post_files
  drop constraint if exists post_files_file_scope_check;

alter table public.post_files
  add constraint post_files_file_scope_check
  check (file_scope in ('internal_reference', 'internal_draft', 'client_current', 'client_archived'));

create index if not exists post_internal_details_company_idx
  on public.post_internal_details (company_id, post_id);

create index if not exists post_files_scope_idx
  on public.post_files (post_id, file_scope, order_index);

insert into public.post_internal_details (
  post_id,
  company_id,
  working_caption,
  working_client_notes,
  internal_notes,
  validated_at,
  validated_by,
  created_at,
  updated_at
)
select
  sp.id,
  sp.company_id,
  coalesce(sp.caption, ''),
  coalesce(sp.client_notes, ''),
  coalesce(sp.internal_notes, ''),
  case when sp.status <> 'rascunho' then coalesce(sp.approved_at, sp.updated_at, sp.created_at) end,
  case when sp.status <> 'rascunho' then sp.approved_by end,
  sp.created_at,
  sp.updated_at
from public.scheduled_posts sp
on conflict (post_id) do update
set working_caption = case
      when public.post_internal_details.working_caption = '' then excluded.working_caption
      else public.post_internal_details.working_caption
    end,
    working_client_notes = case
      when public.post_internal_details.working_client_notes = '' then excluded.working_client_notes
      else public.post_internal_details.working_client_notes
    end,
    internal_notes = case
      when public.post_internal_details.internal_notes = '' then excluded.internal_notes
      else public.post_internal_details.internal_notes
    end,
    validated_at = coalesce(public.post_internal_details.validated_at, excluded.validated_at),
    validated_by = coalesce(public.post_internal_details.validated_by, excluded.validated_by);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'post_internal_details'
      and column_name = 'reference_links'
  ) then
    execute $sql$
      update public.post_internal_details
      set internal_references = case
        when internal_references = '' and jsonb_array_length(reference_links) > 0 then reference_links::text
        else internal_references
      end
    $sql$;
  end if;
end;
$$;

update public.scheduled_posts
set client_released_at = coalesce(client_released_at, approved_at, updated_at, created_at),
    client_released_by = coalesce(client_released_by, approved_by)
where status <> 'rascunho'
  and client_released_at is null;

update public.scheduled_posts
set caption = '',
    client_notes = '',
    internal_notes = ''
where client_released_at is null;

update public.scheduled_posts
set internal_notes = ''
where internal_notes <> '';

update public.post_files pf
set file_scope = case
  when sp.client_released_at is not null then 'client_current'
  else 'internal_draft'
end
from public.scheduled_posts sp
where sp.id = pf.post_id
  and pf.file_scope = 'internal_draft';

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'post_files' and column_name = 'asset_kind'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'post_files' and column_name = 'client_visible'
  ) then
    execute $sql$
      update public.post_files
      set file_scope = case
        when asset_kind = 'referencia' then 'internal_reference'
        when client_visible then 'client_current'
        else 'internal_draft'
      end
    $sql$;
  end if;
end;
$$;

drop trigger if exists post_internal_details_set_updated_at on public.post_internal_details;
create trigger post_internal_details_set_updated_at
before update on public.post_internal_details
for each row execute function private.set_updated_at();

alter table public.post_internal_details enable row level security;

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
            select 1
            from public.partners pa
            where pa.profile_id = p.id
              and pa.id = sp.partner_id
          )
        )
        or (
          p.role = 'empresa_cliente'
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

create or replace function private.can_view_post_internal(p_post_id uuid)
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
            select 1
            from public.partners pa
            where pa.profile_id = p.id
              and pa.id = sp.partner_id
          )
        )
      )
  )
$$;

create or replace function private.can_view_post_file(p_post_id uuid, p_file_scope text)
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
            select 1
            from public.partners pa
            where pa.profile_id = p.id
              and pa.id = sp.partner_id
          )
        )
        or (
          p.role = 'empresa_cliente'
          and p_file_scope = 'client_current'
          and sp.client_released_at is not null
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

drop policy if exists post_internal_details_select on public.post_internal_details;
drop policy if exists post_internal_details_insert on public.post_internal_details;
drop policy if exists post_internal_details_update on public.post_internal_details;
drop policy if exists post_internal_details_delete on public.post_internal_details;

create policy post_internal_details_select
on public.post_internal_details for select to authenticated
using (private.can_view_post_internal(post_id));

create policy post_internal_details_insert
on public.post_internal_details for insert to authenticated
with check (private.can_manage_content(company_id));

create policy post_internal_details_update
on public.post_internal_details for update to authenticated
using (private.can_manage_content(company_id) or private.can_update_assigned_post(post_id))
with check (private.can_manage_content(company_id) or private.can_update_assigned_post(post_id));

create policy post_internal_details_delete
on public.post_internal_details for delete to authenticated
using (private.can_manage_content(company_id));

drop policy if exists post_files_select on public.post_files;
create policy post_files_select
on public.post_files for select to authenticated
using (private.can_view_post_file(post_id, file_scope));

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
      where (pf.file_url = p_name or pf.original_file_url = p_name)
        and private.can_view_post_file(pf.post_id, pf.file_scope)
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
        select 1
        from public.contract_files cf
        where cf.file_url = p_name or cf.original_file_url = p_name
      )
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

  if row(
    new.id, new.company_id, new.title, new.content_type, new.social_network,
    new.scheduled_date, new.scheduled_time, new.caption, new.internal_notes,
    new.client_notes, new.assigned_to, new.partner_id, new.created_by,
    new.approved_by, new.approved_at, new.client_feedback,
    new.client_released_at, new.client_released_by, new.created_at
  ) is distinct from row(
    old.id, old.company_id, old.title, old.content_type, old.social_network,
    old.scheduled_date, old.scheduled_time, old.caption, old.internal_notes,
    old.client_notes, old.assigned_to, old.partner_id, old.created_by,
    old.approved_by, old.approved_at, old.client_feedback,
    old.client_released_at, old.client_released_by, old.created_at
  ) then
    raise exception 'Colaboradores e parceiros só podem alterar a situação do conteúdo.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function private.guard_assigned_post_internal_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
begin
  if (select auth.uid()) is null then return new; end if;

  select p.role into actor_role
  from public.profiles p
  where p.auth_user_id = (select auth.uid()) and p.is_active = true;

  if actor_role in ('super_admin', 'socio') then return new; end if;
  if not private.can_update_assigned_post(old.post_id) then
    raise exception 'Você não pode editar as informações internas deste conteúdo.' using errcode = '42501';
  end if;

  if new.validated_at is not null
    or new.validated_by is not null
    or row(new.post_id, new.company_id, new.created_at)
      is distinct from row(old.post_id, old.company_id, old.created_at) then
    raise exception 'A validação e a liberação são restritas aos sócios.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_assigned_post_internal_update on public.post_internal_details;
create trigger guard_assigned_post_internal_update
before update on public.post_internal_details
for each row execute function private.guard_assigned_post_internal_update();

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
  v_post_ids uuid[] := '{}'::uuid[];
  v_post_id uuid;
  v_post jsonb;
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
      working_caption text,
      internal_references text,
      internal_notes text,
      working_client_notes text,
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
           select 1 from public.partners pa
           where pa.id = p.partner_id and pa.status = 'ativo'
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
      order_index integer,
      file_scope text
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
       or coalesce(f.file_scope, 'internal_draft') not in ('internal_reference', 'internal_draft')
       or not (
         coalesce(f.mime_type, '') like 'image/%'
         or coalesce(f.mime_type, '') like 'video/%'
         or f.mime_type = 'application/pdf'
       )
  ) then
    raise exception 'Um ou mais arquivos enviados são inválidos.' using errcode = '22023';
  end if;

  for v_post in select value from jsonb_array_elements(p_posts)
  loop
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
    ) values (
      p_company_id,
      btrim(v_post->>'title'),
      v_post->>'content_type',
      v_post->>'social_network',
      (v_post->>'scheduled_date')::date,
      (v_post->>'scheduled_time')::time,
      '',
      '',
      '',
      v_post->>'status',
      nullif(v_post->>'assigned_to', '')::uuid,
      nullif(v_post->>'partner_id', '')::uuid,
      v_profile_id
    ) returning id into v_post_id;

    insert into public.post_internal_details (
      post_id,
      company_id,
      working_caption,
      working_client_notes,
      internal_references,
      internal_notes
    ) values (
      v_post_id,
      p_company_id,
      coalesce(v_post->>'working_caption', ''),
      coalesce(v_post->>'working_client_notes', ''),
      coalesce(v_post->>'internal_references', ''),
      coalesce(v_post->>'internal_notes', '')
    );

    v_post_ids := array_append(v_post_ids, v_post_id);
  end loop;

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
      uploaded_by,
      file_scope
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
      v_profile_id,
      coalesce(f.file_scope, 'internal_draft')
    from unnest(v_post_ids) as post_id
    cross join jsonb_to_recordset(p_files) as f(
      file_url text,
      original_file_url text,
      file_name text,
      file_type text,
      file_size bigint,
      mime_type text,
      order_index integer,
      file_scope text
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

  if not (private.can_manage_content(v_company_id) or private.can_attach_post(p_post_id)) then
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
      order_index integer,
      file_scope text
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
       or coalesce(f.file_scope, 'internal_draft') not in ('internal_reference', 'internal_draft')
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
    uploaded_by,
    file_scope
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
    v_profile_id,
    coalesce(f.file_scope, 'internal_draft')
  from jsonb_to_recordset(p_files) as f(
    file_url text,
    original_file_url text,
    file_name text,
    file_type text,
    file_size bigint,
    mime_type text,
    order_index integer,
    file_scope text
  );

  update public.post_internal_details
  set validated_at = null,
      validated_by = null
  where post_id = p_post_id;

  return v_file_count;
end;
$$;

create or replace function public.validate_scheduled_post_internal(p_post_id uuid)
returns public.scheduled_posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_company_id uuid;
begin
  v_profile_id := private.current_profile_id();
  select sp.company_id into v_company_id
  from public.scheduled_posts sp
  where sp.id = p_post_id;

  if v_profile_id is null or v_company_id is null or not private.can_manage_content(v_company_id) then
    raise exception 'Somente os sócios podem validar este conteúdo.' using errcode = '42501';
  end if;

  update public.post_internal_details
  set validated_at = now(),
      validated_by = v_profile_id
  where post_id = p_post_id;

  if not found then
    raise exception 'As informações internas deste conteúdo não foram encontradas.' using errcode = '22023';
  end if;

  insert into public.audit_logs (profile_id, company_id, action, entity_type, entity_id, metadata)
  values (v_profile_id, v_company_id, 'validacao_interna', 'scheduled_post', p_post_id::text, '{}'::jsonb);

  return (select sp from public.scheduled_posts sp where sp.id = p_post_id);
end;
$$;

create or replace function public.release_scheduled_post_to_client(p_post_id uuid)
returns public.scheduled_posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_company_id uuid;
  v_validated_at timestamptz;
  v_working_caption text;
  v_working_client_notes text;
  v_has_new_drafts boolean;
begin
  v_profile_id := private.current_profile_id();

  select sp.company_id, details.validated_at, details.working_caption, details.working_client_notes
  into v_company_id, v_validated_at, v_working_caption, v_working_client_notes
  from public.scheduled_posts sp
  join public.post_internal_details details on details.post_id = sp.id
  where sp.id = p_post_id;

  if v_profile_id is null or v_company_id is null or not private.can_manage_content(v_company_id) then
    raise exception 'Somente os sócios podem liberar este conteúdo para o cliente.' using errcode = '42501';
  end if;

  if v_validated_at is null then
    raise exception 'Faça a validação interna antes de liberar para o cliente.' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.post_files pf
    where pf.post_id = p_post_id and pf.file_scope = 'internal_draft'
  ) into v_has_new_drafts;

  if not v_has_new_drafts and not exists (
    select 1 from public.post_files pf
    where pf.post_id = p_post_id and pf.file_scope = 'client_current'
  ) then
    raise exception 'Anexe a arte em rascunho antes de liberar para o cliente.' using errcode = '22023';
  end if;

  if v_has_new_drafts then
    update public.post_files
    set file_scope = 'client_archived'
    where post_id = p_post_id and file_scope = 'client_current';

    update public.post_files
    set file_scope = 'client_current'
    where post_id = p_post_id and file_scope = 'internal_draft';
  end if;

  update public.scheduled_posts
  set caption = coalesce(v_working_caption, ''),
      client_notes = coalesce(v_working_client_notes, ''),
      status = 'aguardando_aprovacao',
      client_released_at = now(),
      client_released_by = v_profile_id,
      approved_by = null,
      approved_at = null,
      client_feedback = ''
  where id = p_post_id;

  insert into public.audit_logs (profile_id, company_id, action, entity_type, entity_id, metadata)
  values (
    v_profile_id,
    v_company_id,
    'liberado_para_cliente',
    'scheduled_post',
    p_post_id::text,
    jsonb_build_object('novos_arquivos', v_has_new_drafts)
  );

  return (select sp from public.scheduled_posts sp where sp.id = p_post_id);
end;
$$;

revoke all on table public.post_internal_details from anon;
grant select, insert, update, delete on table public.post_internal_details to authenticated;

grant execute on function private.can_view_post_item(uuid) to authenticated;
grant execute on function private.can_view_post_internal(uuid) to authenticated;
grant execute on function private.can_view_post_file(uuid, text) to authenticated;
grant execute on function private.can_view_storage_object(text) to authenticated;

revoke all on function public.create_scheduled_posts_batch(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.attach_scheduled_post_files(uuid, jsonb) from public, anon;
revoke all on function public.validate_scheduled_post_internal(uuid) from public, anon;
revoke all on function public.release_scheduled_post_to_client(uuid) from public, anon;

grant execute on function public.create_scheduled_posts_batch(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.attach_scheduled_post_files(uuid, jsonb) to authenticated;
grant execute on function public.validate_scheduled_post_internal(uuid) to authenticated;
grant execute on function public.release_scheduled_post_to_client(uuid) to authenticated;

create or replace function public.restore_backup_snapshot(
  p_snapshot_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
  v_rows jsonb;
  v_inserted integer := 0;
  v_total integer := 0;
begin
  v_result := private.restore_backup_snapshot_data(p_snapshot_id, p_payload);
  v_rows := coalesce(p_payload -> 'post_internal_details', '[]'::jsonb);

  if jsonb_typeof(v_rows) is distinct from 'array' then
    raise exception 'A seção post_internal_details do backup é inválida.' using errcode = '22023';
  end if;

  if jsonb_array_length(v_rows) > 0 then
    insert into public.post_internal_details
    select * from jsonb_populate_recordset(null::public.post_internal_details, v_rows)
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
  end if;

  v_total := coalesce((v_result ->> 'recordsRestored')::integer, 0) + v_inserted;
  v_result := jsonb_set(v_result, '{recordsRestored}', to_jsonb(v_total), true);
  v_result := jsonb_set(v_result, '{tables,post_internal_details}', to_jsonb(v_inserted), true);
  return v_result;
end;
$$;

revoke all on function public.restore_backup_snapshot(uuid, jsonb) from public, anon;
grant execute on function public.restore_backup_snapshot(uuid, jsonb) to authenticated;

drop policy if exists post_comments_select on public.post_comments;
drop policy if exists post_comments_insert on public.post_comments;

create policy post_comments_select
on public.post_comments for select to authenticated
using (
  exists (
    select 1 from public.scheduled_posts sp
    where sp.id = post_id
      and sp.company_id = company_id
      and (
        private.can_view_post_internal(sp.id)
        or (
          sp.client_released_at is not null
          and comment_type <> 'observacao_interna'
          and private.can_view_post_item(sp.id)
        )
      )
  )
);

create policy post_comments_insert
on public.post_comments for insert to authenticated
with check (
  profile_id = private.current_profile_id()
  and exists (
    select 1 from public.scheduled_posts sp
    where sp.id = post_id
      and sp.company_id = company_id
      and (
        private.can_view_post_internal(sp.id)
        or (
          sp.client_released_at is not null
          and comment_type in ('comentario', 'solicitacao_alteracao', 'aprovacao')
          and private.can_view_post_item(sp.id)
        )
      )
  )
);

drop trigger if exists post_internal_details_audit on public.post_internal_details;
create trigger post_internal_details_audit
after insert or update or delete on public.post_internal_details
for each row execute function private.audit_row_change();
