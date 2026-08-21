import { invokeAdminFunction, jsonError, linkPartnerProfileByMatchingEmail, normalizeEmail, requireAgencyAdministrator, requireSuperAdmin, restRequest } from "../../../lib/oriva-data";

export const dynamic = "force-dynamic";

const roleToUi: Record<string, string> = {
  super_admin: "agency_owner",
  socio: "agency_member",
  colaborador: "collaborator",
  empresa_cliente: "client",
  parceiro: "partner",
};

export async function GET(request: Request) {
  try {
    const actor = await requireAgencyAdministrator(request);
    const rows = await restRequest<Array<Record<string, unknown>>>(
      request,
      "profiles?select=id,name,email,phone,role,permissions,is_active,created_at,updated_at,company_users(company_id,companies(name))&order=created_at.asc",
    );
    const partnerRows = await restRequest<Array<Record<string, unknown>>>(request, "partners?select=id,name,specialty,status,profile_id&order=name.asc");
    const partnerByProfile = new Map(partnerRows.filter((item) => item.profile_id).map((item) => [String(item.profile_id), item]));
    const accesses = rows.map((row) => {
      const memberships = Array.isArray(row.company_users) ? row.company_users as Array<Record<string, unknown>> : [];
      const membership = memberships[0];
      const company = membership?.companies && typeof membership.companies === "object" ? membership.companies as Record<string, unknown> : null;
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone ?? "",
        role: roleToUi[String(row.role)] ?? row.role,
        rawRole: row.role,
        tenantId: membership?.company_id ?? "",
        companyName: company?.name ?? "",
        partnerId: partnerByProfile.get(String(row.id))?.id ?? "",
        partnerName: partnerByProfile.get(String(row.id))?.name ?? "",
        permissions: row.permissions ?? {},
        status: row.is_active === true ? "Ativo" : "Inativo",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
    return Response.json({ accesses, partners: partnerRows, canManage: actor.role === "super_admin" });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireSuperAdmin(request);
    const body = await request.json() as Record<string, unknown>;
    const roleMap: Record<string, string> = { agency_member: "socio", collaborator: "colaborador", client: "empresa_cliente", partner: "parceiro" };
    const role = roleMap[String(body.role)] ?? String(body.role ?? "socio");
    const email = normalizeEmail(body.email);
    const name = String(body.name ?? "").trim();
    const password = String(body.password ?? "");
    if (!email || !name || password.length < 8) {
      return Response.json({ error: "Informe nome, e-mail e uma senha temporária de pelo menos 8 caracteres." }, { status: 400 });
    }
    const result = await invokeAdminFunction(request, {
      action: "create_profile",
      name,
      email,
      phone: body.phone,
      role,
      company_id: body.tenantId || null,
      partner_id: body.partnerId || null,
      password,
      permissions: role === "colaborador" ? { view_companies: true, manage_content: true } : {},
    });
    await linkPartnerProfileByMatchingEmail(request, email);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
