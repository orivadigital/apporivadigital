import { jsonError, normalizeEmail, normalizeLabel, requireAgencyAdministrator, restRequest } from "../../../../lib/oriva-data";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

async function matchingProfileId(request: Request, email: string, partnerId: string) {
  if (!email) return null;
  const profiles = await restRequest<Array<Record<string, unknown>>>(
    request,
    `profiles?email=eq.${encodeURIComponent(email)}&is_active=eq.true&role=in.(colaborador,parceiro)&select=id&limit=2`,
  );
  if (profiles.length !== 1) return null;
  const profileId = String(profiles[0].id ?? "");
  const linked = await restRequest<Array<Record<string, unknown>>>(
    request,
    `partners?profile_id=eq.${encodeURIComponent(profileId)}&select=id&limit=2`,
  );
  return linked.some((row) => String(row.id) !== partnerId) ? null : profileId;
}

export async function PATCH(request: Request, context: Context) {
  try {
    await requireAgencyAdministrator(request);
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const partnerEmail = normalizeEmail(body.email);
    const profileId = await matchingProfileId(request, partnerEmail, id);
    const values: Record<string, unknown> = { name: String(body.name ?? "").trim(), company_name: String(body.companyName ?? "").trim(), email: partnerEmail, phone: String(body.phone ?? "").trim(), specialty: String(body.specialty ?? "").trim(), average_value_cents: Number(body.averageValueCents ?? 0), open_demands: Number(body.openDemands ?? 0), status: normalizeLabel(body.status) || "ativo", notes: String(body.notes ?? "").trim() };
    if (profileId) values.profile_id = profileId;
    await restRequest(request, `partners?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(values) });
    return Response.json({ updated: true });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    await requireAgencyAdministrator(request);
    const { id } = await context.params;
    await restRequest(request, `partners?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    return Response.json({ deleted: true });
  } catch (error) { return jsonError(error); }
}
