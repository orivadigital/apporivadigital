import { getActor, jsonError, restRequest } from "../../../lib/oriva-data";

export const dynamic = "force-dynamic";

const CHAT_TYPES = new Set(["mensagem", "duvida_demanda", "nova_demanda"]);
const EXTERNAL_ROLES = new Set(["empresa_cliente", "colaborador", "parceiro"]);
const ADMIN_ROLES = new Set(["super_admin", "socio"]);
const ALL_CHAT_ROLES = new Set([...ADMIN_ROLES, ...EXTERNAL_ROLES]);

function ids(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function inFilter(values: string[]) {
  return values.map(encodeURIComponent).join(",");
}

function roleLabel(role: string) {
  return ({
    super_admin: "Superadministrador",
    socio: "Sócio",
    empresa_cliente: "Cliente",
    colaborador: "Colaborador",
    parceiro: "Parceiro PJ",
  } as Record<string, string>)[role] ?? role;
}

function memberSummary(members: Array<Record<string, unknown>>, actorId: string) {
  const names = members
    .filter((member) => String(member.profile_id) !== actorId)
    .map((member) => String(member.display_name ?? "Participante"));
  if (!names.length) return "Equipe Óriva";
  return names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
}

export async function GET(request: Request) {
  try {
    const actor = await getActor(request);
    if (!ALL_CHAT_ROLES.has(actor.role)) {
      return Response.json({ error: "Seu perfil não possui acesso ao bate-papo." }, { status: 403 });
    }

    const conversations = await restRequest<Array<Record<string, unknown>>>(
      request,
      "chat_conversations?select=*&order=last_message_at.desc",
    );
    const companyIds = ids(conversations.map((row) => row.company_id));
    const taskIds = ids(conversations.map((row) => row.related_task_id));
    const conversationIds = ids(conversations.map((row) => row.id));

    const [members, companies, tasks, messages, availableParticipants] = await Promise.all([
      conversationIds.length
        ? restRequest<Array<Record<string, unknown>>>(request, `chat_conversation_members?conversation_id=in.(${inFilter(conversationIds)})&select=conversation_id,profile_id,display_name,member_role,is_default_recipient,last_read_at,joined_at&order=joined_at.asc`)
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
        ? restRequest<Array<Record<string, unknown>>>(request, "profiles?role=in.(super_admin,socio,empresa_cliente,colaborador,parceiro)&is_active=eq.true&select=id,name,email,role,chat_default_recipient&order=name.asc")
        : Promise.resolve([]),
    ]);

    const companyById = new Map(companies.map((row) => [String(row.id), row]));
    const taskById = new Map(tasks.map((row) => [String(row.id), row]));
    const membersByConversation = new Map<string, Array<Record<string, unknown>>>();
    for (const member of members) {
      const key = String(member.conversation_id);
      membersByConversation.set(key, [...(membersByConversation.get(key) ?? []), member]);
    }
    const messagesByConversation = new Map<string, Array<Record<string, unknown>>>();
    for (const message of messages) {
      const key = String(message.conversation_id);
      messagesByConversation.set(key, [...(messagesByConversation.get(key) ?? []), message]);
    }

    const result = conversations.map((row) => {
      const relatedMembers = membersByConversation.get(String(row.id)) ?? [];
      const primary = relatedMembers.find((member) => String(member.profile_id) === String(row.participant_profile_id)) ?? relatedMembers[0];
      const relatedMessages = messagesByConversation.get(String(row.id)) ?? [];
      const actorMembership = relatedMembers.find((member) => String(member.profile_id) === actor.id);
      const readTime = actorMembership?.last_read_at ? new Date(String(actorMembership.last_read_at)).getTime() : 0;
      const unread = relatedMessages.filter((message) => (
        String(message.sender_profile_id) !== actor.id
        && new Date(String(message.created_at)).getTime() > readTime
      )).length;
      const latest = relatedMessages[0];
      return {
        id: row.id,
        subject: row.subject,
        type: row.conversation_type,
        participantRole: primary?.member_role ?? row.participant_role,
        participantRoleLabel: roleLabel(String(primary?.member_role ?? row.participant_role)),
        participantId: primary?.profile_id ?? row.participant_profile_id,
        participantName: primary?.display_name ?? "Participante",
        memberSummary: memberSummary(relatedMembers, actor.id),
        members: relatedMembers.map((member) => ({
          id: member.profile_id,
          name: member.display_name,
          role: member.member_role,
          roleLabel: roleLabel(String(member.member_role)),
          automatic: Boolean(member.is_default_recipient),
        })),
        isGroup: Boolean(row.is_group) || relatedMembers.length > 2,
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
      participants: availableParticipants
        .filter((row) => String(row.id) !== actor.id)
        .map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          roleLabel: roleLabel(String(row.role)),
          automatic: Boolean(row.chat_default_recipient),
        })),
      automaticRecipientNames: ["Lucas", "Arsênio", "Alexandre"],
      actor: { id: actor.id, name: actor.name, role: actor.role, companyId: actor.companyId },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getActor(request);
    if (!ALL_CHAT_ROLES.has(actor.role)) {
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

    const rawParticipantIds = Array.isArray(body.participantIds)
      ? body.participantIds
      : body.participantId ? [body.participantId] : [];
    const participantIds = ADMIN_ROLES.has(actor.role) ? ids(rawParticipantIds) : [];
    if (participantIds.length) {
      const selected = await restRequest<Array<Record<string, unknown>>>(
        request,
        `profiles?id=in.(${inFilter(participantIds)})&is_active=eq.true&role=in.(super_admin,socio,empresa_cliente,colaborador,parceiro)&select=id,role`,
      );
      if (selected.length !== participantIds.length) {
        return Response.json({ error: "Uma das pessoas selecionadas não possui acesso ativo." }, { status: 400 });
      }
      const clients = selected.filter((row) => row.role === "empresa_cliente").length;
      const deliveryTeam = selected.filter((row) => row.role === "colaborador" || row.role === "parceiro").length;
      if (clients > 1 || (clients > 0 && deliveryTeam > 0)) {
        return Response.json({ error: "Clientes não podem participar de grupos com outros clientes, colaboradores ou parceiros." }, { status: 400 });
      }
    }

    const companyId = actor.role === "empresa_cliente"
      ? actor.companyId
      : String(body.companyId ?? "").trim() || null;
    const relatedTaskId = String(body.relatedTaskId ?? "").trim() || null;
    const created = await restRequest<Record<string, unknown>>(request, "rpc/create_chat_group", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        p_participant_profile_ids: participantIds,
        p_company_id: companyId,
        p_related_task_id: relatedTaskId,
        p_subject: subject,
        p_conversation_type: type,
        p_message: initialMessage,
      }),
    });
    const conversationId = String(created?.conversation_id ?? "");
    if (!conversationId) return Response.json({ error: "Não foi possível iniciar a conversa." }, { status: 500 });
    return Response.json({ conversationId }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
