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
  assert.match(chat, /Adicionar pessoas ao grupo/);
  assert.match(chat, /formData\.getAll\('participantIds'\)/);
  assert.match(chat, /Sócios mencionados automaticamente/);
  assert.match(chat, /Lucas, Arsênio e Alexandre/);
  assert.match(chat, /Clientes não conversam com parceiros ou colaboradores/);
  assert.doesNotMatch(chat, /localStorage\s*\./);
});

test("chat polling preserves drafts and ignores overlapping refreshes", async () => {
  const chat = await read("public/chat.js");
  assert.match(chat, /drafts:\s*Object\.create\(null\)/);
  assert.match(chat, /refreshPromise:\s*null/);
  assert.match(chat, /threadRequestId:\s*0/);
  assert.match(chat, /if \(chatState\.refreshPromise\) return chatState\.refreshPromise/);
  assert.match(chat, /requestId !== chatState\.threadRequestId/);
  assert.match(chat, /data-chat-id=/);
  assert.match(chat, /oninput="saveChatDraft/);
  assert.match(chat, /chatState\.drafts\[conversation\.id\]/);
  assert.match(chat, /restoreFocus/);
  assert.match(chat, /wasNearBottom/);
  assert.doesNotMatch(chat, /if \(chatState\.loadingThread/);
  assert.doesNotMatch(chat, /var selected = chatState\.selectedId;\s*await loadChat\(true\);[\s\S]*renderChat\(\);\s*await loadChatThread/);
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
  assert.match(listRoute, /participantIds/);
  assert.match(listRoute, /rpc\/create_chat_group/);
  assert.match(listRoute, /automaticRecipientNames/);
  assert.match(listRoute, /chat_conversation_members/);
  assert.match(listRoute, /chat_conversations/);
  assert.match(messagesRoute, /sender_profile_id: actor\.id/);
  assert.match(detailRoute, /action === "archive"/);
  assert.match(detailRoute, /rpc\/mark_chat_conversation_read/);
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

test("group chats mention the three agency partners and keep individual membership protected", async () => {
  const [migration, rlsFix, returningFix, selectFix, backupRoute] = await Promise.all([
    read("supabase/migrations/20260820203000_group_chat_mentions.sql"),
    read("supabase/migrations/20260820213000_fix_group_chat_creation_rls.sql"),
    read("supabase/migrations/20260820214500_allow_chat_creator_returning.sql"),
    read("supabase/migrations/20260820215000_allow_primary_chat_participant_select.sql"),
    read("app/api/backups/route.ts"),
  ]);
  assert.match(migration, /create table if not exists public\.chat_conversation_members/);
  assert.match(migration, /chat_default_recipient = true/);
  assert.match(migration, /'LUCAS GODOY', 'LUCIANO ARSENIO', 'ALEXANDRE TEIXEIRA'/);
  assert.match(migration, /p\.role in \('super_admin', 'socio'\)/);
  assert.match(migration, /or exists \(\s*select 1\s*from public\.chat_conversation_members/s);
  assert.match(migration, /or p\.chat_default_recipient = true/);
  assert.match(migration, /Clients|Clientes não podem participar de grupos/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on function public\.create_chat_group/);
  assert.match(migration, /grant execute on function public\.create_chat_group/);
  assert.match(migration, /grant select, insert, update on public\.chat_conversation_members to authenticated/);
  assert.match(rlsFix, /before insert on public\.chat_conversations/);
  assert.match(rlsFix, /new\.is_group := true/);
  assert.doesNotMatch(rlsFix, /update public\.chat_conversations/);
  assert.match(returningFix, /c\.participant_profile_id = p\.id/);
  assert.match(returningFix, /chat_conversation_members cm/);
  assert.match(selectFix, /participant_profile_id = private\.current_profile_id\(\)/);
  assert.match(selectFix, /private\.can_access_chat_conversation\(id\)/);
  assert.match(backupRoute, /chat_conversation_members/);
});
