import {
  jsonError,
  requireSuperAdmin,
  restRequest,
  storageRequest,
} from "../../../../../lib/oriva-data";
import {
  copyStorageObject,
  listAllOriginalStorageFiles,
  STORAGE_COPY_BATCH_SIZE,
} from "../../../../../lib/oriva-storage-backups";

export const dynamic = "force-dynamic";

type RestoreResult = {
  recordsRestored?: number;
  tables?: Record<string, number>;
  mode?: string;
};

async function responseMessage(error: unknown, fallback = "Não foi possível restaurar o backup.") {
  if (error instanceof Response) {
    try {
      const payload = await error.clone().json() as Record<string, unknown>;
      return String(payload.error ?? fallback);
    } catch {
      return fallback;
    }
  }
  return error instanceof Error ? error.message : fallback;
}

function objectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let runId = "";
  let databaseResult: RestoreResult | null = null;
  try {
    const actor = await requireSuperAdmin(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (String(body.confirmation ?? "").trim().toUpperCase() !== "RESTAURAR") {
      return Response.json({ error: "Digite RESTAURAR para confirmar a recuperação." }, { status: 400 });
    }

    const { id } = await context.params;
    const snapshots = await restRequest<Array<Record<string, unknown>>>(
      request,
      `backup_snapshots?id=eq.${encodeURIComponent(id)}&select=id,status,format,storage_path,storage_file_count,record_count,created_at&limit=1`,
    );
    const snapshot = snapshots[0];
    if (!snapshot) return Response.json({ error: "Backup não encontrado." }, { status: 404 });
    if (snapshot.status !== "concluido" || snapshot.format !== "completo" || !snapshot.storage_path) {
      return Response.json({ error: "Somente backups completos e concluídos podem ser restaurados." }, { status: 409 });
    }

    const active = await restRequest<Array<Record<string, unknown>>>(
      request,
      "backup_restore_runs?status=eq.processando&select=id&limit=1",
    );
    if (active.length) {
      return Response.json({ error: "Outra restauração já está em andamento. Aguarde a conclusão." }, { status: 409 });
    }

    const runs = await restRequest<Array<Record<string, unknown>>>(request, "backup_restore_runs", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ snapshot_id: id, requested_by: actor.id, status: "processando" }),
    });
    runId = String(runs[0]?.id ?? "");
    if (!runId) throw new Error("Não foi possível iniciar o histórico da restauração.");

    const manifestResponse = await storageRequest(request, String(snapshot.storage_path), { method: "GET" });
    const manifest = await manifestResponse.json() as Record<string, unknown>;
    if (Number(manifest.backupVersion ?? 0) < 2 || !objectRecord(manifest.data)) {
      throw Response.json({ error: "O arquivo de dados deste backup está incompleto ou inválido." }, { status: 409 });
    }

    databaseResult = await restRequest<RestoreResult>(request, "rpc/restore_backup_snapshot", {
      method: "POST",
      body: JSON.stringify({ p_snapshot_id: id, p_payload: manifest.data }),
    });

    const inventory = await restRequest<Array<Record<string, unknown>>>(
      request,
      `backup_snapshot_files?snapshot_id=eq.${encodeURIComponent(id)}&select=original_path,backup_path,file_name&order=original_path.asc`,
    );
    if (inventory.length !== Number(snapshot.storage_file_count ?? 0)) {
      throw Response.json({ error: "O inventário de arquivos deste backup está incompleto." }, { status: 409 });
    }

    const currentFiles = await listAllOriginalStorageFiles(request);
    const currentPaths = new Set(currentFiles.map((file) => file.originalPath));
    const missingFiles = inventory.filter((file) => !currentPaths.has(String(file.original_path ?? "")));
    const failures: Array<{ fileName: string; message: string }> = [];
    let filesRestored = 0;

    for (let start = 0; start < missingFiles.length; start += STORAGE_COPY_BATCH_SIZE) {
      const batch = missingFiles.slice(start, start + STORAGE_COPY_BATCH_SIZE);
      const results = await Promise.allSettled(batch.map((file) => copyStorageObject(
        request,
        String(file.backup_path ?? ""),
        String(file.original_path ?? ""),
      )));
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        if (result.status === "fulfilled") {
          filesRestored += 1;
          continue;
        }
        failures.push({
          fileName: String(batch[index]?.file_name ?? batch[index]?.original_path ?? "arquivo"),
          message: await responseMessage(result.reason, "Não foi possível recuperar este arquivo."),
        });
      }
    }

    const filesSkipped = inventory.length - missingFiles.length;
    const completedAt = new Date().toISOString();
    const status = failures.length ? "parcial" : "concluido";
    await restRequest(request, `backup_restore_runs?id=eq.${encodeURIComponent(runId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status,
        records_restored: Number(databaseResult.recordsRestored ?? 0),
        files_restored: filesRestored,
        files_skipped: filesSkipped,
        result: {
          mode: "somente_ausentes",
          database: databaseResult,
          fileFailures: failures.slice(0, 20),
        },
        error_message: failures.length
          ? `${failures.length} arquivo(s) não puderam ser recuperados. Tente restaurar novamente.`
          : null,
        completed_at: completedAt,
      }),
    });

    try {
      await restRequest(request, "audit_logs", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          profile_id: actor.id,
          action: "backup_restaurado",
          entity_type: "backup_restore_run",
          entity_id: runId,
          metadata: {
            snapshot_id: id,
            status,
            records_restored: Number(databaseResult.recordsRestored ?? 0),
            files_restored: filesRestored,
            files_skipped: filesSkipped,
            file_failures: failures.length,
          },
        }),
      });
    } catch {
      // The recovery itself is complete even if the supplementary audit entry fails.
    }

    return Response.json({
      restore: {
        id: runId,
        snapshotId: id,
        status,
        recordsRestored: Number(databaseResult.recordsRestored ?? 0),
        filesRestored,
        filesSkipped,
        fileFailures: failures.length,
        tables: databaseResult.tables ?? {},
        completedAt,
      },
      message: failures.length
        ? "Os dados foram recuperados, mas alguns arquivos precisam de uma nova tentativa."
        : "Restauração concluída sem apagar ou substituir os dados atuais.",
    });
  } catch (error) {
    const message = await responseMessage(error);
    if (runId) {
      try {
        await restRequest(request, `backup_restore_runs?id=eq.${encodeURIComponent(runId)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            status: databaseResult ? "parcial" : "falhou",
            records_restored: Number(databaseResult?.recordsRestored ?? 0),
            result: databaseResult ? { mode: "somente_ausentes", database: databaseResult } : {},
            error_message: message,
            completed_at: new Date().toISOString(),
          }),
        });
      } catch {
        // Keep the original recovery error if the history update also fails.
      }
    }
    if (databaseResult) {
      return Response.json({
        error: `Os registros ausentes foram recuperados, mas os arquivos não foram concluídos: ${message}`,
      }, { status: 500 });
    }
    return jsonError(error);
  }
}
