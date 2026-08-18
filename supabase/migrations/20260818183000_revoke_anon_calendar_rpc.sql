-- Supabase grants EXECUTE to API roles for newly created public functions.
-- These calendar RPCs are authenticated-only and perform their own role checks.

revoke all on function public.create_scheduled_posts_batch(uuid, jsonb, jsonb) from public;
revoke all on function public.create_scheduled_posts_batch(uuid, jsonb, jsonb) from anon;
revoke all on function public.attach_scheduled_post_files(uuid, jsonb) from public;
revoke all on function public.attach_scheduled_post_files(uuid, jsonb) from anon;

grant execute on function public.create_scheduled_posts_batch(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.attach_scheduled_post_files(uuid, jsonb) to authenticated;
