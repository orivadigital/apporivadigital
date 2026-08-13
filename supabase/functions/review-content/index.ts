const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEYS = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const PUBLISHABLE_KEY = PUBLISHABLE_KEYS.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SECRET_KEY = SECRET_KEYS.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type JsonRecord = Record<string, unknown>;

function json(body: JsonRecord, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function clean(value: unknown) { return String(value ?? "").trim(); }

async function platformFetch(path: string, init: RequestInit = {}, options: { secret?: boolean; token?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("apikey", options.secret ? SECRET_KEY : PUBLISHABLE_KEY);
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${SUPABASE_URL}${path}`, { ...init, headers });
}

async function payload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function message(value: unknown, fallback: string) {
  if (typeof value === "string") return value || fallback;
  if (value && typeof value === "object") { const row = value as JsonRecord; return clean(row.message || row.msg || row.error || row.error_description) || fallback; }
  return fallback;
}

async function select(path: string) {
  const response = await platformFetch(`/rest/v1/${path}`, { method: "GET" }, { secret: true });
  const data = await payload(response);
  if (!response.ok) throw new Error(message(data, "Não foi possível verificar o conteúdo."));
  return Array.isArray(data) ? data as JsonRecord[] : [];
}

async function write(path: string, method: string, body: unknown) {
  const response = await platformFetch(`/rest/v1/${path}`, { method, headers: { Prefer: "return=representation" }, body: JSON.stringify(body) }, { secret: true });
  const data = await payload(response);
  if (!response.ok) throw new Error(message(data, "Não foi possível salvar sua resposta."));
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const authorization = req.headers.get("Authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token) return json({ error: "Faça login para continuar." }, 401);
    const userResponse = await platformFetch("/auth/v1/user", { method: "GET" }, { token });
    const user = await payload(userResponse) as JsonRecord | null;
    if (!userResponse.ok || !user) return json({ error: "Sua sessão expirou. Entre novamente." }, 401);

    const profiles = await select(`profiles?auth_user_id=eq.${encodeURIComponent(clean(user.id))}&select=id,role,is_active&limit=1`);
    const profile = profiles[0];
    if (!profile || profile.role !== "empresa_cliente" || profile.is_active !== true) return json({ error: "Apenas o cliente da empresa pode responder ao conteúdo." }, 403);

    const body = await req.json() as JsonRecord;
    const postId = clean(body.post_id);
    const decision = clean(body.decision);
    const feedback = clean(body.feedback);
    const memberships = await select(`company_users?profile_id=eq.${encodeURIComponent(clean(profile.id))}&select=company_id&limit=1`);
    const companyId = clean(memberships[0]?.company_id);
    if (!companyId) return json({ error: "Nenhuma empresa está vinculada ao seu login." }, 403);
    const posts = await select(`scheduled_posts?id=eq.${encodeURIComponent(postId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id,company_id,status&limit=1`);
    const post = posts[0];
    if (!post || post.status === "rascunho") return json({ error: "Conteúdo não encontrado para esta empresa." }, 404);

    let newStatus = clean(post.status);
    let commentType = "comentario";
    let comment = feedback;
    const update: JsonRecord = { client_feedback: feedback };
    if (decision === "aprovar") {
      newStatus = "aprovado"; commentType = "aprovacao"; comment = feedback || "Conteúdo aprovado pelo cliente.";
      update.status = newStatus; update.approved_by = profile.id; update.approved_at = new Date().toISOString();
    } else if (decision === "solicitar_alteracao") {
      if (!feedback) return json({ error: "Descreva a alteração solicitada." }, 400);
      newStatus = "revisao_solicitada"; commentType = "solicitacao_alteracao";
      update.status = newStatus; update.approved_by = null; update.approved_at = null;
    } else if (decision === "comentar") {
      if (!feedback) return json({ error: "Escreva um comentário antes de enviar." }, 400);
    } else {
      return json({ error: "Ação inválida." }, 400);
    }

    await write(`scheduled_posts?id=eq.${encodeURIComponent(postId)}&company_id=eq.${encodeURIComponent(companyId)}`, "PATCH", update);
    await write("post_comments", "POST", { post_id: postId, company_id: companyId, profile_id: profile.id, comment, comment_type: commentType });
    await write("audit_logs", "POST", { profile_id: profile.id, company_id: companyId, action: decision, entity_type: "scheduled_post", entity_id: postId, metadata: { feedback } });
    return json({ updated: true, status: newStatus });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Não foi possível responder ao conteúdo." }, 400);
  }
});
