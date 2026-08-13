import { applySessionCookies, authRequest, clearSessionCookies, getRefreshToken, jsonError, privateJson } from "../../../../lib/oriva-data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const refreshToken = getRefreshToken(request);
    if (!refreshToken) return clearSessionCookies(Response.json({ error: "Entre novamente." }, { status: 401 }), request);
    const session = await authRequest("/token?grant_type=refresh_token", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    return applySessionCookies(privateJson({ refreshed: true }), request, session);
  } catch (error) {
    // Não apague aqui um token que outra aba pode ter acabado de renovar.
    // A próxima autenticação válida substitui os cookies com segurança.
    return jsonError(error);
  }
}
