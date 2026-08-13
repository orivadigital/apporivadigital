import { getActor, jsonError, restRequest } from "../../../../../lib/oriva-data";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const actor = await getActor(request);
    const { id } = await context.params;
    const payload = await request.json() as Record<string, unknown>;
    const message = String(payload.message ?? "").trim();
    if (!message || message.length > 5000) {
      return Response.json({ error: "Escreva uma mensagem de até 5.000 caracteres." }, { status: 400 });
    }
    const created = await restRequest<Array<Record<string, unknown>>>(request, "chat_messages", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ conversation_id: id, sender_profile_id: actor.id, body: message }),
    });
    if (!created[0]) return Response.json({ error: "Não foi possível enviar a mensagem." }, { status: 500 });
    return Response.json({ message: created[0] }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
