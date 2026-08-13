import {
  jsonError,
  requireSuperAdmin,
  restRequest,
  storageRequest,
} from "../../../../../lib/oriva-data";
import { strToU8, Zip, ZipPassThrough } from "fflate";

export const dynamic = "force-dynamic";

function zipPath(value: unknown) {
  return String(value ?? "arquivo")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.replace(/[\u0000-\u001f\u007f]/g, "-"))
    .join("/") || "arquivo";
}

async function appendStorageObject(
  zip: Zip,
  request: Request,
  entryName: string,
  storagePath: string,
) {
  const object = await storageRequest(request, storagePath, { method: "GET" });
  if (!object.body) throw new Error(`O arquivo ${entryName} não está disponível no backup.`);
  const entry = new ZipPassThrough(zipPath(entryName));
  zip.add(entry);
  const reader = object.body.getReader();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    if (chunk.value?.length) entry.push(chunk.value, false);
  }
  entry.push(new Uint8Array(), true);
}

function createCompleteZip(
  request: Request,
  manifestPath: string,
  files: Array<Record<string, unknown>>,
) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let finished = false;
      const zip = new Zip((error, chunk, final) => {
        if (finished) return;
        if (error) {
          finished = true;
          controller.error(error);
          return;
        }
        if (chunk?.length) controller.enqueue(chunk);
        if (final) {
          finished = true;
          controller.close();
        }
      });

      void (async () => {
        const readme = new ZipPassThrough("LEIA-ME.txt");
        zip.add(readme);
        readme.push(strToU8([
          "BACKUP COMPLETO DA PLATAFORMA ORIVA",
          "",
          "dados/oriva-dados.json: cadastros, empresas, tarefas, calendarios, conteudos, financeiro, contratos, comentarios, chats e mensagens.",
          "arquivos/: copias integrais das fotos, imagens, videos, PDFs e demais anexos, mantendo a estrutura original das pastas.",
          "",
          "As senhas nao fazem parte deste pacote. Elas permanecem protegidas exclusivamente pelo Supabase Auth.",
          "Guarde este ZIP em um local privado. Ele pode conter dados internos e arquivos de clientes.",
          "",
        ].join("\n")), true);

        await appendStorageObject(zip, request, "dados/oriva-dados.json", manifestPath);
        for (const file of files) {
          await appendStorageObject(
            zip,
            request,
            `arquivos/${String(file.original_path ?? file.file_name ?? "arquivo")}`,
            String(file.backup_path),
          );
        }
        zip.end();
      })().catch((error) => {
        if (!finished) {
          finished = true;
          controller.error(error);
        }
      });
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin(request);
    const { id } = await context.params;
    const format = new URL(request.url).searchParams.get("format") === "complete" ? "complete" : "json";
    const rows = await restRequest<Array<Record<string, unknown>>>(
      request,
      `backup_snapshots?id=eq.${encodeURIComponent(id)}&select=id,status,format,storage_path,file_name,archive_file_name,file_size,storage_file_count&limit=1`,
    );
    const snapshot = rows[0];
    if (!snapshot) return Response.json({ error: "Backup não encontrado." }, { status: 404 });
    if (snapshot.status !== "concluido" || !snapshot.storage_path) {
      return Response.json({ error: "Este backup ainda não está disponível para baixar." }, { status: 409 });
    }

    if (format === "complete") {
      if (snapshot.format !== "completo") {
        return Response.json({ error: "Este backup antigo contém somente os dados em JSON." }, { status: 409 });
      }
      const files = await restRequest<Array<Record<string, unknown>>>(
        request,
        `backup_snapshot_files?snapshot_id=eq.${encodeURIComponent(id)}&select=original_path,backup_path,file_name,mime_type,file_size&order=original_path.asc`,
      );
      if (files.length !== Number(snapshot.storage_file_count ?? 0)) {
        return Response.json({ error: "A lista de arquivos deste backup está incompleta. Gere um novo backup." }, { status: 409 });
      }
      const stream = createCompleteZip(request, String(snapshot.storage_path), files);
      return new Response(stream, {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(String(snapshot.archive_file_name || "oriva-backup-completo.zip"))}`,
          "Content-Type": "application/zip",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const object = await storageRequest(request, String(snapshot.storage_path), { method: "GET" });
    return new Response(object.body, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(String(snapshot.file_name || "oriva-backup.json"))}`,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": String(snapshot.file_size ?? ""),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
