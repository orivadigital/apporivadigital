import { getActor, jsonError, restRequest } from "../../../../lib/oriva-data";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

function isAgency(role: string) {
  return role === "super_admin" || role === "socio";
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
    const messages = await restRequest<Array<Record<string, unknown>>>(
      request,
      `chat_messages?conversation_id=eq.${encodeURIComponent(id)}&select=id,sender_profile_id,body,created_at&order=created_at.asc&limit=300`,
    );
    return Response.json({
      conversation: {
        id: conversation.id,
        subject: conversation.subject,
        type: conversation.conversation_type,
        status: conversation.status,
        participantId: conversation.participant_profile_id,
      },
      messages: messages.map((message) => {
        const senderId = String(message.sender_profile_id);
        const own = senderId === actor.id;
        const participantMessage = senderId === String(conversation.participant_profile_id);
        return {
          id: message.id,
          body: message.body,
          createdAt: message.created_at,
          own,
          side: participantMessage ? "participant" : "agency",
          senderName: own ? "Você" : participantMessage ? "Participante" : "Equipe Óriva",
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
    const values: Record<string, unknown> = {};
    if (action === "read") {
      values[isAgency(actor.role) ? "agency_last_read_at" : "participant_last_read_at"] = new Date().toISOString();
    } else if ((action === "archive" || action === "reopen") && isAgency(actor.role)) {
      values.status = action === "archive" ? "arquivada" : "aberta";
      values.agency_last_read_at = new Date().toISOString();
    } else {
      return Response.json({ error: "Ação não permitida nesta conversa." }, { status: 403 });
    }
    const updated = await restRequest<Array<Record<string, unknown>>>(request, `chat_conversations?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(values),
    });
    if (!updated[0]) return Response.json({ error: "Conversa não encontrada ou sem permissão de acesso." }, { status: 404 });
    return Response.json({ updated: true, status: updated[0].status });
  } catch (error) {
    return jsonError(error);
  }
}
