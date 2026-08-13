-- Private conversations between the Oriva agency and exactly one external participant.
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  participant_profile_id uuid not null references public.profiles(id) on delete restrict,
  company_id uuid references public.companies(id) on delete set null,
  related_task_id uuid references public.agency_tasks(id) on delete set null,
  subject text not null check (char_length(btrim(subject)) between 2 and 160),
  conversation_type text not null default 'mensagem'
    check (conversation_type in ('mensagem', 'duvida_demanda', 'nova_demanda')),
  participant_role text not null
    check (participant_role in ('empresa_cliente', 'colaborador', 'parceiro')),
  status text not null default 'aberta' check (status in ('aberta', 'arquivada')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  agency_last_read_at timestamptz,
  participant_last_read_at timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_profile_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index if not exists chat_conversations_participant_recent_idx
  on public.chat_conversations (participant_profile_id, last_message_at desc);
create index if not exists chat_conversations_status_recent_idx
  on public.chat_conversations (status, last_message_at desc);
create index if not exists chat_conversations_company_idx
  on public.chat_conversations (company_id) where company_id is not null;
create index if not exists chat_conversations_related_task_idx
  on public.chat_conversations (related_task_id) where related_task_id is not null;
create index if not exists chat_conversations_created_by_idx
  on public.chat_conversations (created_by);
create index if not exists chat_messages_conversation_created_idx
  on public.chat_messages (conversation_id, created_at, id);
create index if not exists chat_messages_sender_idx
  on public.chat_messages (sender_profile_id);

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;

create or replace function private.can_access_chat_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_conversations c
    join public.profiles p
      on p.auth_user_id = (select auth.uid())
     and p.is_active = true
    where c.id = p_conversation_id
      and (p.role in ('super_admin', 'socio') or c.participant_profile_id = p.id)
  )
$$;

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
    and p.role in ('empresa_cliente', 'colaborador', 'parceiro');

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

create or replace function private.guard_chat_conversation_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
begin
  -- The message trigger updates read and activity timestamps in a nested call.
  if pg_trigger_depth() > 1 then return new; end if;

  select p.role into actor_role
  from public.profiles p
  where p.auth_user_id = (select auth.uid()) and p.is_active = true;

  if actor_role in ('super_admin', 'socio') then
    if row(new.id, new.participant_profile_id, new.company_id, new.related_task_id,
           new.subject, new.conversation_type, new.participant_role, new.created_by,
           new.participant_last_read_at, new.last_message_at, new.created_at)
       is distinct from
       row(old.id, old.participant_profile_id, old.company_id, old.related_task_id,
           old.subject, old.conversation_type, old.participant_role, old.created_by,
           old.participant_last_read_at, old.last_message_at, old.created_at) then
      raise exception 'Somente a situação e a leitura da conversa podem ser alteradas.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.participant_profile_id <> private.current_profile_id() then
    raise exception 'Você não pode editar esta conversa.' using errcode = '42501';
  end if;

  if row(new.id, new.participant_profile_id, new.company_id, new.related_task_id,
         new.subject, new.conversation_type, new.participant_role, new.status,
         new.created_by, new.agency_last_read_at, new.last_message_at, new.created_at)
     is distinct from
     row(old.id, old.participant_profile_id, old.company_id, old.related_task_id,
         old.subject, old.conversation_type, old.participant_role, old.status,
         old.created_by, old.agency_last_read_at, old.last_message_at, old.created_at) then
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
begin
  select p.role into sender_role from public.profiles p where p.id = new.sender_profile_id;
  update public.chat_conversations
  set last_message_at = new.created_at,
      updated_at = new.created_at,
      agency_last_read_at = case when sender_role in ('super_admin', 'socio') then new.created_at else agency_last_read_at end,
      participant_last_read_at = case when sender_role not in ('super_admin', 'socio') then new.created_at else participant_last_read_at end
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists chat_conversations_updated_at on public.chat_conversations;
create trigger chat_conversations_updated_at
before update on public.chat_conversations
for each row execute function private.set_updated_at();

drop trigger if exists guard_chat_conversation_update on public.chat_conversations;
create trigger guard_chat_conversation_update
before update on public.chat_conversations
for each row execute function private.guard_chat_conversation_update();

drop trigger if exists touch_chat_conversation_from_message on public.chat_messages;
create trigger touch_chat_conversation_from_message
after insert on public.chat_messages
for each row execute function private.touch_chat_conversation_from_message();

drop policy if exists chat_conversations_select on public.chat_conversations;
drop policy if exists chat_conversations_insert on public.chat_conversations;
drop policy if exists chat_conversations_update on public.chat_conversations;
create policy chat_conversations_select on public.chat_conversations for select to authenticated
using (private.can_access_chat_conversation(id));
create policy chat_conversations_insert on public.chat_conversations for insert to authenticated
with check (
  created_by = private.current_profile_id()
  and status = 'aberta'
  and private.can_create_chat_conversation(participant_profile_id, company_id, related_task_id, participant_role)
);
create policy chat_conversations_update on public.chat_conversations for update to authenticated
using (private.can_access_chat_conversation(id))
with check (private.can_access_chat_conversation(id));

drop policy if exists chat_messages_select on public.chat_messages;
drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_select on public.chat_messages for select to authenticated
using (private.can_access_chat_conversation(conversation_id));
create policy chat_messages_insert on public.chat_messages for insert to authenticated
with check (
  sender_profile_id = private.current_profile_id()
  and private.can_access_chat_conversation(conversation_id)
  and exists (
    select 1 from public.chat_conversations c
    where c.id = conversation_id and c.status = 'aberta'
  )
);

revoke all on public.chat_conversations from anon, authenticated;
revoke all on public.chat_messages from anon, authenticated;
grant select, insert, update on public.chat_conversations to authenticated;
grant select, insert on public.chat_messages to authenticated;
grant execute on function private.can_access_chat_conversation(uuid) to authenticated;
grant execute on function private.can_create_chat_conversation(uuid, uuid, uuid, text) to authenticated;

comment on table public.chat_conversations is 'Private agency conversations with one client, collaborator, or partner.';
comment on table public.chat_messages is 'Persistent messages protected by conversation membership RLS.';
