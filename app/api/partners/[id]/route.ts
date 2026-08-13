import { jsonError, normalizeLabel, requireAgencyAdministrator, restRequest } from "../../../../lib/oriva-data";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    await requireAgencyAdministrator(request);
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    await restRequest(request, `partners?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ name: String(body.name ?? "").trim(), company_name: String(body.companyName ?? "").trim(), email: String(body.email ?? "").trim().toLowerCase(), phone: String(body.phone ?? "").trim(), specialty: String(body.specialty ?? "").trim(), average_value_cents: Number(body.averageValueCents ?? 0), open_demands: Number(body.openDemands ?? 0), status: normalizeLabel(body.status) || "ativo", notes: String(body.notes ?? "").trim() }) });
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
