import {
  authenticatedAuthRequest,
  clearSessionCookies,
  jsonError,
  supabaseFetch,
} from "../../../../lib/oriva-data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!accessToken) {
      return Response.json({ error: "Link de recuperação inválido ou expirado." }, { status: 401 });
    }

    const body = await request.json() as Record<string, unknown>;
    const password = String(body.password ?? "");
    if (password.length < 8) {
      return Response.json({ error: "A nova senha precisa ter pelo menos 8 caracteres." }, { status: 400 });
    }

    await authenticatedAuthRequest("/user", {
      method: "PUT",
      body: JSON.stringify({ password }),
    }, accessToken);

    await supabaseFetch("/auth/v1/logout?scope=global", { method: "POST" }, accessToken).catch(() => null);
    return clearSessionCookies(Response.json({ updated: true }), request);
  } catch (error) {
    return jsonError(error);
  }
}
