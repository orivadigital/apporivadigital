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
    const rows = await restRequest<Array<Record<string, unknown>>>(request, `scheduled_posts?id=eq.${encodeURIComponent(id)}&select=id,company_id,assigned_to,partner_id,client_released_at&limit=1`);
    const post = rows[0];
    if (!post) return Response.json({ error: "Conteúdo não encontrado ou não atribuído ao seu perfil." }, { status: 404 });

    const action = String(body.action ?? "").trim();
    if (action) {
      if (!isAgency) return Response.json({ error: "Somente os sócios podem validar ou liberar conteúdos." }, { status: 403 });
      const tenantId = String(body.tenantId ?? post.company_id ?? "").trim();
      if (tenantId !== String(post.company_id)) return Response.json({ error: "Este conteúdo pertence a outra empresa." }, { status: 403 });
      const rpc = action === "validate_internal"
        ? "validate_scheduled_post_internal"
        : action === "release_to_client"
          ? "release_scheduled_post_to_client"
          : "";
      if (!rpc) return Response.json({ error: "Ação inválida." }, { status: 400 });
      await restRequest(request, `rpc/${rpc}`, { method: "POST", body: JSON.stringify({ p_post_id: id }) });
      return Response.json({ updated: true, action });
    }

    const assigned = String(body.assignedTo ?? "").trim();
    const partnerId = String(body.partnerId ?? "").trim();
    const values: Record<string, unknown> = {};
    const internalValues: Record<string, unknown> = {};
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
      if ("caption" in body || "workingCaption" in body) internalValues.working_caption = String(body.workingCaption ?? body.caption ?? "").trim();
      if ("internalReferences" in body) internalValues.internal_references = String(body.internalReferences ?? "").trim();
      if ("internalNotes" in body) internalValues.internal_notes = String(body.internalNotes ?? "").trim();
      if ("clientNotes" in body || "workingClientNotes" in body) internalValues.working_client_notes = String(body.workingClientNotes ?? body.clientNotes ?? "").trim();
      if ("status" in body) {
        const status = postStatusToDb(body.status);
        if (!POST_STATUSES.includes(status)) return Response.json({ error: "Situação do conteúdo inválida." }, { status: 400 });
        values.status = status;
      }
      if ("assignedTo" in body) {
        if (assigned) {
          if (!isUuid(assigned)) return Response.json({ error: "O responsável interno selecionado é inválido." }, { status: 400 });
          const profiles = await restRequest<Array<Record<string, unknown>>>(request, `profiles?id=eq.${encodeURIComponent(assigned)}&is_active=eq.true&role=in.(super_admin,socio,colaborador)&select=id&limit=1`);
          if (!profiles[0]) return Response.json({ error: "Selecione um responsável interno ativo." }, { status: 400 });
        }
        values.assigned_to = assigned || null;
      }
      if ("partnerId" in body) {
        if (partnerId) {
          if (!isUuid(partnerId)) return Response.json({ error: "O parceiro responsável selecionado é inválido." }, { status: 400 });
          const partners = await restRequest<Array<Record<string, unknown>>>(request, `partners?id=eq.${encodeURIComponent(partnerId)}&status=eq.ativo&select=id&limit=1`);
          if (!partners[0]) return Response.json({ error: "Selecione um parceiro ativo." }, { status: 400 });
        }
        values.partner_id = partnerId || null;
      }
    } else {
      const assignedInternally = actor.role === "colaborador" && String(post.assigned_to ?? "") === actor.id;
      const assignedAsPartner = Boolean(actor.partnerId) && String(post.partner_id ?? "") === actor.partnerId;
      const assignedToActor = assignedInternally || assignedAsPartner;
      if (!assignedToActor) return Response.json({ error: "Este conteúdo não está atribuído ao seu perfil." }, { status: 403 });
      if ("caption" in body || "workingCaption" in body || "description" in body) internalValues.working_caption = String(body.workingCaption ?? body.caption ?? body.description ?? "").trim();
      if ("internalReferences" in body) internalValues.internal_references = String(body.internalReferences ?? "").trim();
      if ("internalNotes" in body) internalValues.internal_notes = String(body.internalNotes ?? "").trim();
      if ("clientNotes" in body || "workingClientNotes" in body) internalValues.working_client_notes = String(body.workingClientNotes ?? body.clientNotes ?? "").trim();
      if ("status" in body) {
        const status = postStatusToDb(body.status);
        if (!POST_STATUSES.includes(status)) return Response.json({ error: "Situação do conteúdo inválida." }, { status: 400 });
        values.status = status;
      }
    }
    if (!Object.keys(values).length && !Object.keys(internalValues).length) return Response.json({ error: "Nenhuma alteração informada." }, { status: 400 });
    if (Object.keys(values).length) {
      const updated = await restRequest<Array<Record<string, unknown>>>(request, `scheduled_posts?id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(String(post.company_id))}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(values) });
      if (!updated[0]) return Response.json({ error: "Não foi possível atualizar este conteúdo." }, { status: 404 });
    }
    if (Object.keys(internalValues).length) {
      internalValues.validated_at = null;
      internalValues.validated_by = null;
      const updatedInternal = await restRequest<Array<Record<string, unknown>>>(request, `post_internal_details?post_id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(String(post.company_id))}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(internalValues) });
      if (!updatedInternal[0]) return Response.json({ error: "Não foi possível atualizar a área interna deste conteúdo." }, { status: 404 });
    }
    return Response.json({ updated: true });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params; const url = new URL(request.url); const access = await requireCompany(request, url.searchParams.get("tenant_id"));
    if (!access.isAgency) return Response.json({ error: "Somente a agência pode excluir conteúdos." }, { status: 403 });
    const files = await restRequest<Array<Record<string, unknown>>>(request, `post_files?post_id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(access.companyId)}&select=file_url`);
    await restRequest(request, `scheduled_posts?id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(access.companyId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    const paths = Array.from(new Set(files.map((file) => String(file.file_url))));
    for (const path of paths) {
      try {
        const references = await restRequest<Array<Record<string, unknown>>>(request, `post_files?file_url=eq.${encodeURIComponent(path)}&select=id&limit=1`);
        if (!references.length) await storageRequest(request, path, { method: "DELETE" });
      } catch {}
    }
    return Response.json({ deleted: true });
  } catch (error) { return jsonError(error); }
}
