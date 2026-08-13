-- Collaborators and partners can work only on tasks and contents explicitly
-- assigned to their own profile. Administrators keep full agency access.
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
          and (
            exists (
              select 1
              from public.partners pa
              join public.agency_tasks t on t.partner_id = pa.id
              where pa.profile_id = p.id and t.company_id = p_company_id
            )
            or exists (
              select 1 from public.scheduled_posts sp
              where sp.company_id = p_company_id and sp.assigned_to = p.id
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
        or (p.role in ('colaborador', 'parceiro') and sp.assigned_to = p.id)
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
        or (p.role in ('colaborador', 'parceiro') and sp.assigned_to = p.id)
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
          p.role = 'parceiro'
          and exists (
            select 1 from public.partners pa
            where pa.profile_id = p.id and pa.id = t.partner_id
          )
        )
      )
  )
$$;

create or replace function private.can_attach_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_view_task(p_task_id)
    and exists (
      select 1
      from public.profiles p
      where p.auth_user_id = (select auth.uid())
        and p.is_active = true
        and p.role in ('super_admin', 'socio', 'colaborador', 'empresa_cliente', 'parceiro')
    )
$$;

create or replace function private.storage_post_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  parts text[];
begin
  parts := string_to_array(p_name, '/');
  if array_length(parts, 1) < 5 or parts[1] <> 'companies' or parts[3] <> 'posts' then
    return null;
  end if;
  begin
    return parts[4]::uuid;
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
      where (pf.file_url = p_name or pf.original_file_url = p_name)
        and private.can_view_post_item(pf.post_id)
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
    or (
      private.is_super_admin()
      and exists (
        select 1 from public.backup_snapshots bs
        where bs.storage_path = p_name and bs.status = 'concluido'
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
    when p_name like 'backups/%'
      then private.is_super_admin()
    when private.storage_post_id(p_name) is not null
      then private.can_attach_post(private.storage_post_id(p_name))
    when private.storage_task_id(p_name) is not null
      then private.can_attach_task(private.storage_task_id(p_name))
    when private.storage_contract_id(p_name) is not null
      then private.can_manage_agency()
    when private.storage_company_id(p_name) is not null
      then private.can_manage_content(private.storage_company_id(p_name))
    else false
  end
$$;

grant execute on function private.has_company_access(uuid) to authenticated;
grant execute on function private.can_view_post_item(uuid) to authenticated;
grant execute on function private.can_update_assigned_post(uuid) to authenticated;
grant execute on function private.can_attach_post(uuid) to authenticated;
grant execute on function private.can_update_assigned_task(uuid) to authenticated;
grant execute on function private.can_attach_task(uuid) to authenticated;
grant execute on function private.storage_post_id(text) to authenticated;
grant execute on function private.can_view_storage_object(text) to authenticated;
grant execute on function private.can_upload_storage_object(text) to authenticated;

drop policy if exists scheduled_posts_select on public.scheduled_posts;
drop policy if exists scheduled_posts_insert on public.scheduled_posts;
drop policy if exists scheduled_posts_update on public.scheduled_posts;
drop policy if exists scheduled_posts_delete on public.scheduled_posts;

create policy scheduled_posts_select on public.scheduled_posts for select to authenticated
using (private.can_view_post_item(id));
create policy scheduled_posts_insert on public.scheduled_posts for insert to authenticated
with check (private.can_manage_content(company_id));
create policy scheduled_posts_update on public.scheduled_posts for update to authenticated
using (private.can_update_assigned_post(id))
with check (private.can_update_assigned_post(id));
create policy scheduled_posts_delete on public.scheduled_posts for delete to authenticated
using (private.can_manage_content(company_id));

drop policy if exists post_files_select on public.post_files;
drop policy if exists post_files_insert on public.post_files;
drop policy if exists post_files_update on public.post_files;
drop policy if exists post_files_delete on public.post_files;

create policy post_files_select on public.post_files for select to authenticated
using (private.can_view_post_item(post_id));
create policy post_files_insert on public.post_files for insert to authenticated
with check (
  private.can_attach_post(post_id)
  and exists (
    select 1 from public.scheduled_posts sp
    where sp.id = post_id and sp.company_id = company_id
  )
);
create policy post_files_update on public.post_files for update to authenticated
using (private.can_manage_content(company_id))
with check (private.can_manage_content(company_id));
create policy post_files_delete on public.post_files for delete to authenticated
using (
  private.can_manage_agency()
  or (uploaded_by = private.current_profile_id() and private.can_attach_post(post_id))
);

drop policy if exists agency_tasks_update on public.agency_tasks;
create policy agency_tasks_update on public.agency_tasks for update to authenticated
using (private.can_update_assigned_task(id))
with check (private.can_update_assigned_task(id));

drop policy if exists post_comments_select on public.post_comments;
drop policy if exists post_comments_insert on public.post_comments;
create policy post_comments_select on public.post_comments for select to authenticated
using (
  exists (
    select 1 from public.scheduled_posts sp
    where sp.id = post_id
      and sp.company_id = company_id
      and private.can_view_post_item(sp.id)
  )
  and (private.is_agency_user() or comment_type <> 'observacao_interna')
);
create policy post_comments_insert on public.post_comments for insert to authenticated
with check (
  profile_id = private.current_profile_id()
  and exists (
    select 1 from public.scheduled_posts sp
    where sp.id = post_id
      and sp.company_id = company_id
      and private.can_view_post_item(sp.id)
  )
  and (private.is_agency_user() or comment_type in ('comentario', 'solicitacao_alteracao', 'aprovacao'))
);

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
  elsif actor_role = 'parceiro' and exists (
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

drop trigger if exists guard_assigned_task_update on public.agency_tasks;
create trigger guard_assigned_task_update
before update on public.agency_tasks
for each row execute function private.guard_assigned_task_update();

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
  if actor_role not in ('colaborador', 'parceiro') or old.assigned_to is distinct from actor_id then
    raise exception 'Você não pode editar este conteúdo.' using errcode = '42501';
  end if;
  if row(new.id, new.company_id, new.title, new.content_type, new.social_network, new.scheduled_date, new.scheduled_time, new.internal_notes, new.client_notes, new.assigned_to, new.created_by, new.approved_by, new.approved_at, new.client_feedback, new.created_at)
    is distinct from row(old.id, old.company_id, old.title, old.content_type, old.social_network, old.scheduled_date, old.scheduled_time, old.internal_notes, old.client_notes, old.assigned_to, old.created_by, old.approved_by, old.approved_at, old.client_feedback, old.created_at) then
    raise exception 'Colaboradores e parceiros só podem alterar descrição e situação.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_assigned_post_update on public.scheduled_posts;
create trigger guard_assigned_post_update
before update on public.scheduled_posts
for each row execute function private.guard_assigned_post_update();

drop policy if exists oriva_storage_select on storage.objects;
drop policy if exists oriva_storage_insert on storage.objects;
drop policy if exists oriva_storage_update on storage.objects;
drop policy if exists oriva_storage_delete on storage.objects;

create policy oriva_storage_select on storage.objects for select to authenticated
using (bucket_id = 'oriva-files' and private.can_view_storage_object(name));
create policy oriva_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'oriva-files' and private.can_upload_storage_object(name));
create policy oriva_storage_update on storage.objects for update to authenticated
using (
  bucket_id = 'oriva-files'
  and (private.can_manage_agency() or (owner_id = (select auth.uid())::text and private.can_upload_storage_object(name)))
)
with check (
  bucket_id = 'oriva-files'
  and (private.can_manage_agency() or (owner_id = (select auth.uid())::text and private.can_upload_storage_object(name)))
);
create policy oriva_storage_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'oriva-files'
  and (private.can_manage_agency() or (owner_id = (select auth.uid())::text and private.can_upload_storage_object(name)))
);
