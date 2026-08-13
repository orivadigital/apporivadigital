import { jsonError, requireAgencyAdministrator, restRequest } from "../../../lib/oriva-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAgencyAdministrator(request);
    const [approvalRows, partnerTaskRows] = await Promise.all([
      restRequest<Array<Record<string, unknown>>>(request, "scheduled_posts?status=eq.aguardando_aprovacao&select=id,title,company_id,scheduled_date,scheduled_time,companies(name)&order=scheduled_date.asc,scheduled_time.asc"),
      restRequest<Array<Record<string, unknown>>>(request, "agency_tasks?partner_id=not.is.null&status=in.(pendente,em_andamento,atrasado)&select=id,title,company_id,partner_id,due_date,status,companies(name)&order=due_date.asc"),
    ]);
    const partnerIds = Array.from(new Set(partnerTaskRows.map((row) => String(row.partner_id ?? "")).filter(Boolean)));
    const partners = partnerIds.length ? await restRequest<Array<Record<string, unknown>>>(request, `partners?id=in.(${partnerIds.join(",")})&select=id,name,company_name`) : [];
    const partnerById = new Map(partners.map((partner) => [String(partner.id), partner]));
    return Response.json({
      awaitingApproval: approvalRows.map((row) => ({ id: row.id, title: row.title, companyId: row.company_id, companyName: row.companies && typeof row.companies === "object" ? (row.companies as Record<string, unknown>).name : "", date: row.scheduled_date, time: String(row.scheduled_time ?? "").slice(0, 5) })),
      partnerTasks: partnerTaskRows.map((row) => ({ id: row.id, title: row.title, companyId: row.company_id, companyName: row.companies && typeof row.companies === "object" ? (row.companies as Record<string, unknown>).name : "", partnerId: row.partner_id, partnerName: partnerById.get(String(row.partner_id))?.name ?? partnerById.get(String(row.partner_id))?.company_name ?? "Parceiro", dueDate: row.due_date, status: row.status })),
    });
  } catch (error) { return jsonError(error); }
}
