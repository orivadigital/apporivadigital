import { getActor, jsonError, restRequest, storageRequest } from "../../../lib/oriva-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await getActor(request); const url = new URL(request.url); const id = url.searchParams.get("id") ?? "";
    if (!id) return Response.json({ error: "Arquivo não informado." }, { status: 400 });
    const entity = url.searchParams.get("entity") ?? "post";
    const table = entity === "task" ? "task_files" : entity === "contract" ? "contract_files" : "post_files";
    const rows = await restRequest<Array<Record<string, unknown>>>(request, `${table}?id=eq.${encodeURIComponent(id)}&select=file_url,file_name,mime_type,file_size&limit=1`);
    const file = rows[0]; if (!file) return Response.json({ error: "Arquivo não encontrado." }, { status: 404 });
    const object = await storageRequest(request, String(file.file_url), { method: "GET" });
    const disposition = url.searchParams.get("download") ? `attachment; filename*=UTF-8''${encodeURIComponent(String(file.file_name))}` : `inline; filename*=UTF-8''${encodeURIComponent(String(file.file_name))}`;
    return new Response(object.body, { headers: { "Cache-Control": "private, max-age=900", "Content-Disposition": disposition, "Content-Type": String(file.mime_type || "application/octet-stream"), "Content-Length": String(file.file_size ?? "") } });
  } catch (error) { return jsonError(error); }
}
