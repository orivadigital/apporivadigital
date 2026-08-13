const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEYS = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const PUBLISHABLE_KEY = PUBLISHABLE_KEYS.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SECRET_KEY = SECRET_KEYS.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type JsonRecord = Record<string, unknown>;

function json(body: JsonRecord, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function email(value: unknown) {
  return clean(value).toLowerCase();
}

function uuidOrNull(value: unknown) {
  const normalized = clean(value);
  return normalized || null;
}

async function platformFetch(
  path: string,
  init: RequestInit = {},
  options: { secret?: boolean; token?: string } = {},
) {
  const headers = new Headers(init.headers);
  headers.set("apikey", options.secret ? SECRET_KEY : PUBLISHABLE_KEY);
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${SUPABASE_URL}${path}`, { ...init, headers });
}

async function responsePayload(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    return { message: text };
  }
}

function failureMessage(payload: JsonRecord, fallback: string) {
  return clean(payload.msg || payload.message || payload.error_description || payload.error) || fallback;
}

async function createAuthUser(userEmail: string, password: string, name: string) {
  const response = await platformFetch(
    "/auth/v1/admin/users",
    {
      method: "POST",
      body: JSON.stringify({
        email: userEmail,
        password,
        email_confirm: true,
        user_metadata: { name },
      }),
    },
    { secret: true },
  );
  const payload = await responsePayload(response);
  if (!response.ok) throw new Error(failureMessage(payload, "Não foi possível criar o usuário."));
  const user = (payload.user as JsonRecord | undefined) ?? payload;
  const id = clean(user.id);
  if (!id) throw new Error("O Supabase não retornou o identificador do usuário.");
  return id;
}

async function deleteAuthUser(authUserId: string) {
  await platformFetch(`/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, { method: "DELETE" }, { secret: true });
}

async function updateAuthUser(
  authUserId: string,
  values: { email?: string; password?: string; name?: string; isActive?: boolean },
) {
  const body: JsonRecord = {};
  if (values.email) body.email = values.email;
  if (values.password) body.password = values.password;
  if (values.name) body.user_metadata = { name: values.name };
  if (typeof values.isActive === "boolean") body.ban_duration = values.isActive ? "none" : "876000h";
  if (!Object.keys(body).length) return;
  const response = await platformFetch(
    `/auth/v1/admin/users/${encodeURIComponent(authUserId)}`,
    { method: "PUT", body: JSON.stringify(body) },
    { secret: true },
  );
  const payload = await responsePayload(response);
  if (!response.ok) throw new Error(failureMessage(payload, "Não foi possível atualizar o login."));
}

async function rpc(name: string, params: JsonRecord) {
  const response = await platformFetch(
    `/rest/v1/rpc/${name}`,
    { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(params) },
    { secret: true },
  );
  const payload = await responsePayload(response);
  if (!response.ok) throw new Error(failureMessage(payload, "Não foi possível salvar os registros do usuário."));
  return payload;
}

function rpcRecord(value: unknown): JsonRecord {
  if (Array.isArray(value)) return (value[0] as JsonRecord | undefined) ?? {};
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function rpcId(value: unknown, field = "") {
  const record = rpcRecord(value);
  if (field && record[field]) return clean(record[field]);
  return clean(record.id ?? record.result ?? value);
}

async function select(path: string) {
  const response = await platformFetch(`/rest/v1/${path}`, { method: "GET" }, { secret: true });
  const payload = await responsePayload(response);
  if (!response.ok) throw new Error(failureMessage(payload, "Não foi possível consultar os dados."));
  return Array.isArray(payload) ? payload as JsonRecord[] : [];
}

async function callerFromRequest(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) throw new Error("Faça login como administrador para continuar.");

  const userResponse = await platformFetch("/auth/v1/user", { method: "GET" }, { token });
  const userPayload = await responsePayload(userResponse);
  if (!userResponse.ok) throw new Error("Sua sessão expirou. Entre novamente.");
  const authUserId = clean(userPayload.id);
  const rows = await select(`profiles?auth_user_id=eq.${encodeURIComponent(authUserId)}&select=id,auth_user_id,role,is_active&limit=1`);
  const profile = rows[0];
  if (!profile || !["super_admin", "socio"].includes(clean(profile.role)) || profile.is_active !== true) {
    throw new Error("Apenas o administrador principal ou um sócio pode gerenciar empresas.");
  }
  return { authUserId, profile };
}

function requireSuperAdminCaller(caller: { profile: JsonRecord }) {
  if (clean(caller.profile.role) !== "super_admin") {
    throw new Error("Apenas o administrador principal pode gerenciar acessos da equipe.");
  }
}

function validatePassword(value: unknown, required = true) {
  const password = String(value ?? "");
  if (required && password.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
  if (!required && password && password.length < 8) throw new Error("A nova senha precisa ter pelo menos 8 caracteres.");
  return password;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SECRET_KEY) {
    return json({ error: "Configuração segura do Supabase indisponível." }, 500);
  }

  try {
    const body = await req.json() as JsonRecord;
    const action = clean(body.action);

    if (action === "bootstrap_status") {
      const owners = await select("profiles?role=eq.super_admin&select=id&limit=1");
      return json({ configured: owners.length > 0 });
    }

    if (action === "bootstrap_owner") {
      const ownerEmail = email(body.email);
      const ownerName = clean(body.name);
      const password = validatePassword(body.password);
      if (!ownerEmail || !ownerName) throw new Error("Informe seu nome e e-mail.");

      const authUserId = await createAuthUser(ownerEmail, password, ownerName);
      try {
        await rpc("admin_bootstrap_owner_records", {
          p_auth_user_id: authUserId,
          p_email: ownerEmail,
          p_name: ownerName,
        });
      } catch (error) {
        await deleteAuthUser(authUserId);
        throw error;
      }
      return json({ created: true }, 201);
    }

    const caller = await callerFromRequest(req);

    if (action === "create_company") {
      const companyName = clean(body.name);
      const clientEmail = email(body.email);
      const clientName = clean(body.client_name) || companyName;
      const password = validatePassword(body.password);
      if (!companyName || !clientEmail) throw new Error("Nome e e-mail de acesso da empresa são obrigatórios.");

      const clientAuthUserId = await createAuthUser(clientEmail, password, clientName);
      try {
        const result = await rpc("admin_create_company_records", {
          p_creator_auth_user_id: caller.authUserId,
          p_client_auth_user_id: clientAuthUserId,
          p_name: companyName,
          p_trade_name: clean(body.trade_name),
          p_document: clean(body.document),
          p_email: clientEmail,
          p_phone: clean(body.phone),
          p_whatsapp: clean(body.whatsapp),
          p_segment: clean(body.segment),
          p_services: clean(body.services),
          p_responsible: clean(body.responsible),
          p_client_name: clientName,
        });
        const companyId = rpcId(result, "company_id");
        if (!companyId) throw new Error("A empresa foi criada, mas não foi possível salvar a classificação comercial.");
        await rpc("admin_set_company_commercial_fields", {
          p_creator_auth_user_id: caller.authUserId,
          p_company_id: companyId,
          p_responsible_email: email(body.responsible_email),
          p_relationship_type: clean(body.relationship_type) === "lead" ? "lead" : "cliente",
        });
        return json({ created: true, result }, 201);
      } catch (error) {
        await deleteAuthUser(clientAuthUserId);
        throw error;
      }
    }

    if (action === "update_company") {
      const companyId = clean(body.company_id);
      const clientEmail = email(body.email);
      const clientName = clean(body.client_name) || clean(body.name);
      const password = validatePassword(body.password, false);
      const links = await select(`company_users?company_id=eq.${encodeURIComponent(companyId)}&select=profile_id&limit=1`);
      if (!links[0]) throw new Error("O login desta empresa não foi encontrado.");
      const profiles = await select(`profiles?id=eq.${encodeURIComponent(clean(links[0].profile_id))}&select=id,auth_user_id&limit=1`);
      if (!profiles[0]) throw new Error("O usuário cliente desta empresa não foi encontrado.");
      await updateAuthUser(clean(profiles[0].auth_user_id), { email: clientEmail, password: password || undefined, name: clientName });
      await rpc("admin_update_company_records", {
        p_creator_auth_user_id: caller.authUserId,
        p_company_id: companyId,
        p_name: clean(body.name),
        p_trade_name: clean(body.trade_name),
        p_document: clean(body.document),
        p_email: clientEmail,
        p_phone: clean(body.phone),
        p_whatsapp: clean(body.whatsapp),
        p_segment: clean(body.segment),
        p_services: clean(body.services),
        p_responsible: clean(body.responsible),
        p_status: clean(body.status) || "ativo",
        p_client_name: clientName,
      });
      await rpc("admin_set_company_commercial_fields", {
        p_creator_auth_user_id: caller.authUserId,
        p_company_id: companyId,
        p_responsible_email: email(body.responsible_email),
        p_relationship_type: clean(body.relationship_type) === "lead" ? "lead" : "cliente",
      });
      return json({ updated: true });
    }

    if (action === "create_profile") {
      requireSuperAdminCaller(caller);
      const userEmail = email(body.email);
      const name = clean(body.name);
      const role = clean(body.role);
      const password = validatePassword(body.password);
      if (!name || !userEmail) throw new Error("Nome e e-mail são obrigatórios.");
      const authUserId = await createAuthUser(userEmail, password, name);
      try {
        const result = await rpc("admin_create_profile_records", {
          p_creator_auth_user_id: caller.authUserId,
          p_auth_user_id: authUserId,
          p_name: name,
          p_email: userEmail,
          p_phone: clean(body.phone),
          p_role: role,
          p_company_id: uuidOrNull(body.company_id),
          p_permissions: (body.permissions as JsonRecord | undefined) ?? {},
        });
        if (role === "parceiro") {
          const profileId = rpcId(result);
          const partnerId = clean(body.partner_id);
          if (!profileId || !partnerId) throw new Error("Selecione o cadastro de Parceiro PJ para este acesso.");
          await rpc("admin_link_partner_profile", {
            p_creator_auth_user_id: caller.authUserId,
            p_profile_id: profileId,
            p_partner_id: partnerId,
          });
        }
        return json({ created: true, result }, 201);
      } catch (error) {
        await deleteAuthUser(authUserId);
        throw error;
      }
    }

    if (action === "update_profile") {
      requireSuperAdminCaller(caller);
      const profileId = clean(body.profile_id);
      const profiles = await select(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id,auth_user_id&limit=1`);
      if (!profiles[0]) throw new Error("Acesso não encontrado.");
      const password = validatePassword(body.password, false);
      const isActive = body.is_active !== false;
      await updateAuthUser(clean(profiles[0].auth_user_id), {
        email: email(body.email),
        password: password || undefined,
        name: clean(body.name),
        isActive,
      });
      await rpc("admin_update_profile_records", {
        p_creator_auth_user_id: caller.authUserId,
        p_profile_id: profileId,
        p_name: clean(body.name),
        p_email: email(body.email),
        p_phone: clean(body.phone),
        p_role: clean(body.role),
        p_company_id: uuidOrNull(body.company_id),
        p_permissions: (body.permissions as JsonRecord | undefined) ?? {},
        p_is_active: isActive,
      });
      if (clean(body.role) === "parceiro") {
        const partnerId = clean(body.partner_id);
        if (!partnerId) throw new Error("Selecione o cadastro de Parceiro PJ para este acesso.");
        await rpc("admin_link_partner_profile", {
          p_creator_auth_user_id: caller.authUserId,
          p_profile_id: profileId,
          p_partner_id: partnerId,
        });
      }
      return json({ updated: true });
    }

    return json({ error: "Ação administrativa inválida." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível concluir a operação.";
    const status = /sessão|login/i.test(message) ? 401 : /apenas|autorizad/i.test(message) ? 403 : 400;
    return json({ error: message }, status);
  }
});
