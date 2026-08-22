-- Somente o superadministrador pode consultar ou alterar dados financeiros.
drop policy if exists financial_entries_all on public.financial_entries;

create policy financial_entries_all
on public.financial_entries
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());
