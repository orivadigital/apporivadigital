import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("a collaborator linked to a Partner PJ sees both assignment types", async () => {
  const [tasks, posts, companyCalendar, migration] = await Promise.all([
    read("app/api/tasks/route.ts"),
    read("app/api/posts/route.ts"),
    read("app/api/company-calendar/route.ts"),
    read("supabase/migrations/20260821153000_partner_assignment_visibility.sql"),
  ]);

  assert.match(tasks, /actor\.role === "colaborador"[\s\S]*filters\.set\("or", `\(assigned_to\.eq\.\$\{actor\.id\},partner_id\.eq\.\$\{actor\.partnerId\}\)`/);
  assert.match(posts, /actor\.role === "colaborador"[\s\S]*params\.set\("or", `\(assigned_to\.eq\.\$\{actor\.id\},partner_id\.eq\.\$\{actor\.partnerId\}\)`/);
  assert.match(companyCalendar, /actor\.role === "colaborador"[\s\S]*taskFilters\.set\("or"/);
  assert.match(migration, /p\.role in \('colaborador', 'parceiro'\)[\s\S]*pa\.profile_id = p\.id and pa\.id = t\.partner_id/);
  assert.match(migration, /create or replace function private\.can_update_assigned_task/);
  assert.match(migration, /create or replace function private\.guard_assigned_task_update/);
});

test("Partner PJ registration links the matching active access without changing internal responsibility", async () => {
  const [partners, partnerItem, accesses, dataLayer, migration] = await Promise.all([
    read("app/api/partners/route.ts"),
    read("app/api/partners/[id]/route.ts"),
    read("app/api/access/route.ts"),
    read("lib/oriva-data.ts"),
    read("supabase/migrations/20260821153000_partner_assignment_visibility.sql"),
  ]);

  assert.match(partners, /role=in\.\(colaborador,parceiro\)/);
  assert.match(partners, /profile_id: profileId/);
  assert.match(partnerItem, /if \(profileId\) values\.profile_id = profileId/);
  assert.match(dataLayer, /function linkPartnerProfileByMatchingEmail/);
  assert.match(accesses, /linkPartnerProfileByMatchingEmail\(request, email\)/);
  assert.match(migration, /lower\(btrim\(p\.email\)\) = lower\(btrim\(pa\.email\)\)/);
  assert.doesNotMatch(migration, /update public\.agency_tasks/);
});

test("overview, task board and agenda unify tasks with assigned calendar contents", async () => {
  const [management, calendar, workItems, html] = await Promise.all([
    read("public/management.js"),
    read("public/content-calendar.js"),
    read("app/api/work-items/route.ts"),
    read("public/oriva-plataforma.html"),
  ]);

  assert.match(management, /async function loadDashboard\([\s\S]*ownPayload = await api\('\/api\/work-items'\)/);
  assert.match(management, /async function loadAgenda\([\s\S]*ownPayload = await api\('\/api\/work-items'\)/);
  assert.match(management, /async function loadTasks\([\s\S]*api\('\/api\/work-items'\)/);
  assert.match(workItems, /Promise\.all\([\s\S]*agency_tasks[\s\S]*scheduled_posts/);
  assert.match(workItems, /entityType: "post"/);
  assert.match(workItems, /entityType: "task"/);
  assert.match(management, /function workItemMatchesPerson\(/);
  assert.match(management, /partner\.profileId \|\| partner\.profile_id/);
  assert.match(management, /task-item-clickable[\s\S]*onclick="openWorkItem/);
  assert.match(management, /function openWorkItemByKeyboard\(/);
  assert.match(calendar, /function abrirConteudoAgenda\(/);
  assert.match(calendar, /openContentDetails\(pendingId\)/);
  assert.match(html, /\.task-item-clickable:hover,\.task-item-clickable:focus-visible/);
  assert.match(html, /management\.js\?v=20260821-3/);
  assert.match(html, /content-calendar\.js\?v=20260821-3/);
});

test("calendar contents open the same item on desktop, tablet and mobile", async () => {
  const [management, calendar, html] = await Promise.all([
    read("public/management.js"),
    read("public/content-calendar.js"),
    read("public/oriva-plataforma.html"),
  ]);

  assert.match(calendar, /function bindContentCalendarInteractions\(/);
  assert.match(calendar, /closest\('\[data-content-post-id\]'\)/);
  assert.match(calendar, /function contentOpenAttributes\(/);
  assert.match(calendar, /contentOpenAttributes\(post\.id[\s\S]*class="post-pill"/);
  assert.match(calendar, /contentOpenAttributes\(post\.id[\s\S]*class="week-post"/);
  assert.match(calendar, /contentOpenAttributes\(post\.id[\s\S]*class="post-list-card"/);
  assert.match(calendar, /contentState\.filters = \{ status: '', content_type: '', social_network: '' \}/);
  assert.match(calendar, /contentState\.cursor = parseDate\(pendingPost\.scheduledDate\)/);
  assert.match(management, /function companyCalendarEventButton[\s\S]{0,400}abrirConteudoAgenda/);
  assert.match(management, /Abrir conteúdo completo[\s\S]{0,300}abrirConteudoAgenda|abrirConteudoAgenda[\s\S]{0,300}Abrir conteúdo completo/);
  assert.match(html, /post-pill:hover,\.post-pill:focus-visible/);
});
