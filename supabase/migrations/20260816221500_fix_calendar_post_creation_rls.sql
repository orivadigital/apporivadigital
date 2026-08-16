-- Fix false RLS denials during INSERT ... RETURNING for agency users.
-- The scoped helper reads scheduled_posts and cannot see a row being returned
-- by the same statement, so agency access must be explicit in the SELECT policy.
drop policy if exists scheduled_posts_select on public.scheduled_posts;

create policy scheduled_posts_select
on public.scheduled_posts
for select
to authenticated
using (
  private.can_manage_agency()
  or private.can_view_post_item(id)
);

-- Multi-date creation intentionally reuses the original stored object across
-- the generated posts. Keep each post/object pair unique, not the object path
-- globally unique.
alter table public.post_files
  drop constraint if exists post_files_file_url_key;

create index if not exists post_files_file_url_idx
  on public.post_files (file_url);

create unique index if not exists post_files_post_file_url_uidx
  on public.post_files (post_id, file_url);

-- Qualify both columns so company_id is checked against the new metadata row.
drop policy if exists post_files_insert on public.post_files;

create policy post_files_insert
on public.post_files
for insert
to authenticated
with check (
  private.can_attach_post(post_id)
  and exists (
    select 1
    from public.scheduled_posts sp
    where sp.id = post_files.post_id
      and sp.company_id = post_files.company_id
  )
);

-- Storage upload returns the inserted object. Mirror upload authorization in
-- SELECT so socios and assigned collaborators can receive that response.
drop policy if exists oriva_storage_select on storage.objects;

create policy oriva_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'oriva-files'
  and (
    private.can_upload_storage_object(name)
    or private.can_view_storage_object(name)
  )
);
