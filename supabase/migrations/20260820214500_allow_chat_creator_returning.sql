-- INSERT ... RETURNING also checks the SELECT policy. The primary participant
-- must therefore be allowed to see the row before the AFTER INSERT membership
-- trigger finishes registering every group member.
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
          from public.chat_conversations c
          where c.id = p_conversation_id
            and c.participant_profile_id = p.id
        )
        or exists (
          select 1
          from public.chat_conversation_members cm
          where cm.conversation_id = p_conversation_id
            and cm.profile_id = p.id
        )
      )
  )
$$;

notify pgrst, 'reload schema';
