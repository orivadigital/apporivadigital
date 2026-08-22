import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("collaborators see only their own dashboard, demands, agenda and assigned contents", async () => {
  const html = await read("public/oriva-plataforma.html");
  const [management, calendar] = await Promise.all([read("public/management.js"), read("public/content-calendar.js")]);

  assert.match(html, /colaboradorPaginasRestritas=\['clientes','calendario-empresa','acessos','parceiros','contratos','financeiro','relatorios'\]/);
  assert.match(html, /parceiro:\['p-dashboard','p-prazos','calendario-posts','p-chat'\]/);
  assert.match(html, /actor&&actor\.role==='colaborador'\?\['dashboard','tarefas','agenda','chat'\]/);
  assert.match(html, /visibleNavItems\(navConfig\[perfilAtual\]/);
  assert.match(html, /if\(!canAccessOrivaPage\(id\)\)/);
  assert.match(html, /superAdminPaginas=\['backups','financeiro'\]/);
  assert.match(management, /window\.canAccessOrivaPage\('financeiro'\)/);
  assert.match(management, /Tarefas e conteúdos atribuídos a você como responsável ou Parceiro PJ/);
  assert.match(management, /Apenas os sócios podem criar novas demandas/);
  assert.match(management, /function saveAssignedTask\(/);
  assert.match(management, /function loadAssignedTaskFiles\(/);
  assert.match(calendar, /function openAssignedContentForm\(/);
  assert.match(calendar, /function saveAssignedContent\(/);
  assert.match(management, /Esta área é restrita ao administrador principal e aos sócios/);
});

test("contracts remain with agency administrators while finance is exclusive to the super administrator", async () => {
  const dataLayer = await read("lib/oriva-data.ts");
  const contractRoutes = await Promise.all([
    read("app/api/contracts/route.ts"),
    read("app/api/contracts/[id]/route.ts"),
  ]);
  const financeRoutes = await Promise.all([
    read("app/api/finance/route.ts"),
    read("app/api/finance/[id]/route.ts"),
  ]);

  assert.match(dataLayer, /export async function requireAgencyAdministrator/);
  assert.match(dataLayer, /actor\.role !== "super_admin" && actor\.role !== "socio"/);
  assert.match(dataLayer, /export async function requireSuperAdmin/);
  assert.match(dataLayer, /actor\.role !== "super_admin"/);
  for (const route of contractRoutes) {
    assert.match(route, /requireAgencyAdministrator\(request\)/);
    assert.doesNotMatch(route, /requireAgency\(request\)/);
  }
  for (const route of financeRoutes) {
    assert.match(route, /requireSuperAdmin\(request\)/);
    assert.doesNotMatch(route, /requireAgencyAdministrator\(request\)/);
  }
});

test("database policies still require the sensitive agency permission", async () => {
  const schema = await read("supabase/schema.sql");
  const scopeMigration = await read("supabase/migrations/20260810013000_assigned_work_editing.sql");
  const adminTaskFix = await read("supabase/migrations/20260814003000_fix_agency_task_admin_returning.sql");
  const financeRestriction = await read("supabase/migrations/20260822012455_restrict_finance_to_super_admin.sql");
  assert.match(schema, /create policy contracts_all[\s\S]*private\.can_manage_agency\(\)/);
  assert.match(financeRestriction, /create policy financial_entries_all[\s\S]*private\.is_super_admin\(\)/);
  assert.match(schema, /create policy agency_tasks_select[\s\S]*private\.can_manage_agency\(\) or private\.can_view_task\(id\)/);
  assert.match(adminTaskFix, /create policy agency_tasks_select[\s\S]*private\.can_manage_agency\(\)[\s\S]*private\.can_view_task\(id\)/);
  assert.match(scopeMigration, /p\.role = 'colaborador' and t\.assigned_to = p\.id/);
  assert.match(scopeMigration, /agency_tasks_update[\s\S]*private\.can_update_assigned_task\(id\)/);
  assert.match(scopeMigration, /can_attach_task[\s\S]*'colaborador', 'empresa_cliente', 'parceiro'/);
  assert.match(scopeMigration, /guard_assigned_task_update[\s\S]*só podem alterar descrição e situação/);
  assert.match(scopeMigration, /guard_assigned_post_update[\s\S]*só podem alterar descrição e situação/);
});

test("collaborator-sensitive APIs enforce the same restriction on the server", async () => {
  const [tasks, taskItem, taskFiles, posts, postItem, postFiles, access, partners, dashboard, companies, companyCalendar] = await Promise.all([
    read("app/api/tasks/route.ts"),
    read("app/api/tasks/[id]/route.ts"),
    read("app/api/task-files/route.ts"),
    read("app/api/posts/route.ts"),
    read("app/api/posts/[id]/route.ts"),
    read("app/api/post-files/route.ts"),
    read("app/api/access/route.ts"),
    read("app/api/partners/route.ts"),
    read("app/api/dashboard/route.ts"),
    read("app/api/companies/route.ts"),
    read("app/api/company-calendar/route.ts"),
  ]);

  assert.match(tasks, /actor\.role === "colaborador"[\s\S]*filters\.set\("assigned_to"/);
  assert.match(tasks, /requireAgencyAdministrator\(request\)/);
  assert.match(taskItem, /actor\.role !== "colaborador" && actor\.role !== "parceiro"/);
  assert.match(taskItem, /Informe a descrição ou a situação/);
  assert.doesNotMatch(taskFiles, /colaborador possui acesso somente para visualização/);
  assert.match(posts, /actor\.role === "colaborador"[\s\S]*params\.set\("assigned_to"/);
  assert.match(posts, /actor\.role === "parceiro"[\s\S]*params\.set\("partner_id"/);
  assert.match(postItem, /actor\.role === "colaborador"[\s\S]*post\.assigned_to/);
  assert.match(postItem, /post\.partner_id[\s\S]*actor\.partnerId/);
  assert.match(postFiles, /Este conteúdo não está atribuído ao seu perfil/);
  assert.match(access, /requireAgencyAdministrator\(request\)/);
  assert.match(partners, /requireAgencyAdministrator\(request\)/);
  assert.match(dashboard, /requireAgencyAdministrator\(request\)/);
  assert.doesNotMatch(companies, /Seu perfil acessa as empresas somente pelas demandas atribuídas/);
  assert.match(companyCalendar, /actor\.role === "colaborador"/);
});
