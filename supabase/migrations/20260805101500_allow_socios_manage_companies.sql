create or replace function public.admin_create_company_records(
  p_creator_auth_user_id uuid,
  p_client_auth_user_id uuid,
  p_name text,
  p_trade_name text,
  p_document text,
  p_email text,
  p_phone text,
  p_whatsapp text,
  p_segment text,
  p_services text,
  p_responsible text,
  p_client_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator public.profiles%rowtype;
  v_company_id uuid;
  v_client_profile_id uuid;
begin
  select * into v_creator from public.profiles
  where auth_user_id = p_creator_auth_user_id
    and is_active = true
    and role in ('super_admin', 'socio');
  if v_creator.id is null then
    raise exception 'Apenas o administrador principal ou um sócio pode cadastrar empresas com login.' using errcode = '42501';
  end if;

  insert into public.companies (name, trade_name, document, email, phone, whatsapp, segment, services, responsible, created_by)
  values (trim(p_name), nullif(trim(p_trade_name), ''), nullif(trim(p_document), ''), lower(trim(p_email)), nullif(trim(p_phone), ''), nullif(trim(p_whatsapp), ''), nullif(trim(p_segment), ''), nullif(trim(p_services), ''), nullif(trim(p_responsible), ''), v_creator.id)
  returning id into v_company_id;

  insert into public.profiles (auth_user_id, name, email, role, permissions)
  values (p_client_auth_user_id, trim(p_client_name), lower(trim(p_email)), 'empresa_cliente', '{}'::jsonb)
  returning id into v_client_profile_id;

  insert into public.company_users (company_id, profile_id, role_in_company, permissions)
  values (v_company_id, v_client_profile_id, 'administrador_cliente', '{"review_content":true,"download_files":true}'::jsonb);

  insert into public.audit_logs (profile_id, company_id, action, entity_type, entity_id, metadata)
  values (v_creator.id, v_company_id, 'criacao_empresa_e_login', 'company', v_company_id::text, jsonb_build_object('client_profile_id', v_client_profile_id));

  return jsonb_build_object('company_id', v_company_id, 'profile_id', v_client_profile_id);
end;
$$;

create or replace function public.admin_update_company_records(
  p_creator_auth_user_id uuid,
  p_company_id uuid,
  p_name text,
  p_trade_name text,
  p_document text,
  p_email text,
  p_phone text,
  p_whatsapp text,
  p_segment text,
  p_services text,
  p_responsible text,
  p_status text,
  p_client_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_id uuid;
  v_client_profile_id uuid;
begin
  select id into v_creator_id from public.profiles
  where auth_user_id = p_creator_auth_user_id
    and is_active = true
    and role in ('super_admin', 'socio');
  if v_creator_id is null then
    raise exception 'Apenas o administrador principal ou um sócio pode editar empresas e acessos.' using errcode = '42501';
  end if;
  if p_status not in ('ativo', 'pausado', 'bloqueado', 'encerrado') then
    raise exception 'Status de empresa inválido.';
  end if;

  select cu.profile_id into v_client_profile_id
  from public.company_users cu
  join public.profiles p on p.id = cu.profile_id and p.role = 'empresa_cliente'
  where cu.company_id = p_company_id
  order by cu.created_at
  limit 1;

  update public.companies
  set name = trim(p_name), trade_name = nullif(trim(p_trade_name), ''), document = nullif(trim(p_document), ''),
      email = lower(trim(p_email)), phone = nullif(trim(p_phone), ''), whatsapp = nullif(trim(p_whatsapp), ''),
      segment = nullif(trim(p_segment), ''), services = nullif(trim(p_services), ''), responsible = nullif(trim(p_responsible), ''), status = p_status
  where id = p_company_id;

  if not found then raise exception 'Empresa não encontrada.'; end if;
  if v_client_profile_id is not null then
    update public.profiles set name = trim(p_client_name), email = lower(trim(p_email)) where id = v_client_profile_id;
  end if;

  insert into public.audit_logs (profile_id, company_id, action, entity_type, entity_id, metadata)
  values (v_creator_id, p_company_id, 'edicao_empresa', 'company', p_company_id::text, jsonb_build_object('status', p_status));
  return v_client_profile_id;
end;
$$;

revoke all on function public.admin_create_company_records(uuid, uuid, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_update_company_records(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_create_company_records(uuid, uuid, text, text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.admin_update_company_records(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text) to service_role;
