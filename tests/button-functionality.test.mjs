import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const uiFiles = [
  "public/oriva-plataforma.html",
  "public/management.js",
  "public/content-calendar.js",
  "public/chat.js",
];

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

test("every rendered button has a click action or submits a working form", async () => {
  const sources = await Promise.all(uiFiles.map(read));
  const failures = [];

  for (let fileIndex = 0; fileIndex < uiFiles.length; fileIndex += 1) {
    const lines = sources[fileIndex].split(/\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const tags = lines[lineIndex].match(/<button(?=[\s>])[^>]*>/g) ?? [];
      for (const tag of tags) {
        const clickable = /\bonclick\s*=/i.test(tag);
        const submits = /\btype\s*=\s*["']submit["']/i.test(tag);
        if (!clickable && !submits) failures.push(`${uiFiles[fileIndex]}:${lineIndex + 1} ${tag}`);
      }
    }
  }

  assert.deepEqual(failures, []);
});

test("every inline click and submit handler is exposed by the application", async () => {
  const combined = (await Promise.all(uiFiles.map(read))).join("\n");
  const handlers = new Set();
  for (const match of combined.matchAll(/\bon(?:click|submit)\s*=\s*["']([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
    handlers.add(match[1]);
  }

  const missing = [...handlers].filter((name) => {
    const declaration = new RegExp(`\\bfunction\\s+${name}\\s*\\(`);
    const assignment = new RegExp(`\\bwindow\\.${name}\\s*=`);
    return !declaration.test(combined) && !assignment.test(combined);
  });

  assert.deepEqual(missing, []);
  assert.ok(handlers.size >= 45, `expected a broad button audit, found only ${handlers.size} handlers`);
});

test("all agency navigation pages are backed by real page implementations", async () => {
  const html = await read("public/oriva-plataforma.html");
  const management = await read("public/management.js");
  const calendar = await read("public/content-calendar.js");
  const chat = await read("public/chat.js");
  const combined = `${html}\n${management}\n${calendar}\n${chat}`;
  const expectedPages = [
    "dashboard", "tarefas", "agenda", "clientes", "calendario-posts", "acessos",
    "parceiros", "contratos", "financeiro", "relatorios", "backups", "c-dashboard",
    "c-conteudo", "c-materiais", "c-entregas", "chat", "c-chat", "p-chat",
  ];

  for (const page of expectedPages) {
    const escaped = page.replace(/[-]/g, "\\-");
    const matcher = new RegExp(`paginas(?:\\.${escaped}|\\[['\"]${escaped}['\"]\\])\\s*=`);
    assert.match(combined, matcher, `missing implementation for ${page}`);
  }
});

test("management actions call persistent API routes instead of browser-only storage", async () => {
  const management = await read("public/management.js");
  const calendar = await read("public/content-calendar.js");
  const chat = await read("public/chat.js");
  const combined = `${management}\n${calendar}\n${chat}`;

  for (const route of ["companies", "partners", "contracts", "finance", "tasks", "access", "posts", "backups", "chat"]) {
    assert.match(combined, new RegExp(`/api/${route}`), `missing persistent route for ${route}`);
  }
  assert.doesNotMatch(combined, /localStorage\s*\./);
  assert.match(management, /\/api\/auth\/login/);
  assert.match(management, /\/api\/auth\/logout/);
  assert.match(management, /\/api\/auth\/forgot-password/);
});

test("partners, contracts, finance and companies expose create, edit and delete flows", async () => {
  const management = await read("public/management.js");
  for (const name of ["Company", "Partner", "Contract", "Finance"]) {
    assert.match(management, new RegExp(`function open${name}Form\\(`));
    assert.match(management, new RegExp(`function save${name}\\(`));
  }
  for (const name of ["Partner", "Contract", "Finance"]) {
    assert.match(management, new RegExp(`function delete${name}\\(`));
  }
  assert.match(management, /function exportFinanceCsv\(/);
  assert.match(management, /function markFinancePaid\(/);
});

test("the partner board and agenda work even when no company has been created yet", async () => {
  const management = await read("public/management.js");
  assert.match(management, /taskOptionsLoaded: false/);
  assert.match(management, /if \(!state\.taskOptionsLoaded\)/);
  assert.doesNotMatch(management, /if \(!state\.companies\.length \|\| !state\.accesses\.length\)/);
  assert.match(management, /function loadAgenda\(/);
  assert.match(management, /function renderAgenda\(/);
  assert.match(management, /function moveAgenda\(/);
  assert.match(management, /function goAgendaToday\(/);
  assert.match(management, /function refreshTasksView\(/);
});

test("client content actions include preview, original download, copy, approval and revision", async () => {
  const calendar = await read("public/content-calendar.js");
  assert.match(calendar, /downloadUrl/);
  assert.match(calendar, /href="' \+ esc\(file\.downloadUrl\) \+ '" download/);
  assert.match(calendar, /function copyCaption\(/);
  assert.match(calendar, /function reviewContent\(/);
  assert.match(calendar, /Revisão solicitada/);
  assert.match(calendar, /function saveClientComment\(/);
  assert.match(calendar, /<video[^>]+controls/);
});
