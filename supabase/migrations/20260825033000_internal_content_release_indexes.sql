-- Cover the new actor foreign keys used by validation and release auditing.
create index if not exists post_internal_details_validated_by_idx
  on public.post_internal_details (validated_by)
  where validated_by is not null;

create index if not exists scheduled_posts_client_released_by_idx
  on public.scheduled_posts (client_released_by)
  where client_released_by is not null;
