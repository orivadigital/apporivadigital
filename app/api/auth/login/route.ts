import { applySessionCookies, authRequest, getActorFromAccessToken, jsonError, normalizeEmail, privateJson } from "../../../../lib/oriva-data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    if (!email || !password) return Response.json({ error: "Informe seu e-mail e sua senha." }, { status: 400 });
    const session = await authRequest("/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    const accessToken = String(session.access_token ?? "");
    if (!accessToken) throw Response.json({ error: "Não foi possível iniciar sua sessão. Tente novamente." }, { status: 502 });
    const actor = await getActorFromAccessToken(accessToken);
    return applySessionCookies(privateJson({
      authenticated: true,
      actor,
      profile: actor.role === "empresa_cliente" ? "cliente" : actor.role === "parceiro" ? "parceiro" : "socio",
      canManageAccess: actor.role === "super_admin",
      canManageCompanies: actor.role === "super_admin" || actor.role === "socio",
    }), request, session);
  } catch (error) {
    return jsonError(error);
  }
}
