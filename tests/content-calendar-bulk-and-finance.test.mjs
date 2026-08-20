import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("content calendar supports several dates with a description for each one", async () => {
  const [calendar, route] = await Promise.all([
    read("public/content-calendar.js"),
    read("app/api/posts/route.ts"),
  ]);

  assert.match(calendar, /name="scheduled_date"/);
  assert.match(calendar, /name="schedule_description"/);
  assert.match(calendar, /function addContentScheduleDate\(/);
  assert.match(calendar, /function removeContentScheduleDate\(/);
  assert.match(calendar, /Cadastre até 31 datas de uma só vez/);
  assert.match(route, /form!?\.getAll\("scheduled_date"\)/);
  assert.match(route, /form!?\.getAll\("schedule_description"\)/);
  assert.match(route, /rowsToCreate = scheduledDates\.map/);
  assert.match(route, /title: scheduleDescriptions\[index\] \|\| title/);
  assert.match(route, /createdCount: postIds\.length/);
});

test("new calendar contents can be created without attachments", async () => {
  const [calendar, route, migration] = await Promise.all([
    read("public/content-calendar.js"),
    read("app/api/posts/route.ts"),
    read("supabase/migrations/20260818180000_calendar_direct_upload_atomic_creation.sql"),
  ]);

  assert.doesNotMatch(calendar, /Selecione pelo menos um arquivo para o conteúdo/);
  assert.match(calendar, /if \(contentState\.pendingFiles\.length\) \{\s*preparedUploads = await uploadContentFilesDirect/);
  assert.match(calendar, /uploadedFiles: uploadedFileMetadata\(preparedUploads\)/);
  assert.match(route, /p_files: sharedFiles/);
  assert.match(migration, /p_files jsonb default '\[\]'::jsonb/);
  assert.match(migration, /if v_file_count > 0 then/);
});

test("selected and persisted content files can be removed safely", async () => {
  const [calendar, filesRoute, postRoute] = await Promise.all([
    read("public/content-calendar.js"),
    read("app/api/post-files/route.ts"),
    read("app/api/posts/[id]/route.ts"),
  ]);

  assert.match(calendar, /function removePendingContentFile\(/);
  assert.match(calendar, /function clearPendingContentFiles\(/);
  assert.match(calendar, /Limpar todos os arquivos/);
  assert.match(calendar, /function deleteContentFile\(/);
  assert.match(filesRoute, /references\.length <= 1/);
  assert.match(postRoute, /if \(!references\.length\) await storageRequest/);
});

test("calendar post policies support returning rows and shared files", async () => {
  const migration = await read("supabase/migrations/20260816221500_fix_calendar_post_creation_rls.sql");

  assert.match(migration, /private\.can_manage_agency\(\)\s+or private\.can_view_post_item\(id\)/);
  assert.match(migration, /drop constraint if exists post_files_file_url_key/);
  assert.match(migration, /unique index if not exists post_files_post_file_url_uidx[\s\S]*\(post_id, file_url\)/);
  assert.match(migration, /sp\.company_id = post_files\.company_id/);
  assert.match(migration, /private\.can_upload_storage_object\(name\)\s+or private\.can_view_storage_object\(name\)/);
});

test("calendar uploads bypass the Vercel payload limit and finalize atomically", async () => {
  const [calendar, signatures, posts, postFiles, migration] = await Promise.all([
    read("public/content-calendar.js"),
    read("app/api/post-upload-signatures/route.ts"),
    read("app/api/posts/route.ts"),
    read("app/api/post-files/route.ts"),
    read("supabase/migrations/20260818180000_calendar_direct_upload_atomic_creation.sql"),
  ]);

  assert.match(calendar, /function uploadContentFilesDirect\(/);
  assert.match(calendar, /fetch\(upload\.signedUrl/);
  assert.match(calendar, /uploadedFiles: uploadedFileMetadata/);
  assert.match(signatures, /createSignedStorageUpload/);
  assert.match(signatures, /posts\/bulk-/);
  assert.match(posts, /rpc\/create_scheduled_posts_batch/);
  assert.match(postFiles, /rpc\/attach_scheduled_post_files/);
  assert.match(migration, /security definer/);
  assert.match(migration, /create_scheduled_posts_batch/);
  assert.match(migration, /attach_scheduled_post_files/);
  assert.match(migration, /post_belongs_to_company/);
});

test("leads are excluded from content calendars in the interface and API", async () => {
  const [calendar, route] = await Promise.all([
    read("public/content-calendar.js"),
    read("app/api/posts/route.ts"),
  ]);

  assert.match(calendar, /relationshipType \|\| 'Cliente'/);
  assert.match(calendar, /toLowerCase\(\) !== 'lead'/);
  assert.match(route, /relationship_type === "lead"/);
  assert.match(route, /Converta o lead em cliente/);
});

test("calendar lists every active partner and hides assignment data from clients", async () => {
  const [calendar, posts, postItem, migration, partnerListMigration] = await Promise.all([
    read("public/content-calendar.js"),
    read("app/api/posts/route.ts"),
    read("app/api/posts/[id]/route.ts"),
    read("supabase/migrations/20260819143000_calendar_partner_assignment.sql"),
    read("supabase/migrations/20260820170000_calendar_include_unlinked_partners.sql"),
  ]);

  assert.match(calendar, /name="assigned_to"/);
  assert.match(calendar, /name="partner_id"/);
  assert.match(calendar, /Esta atribuição não fica visível para o cliente/);
  assert.match(calendar, /partnerId: createData\.get\('partner_id'\)/);
  assert.match(calendar, /return partner\.status === 'ativo'/);
  assert.doesNotMatch(calendar, /activePartnerIds/);
  assert.doesNotMatch(calendar, /contentState\.clientMode && post\.hasResponsible/);
  assert.match(posts, /if \(canSeeAssignments\) \{[\s\S]*post\.hasResponsible = Boolean\(row\.assigned_to \|\| row\.partner_id\)[\s\S]*post\.partnerId = row\.partner_id/);
  assert.match(posts, /actor\.role === "parceiro"[\s\S]*params\.set\("partner_id"/);
  assert.doesNotMatch(posts, /status=eq\.ativo&profile_id=not\.is\.null/);
  assert.match(postItem, /String\(post\.partner_id \?\? ""\) === actor\.partnerId/);
  assert.match(migration, /add column if not exists partner_id uuid references public\.partners/);
  assert.match(migration, /p\.role = 'parceiro'[\s\S]*sp\.partner_id = pa\.id/);
  assert.match(migration, /new\.assigned_to, new\.partner_id/);
  assert.match(migration, /create_scheduled_posts_batch[\s\S]*partner_id uuid/);
  assert.match(partnerListMigration, /from public\.partners pa[\s\S]*pa\.status = 'ativo'/);
  assert.doesNotMatch(partnerListMigration, /join public\.profiles partner_profile/);
});

test("finance distinguishes pending and completed income and expenses", async () => {
  const management = await read("public/management.js");

  assert.match(management, /kpi\('financeiro', money\(receivable\), 'A receber'\)/);
  assert.match(management, /kpi\('check', money\(received\), 'Recebido'\)/);
  assert.match(management, /kpi\('clock', money\(payable\), 'A pagar'\)/);
  assert.match(management, /kpi\('check', money\(paidExpenses\), 'Já pago'\)/);
  assert.match(management, /Marcar recebido/);
  assert.match(management, /function financeStatusChoices\(/);
});
