import { getActor, jsonError, privateJson } from "../../../lib/oriva-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await getActor(request);
    return privateJson({
      actor,
      profile: actor.role === "empresa_cliente" ? "cliente" : actor.role === "parceiro" ? "parceiro" : "socio",
      canManageAccess: actor.role === "super_admin",
      canManageCompanies: actor.role === "super_admin" || actor.role === "socio",
    });
  } catch (error) {
    return jsonError(error);
  }
}
