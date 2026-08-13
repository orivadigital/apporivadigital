import { jsonError, normalizeLabel, requireAgencyAdministrator, restRequest } from "../../../lib/oriva-data";

export const dynamic = "force-dynamic";
const labels: Record<string, string> = { empresa: "Empresa", parceiro: "Parceiro", outro: "Outro", rascunho: "Rascunho", ativo: "Ativo", renovar: "Renovar", encerrado: "Encerrado", cancelado: "Cancelado", sem_recorrencia: "Sem recorrência", mensal: "Mensal", trimestral: "Trimestral", semestral: "Semestral", anual: "Anual", personalizada: "Personalizada" };
function map(row: Record<string, unknown>) { return { id: row.id, title: row.title, partyType: labels[String(row.party_type)] ?? row.party_type, partyName: row.party_name, relatedId: row.related_id ?? "", startDate: row.start_date, endDate: row.end_date ?? "", valueCents: row.value_cents, status: labels[String(row.status)] ?? row.status, recurrence: labels[String(row.recurrence)] ?? row.recurrence, notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at }; }

export async function GET(request: Request) {
  try { await requireAgencyAdministrator(request); const rows = await restRequest<Array<Record<string, unknown>>>(request, "contracts?select=*&order=start_date.desc"); return Response.json({ contracts: rows.map(map) }); } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAgencyAdministrator(request); const body = await request.json() as Record<string, unknown>;
    if (!String(body.title ?? "").trim() || !String(body.partyName ?? "").trim() || !String(body.startDate ?? "")) return Response.json({ error: "Preencha título, parte e data inicial." }, { status: 400 });
    const rows = await restRequest<Array<Record<string, unknown>>>(request, "contracts", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ title: String(body.title).trim(), party_type: normalizeLabel(body.partyType) || "empresa", party_name: String(body.partyName).trim(), related_id: String(body.relatedId ?? "").trim() || null, start_date: body.startDate, end_date: body.endDate || null, value_cents: Number(body.valueCents ?? 0), status: normalizeLabel(body.status) || "ativo", recurrence: normalizeLabel(body.recurrence) || "sem_recorrencia", notes: String(body.notes ?? "").trim(), created_by: actor.id }) });
    return Response.json({ contract: map(rows[0]) }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
