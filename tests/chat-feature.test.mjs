import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("chat is available to agency, client, collaborator and partner views", async () => {
  const [html, chat] = await Promise.all([
    read("public/oriva-plataforma.html"),
    read("public/chat.js"),
  ]);
  assert.match(html, /\{id:'chat',label:'Bate-papo'/);
  assert.match(html, /\{id:'c-chat',label:'Falar com a Óriva'/);
  assert.match(html, /\{id:'p-chat',label:'Falar com os sócios'/);
  for (const handler of ["loadChat", "openChatConversation", "sendChatMessage", "openChatForm", "saveChatConversation"]) {
    assert.match(chat, new RegExp(`window\\.${handler}\\s*=`));
  }
  assert.match(chat, /Solicitar nova demanda/);
  assert.match(chat, /Clientes, colaboradores e parceiros não conversam entre si/);
  assert.doesNotMatch(chat, /localStorage\s*\./);
});

test("chat APIs persist messages under the authenticated profile", async () => {
  const [listRoute, detailRoute, messagesRoute] = await Promise.all([
    read("app/api/chat/route.ts"),
    read("app/api/chat/[id]/route.ts"),
    read("app/api/chat/[id]/messages/route.ts"),
  ]);
  for (const source of [listRoute, detailRoute, messagesRoute]) {
    assert.match(source, /getActor\(request\)/);
    assert.match(source, /restRequest/);
  }
  assert.match(listRoute, /participant_profile_id/);
  assert.match(listRoute, /chat_conversations/);
  assert.match(messagesRoute, /sender_profile_id: actor\.id/);
  assert.match(detailRoute, /action === "archive"/);
});

test("database chat policies keep every external participant isolated from the others", async () => {
  const migration = await read("supabase/migrations/20260810220000_agency_chat.sql");
  assert.match(migration, /alter table public\.chat_conversations enable row level security/);
  assert.match(migration, /alter table public\.chat_messages enable row level security/);
  assert.match(migration, /c\.participant_profile_id = p\.id/);
  assert.match(migration, /p\.role in \('super_admin', 'socio'\)/);
  assert.match(migration, /private\.can_access_chat_conversation\(conversation_id\)/);
  assert.match(migration, /sender_profile_id = private\.current_profile_id\(\)/);
  assert.match(migration, /revoke all on public\.chat_messages from anon, authenticated/);
  assert.doesNotMatch(migration, /grant delete on public\.chat/);
});
