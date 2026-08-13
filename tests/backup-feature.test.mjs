import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strToU8, unzipSync, Zip, ZipPassThrough } from "fflate";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("backup page is visible only to the superadministrator and all actions are implemented", async () => {
  const [html, management] = await Promise.all([
    read("public/oriva-plataforma.html"),
    read("public/management.js"),
  ]);

  assert.match(html, /id:'backups',label:'Backup de dados'/);
  assert.match(html, /const superAdminPaginas=\['backups'\]/);
  assert.match(html, /superAdminPaginas\.includes\(id\)&&actor\.role!=='super_admin'/);
  assert.match(management, /paginas\.backups\s*=/);
  assert.match(management, /function loadBackups\(/);
  assert.match(management, /function createBackup\(/);
  assert.match(management, /function downloadBackup\(/);
  assert.match(management, /function openRestoreBackup\(/);
  assert.match(management, /function restoreBackup\(/);
  assert.match(management, /\/api\/backups/);
  assert.match(management, /Senhas e credenciais do Supabase Auth nunca entram no backup/);
  assert.match(management, /Baixar tudo \(\.zip\)/);
  assert.match(management, /Fotos, imagens, vídeos, PDFs e demais anexos/);
  assert.match(management, /Informações atuais nunca são apagadas nem substituídas/);
  assert.match(management, /Digite RESTAURAR para confirmar/);
});

test("backup APIs copy chats and every original Storage object without authentication secrets", async () => {
  const [route, download, storage] = await Promise.all([
    read("app/api/backups/route.ts"),
    read("app/api/backups/[id]/download/route.ts"),
    read("lib/oriva-storage-backups.ts"),
  ]);

  assert.match(route, /requireSuperAdmin\(request\)/);
  assert.match(download, /requireSuperAdmin\(request\)/);
  assert.match(route, /BACKUP_TABLES/);
  assert.match(route, /Range: `\$\{start\}-\$\{start \+ PAGE_SIZE - 1\}`/);
  assert.match(route, /storageRequest\(request, storagePath/);
  assert.match(route, /chat_conversations/);
  assert.match(route, /chat_messages/);
  assert.match(storage, /object\/list\/oriva-files/);
  assert.match(storage, /object\/copy/);
  assert.match(storage, /path === "backups" \|\| path\.startsWith\("backups\/"\)/);
  assert.match(route, /backup_snapshot_files/);
  assert.match(route, /backupVersion: 3/);
  assert.match(route, /snapshotId/);
  assert.match(route, /backup_gerado/);
  assert.doesNotMatch(route, /auth\.users|service_role|encrypted_password|password_hash/i);
  assert.match(download, /Cache-Control": "private, no-store/);
  assert.match(download, /Content-Disposition/);
  assert.match(download, /ZipPassThrough/);
  assert.match(download, /application\/zip/);
  assert.match(download, /format=complete|format"\) === "complete"/);
});

test("restore API recovers only missing records and files after strong confirmation", async () => {
  const [route, management] = await Promise.all([
    read("app/api/backups/[id]/restore/route.ts"),
    read("public/management.js"),
  ]);

  assert.match(route, /requireSuperAdmin\(request\)/);
  assert.match(route, /toUpperCase\(\) !== "RESTAURAR"/);
  assert.match(route, /rpc\/restore_backup_snapshot/);
  assert.match(route, /listAllOriginalStorageFiles/);
  assert.match(route, /missingFiles = inventory\.filter/);
  assert.match(route, /copyStorageObject/);
  assert.match(route, /status: databaseResult \? "parcial" : "falhou"/);
  assert.match(management, /Restaurar itens ausentes/);
  assert.match(management, /Histórico de restaurações/);
  assert.match(management, /\/restore/);
  assert.doesNotMatch(route, /service_role|SUPABASE_SECRET|password/i);
});

test("backup history and files are protected by RLS and private Storage policies", async () => {
  const migration = await read("supabase/migrations/20260809210000_secure_data_backups.sql");

  assert.match(migration, /create table if not exists public\.backup_snapshots/);
  assert.match(migration, /alter table public\.backup_snapshots enable row level security/);
  assert.match(migration, /create policy backup_snapshots_select[\s\S]*private\.is_super_admin\(\)/);
  assert.match(migration, /create policy backup_snapshots_insert[\s\S]*created_by = private\.current_profile_id\(\)/);
  assert.match(migration, /when p_name like 'backups\/%'[\s\S]*private\.is_super_admin\(\)/);
  assert.match(migration, /bs\.status = 'concluido'/);
  assert.match(migration, /'application\/json'/);
  assert.doesNotMatch(migration, /grant[\s\S]+backup_snapshots[\s\S]+anon/i);
});

test("complete backup inventory is protected by RLS and grants bucket-wide read only to the superadministrator", async () => {
  const migration = await read("supabase/migrations/20260811004500_complete_file_backups.sql");

  assert.match(migration, /create table if not exists public\.backup_snapshot_files/);
  assert.match(migration, /alter table public\.backup_snapshot_files enable row level security/);
  assert.match(migration, /create policy backup_snapshot_files_select[\s\S]*private\.is_super_admin\(\)/);
  assert.match(migration, /create policy backup_snapshot_files_insert[\s\S]*private\.current_profile_id\(\)/);
  assert.match(migration, /original_path not like 'backups\/%'/);
  assert.match(migration, /create or replace function private\.can_view_storage_object[\s\S]*private\.is_super_admin\(\)/);
  assert.doesNotMatch(migration, /grant[\s\S]+backup_snapshot_files[\s\S]+anon/i);
});

test("restore history and transactional recovery function are locked to the superadministrator", async () => {
  const migration = await read("supabase/migrations/20260811010000_restore_backup_snapshots.sql");

  assert.match(migration, /create table if not exists public\.backup_restore_runs/);
  assert.match(migration, /alter table public\.backup_restore_runs enable row level security/);
  assert.match(migration, /create policy backup_restore_runs_select[\s\S]*private\.is_super_admin\(\)/);
  assert.match(migration, /create policy backup_restore_runs_insert[\s\S]*requested_by = private\.current_profile_id\(\)/);
  assert.match(migration, /create or replace function private\.restore_backup_snapshot_data/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /not private\.is_super_admin\(\)/);
  assert.match(migration, /pg_try_advisory_xact_lock/);
  assert.match(migration, /on conflict do nothing/);
  assert.match(migration, /overriding system value/);
  assert.match(migration, /create or replace function public\.restore_backup_snapshot[\s\S]*security invoker/);
  assert.match(migration, /revoke all on function public\.restore_backup_snapshot\(uuid, jsonb\) from public, anon/);
  assert.doesNotMatch(migration, /grant[^;]*on public\.backup_restore_runs to anon/i);
  assert.doesNotMatch(migration, /delete from public\.(profiles|companies|scheduled_posts|agency_tasks|chat_messages)/i);
});

test("backup audit events share one restrictive insert policy", async () => {
  const migration = await read("supabase/migrations/20260811013000_unify_backup_audit_policy.sql");

  assert.match(migration, /create policy audit_logs_backup_actions_insert/);
  assert.match(migration, /private\.is_super_admin\(\)/);
  assert.match(migration, /action = 'backup_gerado'[\s\S]*entity_type = 'backup_snapshot'/);
  assert.match(migration, /action = 'backup_restaurado'[\s\S]*entity_type = 'backup_restore_run'/);
  assert.doesNotMatch(migration, /to anon/i);
});

test("streamed ZIP entries preserve the exact original bytes", async () => {
  const original = Uint8Array.from([0, 255, 1, 128, 64, 32, 10, 13]);
  const chunks = [];
  const archive = await new Promise((resolve, reject) => {
    const zip = new Zip((error, chunk, final) => {
      if (error) return reject(error);
      chunks.push(chunk);
      if (final) resolve(Buffer.concat(chunks.map((item) => Buffer.from(item))));
    });
    const readme = new ZipPassThrough("LEIA-ME.txt");
    zip.add(readme);
    readme.push(strToU8("Backup completo"), true);
    const file = new ZipPassThrough("arquivos/original.bin");
    zip.add(file);
    file.push(original, true);
    zip.end();
  });
  const files = unzipSync(new Uint8Array(archive));
  assert.deepEqual(files["arquivos/original.bin"], original);
});
