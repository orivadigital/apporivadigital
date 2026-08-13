import { storageJsonRequest } from "./oriva-data";

export const STORAGE_COPY_BATCH_SIZE = 4;
const STORAGE_PAGE_SIZE = 1000;

type StorageListItem = {
  id?: string | null;
  name?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown> | null;
};

export type OriginalStorageFile = {
  originalPath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string | null;
  updatedAt: string | null;
};

function storageNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

async function listStorageFolder(
  request: Request,
  prefix: string,
  visited: Set<string>,
): Promise<OriginalStorageFile[]> {
  if (visited.has(prefix)) return [];
  visited.add(prefix);
  const files: OriginalStorageFile[] = [];

  for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
    const rows = await storageJsonRequest<StorageListItem[]>(request, "object/list/oriva-files", {
      method: "POST",
      body: JSON.stringify({
        prefix,
        limit: STORAGE_PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
    });

    for (const row of rows) {
      const name = String(row.name ?? "").trim();
      if (!name) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (path === "backups" || path.startsWith("backups/")) continue;
      if (!row.id) {
        files.push(...await listStorageFolder(request, path, visited));
        continue;
      }
      const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      files.push({
        originalPath: path,
        fileName: name,
        mimeType: String(metadata.mimetype ?? metadata.contentType ?? "application/octet-stream"),
        fileSize: storageNumber(metadata.size),
        createdAt: row.created_at ? String(row.created_at) : null,
        updatedAt: row.updated_at ? String(row.updated_at) : null,
      });
    }

    if (rows.length < STORAGE_PAGE_SIZE) break;
  }
  return files;
}

export async function listAllOriginalStorageFiles(request: Request) {
  const files = await listStorageFolder(request, "", new Set<string>());
  return files.sort((a, b) => a.originalPath.localeCompare(b.originalPath, "pt-BR"));
}

export async function copyStorageObject(request: Request, sourceKey: string, destinationKey: string) {
  await storageJsonRequest(request, "object/copy", {
    method: "POST",
    body: JSON.stringify({
      bucketId: "oriva-files",
      sourceKey,
      destinationKey,
    }),
  });
}
