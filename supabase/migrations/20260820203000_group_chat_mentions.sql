-- Group chats with individual membership, automatic partner mentions and per-user reading.
alter table public.profiles
  add column if not exists chat_default_recipient boolean not null default false;

update public.profiles
set chat_default_recipient = true
where role = 'socio'
  and upper(btrim(name)) in ('LUCAS GODOY', 'LUCIANO ARSENIO', 'ALEXANDRE TEIXEIRA');

comment on column public.profiles.chat_default_recipient is
  'Active agency partner automatically mentioned when any chat is created.';

alter table public.chat_conversations
  add column if not exists is_group boolean not null default false;

alter table public.chat_conversations
  drop constraint if exists chat_conversations_participant_role_check;
alter table public.chat_conversations
  add constraint chat_conversations_participant_role_check
  check (participant_role in ('super_admin', 'socio', 'empresa_cliente', 'colaborador', 'parceiro'));

create table if not exists public.chat_conversation_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 160),
  member_role text not null
    check (member_role in ('super_admin', 'socio', 'empresa_cliente', 'colaborador', 'parceiro')),
  is_default_recipient boolean not null default false,
  added_by uuid references public.profiles(id) on delete set null,
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);

create index if not exists chat_members_profile_recent_idx
  on public.chat_conversation_members (profile_id, joined_at desc);
create index if not exists chat_members_conversation_role_idx
  on public.chat_conversation_members (conversation_id, member_role);

alter table public.chat_conversation_members enable row level security;

create or replace function private.normalize_chat_conversation_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_role text;
  v_default boolean;
begin
  if tg_op = 'UPDATE' then
    if row(new.conversation_id, new.profile_id, new.display_name, new.member_role,
           new.is_default_recipient, new.added_by, new.joined_at)
       is distinct from
       row(old.conversation_id, old.profile_id, old.display_name, old.member_role,
           old.is_default_recipient, old.added_by, old.joined_at) then
      raise exception 'Somente a leitura do participante pode ser atualizada.' using errcode = '42501';
    end if;
    return new;
  end if;

  select p.name, p.role, p.chat_default_recipient
  into v_name, v_role, v_default
  from public.profiles p
  where p.id = new.profile_id and p.is_active = true;

  if v_name is null then
    raise exception 'O participante selecionado não possui acesso ativo.' using errcode = '22023';
  end if;

  new.display_name := v_name;
  new.member_role := v_role;
  new.is_default_recipient := coalesce(v_default, false);
  new.added_by := coalesce(new.added_by, private.current_profile_id(), new.profile_id);
  new.joined_at := coalesce(new.joined_at, now());
  return new;
end;
$$;

drop trigger if exists normalize_chat_conversation_member on public.chat_conversation_members;
create trigger normalize_chat_conversation_member
before insert or update on public.chat_conversation_members
for each row execute function private.normalize_chat_conversation_member();

insert into public.chat_conversation_members (
  conversation_id, profile_id, display_name, member_role,
  is_default_recipient, added_by, last_read_at, joined_at
)
select distinct
  c.id,
  p.id,
  p.name,
  p.role,
  p.chat_default_recipient,
  c.created_by,
  case
    when p.id = c.participant_profile_id then c.participant_last_read_at
    when p.id = c.created_by then c.agency_last_read_at
    else null
  end,
  c.created_at
from public.chat_conversations c
join public.profiles p
  on p.is_active = true
 and (
   p.id = c.participant_profile_id
   or p.id = c.created_by
   or p.chat_default_recipient = true
 )
on conflict (conversation_id, profile_id) do nothing;

update public.chat_conversations c
set is_group = (
  select count(*) > 2
  from public.chat_conversation_members cm
  where cm.conversation_id = c.id
);

create or replace function private.can_access_chat_conversation(p_conversation_id uuid)
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
        or exists (
          select 1
          from public.chat_conversation_members cm
          where cm.conversation_id = p_conversation_id
            and cm.profile_id = p.id
        )
      )
  )
$$;

drop policy if exists chat_conversation_members_select on public.chat_conversation_members;
drop policy if exists chat_conversation_members_insert on public.chat_conversation_members;
drop policy if exists chat_conversation_members_update on public.chat_conversation_members;

create policy chat_conversation_members_select on public.chat_conversation_members
for select to authenticated
using (private.can_access_chat_conversation(conversation_id));

create policy chat_conversation_members_insert on public.chat_conversation_members
for insert to authenticated
with check (
  profile_id = private.current_profile_id()
  and private.can_access_chat_conversation(conversation_id)
);

create policy chat_conversation_members_update on public.chat_conversation_members
for update to authenticated
using (
  profile_id = private.current_profile_id()
  and private.can_access_chat_conversation(conversation_id)
)
with check (
  profile_id = private.current_profile_id()
  and private.can_access_chat_conversation(conversation_id)
);

create or replace function private.guard_chat_conversation_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
begin
  if pg_trigger_depth() > 1 then return new; end if;

  select p.role into actor_role
  from public.profiles p
  where p.auth_user_id = (select auth.uid()) and p.is_active = true;

  if actor_role in ('super_admin', 'socio') then
    if row(new.id, new.participant_profile_id, new.company_id, new.related_task_id,
           new.subject, new.conversation_type, new.participant_role, new.created_by,
           new.participant_last_read_at, new.last_message_at, new.created_at, new.is_group)
       is distinct from
       row(old.id, old.participant_profile_id, old.company_id, old.related_task_id,
           old.subject, old.conversation_type, old.participant_role, old.created_by,
           old.participant_last_read_at, old.last_message_at, old.created_at, old.is_group) then
      raise exception 'Somente a situação e a leitura da conversa podem ser alteradas.' using errcode = '42501';
    end if;
    return new;
  end if;

  if not private.can_access_chat_conversation(new.id) then
    raise exception 'Você não pode editar esta conversa.' using errcode = '42501';
  end if;

  if row(new.id, new.participant_profile_id, new.company_id, new.related_task_id,
         new.subject, new.conversation_type, new.participant_role, new.status,
         new.created_by, new.agency_last_read_at, new.last_message_at, new.created_at, new.is_group)
     is distinct from
     row(old.id, old.participant_profile_id, old.company_id, old.related_task_id,
         old.subject, old.conversation_type, old.participant_role, old.status,
         old.created_by, old.agency_last_read_at, old.last_message_at, old.created_at, old.is_group) then
    raise exception 'Você só pode marcar a conversa como lida.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function private.touch_chat_conversation_from_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sender_role text;
  sender_name text;
  sender_default boolean;
begin
  select p.role, p.name, p.chat_default_recipient
  into sender_role, sender_name, sender_default
  from public.profiles p
  where p.id = new.sender_profile_id and p.is_active = true;

  insert into public.chat_conversation_members (
    conversation_id, profile_id, display_name, member_role,
    is_default_recipient, added_by, last_read_at
  ) values (
    new.conversation_id, new.sender_profile_id, sender_name, sender_role,
    coalesce(sender_default, false), new.sender_profile_id, new.created_at
  )
  on conflict (conversation_id, profile_id)
  do update set last_read_at = excluded.last_read_at;

  update public.chat_conversations
  set last_message_at = new.created_at,
      updated_at = new.created_at,
      agency_last_read_at = case when sender_role in ('super_admin', 'socio') then new.created_at else agency_last_read_at end,
      participant_last_read_at = case when sender_role not in ('super_admin', 'socio') then new.created_at else participant_last_read_at end
  where id = new.conversation_id;
  return new;
end;
$$;

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
security definer
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
  v_is_group boolean := false;
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
  where p.is_active = true
    and (
      p.id = v_actor_id
      or p.id = any(v_selected_ids)
      or p.chat_default_recipient = true
    )
  on conflict (conversation_id, profile_id) do nothing;

  select count(*) > 2 into v_is_group
  from public.chat_conversation_members cm
  where cm.conversation_id = v_conversation_id;

  update public.chat_conversations
  set is_group = v_is_group
  where id = v_conversation_id;

  insert into public.chat_messages (conversation_id, sender_profile_id, body)
  values (v_conversation_id, v_actor_id, btrim(p_message));

  return jsonb_build_object('conversation_id', v_conversation_id);
end;
$$;

create or replace function public.mark_chat_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_actor_name text;
  v_actor_role text;
  v_actor_default boolean;
begin
  select p.id, p.name, p.role, p.chat_default_recipient
  into v_actor_id, v_actor_name, v_actor_role, v_actor_default
  from public.profiles p
  where p.auth_user_id = (select auth.uid()) and p.is_active = true;

  if v_actor_id is null or not private.can_access_chat_conversation(p_conversation_id) then
    raise exception 'Conversa não encontrada ou sem permissão de acesso.' using errcode = '42501';
  end if;

  insert into public.chat_conversation_members (
    conversation_id, profile_id, display_name, member_role,
    is_default_recipient, added_by, last_read_at
  ) values (
    p_conversation_id, v_actor_id, v_actor_name, v_actor_role,
    coalesce(v_actor_default, false), v_actor_id, now()
  )
  on conflict (conversation_id, profile_id)
  do update set last_read_at = excluded.last_read_at;
end;
$$;

drop policy if exists chat_conversations_insert on public.chat_conversations;

revoke insert on public.chat_conversations from authenticated;
revoke all on public.chat_conversation_members from anon, authenticated;
grant select, insert, update on public.chat_conversation_members to authenticated;

revoke all on function public.create_chat_group(uuid[], uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_chat_group(uuid[], uuid, uuid, text, text, text) to authenticated;
revoke all on function public.mark_chat_conversation_read(uuid) from public, anon, authenticated;
grant execute on function public.mark_chat_conversation_read(uuid) to authenticated;
revoke execute on function private.can_create_chat_conversation(uuid, uuid, uuid, text) from authenticated;

comment on table public.chat_conversation_members is
  'Authorized members of each private or group conversation with individual reading state.';
comment on function public.create_chat_group(uuid[], uuid, uuid, text, text, text) is
  'Atomically creates a protected group chat, mentions default agency partners and writes the first message.';

-- Include group membership in complete backup restoration without duplicating the restore routine.
do $migration$
declare
  v_definition text;
  v_updated_definition text;
begin
  select pg_get_functiondef('private.restore_backup_snapshot_data(uuid,jsonb)'::regprocedure)
  into v_definition;

  v_updated_definition := replace(
    v_definition,
    E'''chat_conversations'',\n    ''chat_messages''',
    E'''chat_conversations'',\n    ''chat_conversation_members'',\n    ''chat_messages'''
  );

  if v_updated_definition = v_definition then
    raise exception 'Não foi possível incluir os participantes do chat na restauração de backup.';
  end if;

  execute v_updated_definition;
end;
$migration$;

notify pgrst, 'reload schema';
