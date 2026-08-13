import { clearSessionCookies, getAccessToken, jsonError, supabaseFetch } from "../../../../lib/oriva-data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const token = getAccessToken(request);
    if (token) await supabaseFetch("/auth/v1/logout?scope=global", { method: "POST" }, token);
    return clearSessionCookies(Response.json({ signedOut: true }), request);
  } catch (error) {
    const response = jsonError(error);
    return clearSessionCookies(response, request);
  }
}
