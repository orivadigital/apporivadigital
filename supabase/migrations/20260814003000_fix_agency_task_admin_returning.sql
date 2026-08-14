-- Agency administrators must be able to read the row returned immediately
-- after creating a task. The previous policy delegated every SELECT to
-- can_view_task(id), whose lookup cannot see the new row during INSERT ...
-- RETURNING and therefore caused a false RLS denial.
--
-- Keep the existing scoped helper for collaborators, partners and clients,
-- while giving super administrators and socios an explicit agency-level path.
drop policy if exists agency_tasks_select on public.agency_tasks;

create policy agency_tasks_select
on public.agency_tasks
for select
to authenticated
using (
  private.can_manage_agency()
  or private.can_view_task(id)
);
