import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("lead pipeline exposes filters, stages, follow-up and interaction history", async () => {
  const ui = await read("public/management.js");
  assert.match(ui, /Empresas e leads/);
  assert.match(ui, /function renderLeadPipeline\(/);
  assert.match(ui, /function setCompanyRelationshipFilter\(/);
  assert.match(ui, /Novo lead/);
  assert.match(ui, /Proposta enviada/);
  assert.match(ui, /Negociação/);
  assert.match(ui, /function openLeadDetails\(/);
  assert.match(ui, /function saveLeadActivity\(/);
  assert.match(ui, /\/api\/leads\//);
});

test("lead records use persistent Supabase tables protected by RLS", async () => {
  const [migration, companiesRoute, activitiesRoute] = await Promise.all([
    read("supabase/migrations/20260809123000_lead_sales_pipeline.sql"),
    read("app/api/companies/route.ts"),
    read("app/api/leads/[id]/activities/route.ts"),
  ]);
  assert.match(migration, /create table if not exists public\.lead_details/);
  assert.match(migration, /create table if not exists public\.lead_activities/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /private\.can_manage_company\(company_id\)/);
  assert.match(companiesRoute, /lead_details/);
  assert.match(companiesRoute, /lead_activities/);
  assert.match(activitiesRoute, /requireCompanyManager/);
  assert.doesNotMatch(`${companiesRoute}\n${activitiesRoute}`, /localStorage/);
});

test("lead pipeline includes responsive mobile styling", async () => {
  const html = await read("public/oriva-plataforma.html");
  assert.match(html, /\.lead-pipeline/);
  assert.match(html, /\.crm-summary/);
  assert.match(html, /\.lead-workspace/);
  assert.match(html, /grid-template-columns:repeat\(6,minmax\(82vw,1fr\)\)/);
});
