create index if not exists task_files_uploaded_by_idx
  on public.task_files (uploaded_by) where uploaded_by is not null;

create index if not exists contract_files_uploaded_by_idx
  on public.contract_files (uploaded_by) where uploaded_by is not null;

drop policy if exists partners_manage on public.partners;
drop policy if exists partners_self_select on public.partners;
drop policy if exists partners_select on public.partners;
drop policy if exists partners_insert on public.partners;
drop policy if exists partners_update on public.partners;
drop policy if exists partners_delete on public.partners;

create policy partners_select on public.partners for select to authenticated
using (private.can_manage_agency() or profile_id = private.current_profile_id());

create policy partners_insert on public.partners for insert to authenticated
with check (private.can_manage_agency());

create policy partners_update on public.partners for update to authenticated
using (private.can_manage_agency()) with check (private.can_manage_agency());

create policy partners_delete on public.partners for delete to authenticated
using (private.can_manage_agency());
