import { jsonError, requireAgencyAdministrator, restRequest } from "../../../lib/oriva-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAgencyAdministrator(request);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    const today = now.toISOString().slice(0, 10);
    const [companies, tasks, partners] = await Promise.all([
      restRequest<Array<Record<string, unknown>>>(request, "companies?select=id,name,status,relationship_type,created_at,updated_at"),
      restRequest<Array<Record<string, unknown>>>(request, "agency_tasks?select=id,title,company_id,partner_id,due_date,status,completed_at,companies(name)"),
      restRequest<Array<Record<string, unknown>>>(request, "partners?select=id,name,company_name"),
    ]);
    const isMonth = (value: unknown) => String(value ?? "") >= monthStart && String(value ?? "") < nextMonth;
    const partnerById = new Map(partners.map((partner) => [String(partner.id), partner]));
    const openTasks = tasks.filter((task) => task.status !== "concluido");
    const completedTasks = tasks.filter((task) => task.status === "concluido");
    const overdueTasks = openTasks.filter((task) => String(task.due_date) < today || task.status === "atrasado");
    const group = (rows: Array<Record<string, unknown>>, keyName: "partner_id" | "company_id") => {
      const counts = new Map<string, number>();
      rows.forEach((row) => { const key = String(row[keyName] ?? ""); if (key) counts.set(key, (counts.get(key) ?? 0) + 1); });
      return Array.from(counts.entries()).map(([id, count]) => {
        if (keyName === "partner_id") {
          const partner = partnerById.get(id);
          return { id, name: partner?.name ?? partner?.company_name ?? "Parceiro", count };
        }
        const company = companies.find((item) => String(item.id) === id);
        return { id, name: company?.name ?? "Empresa", count };
      }).sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
    };
    return Response.json({
      clientsActive: companies.filter((company) => company.relationship_type === "cliente" && company.status === "ativo").length,
      clientsNewMonth: companies.filter((company) => company.relationship_type === "cliente" && isMonth(company.created_at)).length,
      clientsLostMonth: companies.filter((company) => company.relationship_type === "cliente" && company.status === "encerrado" && isMonth(company.updated_at)).length,
      leads: companies.filter((company) => company.relationship_type === "lead").length,
      tasksOpen: openTasks.length,
      tasksCompleted: completedTasks.length,
      tasksOverdue: overdueTasks.length,
      tasksByPartner: group(openTasks.filter((task) => task.partner_id), "partner_id"),
      deliveriesByPartner: group(completedTasks.filter((task) => task.partner_id), "partner_id"),
      deliveriesByClient: group(completedTasks.filter((task) => task.company_id), "company_id"),
    });
  } catch (error) { return jsonError(error); }
}
