import { jsonError, requireAgencyAdministrator, restRequest, safeFileName, storageRequest } from "../../../lib/oriva-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAgencyAdministrator(request);
    const contractId = new URL(request.url).searchParams.get("contract_id") ?? "";
    if (!contractId) return Response.json({ error: "Contrato não informado." }, { status: 400 });
    const rows = await restRequest<Array<Record<string, unknown>>>(request, `contract_files?contract_id=eq.${encodeURIComponent(contractId)}&select=*&order=created_at.asc`);
    return Response.json({ files: rows.map((file) => ({ id: file.id, fileName: file.file_name, fileType: file.mime_type, fileSize: file.file_size, previewUrl: `/api/files?entity=contract&id=${encodeURIComponent(String(file.id))}`, downloadUrl: `/api/files?entity=contract&id=${encodeURIComponent(String(file.id))}&download=1`, createdAt: file.created_at })) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  const uploaded: string[] = [];
  try {
    const actor = await requireAgencyAdministrator(request);
    const form = await request.formData();
    const contractId = String(form.get("contract_id") ?? "");
    const contracts = await restRequest<Array<Record<string, unknown>>>(request, `contracts?id=eq.${encodeURIComponent(contractId)}&select=id&limit=1`);
    if (!contracts[0]) return Response.json({ error: "Contrato não encontrado." }, { status: 404 });
    const files = form.getAll("files").filter((value): value is File => typeof value !== "string" && value.size > 0 && Boolean(value.name));
    if (!files.length) return Response.json({ error: "Selecione pelo menos um documento." }, { status: 400 });
    if (files.length > 12) return Response.json({ error: "Envie no máximo 12 documentos por vez." }, { status: 400 });
    const metadata: Array<Record<string, unknown>> = [];
    for (const file of files) {
      const path = `contracts/${contractId}/original/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      await storageRequest(request, path, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" }, body: await file.arrayBuffer() });
      uploaded.push(path);
      metadata.push({ contract_id: contractId, file_url: path, original_file_url: path, file_name: file.name, file_type: file.type || "application/octet-stream", file_size: file.size, mime_type: file.type || "application/octet-stream", uploaded_by: actor.id });
    }
    const rows = await restRequest<Array<Record<string, unknown>>>(request, "contract_files", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(metadata) });
    return Response.json({ created: rows.length }, { status: 201 });
  } catch (error) {
    for (const path of uploaded) { try { await storageRequest(request, path, { method: "DELETE" }); } catch {} }
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAgencyAdministrator(request);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    const rows = await restRequest<Array<Record<string, unknown>>>(request, `contract_files?id=eq.${encodeURIComponent(id)}&select=id,file_url&limit=1`);
    const file = rows[0];
    if (!file) return Response.json({ error: "Documento não encontrado." }, { status: 404 });
    await storageRequest(request, String(file.file_url), { method: "DELETE" });
    await restRequest(request, `contract_files?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    return Response.json({ deleted: true });
  } catch (error) { return jsonError(error); }
}
