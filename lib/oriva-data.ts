type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = Record<string, JsonValue>;

type RuntimeConfig = {
  url: string;
  publishableKey: string;
};

export type Actor = {
  id: string;
  authUserId: string;
  email: string;
  name: string;
  phone: string;
  role: "super_admin" | "socio" | "colaborador" | "empresa_cliente" | "parceiro";
  permissions: Record<string, boolean>;
  companyId: string | null;
  partnerId: string | null;
  isActive: boolean;
};

export type CompanyAccess = {
  actor: Actor;
  companyId: string;
  isAgency: boolean;
};

export const CONTENT_TYPES = ["post", "carrossel", "stories", "reels", "video", "arte", "campanha", "outro"];
export const NETWORKS = ["instagram", "tiktok", "facebook", "linkedin", "youtube_shorts", "outra"];
export const POST_STATUSES = ["rascunho", "programado", "aguardando_aprovacao", "aprovado", "revisao_solicitada", "publicado"];

let cachedConfig: RuntimeConfig | null = null;

async function getConfig(): Promise<RuntimeConfig> {
  if (cachedConfig) return cachedConfig;
  let runtime: Record<string, unknown> = {};
  try {
    const cloudflare = await import("cloudflare:workers");
    runtime = cloudflare.env as unknown as Record<string, unknown>;
  } catch {
    runtime = {};
  }
  const url = String(runtime.SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const publishableKey = String(runtime.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? "");
  if (!url || !publishableKey) throw new Error("A conexão com o Supabase ainda não foi configurada.");
  cachedConfig = { url, publishableKey };
  return cachedConfig;
}

function readCookie(request: Request, name: string) {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

export function getAccessToken(request: Request) {
  return readCookie(request, "oriva_access_token");
}

export function getRefreshToken(request: Request) {
  return readCookie(request, "oriva_refresh_token");
}

function cookie(name: string, value: string, maxAge: number, request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function applySessionCookies(response: Response, request: Request, session: Record<string, unknown>) {
  const headers = new Headers(response.headers);
  const expiresIn = Math.max(60, Number(session.expires_in ?? 3600));
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  headers.set("Vary", "Cookie");
  headers.append("Set-Cookie", cookie("oriva_access_token", String(session.access_token ?? ""), expiresIn, request));
  headers.append("Set-Cookie", cookie("oriva_refresh_token", String(session.refresh_token ?? ""), 60 * 60 * 24 * 30, request));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function clearSessionCookies(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  headers.set("Vary", "Cookie");
  headers.append("Set-Cookie", cookie("oriva_access_token", "", 0, request));
  headers.append("Set-Cookie", cookie("oriva_refresh_token", "", 0, request));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function privateJson(data: unknown, init?: ResponseInit) {
  const response = Response.json(data, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Cookie");
  return response;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const translatedErrorsByCode: Record<string, string> = {
  email_not_confirmed: "E-mail não confirmado. Abra o link de confirmação enviado para o seu e-mail e tente novamente.",
  invalid_credentials: "E-mail ou senha incorretos.",
  user_not_found: "Usuário não encontrado.",
  email_address_invalid: "Informe um e-mail válido.",
  weak_password: "A senha não atende aos requisitos de segurança. Use pelo menos 8 caracteres.",
  over_email_send_rate_limit: "Muitos e-mails foram solicitados em pouco tempo. Aguarde alguns minutos e tente novamente.",
  email_rate_limit_exceeded: "Muitos e-mails foram solicitados em pouco tempo. Aguarde alguns minutos e tente novamente.",
  otp_expired: "Este link ou código expirou. Solicite um novo e tente novamente.",
  same_password: "A nova senha deve ser diferente da senha atual.",
  signup_disabled: "A criação de novas contas está temporariamente desativada.",
  user_already_exists: "Já existe uma conta cadastrada com este e-mail.",
  refresh_token_not_found: "Sua sessão expirou. Entre novamente.",
  invalid_refresh_token: "Sua sessão expirou. Entre novamente.",
  session_not_found: "Sua sessão expirou. Entre novamente.",
};

const translatedErrorPatterns: Array<[RegExp, string]> = [
  [/email not confirmed/i, translatedErrorsByCode.email_not_confirmed],
  [/invalid (login )?credentials/i, translatedErrorsByCode.invalid_credentials],
  [/user not found/i, translatedErrorsByCode.user_not_found],
  [/invalid email|email address.*invalid/i, translatedErrorsByCode.email_address_invalid],
  [/email rate limit exceeded|too many.*email/i, translatedErrorsByCode.over_email_send_rate_limit],
  [/token.*expired|expired.*token|otp.*expired|invalid.*otp/i, translatedErrorsByCode.otp_expired],
  [/password should be at least|weak password/i, translatedErrorsByCode.weak_password],
  [/new password should be different|same password/i, translatedErrorsByCode.same_password],
  [/signup.*disabled|signups? not allowed/i, translatedErrorsByCode.signup_disabled],
  [/user already (exists|registered)/i, translatedErrorsByCode.user_already_exists],
  [/refresh token.*(not found|invalid)|invalid refresh token|auth session missing/i, translatedErrorsByCode.session_not_found],
  [/failed to fetch|fetch failed|network request failed|load failed/i, "Não foi possível conectar ao sistema. Verifique sua internet e tente novamente."],
  [/row-level security|permission denied|insufficient permissions|unauthorized|forbidden/i, "Você não tem permissão para realizar esta ação."],
  [/duplicate key value|unique constraint/i, "Já existe um cadastro com essas informações."],
  [/not found/i, "O registro solicitado não foi encontrado."],
];

function isPortugueseMessage(value: string) {
  return /[áàâãéêíóôõúç]|\b(não|senha|conta|acesso|empresa|usuário|arquivo|dados|sessão|entre|informe|selecione|cadastro|conteúdo|possível|inválido|expirou)\b/i.test(value);
}

export function translateUserMessage(value: unknown, fallback = "Não foi possível concluir a operação.") {
  const message = String(value ?? "").trim();
  if (!message) return fallback;
  const byCode = translatedErrorsByCode[message.toLowerCase()];
  if (byCode) return byCode;
  const pattern = translatedErrorPatterns.find(([matcher]) => matcher.test(message));
  if (pattern) return pattern[1];
  return isPortugueseMessage(message) ? message : fallback;
}

function errorMessage(payload: unknown, fallback: string) {
  if (typeof payload === "string") return translateUserMessage(payload, fallback);
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const code = record.error_code ?? record.code;
    if (typeof code === "string" && translatedErrorsByCode[code.toLowerCase()]) {
      return translatedErrorsByCode[code.toLowerCase()];
    }
    return translateUserMessage(record.message ?? record.msg ?? record.error_description ?? record.error, fallback);
  }
  return fallback;
}

export async function supabaseFetch(
  path: string,
  init: RequestInit = {},
  accessToken?: string,
) {
  const config = await getConfig();
  const headers = new Headers(init.headers);
  headers.set("apikey", config.publishableKey);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${config.url}${path}`, { ...init, headers });
}

export async function authRequest(path: string, init: RequestInit = {}) {
  const response = await supabaseFetch(`/auth/v1${path}`, init);
  const payload = await parseResponse(response);
  if (!response.ok) {
    throw Response.json({ error: errorMessage(payload, "Não foi possível autenticar.") }, { status: response.status });
  }
  return payload as Record<string, unknown>;
}

export async function authenticatedAuthRequest(
  path: string,
  init: RequestInit,
  accessToken: string,
) {
  const response = await supabaseFetch(`/auth/v1${path}`, init, accessToken);
  const payload = await parseResponse(response);
  if (!response.ok) {
    throw Response.json({ error: errorMessage(payload, "Não foi possível atualizar sua conta.") }, { status: response.status });
  }
  return payload as Record<string, unknown>;
}

export async function restRequest<T = unknown>(
  request: Request,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getAccessToken(request);
  if (!token) throw Response.json({ error: "Faça login para continuar." }, { status: 401 });
  return restRequestWithToken<T>(path, init, token);
}

export async function restRequestWithToken<T = unknown>(
  path: string,
  init: RequestInit = {},
  token: string,
): Promise<T> {
  const response = await supabaseFetch(`/rest/v1/${path}`, init, token);
  const payload = await parseResponse(response);
  if (!response.ok) {
    throw Response.json({ error: errorMessage(payload, "Não foi possível acessar os dados.") }, { status: response.status });
  }
  return payload as T;
}

export async function invokeAdminFunction<T = unknown>(
  request: Request,
  body: Record<string, unknown>,
): Promise<T> {
  const token = getAccessToken(request);
  const response = await supabaseFetch(
    "/functions/v1/admin-users",
    { method: "POST", body: JSON.stringify(body) },
    token || undefined,
  );
  const payload = await parseResponse(response);
  if (!response.ok) {
    throw Response.json({ error: errorMessage(payload, "Não foi possível gerenciar o acesso.") }, { status: response.status });
  }
  return payload as T;
}

export async function invokeUserFunction<T = unknown>(
  request: Request,
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = getAccessToken(request);
  if (!token) throw Response.json({ error: "Faça login para continuar." }, { status: 401 });
  const response = await supabaseFetch(
    `/functions/v1/${encodeURIComponent(functionName)}`,
    { method: "POST", body: JSON.stringify(body) },
    token,
  );
  const payload = await parseResponse(response);
  if (!response.ok) {
    throw Response.json({ error: errorMessage(payload, "Não foi possível concluir a ação.") }, { status: response.status });
  }
  return payload as T;
}

export async function getActor(request: Request): Promise<Actor> {
  const token = getAccessToken(request);
  if (!token) throw Response.json({ error: "Faça login para continuar." }, { status: 401 });

  return getActorFromAccessToken(token);
}

export async function getActorFromAccessToken(token: string): Promise<Actor> {
  if (!token) throw Response.json({ error: "Faça login para continuar." }, { status: 401 });

  const authResponse = await supabaseFetch("/auth/v1/user", { method: "GET" }, token);
  const authPayload = await parseResponse(authResponse);
  if (!authResponse.ok || !authPayload || typeof authPayload !== "object") {
    throw Response.json({ error: "Sua sessão expirou. Entre novamente." }, { status: 401 });
  }
  const authUserId = String((authPayload as Record<string, unknown>).id ?? "");
  const rows = await restRequestWithToken<Array<Record<string, unknown>>>(
    `profiles?auth_user_id=eq.${encodeURIComponent(authUserId)}&select=id,auth_user_id,name,email,phone,role,permissions,avatar_url,is_active,company_users(company_id)&limit=1`,
    {},
    token,
  );
  const profile = rows[0];
  if (!profile || profile.is_active !== true) {
    throw Response.json({ error: "Seu acesso está inativo ou ainda não foi configurado." }, { status: 403 });
  }
  const memberships = Array.isArray(profile.company_users) ? profile.company_users as Array<Record<string, unknown>> : [];
  const partnerRows = await restRequestWithToken<Array<Record<string, unknown>>>(
    `partners?profile_id=eq.${encodeURIComponent(String(profile.id))}&select=id&limit=1`,
    {},
    token,
  );
  return {
    id: String(profile.id),
    authUserId,
    email: String(profile.email ?? ""),
    name: String(profile.name ?? ""),
    phone: String(profile.phone ?? ""),
    role: profile.role as Actor["role"],
    permissions: (profile.permissions && typeof profile.permissions === "object" ? profile.permissions : {}) as Record<string, boolean>,
    companyId: memberships[0] ? String(memberships[0].company_id ?? "") || null : null,
    partnerId: partnerRows[0] ? String(partnerRows[0].id ?? "") || null : null,
    isActive: true,
  };
}

export async function requireAgency(request: Request) {
  const actor = await getActor(request);
  if (!(["super_admin", "socio", "colaborador"] as string[]).includes(actor.role)) {
    throw Response.json({ error: "Acesso restrito à equipe da agência." }, { status: 403 });
  }
  return actor;
}

export async function requireAgencyAdministrator(request: Request) {
  const actor = await getActor(request);
  if (actor.role !== "super_admin" && actor.role !== "socio") {
    throw Response.json({
      error: "Esta área é restrita ao administrador principal e aos sócios.",
    }, { status: 403 });
  }
  return actor;
}

export async function requireSuperAdmin(request: Request) {
  const actor = await getActor(request);
  if (actor.role !== "super_admin") {
    throw Response.json({ error: "Apenas o administrador principal pode realizar esta ação." }, { status: 403 });
  }
  return actor;
}

export async function requireCompanyManager(request: Request) {
  const actor = await getActor(request);
  if (actor.role !== "super_admin" && actor.role !== "socio") {
    throw Response.json({ error: "Apenas o administrador principal ou um sócio pode gerenciar empresas." }, { status: 403 });
  }
  return actor;
}

export async function requireCompany(request: Request, requestedCompanyId: string | null): Promise<CompanyAccess> {
  const actor = await getActor(request);
  if (actor.role === "empresa_cliente") {
    if (!actor.companyId) throw Response.json({ error: "Nenhuma empresa está vinculada ao seu login." }, { status: 403 });
    if (requestedCompanyId && requestedCompanyId !== actor.companyId) {
      throw Response.json({ error: "Você não possui acesso a esta empresa." }, { status: 403 });
    }
    return { actor, companyId: actor.companyId, isAgency: false };
  }
  if (actor.role !== "super_admin" && actor.role !== "socio") {
    throw Response.json({
      error: "Esta área é restrita ao administrador principal, aos sócios e ao cliente da empresa.",
    }, { status: 403 });
  }
  if (!requestedCompanyId) throw Response.json({ error: "Selecione uma empresa." }, { status: 400 });
  return { actor, companyId: requestedCompanyId, isAgency: true };
}

export async function storageRequest(
  request: Request,
  path: string,
  init: RequestInit = {},
) {
  const token = getAccessToken(request);
  if (!token) throw Response.json({ error: "Faça login para continuar." }, { status: 401 });
  const response = await supabaseFetch(`/storage/v1/object/oriva-files/${encodeStoragePath(path)}`, init, token);
  if (!response.ok) {
    const payload = await parseResponse(response);
    throw Response.json({ error: errorMessage(payload, "Não foi possível acessar o arquivo.") }, { status: response.status });
  }
  return response;
}

export async function storageJsonRequest<T = unknown>(
  request: Request,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getAccessToken(request);
  if (!token) throw Response.json({ error: "Faça login para continuar." }, { status: 401 });
  const response = await supabaseFetch(`/storage/v1/${path}`, init, token);
  const payload = await parseResponse(response);
  if (!response.ok) {
    throw Response.json({ error: errorMessage(payload, "Não foi possível acessar o armazenamento.") }, { status: response.status });
  }
  return payload as T;
}

export async function createSignedStorageUpload(request: Request, path: string) {
  const payload = await storageJsonRequest<Record<string, unknown>>(
    request,
    `object/upload/sign/oriva-files/${encodeStoragePath(path)}`,
    {
      method: "POST",
      headers: { "x-upsert": "false" },
      body: JSON.stringify({}),
    },
  );
  const relativeUrl = String(payload.url ?? "").trim();
  if (!relativeUrl) {
    throw Response.json({ error: "Não foi possível preparar o envio do arquivo." }, { status: 502 });
  }
  const config = await getConfig();
  const signedUrl = relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")
    ? relativeUrl
    : `${config.url}/storage/v1${relativeUrl.startsWith("/") ? "" : "/"}${relativeUrl}`;
  return { path, signedUrl };
}

export function encodeStoragePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function safeFileName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "arquivo";
}

export function jsonError(error: unknown) {
  if (error instanceof Response) return error;
  console.error(error);
  const message = translateUserMessage(
    error instanceof Error ? error.message : "",
    "Não foi possível concluir a operação.",
  );
  return Response.json({ error: message }, { status: 500 });
}

export function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeLabel(value: unknown) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function companyStatusToDb(value: unknown) {
  const normalized = normalizeLabel(value);
  return ({ ativo: "ativo", pausado: "pausado", bloqueado: "bloqueado", encerrado: "encerrado" } as Record<string, string>)[normalized] ?? "ativo";
}

export function companyStatusToUi(value: unknown) {
  return ({ ativo: "Ativo", pausado: "Pausado", bloqueado: "Bloqueado", encerrado: "Encerrado" } as Record<string, string>)[String(value)] ?? String(value ?? "");
}

const contentTypeLabels: Record<string, string> = { post: "Post", carrossel: "Carrossel", stories: "Stories", reels: "Reels", video: "Vídeo", arte: "Arte", campanha: "Campanha", outro: "Outro" };
const networkLabels: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", linkedin: "LinkedIn", youtube_shorts: "YouTube Shorts", outra: "Outra" };
const postStatusLabels: Record<string, string> = { rascunho: "Rascunho", programado: "Programado", aguardando_aprovacao: "Aguardando aprovação", aprovado: "Aprovado", revisao_solicitada: "Revisão solicitada", publicado: "Publicado" };

export function contentTypeToDb(value: unknown) { return normalizeLabel(value); }
export function contentTypeToUi(value: unknown) { return contentTypeLabels[String(value)] ?? String(value ?? ""); }
export function networkToDb(value: unknown) { return normalizeLabel(value); }
export function networkToUi(value: unknown) { return networkLabels[String(value)] ?? String(value ?? ""); }
export function postStatusToDb(value: unknown) { return normalizeLabel(value); }
export function postStatusToUi(value: unknown) { return postStatusLabels[String(value)] ?? String(value ?? ""); }

export function mapKeys<T extends Record<string, unknown>>(row: T, mapping: Record<string, string>) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) result[mapping[key] ?? key] = value;
  return result;
}
