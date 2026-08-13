import { CONTENT_TYPES, getActor, invokeUserFunction, jsonError, NETWORKS, POST_STATUSES, contentTypeToDb, networkToDb, postStatusToDb, requireCompany, restRequest, storageRequest } from "../../../../lib/oriva-data";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params; const body = await request.json() as Record<string, unknown>;
    const actor = await getActor(request);
    if (actor.role === "empresa_cliente") {
      const feedback = String(body.clientFeedback ?? "").trim();
      const status = String(body.status ?? "");
      const decision = status ? (status === "Aprovado" ? "aprovar" : status === "Revisão solicitada" ? "solicitar_alteracao" : "") : "comentar";
      if (!decision) return Response.json({ error: "O cliente pode aprovar, comentar ou solicitar alteração." }, { status: 403 });
      await invokeUserFunction(request, "review-content", { post_id: id, decision, feedback });
      return Response.json({ updated: true });
    }

    const isAgency = actor.role === "super_admin" || actor.role === "socio";
    const isAssignedUser = actor.role === "colaborador" || actor.role === "parceiro";
    if (!isAgency && !isAssignedUser) return Response.json({ error: "Você não pode editar este conteúdo." }, { status: 403 });
    const rows = await restRequest<Array<Record<string, unknown>>>(request, `scheduled_posts?id=eq.${encodeURIComponent(id)}&select=id,company_id,assigned_to&limit=1`);
    const post = rows[0];
    if (!post) return Response.json({ error: "Conteúdo não encontrado ou não atribuído ao seu perfil." }, { status: 404 });

    const assigned = String(body.assignedTo ?? "").trim();
    const values: Record<string, unknown> = {};
    if (isAgency) {
      const tenantId = String(body.tenantId ?? post.company_id ?? "").trim();
      if (tenantId !== String(post.company_id)) return Response.json({ error: "Este conteúdo pertence a outra empresa." }, { status: 403 });
      if ("title" in body) values.title = String(body.title ?? "").trim();
      if ("contentType" in body) {
        const contentType = contentTypeToDb(body.contentType);
        if (!CONTENT_TYPES.includes(contentType)) return Response.json({ error: "Tipo de conteúdo inválido." }, { status: 400 });
        values.content_type = contentType;
      }
      if ("socialNetwork" in body) {
        const network = networkToDb(body.socialNetwork);
        if (!NETWORKS.includes(network)) return Response.json({ error: "Rede social inválida." }, { status: 400 });
        values.social_network = network;
      }
      if ("scheduledDate" in body) values.scheduled_date = body.scheduledDate;
      if ("scheduledTime" in body) values.scheduled_time = body.scheduledTime;
      if ("caption" in body) values.caption = String(body.caption ?? "").trim();
      if ("internalNotes" in body) values.internal_notes = String(body.internalNotes ?? "").trim();
      if ("clientNotes" in body) values.client_notes = String(body.clientNotes ?? "").trim();
      if ("status" in body) {
        const status = postStatusToDb(body.status);
        if (!POST_STATUSES.includes(status)) return Response.json({ error: "Situação do conteúdo inválida." }, { status: 400 });
        values.status = status;
      }
      if ("assignedTo" in body) values.assigned_to = isUuid(assigned) ? assigned : null;
    } else {
      if (String(post.assigned_to ?? "") !== actor.id) return Response.json({ error: "Este conteúdo não está atribuído ao seu perfil." }, { status: 403 });
      if ("caption" in body || "description" in body) values.caption = String(body.caption ?? body.description ?? "").trim();
      if ("status" in body) {
        const status = postStatusToDb(body.status);
        if (!POST_STATUSES.includes(status)) return Response.json({ error: "Situação do conteúdo inválida." }, { status: 400 });
        values.status = status;
      }
    }
    if (!Object.keys(values).length) return Response.json({ error: "Nenhuma alteração informada." }, { status: 400 });
    const updated = await restRequest<Array<Record<string, unknown>>>(request, `scheduled_posts?id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(String(post.company_id))}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(values) });
    if (!updated[0]) return Response.json({ error: "Não foi possível atualizar este conteúdo." }, { status: 404 });
    return Response.json({ updated: true });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params; const url = new URL(request.url); const access = await requireCompany(request, url.searchParams.get("tenant_id"));
    if (!access.isAgency) return Response.json({ error: "Somente a agência pode excluir conteúdos." }, { status: 403 });
    const files = await restRequest<Array<Record<string, unknown>>>(request, `post_files?post_id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(access.companyId)}&select=file_url`);
    for (const file of files) { try { await storageRequest(request, String(file.file_url), { method: "DELETE" }); } catch {} }
    await restRequest(request, `scheduled_posts?id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(access.companyId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    return Response.json({ deleted: true });
  } catch (error) { return jsonError(error); }
}
