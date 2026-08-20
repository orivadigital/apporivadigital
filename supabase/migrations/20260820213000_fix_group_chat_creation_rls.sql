-- Avoid an AFTER INSERT self-update that can be rejected by the conversation RLS.
-- Every conversation created by the current product includes the three default
-- agency recipients, so it is a group from the first database write.
create or replace function private.mark_chat_conversation_as_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.is_group := true;
  return new;
end;
$$;

drop trigger if exists mark_chat_conversation_as_group on public.chat_conversations;
create trigger mark_chat_conversation_as_group
before insert on public.chat_conversations
for each row execute function private.mark_chat_conversation_as_group();

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

  return new;
end;
$$;

notify pgrst, 'reload schema';
