-- Keep group creation atomic while letting RLS remain the final authorization layer.
create index if not exists chat_members_added_by_idx
  on public.chat_conversation_members (added_by)
  where added_by is not null;

create or replace function private.can_create_chat_conversation(
  p_participant_profile_id uuid,
  p_company_id uuid,
  p_related_task_id uuid,
  p_participant_role text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  actor_role text;
  target_role text;
begin
  select p.id, p.role into actor_id, actor_role
  from public.profiles p
  where p.auth_user_id = (select auth.uid()) and p.is_active = true;

  select p.role into target_role
  from public.profiles p
  where p.id = p_participant_profile_id
    and p.is_active = true
    and p.role in ('super_admin', 'socio', 'empresa_cliente', 'colaborador', 'parceiro');

  if actor_id is null or target_role is null or target_role <> p_participant_role then
    return false;
  end if;

  if actor_role in ('super_admin', 'socio') then
    return true;
  end if;

  if actor_id <> p_participant_profile_id or actor_role <> target_role then
    return false;
  end if;

  if actor_role = 'empresa_cliente' and (
    p_company_id is null or not exists (
      select 1 from public.company_users cu
      join public.companies c on c.id = cu.company_id
      where cu.profile_id = actor_id
        and cu.company_id = p_company_id
        and c.status <> 'bloqueado'
    )
  ) then
    return false;
  end if;

  if actor_role in ('colaborador', 'parceiro')
     and p_company_id is not null
     and not private.has_company_access(p_company_id) then
    return false;
  end if;

  if p_related_task_id is not null and not private.can_view_task(p_related_task_id) then
    return false;
  end if;

  if p_related_task_id is not null and p_company_id is not null and not exists (
    select 1 from public.agency_tasks t
    where t.id = p_related_task_id and t.company_id = p_company_id
  ) then
    return false;
  end if;

  return true;
end;
$$;

create or replace function private.populate_chat_conversation_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.chat_conversation_members (
    conversation_id, profile_id, display_name, member_role,
    is_default_recipient, added_by, last_read_at, joined_at
  )
  select
    new.id,
    p.id,
    p.name,
    p.role,
    p.chat_default_recipient,
    new.created_by,
    case when p.id = new.created_by then now() else null end,
    new.created_at
  from public.profiles p
  where p.is_active = true
    and (
      p.id = new.created_by
      or p.id = new.participant_profile_id
      or p.chat_default_recipient = true
    )
  on conflict (conversation_id, profile_id) do nothing;

  update public.chat_conversations c
  set is_group = (
    select count(*) > 2
    from public.chat_conversation_members cm
    where cm.conversation_id = new.id
  )
  where c.id = new.id;

  return new;
end;
$$;

drop trigger if exists populate_chat_conversation_members on public.chat_conversations;
create trigger populate_chat_conversation_members
after insert on public.chat_conversations
for each row execute function private.populate_chat_conversation_members();

drop policy if exists chat_conversations_insert on public.chat_conversations;
create policy chat_conversations_insert on public.chat_conversations
for insert to authenticated
with check (
  created_by = private.current_profile_id()
  and status = 'aberta'
  and private.can_create_chat_conversation(
    participant_profile_id, company_id, related_task_id, participant_role
  )
);

drop policy if exists chat_conversation_members_insert on public.chat_conversation_members;
create policy chat_conversation_members_insert on public.chat_conversation_members
for insert to authenticated
with check (
  (profile_id = private.current_profile_id() or private.is_agency_user())
  and private.can_access_chat_conversation(conversation_id)
);

grant insert on public.chat_conversations to authenticated;
grant execute on function private.can_create_chat_conversation(uuid, uuid, uuid, text) to authenticated;

create or replace function public.create_chat_group(
  p_participant_profile_ids uuid[],
  p_company_id uuid,
  p_related_task_id uuid,
  p_subject text,
  p_conversation_type text,
  p_message text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_selected_ids uuid[] := array[]::uuid[];
  v_invalid_count integer := 0;
  v_client_count integer := 0;
  v_delivery_team_count integer := 0;
  v_primary_id uuid;
  v_primary_role text;
  v_company_id uuid := p_company_id;
  v_task_company_id uuid;
  v_conversation_id uuid;
begin
  select p.id, p.role
  into v_actor_id, v_actor_role
  from public.profiles p
  where p.auth_user_id = (select auth.uid()) and p.is_active = true;

  if v_actor_id is null or v_actor_role not in ('super_admin', 'socio', 'empresa_cliente', 'colaborador', 'parceiro') then
    raise exception 'Seu perfil não possui acesso ao bate-papo.' using errcode = '42501';
  end if;

  if char_length(btrim(coalesce(p_subject, ''))) not between 2 and 160 then
    raise exception 'Informe um assunto entre 2 e 160 caracteres.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_message, ''))) not between 1 and 5000 then
    raise exception 'Escreva uma mensagem de até 5.000 caracteres.' using errcode = '22023';
  end if;
  if p_conversation_type not in ('mensagem', 'duvida_demanda', 'nova_demanda') then
    raise exception 'Selecione um tipo de conversa válido.' using errcode = '22023';
  end if;
  if p_conversation_type = 'nova_demanda'
     and v_actor_role not in ('super_admin', 'socio', 'empresa_cliente') then
    raise exception 'A solicitação de nova demanda está disponível para clientes e sócios.' using errcode = '42501';
  end if;

  select coalesce(array_agg(profile_id order by first_position), array[]::uuid[])
  into v_selected_ids
  from (
    select input.profile_id, min(input.position) as first_position
    from unnest(coalesce(p_participant_profile_ids, array[]::uuid[]))
      with ordinality as input(profile_id, position)
    where input.profile_id is not null and input.profile_id <> v_actor_id
    group by input.profile_id
  ) selected;

  if v_actor_role not in ('super_admin', 'socio') and cardinality(v_selected_ids) > 0 then
    raise exception 'Clientes, colaboradores e parceiros não podem adicionar outros participantes.' using errcode = '42501';
  end if;

  select count(*)
  into v_invalid_count
  from unnest(v_selected_ids) as selected(profile_id)
  left join public.profiles p
    on p.id = selected.profile_id
   and p.is_active = true
   and p.role in ('super_admin', 'socio', 'empresa_cliente', 'colaborador', 'parceiro')
  where p.id is null;

  if v_invalid_count > 0 then
    raise exception 'Uma das pessoas selecionadas não possui acesso ativo.' using errcode = '22023';
  end if;

  select
    count(*) filter (where p.role = 'empresa_cliente'),
    count(*) filter (where p.role in ('colaborador', 'parceiro'))
  into v_client_count, v_delivery_team_count
  from public.profiles p
  where p.id = any(v_selected_ids);

  if v_client_count > 1 or (v_client_count > 0 and v_delivery_team_count > 0) then
    raise exception 'Clientes não podem participar de grupos com outros clientes, colaboradores ou parceiros.' using errcode = '22023';
  end if;

  if v_actor_role = 'empresa_cliente' then
    if v_company_id is null or not exists (
      select 1
      from public.company_users cu
      join public.companies c on c.id = cu.company_id
      where cu.profile_id = v_actor_id
        and cu.company_id = v_company_id
        and c.status <> 'bloqueado'
    ) then
      raise exception 'Sua conta não está vinculada a uma empresa ativa.' using errcode = '42501';
    end if;
  elsif v_actor_role in ('colaborador', 'parceiro')
        and v_company_id is not null
        and not private.has_company_access(v_company_id) then
    raise exception 'Você não possui acesso a esta empresa.' using errcode = '42501';
  elsif v_actor_role in ('super_admin', 'socio')
        and v_company_id is not null
        and not exists (
          select 1 from public.companies c
          where c.id = v_company_id and c.status <> 'bloqueado'
        ) then
    raise exception 'Selecione uma empresa ativa.' using errcode = '22023';
  end if;

  if p_related_task_id is not null then
    if not private.can_view_task(p_related_task_id) then
      raise exception 'Você não possui acesso à demanda selecionada.' using errcode = '42501';
    end if;
    select t.company_id into v_task_company_id
    from public.agency_tasks t
    where t.id = p_related_task_id;
    if v_company_id is null then
      v_company_id := v_task_company_id;
    elsif v_task_company_id is distinct from v_company_id then
      raise exception 'A demanda selecionada não pertence à empresa informada.' using errcode = '22023';
    end if;
  end if;

  if cardinality(v_selected_ids) > 0 then
    v_primary_id := v_selected_ids[1];
  else
    v_primary_id := v_actor_id;
  end if;
  select p.role into v_primary_role from public.profiles p where p.id = v_primary_id;

  insert into public.chat_conversations (
    participant_profile_id, company_id, related_task_id, subject,
    conversation_type, participant_role, status, created_by, is_group
  ) values (
    v_primary_id, v_company_id, p_related_task_id, btrim(p_subject),
    p_conversation_type, v_primary_role, 'aberta', v_actor_id, false
  ) returning id into v_conversation_id;

  insert into public.chat_conversation_members (
    conversation_id, profile_id, display_name, member_role,
    is_default_recipient, added_by, last_read_at
  )
  select
    v_conversation_id,
    p.id,
    p.name,
    p.role,
    p.chat_default_recipient,
    v_actor_id,
    case when p.id = v_actor_id then now() else null end
  from public.profiles p
  where p.is_active = true and p.id = any(v_selected_ids)
  on conflict (conversation_id, profile_id) do nothing;

  insert into public.chat_messages (conversation_id, sender_profile_id, body)
  values (v_conversation_id, v_actor_id, btrim(p_message));

  return jsonb_build_object('conversation_id', v_conversation_id);
end;
$$;

revoke all on function public.create_chat_group(uuid[], uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_chat_group(uuid[], uuid, uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
