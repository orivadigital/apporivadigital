-- PostgreSQL evaluates the SELECT policy for INSERT ... RETURNING before a
-- helper query can find the freshly inserted row. Keep the membership helper
-- and add the safe row-local primary-participant check directly to the policy.
drop policy if exists chat_conversations_select on public.chat_conversations;
create policy chat_conversations_select on public.chat_conversations
for select to authenticated
using (
  participant_profile_id = private.current_profile_id()
  or private.can_access_chat_conversation(id)
);

notify pgrst, 'reload schema';
