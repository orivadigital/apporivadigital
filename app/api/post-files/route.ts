import { getActor, jsonError, restRequest, safeFileName, storageRequest } from "../../../lib/oriva-data";

export const dynamic = "force-dynamic";

function canWorkWithAssignedContent(role: string) {
  return ["super_admin", "socio", "colaborador", "parceiro"].includes(role);
}

export async function GET(request: Request) {
  try {
    await getActor(request);
    const postId = new URL(request.url).searchParams.get("post_id") ?? "";
    if (!postId) return Response.json({ error: "Conteúdo não informado." }, { status: 400 });
    const rows = await restRequest<Array<Record<string, unknown>>>(request, `post_files?post_id=eq.${encodeURIComponent(postId)}&select=*&order=order_index.asc,created_at.asc`);
    return Response.json({ files: rows.map((file) => ({
      id: file.id,
      fileName: file.file_name,
      fileType: file.mime_type,
      fileSize: file.file_size,
      sortOrder: file.order_index,
      uploadedBy: file.uploaded_by ?? "",
      previewUrl: `/api/files?id=${encodeURIComponent(String(file.id))}`,
      downloadUrl: `/api/files?id=${encodeURIComponent(String(file.id))}&download=1`,
      createdAt: file.created_at,
    })) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  const uploaded: string[] = [];
  try {
    const actor = await getActor(request);
    if (!canWorkWithAssignedContent(actor.role)) return Response.json({ error: "Seu perfil não pode anexar materiais a conteúdos." }, { status: 403 });
    const isJson = (request.headers.get("content-type") ?? "").includes("application/json");
    const body = isJson ? await request.json() as Record<string, unknown> : null;
    const form = isJson ? null : await request.formData();
    const postId = String(body?.postId ?? form?.get("post_id") ?? "").trim();
    if (!postId) return Response.json({ error: "Conteúdo não informado." }, { status: 400 });
    const posts = await restRequest<Array<Record<string, unknown>>>(request, `scheduled_posts?id=eq.${encodeURIComponent(postId)}&select=id,company_id,assigned_to,partner_id&limit=1`);
    const post = posts[0];
    if (!post?.company_id) return Response.json({ error: "Conteúdo não encontrado ou não atribuído ao seu perfil." }, { status: 404 });
    const assignedInternally = actor.role === "colaborador" && String(post.assigned_to ?? "") === actor.id;
    const assignedAsPartner = ["colaborador", "parceiro"].includes(actor.role)
      && Boolean(actor.partnerId)
      && String(post.partner_id ?? "") === actor.partnerId;
    const assignedToActor = ["super_admin", "socio"].includes(actor.role)
      || assignedInternally
      || assignedAsPartner;
    if (!assignedToActor) {
      return Response.json({ error: "Este conteúdo não está atribuído ao seu perfil." }, { status: 403 });
    }
    const files = form
      ? form.getAll("files").filter((value): value is File => typeof value !== "string" && value.size > 0 && Boolean(value.name))
      : [];
    const directFiles = isJson && Array.isArray(body?.uploadedFiles) ? body.uploadedFiles : [];
    if (!files.length && !directFiles.length) return Response.json({ error: "Selecione pelo menos um arquivo." }, { status: 400 });
    if (files.length > 20) return Response.json({ error: "Envie no máximo 20 arquivos por vez." }, { status: 400 });
    const lastRows = await restRequest<Array<Record<string, unknown>>>(request, `post_files?post_id=eq.${encodeURIComponent(postId)}&select=order_index&order=order_index.desc&limit=1`);
    const startOrder = Number(lastRows[0]?.order_index ?? -1) + 1;
    const metadata: Array<Record<string, unknown>> = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const orderIndex = startOrder + index;
      const path = `companies/${post.company_id}/posts/${postId}/original/${String(orderIndex).padStart(3, "0")}-${crypto.randomUUID()}-${safeFileName(file.name)}`;
      await storageRequest(request, path, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" },
        body: await file.arrayBuffer(),
      });
      uploaded.push(path);
      metadata.push({
        post_id: postId,
        company_id: post.company_id,
        file_url: path,
        original_file_url: path,
        file_name: file.name,
        file_type: file.type || "application/octet-stream",
        file_size: file.size,
        mime_type: file.type || "application/octet-stream",
        order_index: orderIndex,
        uploaded_by: actor.id,
      });
    }

    if (directFiles.length > 20) return Response.json({ error: "Envie no máximo 20 arquivos por vez." }, { status: 400 });
    for (let index = 0; index < directFiles.length; index += 1) {
      const raw = directFiles[index] && typeof directFiles[index] === "object"
        ? directFiles[index] as Record<string, unknown>
        : {};
      const path = String(raw.path ?? "").trim();
      const fileName = String(raw.fileName ?? "").trim();
      const mimeType = String(raw.mimeType ?? raw.fileType ?? "").trim().toLowerCase();
      const fileSize = Number(raw.fileSize ?? 0);
      const orderIndex = Number(raw.orderIndex ?? startOrder + index);
      const prefix = `companies/${post.company_id}/posts/${postId}/original/`;
      if (!path.startsWith(prefix) || path.includes("..") || !fileName || !Number.isFinite(fileSize) || fileSize < 1 || !Number.isInteger(orderIndex) || orderIndex < 0) {
        throw new Error("Um ou mais arquivos enviados são inválidos.");
      }
      uploaded.push(path);
      metadata.push({
        file_url: path,
        original_file_url: path,
        file_name: fileName,
        file_type: mimeType,
        file_size: fileSize,
        mime_type: mimeType,
        order_index: orderIndex,
      });
    }

    await restRequest(request, "rpc/attach_scheduled_post_files", {
      method: "POST",
      body: JSON.stringify({ p_post_id: postId, p_files: metadata }),
    });
    return Response.json({ created: metadata.length }, { status: 201 });
  } catch (error) {
    for (const path of uploaded) { try { await storageRequest(request, path, { method: "DELETE" }); } catch {} }
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await getActor(request);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) return Response.json({ error: "Arquivo não informado." }, { status: 400 });
    const rows = await restRequest<Array<Record<string, unknown>>>(request, `post_files?id=eq.${encodeURIComponent(id)}&select=id,post_id,file_url,uploaded_by&limit=1`);
    const file = rows[0];
    if (!file) return Response.json({ error: "Arquivo não encontrado." }, { status: 404 });
    const administrator = actor.role === "super_admin" || actor.role === "socio";
    if (!administrator && String(file.uploaded_by ?? "") !== actor.id) {
      return Response.json({ error: "Você só pode excluir arquivos enviados pelo seu próprio perfil." }, { status: 403 });
    }
    const references = await restRequest<Array<Record<string, unknown>>>(request, `post_files?file_url=eq.${encodeURIComponent(String(file.file_url))}&select=id&limit=2`);
    if (references.length <= 1) await storageRequest(request, String(file.file_url), { method: "DELETE" });
    await restRequest(request, `post_files?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    return Response.json({ deleted: true });
  } catch (error) { return jsonError(error); }
}
