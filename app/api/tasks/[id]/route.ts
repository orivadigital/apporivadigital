import { getActor, jsonError, normalizeLabel, requireAgencyAdministrator, restRequest } from "../../../../lib/oriva-data";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const TASK_STATUSES = new Set(["pendente", "em_andamento", "atrasado", "concluido"]);

export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await getActor(request);
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const administrator = actor.role === "super_admin" || actor.role === "socio";
    if (!administrator && actor.role !== "colaborador" && actor.role !== "parceiro") {
      return Response.json({ error: "Você não pode editar esta demanda." }, { status: 403 });
    }

    const visible = await restRequest<Array<Record<string, unknown>>>(request, `agency_tasks?id=eq.${encodeURIComponent(id)}&select=id&limit=1`);
    if (!visible[0]) return Response.json({ error: "Demanda não encontrada ou não atribuída ao seu perfil." }, { status: 404 });

    const status = normalizeLabel(body.status);
    if (status && !TASK_STATUSES.has(status)) return Response.json({ error: "Situação da demanda inválida." }, { status: 400 });
    const values: Record<string, unknown> = {};
    if (administrator) {
      values.title = String(body.title ?? "").trim();
      values.description = String(body.description ?? "").trim();
      values.company_id = String(body.tenantId ?? "").trim() || null;
      values.task_type = normalizeLabel(body.taskType) || "outro";
      values.assigned_to = String(body.assignedTo ?? "").trim() || null;
      values.partner_id = String(body.partnerId ?? "").trim() || null;
      values.due_date = body.dueDate;
      values.priority = normalizeLabel(body.priority) || "media";
      values.status = status || "pendente";
      values.completed_at = values.status === "concluido" ? (body.completedAt || new Date().toISOString()) : null;
    } else {
      if ("description" in body) values.description = String(body.description ?? "").trim();
      if (status) {
        values.status = status;
        values.completed_at = status === "concluido" ? (body.completedAt || new Date().toISOString()) : null;
      }
      if (!Object.keys(values).length) return Response.json({ error: "Informe a descrição ou a situação que deseja atualizar." }, { status: 400 });
    }
    const updated = await restRequest<Array<Record<string, unknown>>>(request, `agency_tasks?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(values),
    });
    if (!updated[0]) return Response.json({ error: "Não foi possível atualizar esta demanda." }, { status: 404 });
    return Response.json({ updated: true });
  } catch (error) { return jsonError(error); }
}
export async function DELETE(request: Request, context: Context) {
  try { await requireAgencyAdministrator(request); const { id } = await context.params; await restRequest(request, `agency_tasks?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); return Response.json({ deleted: true }); } catch (error) { return jsonError(error); }
}
