import {
  jsonError,
  requireSuperAdmin,
  restRequest,
  storageRequest,
} from "../../../lib/oriva-data";
import {
  copyStorageObject,
  listAllOriginalStorageFiles,
  OriginalStorageFile,
  STORAGE_COPY_BATCH_SIZE,
} from "../../../lib/oriva-storage-backups";

export const dynamic = "force-dynamic";

type BackupTable = {
  name: string;
  order: string;
  select?: string;
};

const BACKUP_TABLES: BackupTable[] = [
  { name: "profiles", order: "id" },
  { name: "companies", order: "id" },
  { name: "company_users", order: "id" },
  { name: "scheduled_posts", order: "id" },
  { name: "post_internal_details", order: "post_id" },
  { name: "post_files", order: "id" },
  { name: "post_comments", order: "id" },
  { name: "agency_tasks", order: "id" },
  { name: "task_files", order: "id" },
  { name: "partners", order: "id" },
  { name: "contracts", order: "id" },
  { name: "contract_files", order: "id" },
  { name: "financial_entries", order: "id" },
  { name: "lead_details", order: "company_id" },
  { name: "lead_activities", order: "id" },
  { name: "audit_logs", order: "id" },
  { name: "chat_conversations", order: "id" },
  { name: "chat_conversation_members", order: "conversation_id" },
  { name: "chat_messages", order: "id" },
];

const PAGE_SIZE = 1000;
type BackupStorageFile = OriginalStorageFile & {
  backupPath: string;
};

async function readAllRows(request: Request, table: BackupTable) {
  const rows: Array<Record<string, unknown>> = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const page = await restRequest<Array<Record<string, unknown>>>(
      request,
      `${table.name}?select=${encodeURIComponent(table.select ?? "*")}&order=${encodeURIComponent(`${table.order}.asc`)}`,
      { headers: { Range: `${start}-${start + PAGE_SIZE - 1}` } },
    );
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function backupFileName(date: Date) {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `oriva-backup-${stamp}.json`;
}

function completeBackupFileName(date: Date) {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `oriva-backup-completo-${stamp}.zip`;
}

async function copyStorageFiles(
  request: Request,
  actorId: string,
  snapshotId: string,
  files: OriginalStorageFile[],
  copiedPaths: string[],
) {
  const copied: BackupStorageFile[] = [];
  const root = `backups/${actorId}/${snapshotId}/files`;

  for (let start = 0; start < files.length; start += STORAGE_COPY_BATCH_SIZE) {
    const batch = files.slice(start, start + STORAGE_COPY_BATCH_SIZE);
    const results = await Promise.all(batch.map(async (file) => {
      const backupPath = `${root}/${file.originalPath}`;
      await copyStorageObject(request, file.originalPath, backupPath);
      copiedPaths.push(backupPath);
      return { ...file, backupPath };
    }));
    copied.push(...results);
    await restRequest(request, "backup_snapshot_files", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(results.map((file) => ({
        snapshot_id: snapshotId,
        original_path: file.originalPath,
        backup_path: file.backupPath,
        file_name: file.fileName,
        mime_type: file.mimeType,
        file_size: file.fileSize,
        original_created_at: file.createdAt,
        original_updated_at: file.updatedAt,
      }))),
    });
  }

  return copied;
}

async function responseMessage(error: unknown) {
  if (error instanceof Response) {
    try {
      const payload = await error.clone().json() as Record<string, unknown>;
      return String(payload.error ?? "Não foi possível gerar o backup.");
    } catch {
      return "Não foi possível gerar o backup.";
    }
  }
  return error instanceof Error ? error.message : "Não foi possível gerar o backup.";
}

export async function GET(request: Request) {
  try {
    await requireSuperAdmin(request);
    const [rows, restoreRows] = await Promise.all([
      restRequest<Array<Record<string, unknown>>>(
        request,
        "backup_snapshots?select=id,status,format,file_name,archive_file_name,file_size,storage_file_count,storage_file_size,total_size,record_count,error_message,created_at,updated_at,completed_at,profiles(name,email)&order=created_at.desc&limit=50",
      ),
      restRequest<Array<Record<string, unknown>>>(
        request,
        "backup_restore_runs?select=id,snapshot_id,status,records_restored,files_restored,files_skipped,error_message,created_at,completed_at,profiles(name,email)&order=created_at.desc&limit=30",
      ),
    ]);
    return Response.json({
      backups: rows.map((row) => ({
        id: row.id,
        status: row.status,
        format: row.format,
        fileName: row.file_name,
        fileSize: row.file_size,
        storageFileCount: row.storage_file_count ?? 0,
        storageFileSize: row.storage_file_size ?? 0,
        totalSize: row.total_size ?? row.file_size,
        archiveFileName: row.archive_file_name ?? "",
        recordCount: row.record_count,
        errorMessage: row.error_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at,
        createdBy: Array.isArray(row.profiles) ? row.profiles[0] : row.profiles,
        downloadUrl: row.status === "concluido" ? `/api/backups/${encodeURIComponent(String(row.id))}/download?format=json` : null,
        fullDownloadUrl: row.status === "concluido" && row.format === "completo"
          ? `/api/backups/${encodeURIComponent(String(row.id))}/download?format=complete`
          : null,
      })),
      restores: restoreRows.map((row) => ({
        id: row.id,
        snapshotId: row.snapshot_id,
        status: row.status,
        recordsRestored: row.records_restored ?? 0,
        filesRestored: row.files_restored ?? 0,
        filesSkipped: row.files_skipped ?? 0,
        errorMessage: row.error_message,
        createdAt: row.created_at,
        completedAt: row.completed_at,
        requestedBy: Array.isArray(row.profiles) ? row.profiles[0] : row.profiles,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  let snapshotId = "";
  const copiedPaths: string[] = [];
  try {
    const actor = await requireSuperAdmin(request);
    const now = new Date();
    const created = await restRequest<Array<Record<string, unknown>>>(request, "backup_snapshots", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ created_by: actor.id, status: "processando", format: "completo" }),
    });
    snapshotId = String(created[0]?.id ?? "");
    if (!snapshotId) throw new Error("Não foi possível iniciar o histórico do backup.");

    const fileName = backupFileName(now);
    const archiveFileName = completeBackupFileName(now);
    const storagePath = `backups/${actor.id}/${snapshotId}/${fileName}`;
    await restRequest(request, `backup_snapshots?id=eq.${encodeURIComponent(snapshotId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ storage_path: storagePath, file_name: fileName, archive_file_name: archiveFileName }),
    });

    const tableResults = await Promise.all(BACKUP_TABLES.map(async (table) => ({
      name: table.name,
      rows: await readAllRows(request, table),
    })));
    const data = Object.fromEntries(tableResults.map((table) => [table.name, table.rows]));
    const recordCount = tableResults.reduce((total, table) => total + table.rows.length, 0);
    const storageFiles = await listAllOriginalStorageFiles(request);
    const copiedFiles = await copyStorageFiles(request, actor.id, snapshotId, storageFiles, copiedPaths);
    const storageFileSize = copiedFiles.reduce((total, file) => total + file.fileSize, 0);
    const serialized = JSON.stringify({
      backupVersion: 3,
      snapshotId,
      generatedAt: now.toISOString(),
      generatedBy: { id: actor.id, name: actor.name, email: actor.email },
      scope: "Cópia completa dos dados e arquivos da plataforma Óriva",
      storage: {
        bucket: "oriva-files",
        fileCount: copiedFiles.length,
        totalBytes: storageFileSize,
        files: copiedFiles,
      },
      credentials: "As credenciais de autenticação não fazem parte deste arquivo.",
      data,
    }, null, 2);
    const fileSize = new TextEncoder().encode(serialized).byteLength;

    await storageRequest(request, storagePath, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-upsert": "false" },
      body: serialized,
    });
    copiedPaths.push(storagePath);
    const totalSize = fileSize + storageFileSize;

    const completedAt = new Date().toISOString();
    await restRequest(request, `backup_snapshots?id=eq.${encodeURIComponent(snapshotId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "concluido",
        file_size: fileSize,
        storage_file_count: copiedFiles.length,
        storage_file_size: storageFileSize,
        total_size: totalSize,
        record_count: recordCount,
        error_message: null,
        completed_at: completedAt,
      }),
    });
    await restRequest(request, "audit_logs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        profile_id: actor.id,
        action: "backup_gerado",
        entity_type: "backup_snapshot",
        entity_id: snapshotId,
        metadata: {
          file_name: fileName,
          archive_file_name: archiveFileName,
          data_file_size: fileSize,
          storage_file_count: copiedFiles.length,
          storage_file_size: storageFileSize,
          total_size: totalSize,
          record_count: recordCount,
        },
      }),
    });

    return Response.json({
      backup: {
        id: snapshotId,
        status: "concluido",
        fileName,
        fileSize,
        storageFileCount: copiedFiles.length,
        storageFileSize,
        totalSize,
        archiveFileName,
        recordCount,
        completedAt,
        downloadUrl: `/api/backups/${encodeURIComponent(snapshotId)}/download?format=json`,
        fullDownloadUrl: `/api/backups/${encodeURIComponent(snapshotId)}/download?format=complete`,
      },
    }, { status: 201 });
  } catch (error) {
    for (const path of copiedPaths.reverse()) {
      try { await storageRequest(request, path, { method: "DELETE" }); } catch {}
    }
    if (snapshotId) {
      try {
        await restRequest(request, `backup_snapshot_files?snapshot_id=eq.${encodeURIComponent(snapshotId)}`, {
          method: "DELETE",
          headers: { Prefer: "return=minimal" },
        });
      } catch {
        // Keep the original backup error even if metadata cleanup fails.
      }
      try {
        await restRequest(request, `backup_snapshots?id=eq.${encodeURIComponent(snapshotId)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            status: "falhou",
            error_message: await responseMessage(error),
            completed_at: new Date().toISOString(),
          }),
        });
      } catch {
        // Preserve the original failure if the status update also fails.
      }
    }
    return jsonError(error);
  }
}
