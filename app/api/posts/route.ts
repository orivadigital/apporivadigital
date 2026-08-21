import {
  CONTENT_TYPES,
  NETWORKS,
  POST_STATUSES,
  contentTypeToDb,
  contentTypeToUi,
  getActor,
  jsonError,
  networkToDb,
  networkToUi,
  postStatusToDb,
  postStatusToUi,
  requireCompany,
  restRequest,
  safeFileName,
  storageRequest,
} from "../../../lib/oriva-data";

export const dynamic = "force-dynamic";

function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

function mapPost(row: Record<string, unknown>, files: Array<Record<string, unknown>>, comments: Array<Record<string, unknown>>, isAgency: boolean, canSeeAssignments: boolean) {
  const post: Record<string, unknown> = {
    id: row.id,
    tenantId: row.company_id,
    title: row.title,
    contentType: contentTypeToUi(row.content_type),
    socialNetwork: networkToUi(row.social_network),
    scheduledDate: row.scheduled_date,
    scheduledTime: String(row.scheduled_time ?? "").slice(0, 5),
    caption: row.caption ?? "",
    clientNotes: row.client_notes ?? "",
    status: postStatusToUi(row.status),
    clientFeedback: row.client_feedback ?? "",
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    files: files.map((file) => ({
      id: file.id,
      fileName: file.file_name,
      fileType: file.mime_type,
      fileSize: file.file_size,
      sortOrder: file.order_index,
      uploadedBy: file.uploaded_by ?? "",
      r2Key: file.file_url,
      previewUrl: `/api/files?id=${encodeURIComponent(String(file.id))}`,
      downloadUrl: `/api/files?id=${encodeURIComponent(String(file.id))}&download=1`,
    })),
    comments: comments.map((comment) => {
      const profile = comment.profiles && typeof comment.profiles === "object" ? comment.profiles as Record<string, unknown> : null;
      return { id: comment.id, comment: comment.comment, commentType: comment.comment_type, author: profile?.name ?? "Usuário", createdAt: comment.created_at };
    }),
  };
  if (canSeeAssignments) {
    post.hasResponsible = Boolean(row.assigned_to || row.partner_id);
    post.assignedTo = row.assigned_to ?? "";
    post.partnerId = row.partner_id ?? "";
  }
  if (isAgency) post.internalNotes = row.internal_notes ?? "";
  return post;
}

async function validateAssignments(request: Request, assignedTo: string, partnerId: string) {
  if (assignedTo) {
    if (!isUuid(assignedTo)) throw Response.json({ error: "O responsável interno selecionado é inválido." }, { status: 400 });
    const profiles = await restRequest<Array<Record<string, unknown>>>(
      request,
      `profiles?id=eq.${encodeURIComponent(assignedTo)}&is_active=eq.true&role=in.(super_admin,socio,colaborador)&select=id&limit=1`,
    );
    if (!profiles[0]) throw Response.json({ error: "Selecione um responsável interno ativo." }, { status: 400 });
  }
  if (partnerId) {
    if (!isUuid(partnerId)) throw Response.json({ error: "O parceiro responsável selecionado é inválido." }, { status: 400 });
    const partners = await restRequest<Array<Record<string, unknown>>>(
      request,
      `partners?id=eq.${encodeURIComponent(partnerId)}&status=eq.ativo&select=id&limit=1`,
    );
    if (!partners[0]) {
      throw Response.json({ error: "Selecione um parceiro ativo." }, { status: 400 });
    }
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const actor = await getActor(request);
    const requestedCompanyId = String(url.searchParams.get("tenant_id") ?? "").trim();
    const isAgency = actor.role === "super_admin" || actor.role === "socio";
    const isAssignedUser = actor.role === "colaborador" || actor.role === "parceiro";
    let companyId = requestedCompanyId;
    if (actor.role === "empresa_cliente") {
      if (!actor.companyId) return Response.json({ error: "Nenhuma empresa está vinculada ao seu login." }, { status: 403 });
      if (companyId && companyId !== actor.companyId) return Response.json({ error: "Você não possui acesso a esta empresa." }, { status: 403 });
      companyId = actor.companyId;
    } else if (!isAgency && !isAssignedUser) {
      return Response.json({ error: "Seu perfil não possui acesso ao calendário de conteúdos." }, { status: 403 });
    }
    if (!companyId) return Response.json({ error: "Selecione uma empresa." }, { status: 400 });
    if (isAssignedUser) {
      const companies = await restRequest<Array<Record<string, unknown>>>(request, `companies?id=eq.${encodeURIComponent(companyId)}&select=id&limit=1`);
      if (!companies[0]) return Response.json({ error: "Empresa não encontrada entre os seus conteúdos atribuídos." }, { status: 404 });
    }
    const params = new URLSearchParams({ company_id: `eq.${companyId}`, select: "*", order: "scheduled_date.asc,scheduled_time.asc,created_at.asc" });
    if (actor.role === "colaborador") {
      if (actor.partnerId) {
        params.set("or", `(assigned_to.eq.${actor.id},partner_id.eq.${actor.partnerId})`);
      } else {
        params.set("assigned_to", `eq.${actor.id}`);
      }
    }
    if (actor.role === "parceiro") {
      if (!actor.partnerId) return Response.json({ error: "Seu perfil ainda não está vinculado a um parceiro." }, { status: 403 });
      params.set("partner_id", `eq.${actor.partnerId}`);
    }
    const status = url.searchParams.get("status"); if (status) params.set("status", `eq.${postStatusToDb(status)}`);
    const contentType = url.searchParams.get("content_type"); if (contentType) params.set("content_type", `eq.${contentTypeToDb(contentType)}`);
    const network = url.searchParams.get("social_network"); if (network) params.set("social_network", `eq.${networkToDb(network)}`);
    const from = url.searchParams.get("from"); if (from) params.set("scheduled_date", `gte.${from}`);
    const to = url.searchParams.get("to"); if (to) params.append("scheduled_date", `lte.${to}`);
    const rows = await restRequest<Array<Record<string, unknown>>>(request, `scheduled_posts?${params.toString()}`);
    const ids = rows.map((row) => String(row.id));
    const fileRows = ids.length ? await restRequest<Array<Record<string, unknown>>>(request, `post_files?post_id=in.(${ids.join(",")})&select=*&order=order_index.asc`) : [];
    const commentRows = ids.length ? await restRequest<Array<Record<string, unknown>>>(request, `post_comments?post_id=in.(${ids.join(",")})&select=id,post_id,profile_id,comment,comment_type,created_at,profiles(name)&order=created_at.asc`) : [];
    const filesByPost = new Map<string, Array<Record<string, unknown>>>();
    for (const file of fileRows) { const key = String(file.post_id); const current = filesByPost.get(key) ?? []; current.push(file); filesByPost.set(key, current); }
    const commentsByPost = new Map<string, Array<Record<string, unknown>>>();
    for (const comment of commentRows) { const key = String(comment.post_id); const current = commentsByPost.get(key) ?? []; current.push(comment); commentsByPost.set(key, current); }
    return Response.json({
      posts: rows.map((row) => mapPost(row, filesByPost.get(String(row.id)) ?? [], commentsByPost.get(String(row.id)) ?? [], isAgency, isAgency || isAssignedUser)),
      tenantId: companyId,
      permissions: {
        canManage: isAgency,
        canReview: actor.role === "empresa_cliente",
        canEditAssigned: isAssignedUser,
        canAttach: isAgency || isAssignedUser,
        restricted: isAssignedUser,
      },
    });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  const uploadedPaths: string[] = [];
  try {
    const isJson = (request.headers.get("content-type") ?? "").includes("application/json");
    const body = isJson ? await request.json() as Record<string, unknown> : null;
    const form = isJson ? null : await request.formData();
    const tenantId = String(body?.tenantId ?? form?.get("tenant_id") ?? "").trim();
    const access = await requireCompany(request, tenantId);
    if (!access.isAgency) return Response.json({ error: "Somente a agência pode criar conteúdos." }, { status: 403 });
    const companies = await restRequest<Array<Record<string, unknown>>>(request, `companies?id=eq.${encodeURIComponent(access.companyId)}&select=id,relationship_type&limit=1`);
    if (!companies[0]) return Response.json({ error: "Empresa não encontrada." }, { status: 404 });
    if (companies[0].relationship_type === "lead") {
      return Response.json({ error: "Leads não podem receber conteúdos. Converta o lead em cliente antes de usar o calendário de posts." }, { status: 400 });
    }

    const title = String(body?.title ?? form?.get("title") ?? "").trim();
    const contentType = contentTypeToDb(body?.contentType ?? form?.get("content_type"));
    const network = networkToDb(body?.socialNetwork ?? form?.get("social_network"));
    const status = postStatusToDb(body?.status ?? form?.get("status") ?? "Rascunho");
    const jsonSchedules = Array.isArray(body?.schedules) ? body.schedules as Array<Record<string, unknown>> : [];
    const scheduledDates = isJson
      ? jsonSchedules.map((item) => String(item.date ?? "").trim())
      : form!.getAll("scheduled_date").map((value) => String(value ?? "").trim());
    const scheduleDescriptions = isJson
      ? jsonSchedules.map((item) => String(item.description ?? "").trim())
      : form!.getAll("schedule_description").map((value) => String(value ?? "").trim());
    const scheduledTime = String(body?.scheduledTime ?? form?.get("scheduled_time") ?? "");
    const assigned = String(body?.assignedTo ?? form?.get("assigned_to") ?? "").trim();
    const partnerId = String(body?.partnerId ?? form?.get("partner_id") ?? "").trim();
    if (!title || !scheduledDates.length || scheduledDates.some((date) => !date) || !scheduledTime) return Response.json({ error: "Título, todas as datas e horário são obrigatórios." }, { status: 400 });
    if (scheduledDates.length > 31) return Response.json({ error: "Cadastre no máximo 31 datas por vez." }, { status: 400 });
    if (scheduledDates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) return Response.json({ error: "Uma das datas programadas é inválida." }, { status: 400 });
    if (!CONTENT_TYPES.includes(contentType) || !NETWORKS.includes(network) || !POST_STATUSES.includes(status)) return Response.json({ error: "Tipo, rede social ou status inválido." }, { status: 400 });
    await validateAssignments(request, assigned, partnerId);

    const defaultCaption = String(body?.caption ?? form?.get("caption") ?? "").trim();
    const basePost = {
      title,
      content_type: contentType,
      social_network: network,
      scheduled_time: scheduledTime,
      internal_notes: String(body?.internalNotes ?? form?.get("internal_notes") ?? "").trim(),
      client_notes: String(body?.clientNotes ?? form?.get("client_notes") ?? "").trim(),
      status,
      assigned_to: assigned || null,
      partner_id: partnerId || null,
    };
    const rowsToCreate = scheduledDates.map((scheduledDate, index) => ({
      ...basePost,
      title: scheduleDescriptions[index] || title,
      scheduled_date: scheduledDate,
      caption: scheduleDescriptions[index] || defaultCaption,
    }));

    const files = form
      ? form.getAll("files").filter((value): value is File => typeof value !== "string" && value.size > 0 && Boolean(value.name))
      : [];
    if (files.length > 20) throw new Error("Envie no máximo 20 arquivos por conteúdo.");
    const sharedFiles: Array<Record<string, unknown>> = [];
    const batchId = crypto.randomUUID();
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const path = `companies/${access.companyId}/posts/bulk-${batchId}/original/${String(index).padStart(2, "0")}-${crypto.randomUUID()}-${safeFileName(file.name)}`;
      await storageRequest(request, path, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" }, body: await file.arrayBuffer() });
      uploadedPaths.push(path);
      sharedFiles.push({ company_id: access.companyId, file_url: path, original_file_url: path, file_name: file.name, file_type: file.type || "application/octet-stream", file_size: file.size, mime_type: file.type || "application/octet-stream", order_index: index, uploaded_by: access.actor.id });
    }

    if (isJson) {
      const directFiles = Array.isArray(body?.uploadedFiles) ? body.uploadedFiles : [];
      if (directFiles.length > 20) throw new Error("Envie no máximo 20 arquivos por conteúdo.");
      for (let index = 0; index < directFiles.length; index += 1) {
        const raw = directFiles[index] && typeof directFiles[index] === "object"
          ? directFiles[index] as Record<string, unknown>
          : {};
        const path = String(raw.path ?? "").trim();
        const fileName = String(raw.fileName ?? "").trim();
        const mimeType = String(raw.mimeType ?? raw.fileType ?? "").trim().toLowerCase();
        const fileSize = Number(raw.fileSize ?? 0);
        const orderIndex = Number(raw.orderIndex ?? index);
        const prefix = `companies/${access.companyId}/posts/bulk-`;
        if (!path.startsWith(prefix) || !path.includes("/original/") || path.includes("..") || !fileName || !Number.isFinite(fileSize) || fileSize < 1 || !Number.isInteger(orderIndex) || orderIndex < 0) {
          throw new Error("Um ou mais arquivos enviados são inválidos.");
        }
        uploadedPaths.push(path);
        sharedFiles.push({
          file_url: path,
          original_file_url: path,
          file_name: fileName,
          file_type: mimeType,
          file_size: fileSize,
          mime_type: mimeType,
          order_index: orderIndex,
        });
      }
    }

    const posts = await restRequest<Array<Record<string, unknown>>>(
      request,
      "rpc/create_scheduled_posts_batch",
      {
        method: "POST",
        body: JSON.stringify({
          p_company_id: access.companyId,
          p_posts: rowsToCreate,
          p_files: sharedFiles,
        }),
      },
    );
    const postIds = posts.map((post) => String(post.id ?? "")).filter(Boolean);
    if (postIds.length !== rowsToCreate.length) throw new Error("Não foi possível criar todos os conteúdos.");
    return Response.json({ id: postIds[0], ids: postIds, created: true, createdCount: postIds.length }, { status: 201 });
  } catch (error) {
    for (const path of uploadedPaths) { try { await storageRequest(request, path, { method: "DELETE" }); } catch {} }
    return jsonError(error);
  }
}
