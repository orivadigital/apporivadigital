import { applySessionCookies, authRequest, invokeAdminFunction, jsonError, normalizeEmail } from "../../../../lib/oriva-data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    const name = String(body.name ?? "").trim();
    await invokeAdminFunction(request, { action: "bootstrap_owner", email, password, name });
    const session = await authRequest("/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    return applySessionCookies(Response.json({ created: true, authenticated: true }, { status: 201 }), request, session);
  } catch (error) {
    return jsonError(error);
  }
}
