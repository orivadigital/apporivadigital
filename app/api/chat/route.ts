import { getActor, jsonError, restRequest } from "../../../lib/oriva-data";

export const dynamic = "force-dynamic";

const CHAT_TYPES = new Set(["mensagem", "duvida_demanda", "nova_demanda"]);
const EXTERNAL_ROLES = new Set(["empresa_cliente", "colaborador", "parceiro"]);
const ADMIN_ROLES = new Set(["super_admin", "socio"]);

function ids(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value ?? "")).filter(Boolean)));
}

function inFilter(values: string[]) {
  return values.map(encodeURIComponent).join(",");
}

function roleLabel(role: string) {
  return ({ empresa_cliente: "Cliente", colaborador: "Colaborador", parceiro: "Parceiro PJ" } as Record<string, string>)[role] ?? role;
}

export async function GET(request: Request) {
  try {
    const actor = await getActor(request);
    const allowed = ADMIN_ROLES.has(actor.role) || EXTERNAL_ROLES.has(actor.role);
    if (!allowed) return Response.json({ error: "Seu perfil não possui acesso ao bate-papo." }, { status: 403 });

    const conversations = await restRequest<Array<Record<string, unknown>>>(
      request,
      "chat_conversations?select=*&order=last_message_at.desc",
    );
    const participantIds = ids(conversations.map((row) => row.participant_profile_id));
    const companyIds = ids(conversations.map((row) => row.company_id));
    const taskIds = ids(conversations.map((row) => row.related_task_id));
    const conversationIds = ids(conversations.map((row) => row.id));

    const [participants, companies, tasks, messages, availableParticipants] = await Promise.all([
      participantIds.length
        ? restRequest<Array<Record<string, unknown>>>(request, `profiles?id=in.(${inFilter(participantIds)})&select=id,name,email,role`)
        : Promise.resolve([]),
      companyIds.length
        ? restRequest<Array<Record<string, unknown>>>(request, `companies?id=in.(${inFilter(companyIds)})&select=id,name`)
        : Promise.resolve([]),
      taskIds.length
        ? restRequest<Array<Record<string, unknown>>>(request, `agency_tasks?id=in.(${inFilter(taskIds)})&select=id,title`)
        : Promise.resolve([]),
      conversationIds.length
        ? restRequest<Array<Record<string, unknown>>>(request, `chat_messages?conversation_id=in.(${inFilter(conversationIds)})&select=id,conversation_id,sender_profile_id,body,created_at&order=created_at.desc`)
        : Promise.resolve([]),
      ADMIN_ROLES.has(actor.role)
        ? restRequest<Array<Record<string, unknown>>>(request, "profiles?role=in.(empresa_cliente,colaborador,parceiro)&is_active=eq.true&select=id,name,email,role&order=name.asc")
        : Promise.resolve([]),
    ]);

    const participantById = new Map(participants.map((row) => [String(row.id), row]));
    const companyById = new Map(companies.map((row) => [String(row.id), row]));
    const taskById = new Map(tasks.map((row) => [String(row.id), row]));
    const messagesByConversation = new Map<string, Array<Record<string, unknown>>>();
    for (const message of messages) {
      const key = String(message.conversation_id);
      messagesByConversation.set(key, [...(messagesByConversation.get(key) ?? []), message]);
    }

    const result = conversations.map((row) => {
      const participant = participantById.get(String(row.participant_profile_id));
      const relatedMessages = messagesByConversation.get(String(row.id)) ?? [];
      const readAt = ADMIN_ROLES.has(actor.role) ? row.agency_last_read_at : row.participant_last_read_at;
      const readTime = readAt ? new Date(String(readAt)).getTime() : 0;
      const unread = relatedMessages.filter((message) => {
        const sentByParticipant = String(message.sender_profile_id) === String(row.participant_profile_id);
        const sentByOtherSide = ADMIN_ROLES.has(actor.role) ? sentByParticipant : !sentByParticipant;
        return sentByOtherSide && new Date(String(message.created_at)).getTime() > readTime;
      }).length;
      const latest = relatedMessages[0];
      return {
        id: row.id,
        subject: row.subject,
        type: row.conversation_type,
        participantRole: row.participant_role,
        participantRoleLabel: roleLabel(String(row.participant_role)),
        participantId: row.participant_profile_id,
        participantName: participant?.name ?? (ADMIN_ROLES.has(actor.role) ? "Usuário" : actor.name),
        participantEmail: participant?.email ?? (ADMIN_ROLES.has(actor.role) ? "" : actor.email),
        companyId: row.company_id ?? "",
        companyName: companyById.get(String(row.company_id))?.name ?? "",
        relatedTaskId: row.related_task_id ?? "",
        relatedTaskTitle: taskById.get(String(row.related_task_id))?.title ?? "",
        status: row.status,
        unread,
        lastMessage: latest?.body ?? "Conversa iniciada",
        lastMessageAt: row.last_message_at,
        createdAt: row.created_at,
      };
    });

    return Response.json({
      conversations: result,
      participants: availableParticipants.map((row) => ({
        id: row.id, name: row.name, email: row.email, role: row.role, roleLabel: roleLabel(String(row.role)),
      })),
      actor: { id: actor.id, name: actor.name, role: actor.role, companyId: actor.companyId },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getActor(request);
    if (!ADMIN_ROLES.has(actor.role) && !EXTERNAL_ROLES.has(actor.role)) {
      return Response.json({ error: "Seu perfil não possui acesso ao bate-papo." }, { status: 403 });
    }
    const body = await request.json() as Record<string, unknown>;
    const subject = String(body.subject ?? "").trim();
    const initialMessage = String(body.message ?? "").trim();
    const requestedType = String(body.type ?? "mensagem");
    const type = CHAT_TYPES.has(requestedType) ? requestedType : "mensagem";
    if (subject.length < 2 || subject.length > 160) {
      return Response.json({ error: "Informe um assunto entre 2 e 160 caracteres." }, { status: 400 });
    }
    if (!initialMessage || initialMessage.length > 5000) {
      return Response.json({ error: "Escreva uma mensagem de até 5.000 caracteres." }, { status: 400 });
    }
    if (type === "nova_demanda" && actor.role !== "empresa_cliente" && !ADMIN_ROLES.has(actor.role)) {
      return Response.json({ error: "A solicitação de nova demanda está disponível para clientes e sócios." }, { status: 403 });
    }

    let participantId = actor.id;
    let participantRole = actor.role;
    if (ADMIN_ROLES.has(actor.role)) {
      participantId = String(body.participantId ?? "").trim();
      const rows = participantId
        ? await restRequest<Array<Record<string, unknown>>>(request, `profiles?id=eq.${encodeURIComponent(participantId)}&is_active=eq.true&role=in.(empresa_cliente,colaborador,parceiro)&select=id,role&limit=1`)
        : [];
      if (!rows[0]) return Response.json({ error: "Selecione um cliente, colaborador ou parceiro ativo." }, { status: 400 });
      participantRole = String(rows[0].role) as typeof actor.role;
    }

    const companyId = actor.role === "empresa_cliente"
      ? actor.companyId
      : String(body.companyId ?? "").trim() || null;
    const relatedTaskId = String(body.relatedTaskId ?? "").trim() || null;
    const created = await restRequest<Array<Record<string, unknown>>>(request, "chat_conversations", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        participant_profile_id: participantId,
        participant_role: participantRole,
        company_id: companyId,
        related_task_id: relatedTaskId,
        subject,
        conversation_type: type,
        status: "aberta",
        created_by: actor.id,
      }),
    });
    const conversation = created[0];
    if (!conversation) return Response.json({ error: "Não foi possível iniciar a conversa." }, { status: 500 });
    await restRequest(request, "chat_messages", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ conversation_id: conversation.id, sender_profile_id: actor.id, body: initialMessage }),
    });
    return Response.json({ conversationId: conversation.id }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
