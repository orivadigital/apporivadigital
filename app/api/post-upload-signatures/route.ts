import {
  createSignedStorageUpload,
  getActor,
  jsonError,
  requireCompany,
  restRequest,
  safeFileName,
  storageRequest,
} from "../../../lib/oriva-data";

export const dynamic = "force-dynamic";

type UploadDescriptor = {
  name?: unknown;
  type?: unknown;
  size?: unknown;
};

const MAX_FILES = 20;
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;

function isAllowedMimeType(value: string) {
  return value.startsWith("image/") || value.startsWith("video/") || value === "application/pdf";
}

function validateFiles(value: unknown) {
  if (!Array.isArray(value) || !value.length) {
    throw Response.json({ error: "Selecione pelo menos um arquivo." }, { status: 400 });
  }
  if (value.length > MAX_FILES) {
    throw Response.json({ error: "Envie no máximo 20 arquivos por vez." }, { status: 400 });
  }
  return value.map((raw, index) => {
    const file = (raw && typeof raw === "object" ? raw : {}) as UploadDescriptor;
    const name = String(file.name ?? "").trim();
    const type = String(file.type ?? "application/octet-stream").trim().toLowerCase();
    const size = Number(file.size ?? 0);
    if (!name || name.length > 255 || !Number.isFinite(size) || size < 1 || size > MAX_FILE_SIZE || !isAllowedMimeType(type)) {
      throw Response.json({ error: `O arquivo ${index + 1} é inválido ou não é compatível.` }, { status: 400 });
    }
    return { name, type, size };
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const files = validateFiles(body.files);
    const postId = String(body.postId ?? "").trim();
    let companyId = String(body.tenantId ?? "").trim();
    let prefix = "";
    let startOrder = 0;

    if (postId) {
      const actor = await getActor(request);
      if (!["super_admin", "socio", "colaborador", "parceiro"].includes(actor.role)) {
        return Response.json({ error: "Seu perfil não pode anexar materiais a conteúdos." }, { status: 403 });
      }
      const posts = await restRequest<Array<Record<string, unknown>>>(
        request,
        `scheduled_posts?id=eq.${encodeURIComponent(postId)}&select=id,company_id,assigned_to&limit=1`,
      );
      const post = posts[0];
      if (!post?.company_id) return Response.json({ error: "Conteúdo não encontrado." }, { status: 404 });
      if (["colaborador", "parceiro"].includes(actor.role) && String(post.assigned_to ?? "") !== actor.id) {
        return Response.json({ error: "Este conteúdo não está atribuído ao seu perfil." }, { status: 403 });
      }
      companyId = String(post.company_id);
      const lastRows = await restRequest<Array<Record<string, unknown>>>(
        request,
        `post_files?post_id=eq.${encodeURIComponent(postId)}&select=order_index&order=order_index.desc&limit=1`,
      );
      startOrder = Number(lastRows[0]?.order_index ?? -1) + 1;
      prefix = `companies/${companyId}/posts/${postId}/original`;
    } else {
      const access = await requireCompany(request, companyId);
      if (!access.isAgency) return Response.json({ error: "Somente a agência pode criar conteúdos." }, { status: 403 });
      companyId = access.companyId;
      const companies = await restRequest<Array<Record<string, unknown>>>(
        request,
        `companies?id=eq.${encodeURIComponent(companyId)}&select=id,relationship_type&limit=1`,
      );
      if (!companies[0]) return Response.json({ error: "Empresa não encontrada." }, { status: 404 });
      if (companies[0].relationship_type === "lead") {
        return Response.json({ error: "Leads não podem receber conteúdos. Converta o lead em cliente primeiro." }, { status: 400 });
      }
      prefix = `companies/${companyId}/posts/bulk-${crypto.randomUUID()}/original`;
    }

    const uploads = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const orderIndex = startOrder + index;
      const path = `${prefix}/${String(orderIndex).padStart(3, "0")}-${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const signed = await createSignedStorageUpload(request, path);
      uploads.push({
        ...signed,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        mimeType: file.type,
        orderIndex,
      });
    }

    return Response.json({ uploads, companyId, postId: postId || null });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const actor = await getActor(request);
    const companyId = String(body.tenantId ?? "").trim();
    const postId = String(body.postId ?? "").trim();
    const paths = Array.isArray(body.paths) ? body.paths.map(String).slice(0, MAX_FILES) : [];
    if (!companyId || !paths.length) return Response.json({ cleaned: 0 });
    if (!["super_admin", "socio", "colaborador", "parceiro"].includes(actor.role)) {
      return Response.json({ error: "Seu perfil não pode remover estes envios." }, { status: 403 });
    }
    if (postId && ["colaborador", "parceiro"].includes(actor.role)) {
      const posts = await restRequest<Array<Record<string, unknown>>>(
        request,
        `scheduled_posts?id=eq.${encodeURIComponent(postId)}&select=id,company_id,assigned_to&limit=1`,
      );
      const post = posts[0];
      if (!post || String(post.company_id ?? "") !== companyId || String(post.assigned_to ?? "") !== actor.id) {
        return Response.json({ error: "Este conteúdo não está atribuído ao seu perfil." }, { status: 403 });
      }
    }
    const allowedPrefix = postId
      ? `companies/${companyId}/posts/${postId}/original/`
      : `companies/${companyId}/posts/bulk-`;
    let cleaned = 0;
    for (const path of paths) {
      if (!path.startsWith(allowedPrefix) || path.includes("..")) continue;
      try {
        await storageRequest(request, path, { method: "DELETE" });
        cleaned += 1;
      } catch {}
    }
    return Response.json({ cleaned });
  } catch (error) {
    return jsonError(error);
  }
}
