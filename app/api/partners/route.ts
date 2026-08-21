import { jsonError, normalizeEmail, normalizeLabel, requireAgencyAdministrator, restRequest } from "../../../lib/oriva-data";

export const dynamic = "force-dynamic";
const statusUi: Record<string, string> = { ativo: "Ativo", pausado: "Pausado", inativo: "Inativo" };

function map(row: Record<string, unknown>) {
  return { id: row.id, name: row.name, companyName: row.company_name, email: row.email, phone: row.phone, specialty: row.specialty, averageValueCents: row.average_value_cents, openDemands: row.open_demands, status: statusUi[String(row.status)] ?? row.status, notes: row.notes, profileId: row.profile_id ?? "", accessLinked: Boolean(row.profile_id), createdAt: row.created_at, updatedAt: row.updated_at };
}

async function matchingProfileId(request: Request, email: string) {
  if (!email) return null;
  const profiles = await restRequest<Array<Record<string, unknown>>>(
    request,
    `profiles?email=eq.${encodeURIComponent(email)}&is_active=eq.true&role=in.(colaborador,parceiro)&select=id&limit=2`,
  );
  if (profiles.length !== 1) return null;
  const profileId = String(profiles[0].id ?? "");
  const linked = await restRequest<Array<Record<string, unknown>>>(
    request,
    `partners?profile_id=eq.${encodeURIComponent(profileId)}&select=id&limit=1`,
  );
  return linked.length ? null : profileId;
}

export async function GET(request: Request) {
  try {
    await requireAgencyAdministrator(request);
    const rows = await restRequest<Array<Record<string, unknown>>>(request, "partners?select=*&order=name.asc");
    return Response.json({ partners: rows.map(map) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAgencyAdministrator(request);
    const body = await request.json() as Record<string, unknown>;
    if (!String(body.name ?? "").trim() || !String(body.specialty ?? "").trim()) return Response.json({ error: "Informe o nome e a especialidade." }, { status: 400 });
    const partnerEmail = normalizeEmail(body.email);
    const profileId = await matchingProfileId(request, partnerEmail);
    const rows = await restRequest<Array<Record<string, unknown>>>(request, "partners", {
      method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
        name: String(body.name).trim(), company_name: String(body.companyName ?? "").trim(), email: partnerEmail, phone: String(body.phone ?? "").trim(), specialty: String(body.specialty).trim(), average_value_cents: Number(body.averageValueCents ?? 0), open_demands: Number(body.openDemands ?? 0), status: normalizeLabel(body.status) || "ativo", notes: String(body.notes ?? "").trim(), profile_id: profileId, created_by: actor.id,
      }),
    });
    return Response.json({ partner: map(rows[0]) }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
