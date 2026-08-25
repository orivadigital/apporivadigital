import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("calendar exposes an explicit internal validation and client release flow", async () => {
  const calendar = await read("public/content-calendar.js");

  assert.match(calendar, /Área interna da equipe/);
  assert.match(calendar, /Inspirações, referências e links/);
  assert.match(calendar, /Arte em rascunho/);
  assert.match(calendar, /Validar internamente/);
  assert.match(calendar, /Liberar para o cliente/);
  assert.match(calendar, /Enviado ao cliente/);
  assert.match(calendar, /Somente equipe/);
  assert.match(calendar, /action: 'release_to_client'/);
  assert.match(calendar, /action: 'validate_internal'/);
});

test("API sends clients only released snapshots and current client files", async () => {
  const [posts, item, files] = await Promise.all([
    read("app/api/posts/route.ts"),
    read("app/api/posts/[id]/route.ts"),
    read("app/api/files/route.ts"),
  ]);

  assert.match(posts, /client_released_at/);
  assert.match(posts, /working_caption/);
  assert.match(posts, /working_client_notes/);
  assert.match(posts, /client_current/);
  assert.match(posts, /Em produção/);
  assert.match(item, /release_scheduled_post_to_client/);
  assert.match(item, /validate_scheduled_post_internal/);
  assert.match(files, /post_files\?id=eq\./);
});

test("database migration protects internal references and draft artwork with RLS", async () => {
  const migration = await read("supabase/migrations/20260825030000_internal_content_release.sql");

  assert.match(migration, /add column if not exists client_released_at/);
  assert.match(migration, /create table if not exists public\.post_internal_details/);
  assert.match(migration, /internal_references/);
  assert.match(migration, /working_caption/);
  assert.match(migration, /add column if not exists file_scope/);
  assert.match(migration, /internal_reference/);
  assert.match(migration, /internal_draft/);
  assert.match(migration, /client_current/);
  assert.match(migration, /client_archived/);
  assert.match(migration, /create or replace function private\.can_view_post_file/);
  assert.match(migration, /p_file_scope = 'client_current'/);
  assert.match(migration, /create or replace function public\.release_scheduled_post_to_client/);
  assert.match(migration, /create or replace function public\.validate_scheduled_post_internal/);
  assert.match(migration, /drop policy if exists post_files_select/);
});

test("client review is rejected until the agency has released the content", async () => {
  const review = await read("supabase/functions/review-content/index.ts");

  assert.match(review, /client_released_at/);
  assert.match(review, /ainda não foi liberado para aprovação/);
});

test("the public page uses a fresh calendar asset version for mobile browsers", async () => {
  const html = await read("public/oriva-plataforma.html");
  assert.match(html, /content-calendar\.js\?v=20260825-1/);
});
