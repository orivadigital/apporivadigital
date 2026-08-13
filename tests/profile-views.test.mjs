import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("finance opens as a complete panorama with an optional monthly filter", async () => {
  const [ui, route] = await Promise.all([
    read("public/management.js"),
    read("app/api/finance/route.ts"),
  ]);

  assert.match(ui, /loadFinance\(''\)/);
  assert.match(ui, /Panorama financeiro completo/);
  assert.match(ui, /Todos os períodos/);
  assert.match(ui, /Receitas' \+ periodSuffix/);
  assert.match(ui, /Saldo geral/);
  assert.match(route, /else if \(\/\^\\d\{4\}-\\d\{2\}\$\/\.test\(month\)\)/);
  assert.match(route, /financial_entries\?select=\*&order=due_date\.asc/);
});

test("dashboard and report indicators open their operational destination", async () => {
  const [html, ui] = await Promise.all([
    read("public/oriva-plataforma.html"),
    read("public/management.js"),
  ]);

  assert.match(html, /function kpi\(icoName,val,lbl,trend,dir,action\)/);
  assert.match(html, /class="card kpi\$\{action\?' kpi-link':''\}"/);
  assert.match(ui, /Demandas em atraso', '', '', "irPara\('tarefas'\)"/);
  assert.match(ui, /Projetos em aprovação', '', '', "irPara\('calendario-posts'\)"/);
  assert.match(ui, /Empresas ativas', '', '', "irPara\('clientes'\)"/);
  assert.match(ui, /A receber no mês', '', '', "irPara\('financeiro'\)"/);
  assert.match(ui, /Clientes ativos', '', '', "irPara\('clientes'\)"/);
  assert.match(ui, /Demandas abertas', '', '', "irPara\('tarefas'\)"/);
  assert.match(ui, /function reportRanking\(title, rows, action\)/);
});

test("client navigation unifies contents and materials into one practical area", async () => {
  const [html, calendar, ui] = await Promise.all([
    read("public/oriva-plataforma.html"),
    read("public/content-calendar.js"),
    read("public/management.js"),
  ]);

  assert.match(html, /c-conteudo',label:'Conteúdos e arquivos'/);
  assert.doesNotMatch(html, /c-materiais',label:'Materiais'/);
  assert.match(calendar, /clientMode \? 'Conteúdos e arquivos'/);
  assert.match(calendar, /baixe os arquivos originais e copie as legendas/);
  assert.match(ui, />Conteúdos e arquivos<\/button>/);
});
