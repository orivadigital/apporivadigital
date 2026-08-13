import {
  jsonError,
  requireCompanyManager,
  restRequest,
} from "../../../../../lib/oriva-data";

export const dynamic = "force-dynamic";

const LEAD_STAGES = new Set(["novo", "contato_realizado", "proposta_enviada", "negociacao", "ganho", "perdido"]);
const ACTIVITY_TYPES = new Set(["ligacao", "whatsapp", "email", "reuniao", "nota"]);

function isoOrNull(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw Response.json({ error: "Informe uma data válida para o próximo contato." }, { status: 400 });
  return date.toISOString();
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireCompanyManager(request);
    const { id } = await context.params;
    const rows = await restRequest<Array<Record<string, unknown>>>(
      request,
      `lead_activities?company_id=eq.${encodeURIComponent(id)}&select=id,activity_type,description,previous_stage,new_stage,contact_at,next_follow_up_at,created_at,profile_id,profiles(name)&order=created_at.desc`,
    );
    return Response.json({
      activities: rows.map((row) => ({
        id: row.id,
        type: row.activity_type,
        description: row.description,
        previousStage: row.previous_stage,
        newStage: row.new_stage,
        contactAt: row.contact_at,
        nextFollowUpAt: row.next_follow_up_at,
        createdAt: row.created_at,
        authorName: row.profiles && typeof row.profiles === "object" ? (row.profiles as Record<string, unknown>).name : "Equipe Óriva",
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireCompanyManager(request);
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const companyRows = await restRequest<Array<Record<string, unknown>>>(request, `companies?id=eq.${encodeURIComponent(id)}&relationship_type=eq.lead&select=id&limit=1`);
    if (!companyRows[0]) return Response.json({ error: "Lead não encontrado." }, { status: 404 });

    const detailRows = await restRequest<Array<Record<string, unknown>>>(request, `lead_details?company_id=eq.${encodeURIComponent(id)}&select=company_id,stage,next_follow_up_at&limit=1`);
    const current = detailRows[0];
    const previousStage = String(current?.stage ?? "novo");
    const requestedStage = String(body.newStage ?? "").trim();
    const newStage = LEAD_STAGES.has(requestedStage) ? requestedStage : previousStage;
    const type = ACTIVITY_TYPES.has(String(body.activityType)) ? String(body.activityType) : "nota";
    const description = String(body.description ?? "").trim();
    if (!description && newStage === previousStage) {
      return Response.json({ error: "Escreva um resumo do contato ou altere a etapa do lead." }, { status: 400 });
    }
    const nextFollowUpAt = isoOrNull(body.nextFollowUpAt);
    const details = {
      stage: newStage,
      next_follow_up_at: nextFollowUpAt ?? current?.next_follow_up_at ?? null,
      last_contact_at: type === "nota" ? undefined : new Date().toISOString(),
      converted_at: newStage === "ganho" ? new Date().toISOString() : undefined,
    };
    const cleanDetails = Object.fromEntries(Object.entries(details).filter((entry) => entry[1] !== undefined));
    await restRequest(request, current ? `lead_details?company_id=eq.${encodeURIComponent(id)}` : "lead_details", {
      method: current ? "PATCH" : "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(current ? cleanDetails : { company_id: id, ...cleanDetails }),
    });
    await restRequest(request, "lead_activities", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        company_id: id,
        profile_id: actor.id,
        activity_type: newStage !== previousStage && !description ? "mudanca_etapa" : type,
        description: description || "Etapa comercial atualizada.",
        previous_stage: newStage !== previousStage ? previousStage : null,
        new_stage: newStage !== previousStage ? newStage : null,
        next_follow_up_at: nextFollowUpAt,
      }),
    });
    return Response.json({ updated: true });
  } catch (error) {
    return jsonError(error);
  }
}
