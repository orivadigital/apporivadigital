import { jsonError, normalizeLabel, requireSuperAdmin, restRequest } from "../../../lib/oriva-data";

export const dynamic = "force-dynamic";
const statusUi: Record<string, string> = { pendente: "Pendente", pago: "Pago", atrasado: "Atrasado", cancelado: "Cancelado" };
const recurrenceUi: Record<string, string> = { unico: "Único", mensal: "Mensal", quinzenal: "Quinzenal", semanal: "Semanal", anual: "Anual" };
function map(row: Record<string, unknown>) { return { id: row.id, kind: row.kind === "receber" ? "receita" : "despesa", category: row.category, description: row.description, partyName: row.party_name, companyId: row.company_id ?? "", amountCents: row.amount_cents, dueDate: row.due_date, paidDate: row.paid_date ?? "", status: statusUi[String(row.status)] ?? row.status, recurrence: recurrenceUi[String(row.recurrence)] ?? row.recurrence, notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at }; }
function dbKind(value: unknown) { const normalized = normalizeLabel(value); return normalized === "receita" || normalized === "receber" ? "receber" : "pagar"; }

export async function GET(request: Request) {
  try {
    await requireSuperAdmin(request); const url = new URL(request.url); const month = url.searchParams.get("month") ?? ""; const delinquent = url.searchParams.get("delinquent") === "1";
    let query = "financial_entries?select=*&order=due_date.asc,created_at.asc";
    if (delinquent) {
      query += `&kind=eq.receber&status=in.(pendente,atrasado)&due_date=lt.${new Date().toISOString().slice(0, 10)}`;
    } else if (/^\d{4}-\d{2}$/.test(month)) { const [year, monthNumber] = month.split("-").map(Number); const next = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10); query += `&due_date=gte.${month}-01&due_date=lt.${next}`; }
    const rows = await restRequest<Array<Record<string, unknown>>>(request, query); return Response.json({ entries: rows.map(map) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSuperAdmin(request); const body = await request.json() as Record<string, unknown>;
    if (!String(body.description ?? "").trim() || !String(body.dueDate ?? "")) return Response.json({ error: "Preencha descrição e vencimento." }, { status: 400 });
    const rows = await restRequest<Array<Record<string, unknown>>>(request, "financial_entries", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ kind: dbKind(body.kind), category: String(body.category ?? "Outro").trim(), description: String(body.description).trim(), party_name: String(body.partyName ?? "").trim(), company_id: String(body.companyId ?? "").trim() || null, amount_cents: Number(body.amountCents ?? 0), due_date: body.dueDate, paid_date: body.paidDate || null, status: normalizeLabel(body.status) || "pendente", recurrence: normalizeLabel(body.recurrence) || "unico", notes: String(body.notes ?? "").trim(), created_by: actor.id }) });
    return Response.json({ entry: map(rows[0]) }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
