import {
  companyStatusToUi,
  getActor,
  invokeAdminFunction,
  jsonError,
  normalizeEmail,
  requireCompanyManager,
  restRequest,
} from "../../../lib/oriva-data";

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

function companyIdFromResult(result: unknown) {
  if (!result || typeof result !== "object") return "";
  const root = result as Record<string, unknown>;
  const nested = root.result;
  if (Array.isArray(nested)) return String((nested[0] as Record<string, unknown> | undefined)?.company_id ?? "");
  if (nested && typeof nested === "object") return String((nested as Record<string, unknown>).company_id ?? "");
  return String(root.company_id ?? "");
}

function mapCompany(row: Record<string, unknown>, lead: Record<string, unknown> | undefined, ownerById: Map<string, Record<string, unknown>>) {
  const owner = lead?.owner_profile_id ? ownerById.get(String(lead.owner_profile_id)) : undefined;
  return {
    id: row.id,
    name: row.name,
    tradeName: row.trade_name ?? "",
    document: row.document ?? "",
    contactEmail: row.email ?? "",
    phone: row.phone ?? "",
    whatsapp: row.whatsapp ?? "",
    logoUrl: row.logo_url ?? "",
    segment: row.segment ?? "",
    services: row.services ?? "",
    responsible: row.responsible ?? "",
    responsibleEmail: row.responsible_email ?? "",
    relationshipType: row.relationship_type === "lead" ? "Lead" : "Cliente",
    leadStage: lead?.stage ?? "novo",
    leadSource: lead?.source ?? "",
    leadOwnerId: lead?.owner_profile_id ?? "",
    leadOwnerName: owner?.name ?? "",
    nextFollowUpAt: lead?.next_follow_up_at ?? null,
    lastContactAt: lead?.last_contact_at ?? null,
    commercialNotes: lead?.notes ?? "",
    lostReason: lead?.lost_reason ?? "",
    convertedAt: lead?.converted_at ?? null,
    status: companyStatusToUi(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  try {
    const actor = await getActor(request);
    const assignedOnly = actor.role === "colaborador" || actor.role === "parceiro";
    const companySelect = assignedOnly
      ? "id,name"
      : "id,name,trade_name,document,email,phone,whatsapp,logo_url,segment,services,responsible,responsible_email,relationship_type,status,created_at,updated_at";
    const [rows, leadRows, ownerRows] = await Promise.all([
      restRequest<Array<Record<string, unknown>>>(request, `companies?select=${companySelect}&order=name.asc`),
      actor.role === "super_admin" || actor.role === "socio"
        ? restRequest<Array<Record<string, unknown>>>(request, "lead_details?select=company_id,stage,source,owner_profile_id,next_follow_up_at,last_contact_at,notes,lost_reason,converted_at")
        : Promise.resolve([]),
      actor.role === "super_admin" || actor.role === "socio"
        ? restRequest<Array<Record<string, unknown>>>(request, "profiles?role=in.(super_admin,socio)&is_active=eq.true&select=id,name,email&order=name.asc")
        : Promise.resolve([]),
    ]);
    const leadByCompany = new Map(leadRows.map((lead) => [String(lead.company_id), lead]));
    const ownerById = new Map(ownerRows.map((owner) => [String(owner.id), owner]));
    return Response.json({
      companies: rows.map((row) => mapCompany(row, leadByCompany.get(String(row.id)), ownerById)),
      commercialOwners: ownerRows,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireCompanyManager(request);
    const body = await request.json() as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    const email = normalizeEmail(body.contactEmail ?? body.email);
    const password = String(body.password ?? "");
    if (!name || !email || password.length < 8) {
      return Response.json({ error: "Informe o nome, o e-mail e uma senha temporária de pelo menos 8 caracteres." }, { status: 400 });
    }
    const relationshipType = String(body.relationshipType ?? "Cliente").toLowerCase() === "lead" ? "lead" : "cliente";
    const result = await invokeAdminFunction<Record<string, unknown>>(request, {
      action: "create_company",
      name,
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
      client_name: body.clientName || name,
      password,
    });
    const companyId = companyIdFromResult(result);
    if (relationshipType === "lead" && companyId) {
      const stage = LEAD_STAGES.has(String(body.leadStage)) ? String(body.leadStage) : "novo";
      const nextFollowUpAt = isoOrNull(body.nextFollowUpAt);
      await restRequest(request, "lead_details?on_conflict=company_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          company_id: companyId,
          stage,
          source: String(body.leadSource ?? "").trim() || null,
          owner_profile_id: await ownerOrNull(request, body.leadOwnerId),
          next_follow_up_at: nextFollowUpAt,
          last_contact_at: isoOrNull(body.lastContactAt),
          notes: String(body.commercialNotes ?? "").trim(),
          lost_reason: String(body.lostReason ?? "").trim() || null,
          converted_at: stage === "ganho" ? new Date().toISOString() : null,
        }),
      });
      await restRequest(request, "lead_activities", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          company_id: companyId,
          profile_id: actor.id,
          activity_type: "cadastro",
          description: "Lead cadastrado no funil comercial.",
          new_stage: stage,
          next_follow_up_at: nextFollowUpAt,
        }),
      });
    }
    return Response.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
