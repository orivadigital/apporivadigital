import { authRequest, jsonError, normalizeEmail } from "../../../../lib/oriva-data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Informe um e-mail válido." }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const redirectTo = `${origin}/oriva-plataforma.html?password-recovery=1`;
    await authRequest(`/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: "POST",
      body: JSON.stringify({ email }),
    });

    return Response.json({ sent: true });
  } catch (error) {
    return jsonError(error);
  }
}
