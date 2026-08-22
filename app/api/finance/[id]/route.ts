import { jsonError, normalizeLabel, requireSuperAdmin, restRequest } from "../../../../lib/oriva-data";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
function dbKind(value: unknown) { const normalized = normalizeLabel(value); return normalized === "receita" || normalized === "receber" ? "receber" : "pagar"; }

export async function PATCH(request: Request, context: Context) {
  try { await requireSuperAdmin(request); const { id } = await context.params; const body = await request.json() as Record<string, unknown>; await restRequest(request, `financial_entries?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ kind: dbKind(body.kind), category: String(body.category ?? "Outro").trim(), description: String(body.description ?? "").trim(), party_name: String(body.partyName ?? "").trim(), company_id: String(body.companyId ?? "").trim() || null, amount_cents: Number(body.amountCents ?? 0), due_date: body.dueDate, paid_date: body.paidDate || null, status: normalizeLabel(body.status) || "pendente", recurrence: normalizeLabel(body.recurrence) || "unico", notes: String(body.notes ?? "").trim() }) }); return Response.json({ updated: true }); } catch (error) { return jsonError(error); }
}
export async function DELETE(request: Request, context: Context) {
  try { await requireSuperAdmin(request); const { id } = await context.params; await restRequest(request, `financial_entries?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); return Response.json({ deleted: true }); } catch (error) { return jsonError(error); }
}
