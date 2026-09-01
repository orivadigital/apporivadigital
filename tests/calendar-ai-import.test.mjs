import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("AI calendar import uses strict structured outputs and never invents missing data", async () => {
  const helper = await read("lib/calendar-import-ai.ts");

  assert.match(helper, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(helper, /OPENAI_API_KEY/);
  assert.match(helper, /text:\s*\{[\s\S]*format:\s*\{[\s\S]*type:\s*"json_schema"/);
  assert.match(helper, /strict:\s*true/);
  assert.match(helper, /additionalProperties:\s*false/);
  assert.match(helper, /Nunca invente datas, textos, aprovações, links, horários ou decisões/);
  assert.match(helper, /nunca declare validação concluída/);
  assert.match(helper, /Não gere nem sugira modelos de imagem, artes ou arquivos/);
});

test("structured fallback understands dated cronograms and groups Stories from the same day", async () => {
  const helper = await read("lib/calendar-import-ai.ts");

  assert.match(helper, /fallbackAnalysis/);
  assert.match(helper, /Stories — \$\{group\.labels\.length\} tela/);
  assert.match(helper, /const groups = new Map/);
  assert.match(helper, /items\.sort\(\(a, b\) => a\.scheduledDate\.localeCompare/);
  assert.match(helper, /IMPORTADO DO CRONOGRAMA — REVISÃO HUMANA OBRIGATÓRIA/);
  assert.match(helper, /A chave da IA ainda não está configurada/);
});

test("calendar import route is agency-only, checks duplicates and commits atomically", async () => {
  const route = await read("app/api/calendar-import/route.ts");

  assert.match(route, /if \(!access\.isAgency\)/);
  assert.match(route, /Somente a equipe da Óriva pode importar cronogramas/);
  assert.match(route, /scheduled_posts\?company_id=eq\./);
  assert.match(route, /duplicateKeys/);
  assert.match(route, /status:\s*"rascunho"/);
  assert.match(route, /client_notes:\s*""/);
  assert.match(route, /assigned_to:\s*null/);
  assert.match(route, /partner_id:\s*null/);
  assert.match(route, /rpc\/create_scheduled_posts_batch/);
  assert.match(route, /p_files:\s*\[\]/);
  assert.doesNotMatch(route, /client_released_at/);
});

test("calendar interface provides paste, preview, editing and explicit draft confirmation", async () => {
  const [calendar, html] = await Promise.all([
    read("public/content-calendar.js"),
    read("public/oriva-plataforma.html"),
  ]);

  assert.match(calendar, /Importar cronograma com IA/);
  assert.match(calendar, /function openCalendarAiImport\(/);
  assert.match(calendar, /function analyzeCalendarAiImport\(/);
  assert.match(calendar, /function renderCalendarAiPreview\(/);
  assert.match(calendar, /function commitCalendarAiImport\(/);
  assert.match(calendar, /Tudo será mostrado em uma prévia editável/);
  assert.match(calendar, /rascunhos internos/);
  assert.match(calendar, /sem arte e sem envio ao cliente/);
  assert.match(calendar, /Revisar legenda e briefing/);
  assert.match(calendar, /Nada será enviado ao cliente/);
  assert.match(html, /ai-import-item-grid/);
  assert.match(html, /content-calendar\.js\?v=20260901-1/);
});
