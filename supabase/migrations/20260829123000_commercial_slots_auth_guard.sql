-- Keep the public availability RPC useful to authenticated clients without exposing
-- the underlying schedules or block reasons.
create or replace function public.list_commercial_slots(
  p_from date,
  p_to date,
  p_duration_minutes integer default 60
)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with authorized as (
    select 1 as allowed
    where (select auth.uid()) is not null
  ),
  reference_partner as (
    select sp.profile_id
    from public.commercial_schedule_partners sp
    join authorized on true
    where sp.is_reference = true and sp.is_active = true
    limit 1
  ),
  requested_days as (
    select day::date
    from generate_series(p_from, p_to, interval '1 day') day
    where p_to >= p_from and p_to <= p_from + 62
  ),
  candidates as (
    select
      slot_start as starts_at,
      slot_start + make_interval(mins => p_duration_minutes) as ends_at,
      rp.profile_id
    from requested_days d
    join reference_partner rp on true
    join public.commercial_availability a
      on a.profile_id = rp.profile_id
     and a.is_active = true
     and a.weekday = extract(dow from d.day)::smallint
     and (a.valid_from is null or d.day >= a.valid_from)
     and (a.valid_until is null or d.day <= a.valid_until)
    cross join lateral generate_series(
      (d.day + a.start_time) at time zone a.timezone,
      ((d.day + a.end_time) at time zone a.timezone) - make_interval(mins => p_duration_minutes),
      interval '30 minutes'
    ) slot_start
    where p_duration_minutes between 15 and 240
  )
  select c.starts_at, c.ends_at
  from candidates c
  where c.starts_at >= now() + interval '15 minutes'
    and not exists (
      select 1 from public.commercial_schedule_blocks b
      where b.profile_id = c.profile_id
        and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(c.starts_at, c.ends_at, '[)')
    )
    and not exists (
      select 1 from public.commercial_meetings m
      where m.status in ('agendada', 'realizada', 'no_show')
        and m.slot && tstzrange(c.starts_at, c.ends_at, '[)')
    )
  order by c.starts_at
$$;

revoke all on function public.list_commercial_slots(date, date, integer) from public, anon;
grant execute on function public.list_commercial_slots(date, date, integer) to authenticated;

notify pgrst, 'reload schema';
