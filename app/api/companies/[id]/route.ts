import {
  companyStatusToDb,
  companyStatusToUi,
  getActor,
  invokeAdminFunction,
  jsonError,
  normalizeEmail,
  requireCompanyManager,
  restRequest,
} from "../../../../lib/oriva-data";

export const dynamic = "force-dynamic";

const LEAD_STAGES = new Set(["novo", "contato_realizado", "proposta_enviada", "negociacao", "ganho", "perdido"]);

function isoOrNull(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw Response.json({ error: "Informe uma data válida para o próximo contato." }, { status: 400 });
  return date.toISOString();
}

async function ownerOrNull(request: Request, value: unknown) {
  const id = String(value ?? "").trim();
  if (!id) return null;
  const rows = await restRequest<Array<Record<string, unknown>>>(request, `profiles?id=eq.${encodeURIComponent(id)}&role=in.(super_admin,socio)&is_active=eq.true&select=id&limit=1`);
  if (!rows[0]) throw Response.json({ error: "Selecione um responsável comercial ativo." }, { status: 400 });
  return id;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await getActor(request);
    const { id } = await context.params;
    const rows = await restRequest<Array<Record<string, unknown>>>(
      request,
      `companies?id=eq.${encodeURIComponent(id)}&select=id,name,trade_name,document,email,phone,whatsapp,logo_url,segment,services,responsible,responsible_email,relationship_type,status,created_at,updated_at&limit=1`,
    );
    if (!rows[0]) return Response.json({ error: "Empresa não encontrada." }, { status: 404 });
    const row = rows[0];
    return Response.json({ company: { ...row, contactEmail: row.email, tradeName: row.trade_name, responsibleEmail: row.responsible_email, relationshipType: row.relationship_type === "lead" ? "Lead" : "Cliente", status: companyStatusToUi(row.status) } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireCompanyManager(request);
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const previousRows = await restRequest<Array<Record<string, unknown>>>(request, `lead_details?company_id=eq.${encodeURIComponent(id)}&select=company_id,stage,source,owner_profile_id,next_follow_up_at,last_contact_at,notes,lost_reason,converted_at&limit=1`);
    const previous = previousRows[0];
    const email = normalizeEmail(body.contactEmail ?? body.email);
    const relationshipType = String(body.relationshipType ?? "Cliente").toLowerCase() === "lead" ? "lead" : "cliente";
    const result = await invokeAdminFunction(request, {
      action: "update_company",
      company_id: id,
      name: body.name,
      trade_name: body.tradeName,
      document: body.document,
      email,
      phone: body.phone,
      whatsapp: body.whatsapp,
      segment: body.segment,
      services: body.services,
      responsible: body.responsible,
      responsible_email: body.responsibleEmail,
      relationship_type: relationshipType,
      status: companyStatusToDb(body.status),
      client_name: body.clientName || body.name,
      password: body.password || "",
    });

    if (relationshipType === "lead" || previous) {
      const stage = relationshipType === "cliente"
        ? "ganho"
        : LEAD_STAGES.has(String(body.leadStage)) ? String(body.leadStage) : String(previous?.stage ?? "novo");
      const details = {
        stage,
        source: String(body.leadSource ?? previous?.source ?? "").trim() || null,
        owner_profile_id: await ownerOrNull(request, body.leadOwnerId ?? previous?.owner_profile_id),
        next_follow_up_at: isoOrNull(body.nextFollowUpAt ?? previous?.next_follow_up_at),
        last_contact_at: isoOrNull(body.lastContactAt ?? previous?.last_contact_at),
        notes: String(body.commercialNotes ?? previous?.notes ?? "").trim(),
        lost_reason: String(body.lostReason ?? previous?.lost_reason ?? "").trim() || null,
        converted_at: stage === "ganho" ? String(previous?.converted_at ?? new Date().toISOString()) : null,
      };
      await restRequest(request, previous ? `lead_details?company_id=eq.${encodeURIComponent(id)}` : "lead_details", {
        method: previous ? "PATCH" : "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(previous ? details : { company_id: id, ...details }),
      });
      if (String(previous?.stage ?? "") !== stage) {
        await restRequest(request, "lead_activities", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            company_id: id,
            profile_id: actor.id,
            activity_type: "mudanca_etapa",
            description: relationshipType === "cliente" ? "Lead convertido em cliente." : "Etapa comercial atualizada.",
            previous_stage: previous?.stage ?? null,
            new_stage: stage,
            next_follow_up_at: details.next_follow_up_at,
          }),
        });
      }
    }
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
