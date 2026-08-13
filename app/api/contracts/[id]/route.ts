import { jsonError, normalizeLabel, requireAgencyAdministrator, restRequest } from "../../../../lib/oriva-data";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try { await requireAgencyAdministrator(request); const { id } = await context.params; const body = await request.json() as Record<string, unknown>; await restRequest(request, `contracts?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ title: String(body.title ?? "").trim(), party_type: normalizeLabel(body.partyType) || "empresa", party_name: String(body.partyName ?? "").trim(), related_id: String(body.relatedId ?? "").trim() || null, start_date: body.startDate, end_date: body.endDate || null, value_cents: Number(body.valueCents ?? 0), status: normalizeLabel(body.status) || "ativo", recurrence: normalizeLabel(body.recurrence) || "sem_recorrencia", notes: String(body.notes ?? "").trim() }) }); return Response.json({ updated: true }); } catch (error) { return jsonError(error); }
}
export async function DELETE(request: Request, context: Context) {
  try { await requireAgencyAdministrator(request); const { id } = await context.params; await restRequest(request, `contracts?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); return Response.json({ deleted: true }); } catch (error) { return jsonError(error); }
}
