import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('company registration includes responsible email and Client/Lead classification', async () => {
  const [ui, route] = await Promise.all([read('public/management.js'), read('app/api/companies/route.ts')]);
  assert.match(ui, /name="responsibleEmail"/);
  assert.match(ui, /name="relationshipType"/);
  assert.match(route, /responsible_email/);
  assert.match(route, /relationship_type/);
});

test('general company calendar combines tasks and posts and supports original attachments', async () => {
  const [ui, route, taskFiles] = await Promise.all([
    read('public/management.js'),
    read('app/api/company-calendar/route.ts'),
    read('app/api/task-files/route.ts'),
  ]);
  assert.match(ui, /Calendário geral da empresa/);
  assert.match(ui, /uploadTaskFiles/);
  assert.match(route, /scheduled_posts/);
  assert.match(route, /agency_tasks/);
  assert.match(taskFiles, /original\/\$\{crypto\.randomUUID\(\)\}/);
});

test('contracts support recurrence and a persistent documents area', async () => {
  const [ui, route, files] = await Promise.all([
    read('public/management.js'),
    read('app/api/contracts/route.ts'),
    read('app/api/contract-files/route.ts'),
  ]);
  assert.match(ui, /name="recurrence"/);
  assert.match(ui, /openContractDocuments/);
  assert.match(route, /recurrence/);
  assert.match(files, /contract_files/);
});

test('dashboard, delinquency and reports expose the requested operational indicators', async () => {
  const [ui, dashboard, reports] = await Promise.all([
    read('public/management.js'),
    read('app/api/dashboard/route.ts'),
    read('app/api/reports/route.ts'),
  ]);
  assert.match(ui, /Demandas em atraso/);
  assert.match(ui, /Clientes inadimplentes/);
  assert.match(ui, /Conteúdos entregues por cliente/);
  assert.match(dashboard, /aguardando_aprovacao/);
  assert.match(reports, /deliveriesByPartner/);
});

