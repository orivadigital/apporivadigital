import { getActor, jsonError, normalizeLabel, requireAgencyAdministrator, restRequest } from "../../../lib/oriva-data";

export const dynamic = "force-dynamic";
const statusUi: Record<string, string> = { pendente: "Pendente", em_andamento: "Em andamento", atrasado: "Atrasado", concluido: "Concluído" };
const priorityUi: Record<string, string> = { baixa: "Baixa", media: "Média", alta: "Alta", urgente: "Urgente" };

export async function GET(request: Request) {
  try {
    const actor = await getActor(request);
    if (!["super_admin", "socio", "colaborador", "parceiro"].includes(actor.role)) {
      return Response.json({ error: "Acesso restrito à equipe e aos parceiros da agência." }, { status: 403 });
    }
    const filters = new URLSearchParams({ select: "*,companies(name)", order: "due_date.asc,created_at.asc" });
    if (actor.role === "colaborador") filters.set("assigned_to", `eq.${actor.id}`);
    if (actor.role === "parceiro") {
      if (!actor.partnerId) return Response.json({ error: "Seu login ainda não está vinculado a um Parceiro PJ." }, { status: 403 });
      filters.set("partner_id", `eq.${actor.partnerId}`);
    }
    const rows = await restRequest<Array<Record<string, unknown>>>(request, `agency_tasks?${filters.toString()}`);
    const ids = Array.from(new Set(rows.map((row) => String(row.assigned_to ?? "")).filter(Boolean)));
    const people = ids.length ? await restRequest<Array<Record<string, unknown>>>(request, `profiles?id=in.(${ids.join(",")})&select=id,name,email`) : [];
    const peopleById = new Map(people.map((person) => [String(person.id), person]));
    const partnerIds = Array.from(new Set(rows.map((row) => String(row.partner_id ?? "")).filter(Boolean)));
    const partners = partnerIds.length ? await restRequest<Array<Record<string, unknown>>>(request, `partners?id=in.(${partnerIds.join(",")})&select=id,name,company_name`) : [];
    const partnersById = new Map(partners.map((partner) => [String(partner.id), partner]));
    const today = new Date().toISOString().slice(0, 10);
    const tasks = rows.map((row) => {
      const person = peopleById.get(String(row.assigned_to ?? ""));
      const company = row.companies && typeof row.companies === "object" ? row.companies as Record<string, unknown> : null;
      const partner = partnersById.get(String(row.partner_id ?? ""));
      const overdue = !["concluido", "atrasado"].includes(String(row.status)) && String(row.due_date) < today;
      return { id: row.id, title: row.title, description: row.description, tenantId: row.company_id ?? "", companyName: company?.name ?? "", taskType: String(row.task_type ?? "outro").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), assignedTo: row.assigned_to ?? "", assignedToName: person?.name ?? person?.email ?? "", partnerId: row.partner_id ?? "", partnerName: partner?.name ?? partner?.company_name ?? "", dueDate: row.due_date, priority: priorityUi[String(row.priority)] ?? row.priority, status: statusUi[String(row.status)] ?? row.status, displayStatus: overdue ? "Atrasado" : statusUi[String(row.status)] ?? row.status, completedAt: row.completed_at ?? "", createdAt: row.created_at, updatedAt: row.updated_at };
    });
    return Response.json({ tasks });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAgencyAdministrator(request); const body = await request.json() as Record<string, unknown>; const status = normalizeLabel(body.status) || "pendente";
    if (!String(body.title ?? "").trim() || !String(body.dueDate ?? "")) return Response.json({ error: "Preencha título e data de entrega." }, { status: 400 });
    const rows = await restRequest<Array<Record<string, unknown>>>(request, "agency_tasks", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ title: String(body.title).trim(), description: String(body.description ?? "").trim(), company_id: String(body.tenantId ?? "").trim() || null, task_type: normalizeLabel(body.taskType) || "outro", assigned_to: String(body.assignedTo ?? "").trim() || null, partner_id: String(body.partnerId ?? "").trim() || null, due_date: body.dueDate, priority: normalizeLabel(body.priority) || "media", status, completed_at: status === "concluido" ? new Date().toISOString() : null, created_by: actor.id }) });
    return Response.json({ task: rows[0] }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
