import { invokeAdminFunction, jsonError, linkPartnerProfileByMatchingEmail, normalizeEmail, requireSuperAdmin, restRequest } from "../../../../lib/oriva-data";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

const roleMap: Record<string, string> = { agency_member: "socio", collaborator: "colaborador", client: "empresa_cliente", partner: "parceiro" };

export async function PATCH(request: Request, context: Context) {
  try {
    await requireSuperAdmin(request);
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const role = roleMap[String(body.role)] ?? String(body.role ?? "socio");
    const accessEmail = normalizeEmail(body.email);
    const result = await invokeAdminFunction(request, {
      action: "update_profile",
      profile_id: id,
      name: body.name,
      email: accessEmail,
      phone: body.phone,
      role,
      company_id: body.tenantId || null,
      partner_id: body.partnerId || null,
      password: body.password || "",
      is_active: String(body.status ?? "Ativo") === "Ativo",
      permissions: role === "colaborador" ? { view_companies: true, manage_content: true } : {},
    });
    await linkPartnerProfileByMatchingEmail(request, accessEmail, id);
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    await requireSuperAdmin(request);
    const { id } = await context.params;
    const rows = await restRequest<Array<Record<string, unknown>>>(request, `profiles?id=eq.${encodeURIComponent(id)}&select=id,name,email,phone,role,permissions,is_active,company_users(company_id)&limit=1`);
    const profile = rows[0];
    if (!profile) return Response.json({ disabled: true });
    if (profile.role === "super_admin") return Response.json({ error: "O acesso proprietário não pode ser desativado." }, { status: 403 });
    const memberships = Array.isArray(profile.company_users) ? profile.company_users as Array<Record<string, unknown>> : [];
    const partnerRows = profile.role === "parceiro" ? await restRequest<Array<Record<string, unknown>>>(request, `partners?profile_id=eq.${encodeURIComponent(id)}&select=id&limit=1`) : [];
    await invokeAdminFunction(request, {
      action: "update_profile",
      profile_id: id,
      name: profile.name,
      email: profile.email,
      phone: profile.phone,
      role: profile.role,
      company_id: memberships[0]?.company_id ?? null,
      partner_id: partnerRows[0]?.id ?? null,
      permissions: profile.permissions ?? {},
      is_active: false,
      password: "",
    });
    return Response.json({ disabled: true });
  } catch (error) {
    return jsonError(error);
  }
}
