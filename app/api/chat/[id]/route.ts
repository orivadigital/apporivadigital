import { getActor, jsonError, restRequest } from "../../../../lib/oriva-data";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

function isAgency(role: string) {
  return role === "super_admin" || role === "socio";
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

export async function GET(request: Request, context: Context) {
  try {
    const actor = await getActor(request);
    const { id } = await context.params;
    const rows = await restRequest<Array<Record<string, unknown>>>(
      request,
      `chat_conversations?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    );
    const conversation = rows[0];
    if (!conversation) return Response.json({ error: "Conversa não encontrada ou sem permissão de acesso." }, { status: 404 });
    const [members, messages] = await Promise.all([
      restRequest<Array<Record<string, unknown>>>(
        request,
        `chat_conversation_members?conversation_id=eq.${encodeURIComponent(id)}&select=profile_id,display_name,member_role,is_default_recipient,joined_at&order=joined_at.asc`,
      ),
      restRequest<Array<Record<string, unknown>>>(
        request,
        `chat_messages?conversation_id=eq.${encodeURIComponent(id)}&select=id,sender_profile_id,body,created_at&order=created_at.asc&limit=300`,
      ),
    ]);
    const memberById = new Map(members.map((member) => [String(member.profile_id), member]));
    return Response.json({
      conversation: {
        id: conversation.id,
        subject: conversation.subject,
        type: conversation.conversation_type,
        status: conversation.status,
        participantId: conversation.participant_profile_id,
        isGroup: Boolean(conversation.is_group) || members.length > 2,
        members: members.map((member) => ({
          id: member.profile_id,
          name: member.display_name,
          role: member.member_role,
          roleLabel: roleLabel(String(member.member_role)),
          automatic: Boolean(member.is_default_recipient),
        })),
      },
      messages: messages.map((message) => {
        const senderId = String(message.sender_profile_id);
        const own = senderId === actor.id;
        const sender = memberById.get(senderId);
        const senderRole = String(sender?.member_role ?? "");
        return {
          id: message.id,
          body: message.body,
          createdAt: message.created_at,
          own,
          side: isAgency(senderRole) ? "agency" : "participant",
          senderName: own ? "Você" : String(sender?.display_name ?? (isAgency(senderRole) ? "Equipe Óriva" : "Participante")),
        };
      }),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await getActor(request);
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "read");
    if (action === "read") {
      await restRequest(request, "rpc/mark_chat_conversation_read", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ p_conversation_id: id }),
      });
      return Response.json({ updated: true });
    }
    if ((action !== "archive" && action !== "reopen") || !isAgency(actor.role)) {
      return Response.json({ error: "Ação não permitida nesta conversa." }, { status: 403 });
    }
    const updated = await restRequest<Array<Record<string, unknown>>>(request, `chat_conversations?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: action === "archive" ? "arquivada" : "aberta",
        agency_last_read_at: new Date().toISOString(),
      }),
    });
    if (!updated[0]) return Response.json({ error: "Conversa não encontrada ou sem permissão de acesso." }, { status: 404 });
    return Response.json({ updated: true, status: updated[0].status });
  } catch (error) {
    return jsonError(error);
  }
}
