import {
  getActor,
  jsonError,
  requireAgency,
  requireAgencyAdministrator,
  restRequest,
} from "../../../lib/oriva-data";
import {
  cancelGoogleCommercialMeeting,
  CommercialMeetingForGoogle,
  CommercialParticipantForGoogle,
  createGoogleCommercialMeeting,
} from "../../../lib/google-calendar";

export const dynamic = "force-dynamic";

const MEETING_STATUSES = new Set(["agendada", "realizada", "no_show", "cancelada"]);
const MEETING_RESULTS = new Set(["qualificado", "desqualificado"]);
const WEEKDAYS = new Set([0, 1, 2, 3, 4, 5, 6]);
const AGENCY_ROLES = new Set(["super_admin", "socio", "colaborador"]);

function isoDate(value: unknown, fallback: Date) {
  const text = String(value ?? "").trim();
  const date = text ? new Date(text) : fallback;
  if (Number.isNaN(date.getTime())) throw Response.json({ error: "Informe um período válido." }, { status: 400 });
  return date;
}

function isoTimestamp(value: unknown, label: string) {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) throw Response.json({ error: `Informe ${label}.` }, { status: 400 });
  return date.toISOString();
}

function validEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Response.json({ error: "Informe um e-mail válido para o cliente." }, { status: 400 });
  }
  return email;
}

function text(value: unknown, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function mapMeeting(row: Record<string, unknown>, participants: Array<Record<string, unknown>>) {
  const company = row.companies && typeof row.companies === "object"
    ? row.companies as Record<string, unknown>
    : {};
  return {
    id: row.id,
    companyId: row.company_id ?? "",
    companyName: company.name ?? row.client_company ?? "",
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone ?? "",
    clientCompany: row.client_company ?? "",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    status: row.status,
    result: row.result,
    clientNeeds: row.client_needs ?? "",
    serviceInterest: row.service_interest ?? "",
    budget: row.budget ?? "",
    objections: row.objections ?? "",
    importantInformation: row.important_information ?? "",
    nextStep: row.next_step ?? "",
    closingNotes: row.closing_notes ?? "",
    observations: row.observations ?? "",
    bookedByProfileId: row.booked_by_profile_id,
    bookedByName: row.booked_by_name,
    bookedSource: row.booked_source,
    googleEventId: row.google_event_id,
    meetUrl: row.google_meet_url,
    googleSyncStatus: row.google_sync_status,
    googleSyncError: row.google_sync_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    participants: participants.map((participant) => ({
      profileId: participant.profile_id,
      displayName: participant.display_name,
      email: participant.email,
    })),
  };
}

function googleMeeting(row: Record<string, unknown>): CommercialMeetingForGoogle {
  return {
    id: String(row.id),
    clientName: String(row.client_name ?? ""),
    clientEmail: String(row.client_email ?? ""),
    clientPhone: String(row.client_phone ?? ""),
    clientCompany: String(row.client_company ?? ""),
    startsAt: String(row.starts_at ?? ""),
    endsAt: String(row.ends_at ?? ""),
    clientNeeds: String(row.client_needs ?? ""),
    serviceInterest: String(row.service_interest ?? ""),
    budget: String(row.budget ?? ""),
    objections: String(row.objections ?? ""),
    importantInformation: String(row.important_information ?? ""),
    nextStep: String(row.next_step ?? ""),
    closingNotes: String(row.closing_notes ?? ""),
    observations: String(row.observations ?? ""),
  };
}

async function meetingRows(request: Request, id: string) {
  const meetings = await restRequest<Array<Record<string, unknown>>>(
    request,
    `commercial_meetings?id=eq.${encodeURIComponent(id)}&select=*,companies(name)&limit=1`,
  );
  if (!meetings[0]) throw Response.json({ error: "Reunião não encontrada." }, { status: 404 });
  const participants = await restRequest<Array<Record<string, unknown>>>(
    request,
    `commercial_meeting_participants?meeting_id=eq.${encodeURIComponent(id)}&select=profile_id,display_name,email&order=display_name.asc`,
  );
  return { meeting: meetings[0], participants };
}

async function recordGoogleSync(
  request: Request,
  id: string,
  values: { eventId?: string; meetUrl?: string; status: string; error?: string },
) {
  await restRequest(request, "rpc/record_commercial_google_sync", {
    method: "POST",
    body: JSON.stringify({
      p_meeting_id: id,
      p_event_id: values.eventId ?? "",
      p_meet_url: values.meetUrl ?? "",
      p_status: values.status,
      p_error: values.error ?? null,
    }),
  });
}

async function synchronizeGoogle(request: Request, id: string) {
  const { meeting, participants } = await meetingRows(request, id);
  try {
    const sync = await createGoogleCommercialMeeting(
      googleMeeting(meeting),
      participants.map((participant): CommercialParticipantForGoogle => ({
        displayName: String(participant.display_name ?? ""),
        email: String(participant.email ?? ""),
      })),
    );
    if (!sync.configured) {
      await recordGoogleSync(request, id, { status: "nao_configurado" });
      return { synchronized: false, configured: false, message: "Reunião salva. A conexão do Google Calendar ainda precisa ser autorizada." };
    }
    await recordGoogleSync(request, id, {
      status: "sincronizado",
      eventId: sync.eventId,
      meetUrl: sync.meetUrl,
    });
    return { synchronized: true, configured: true, meetUrl: sync.meetUrl, message: "Reunião criada no Google Calendar e convites enviados." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível sincronizar com o Google Calendar.";
    await recordGoogleSync(request, id, { status: "erro", error: message });
    return { synchronized: false, configured: true, message: `A reunião foi salva, mas o Google Calendar retornou um erro: ${message}` };
  }
}

export async function GET(request: Request) {
  try {
    const actor = await getActor(request);
    const isAgency = AGENCY_ROLES.has(actor.role);
    const url = new URL(request.url);
    const now = new Date();
    const defaultFrom = new Date(now); defaultFrom.setDate(defaultFrom.getDate() - 30);
    const defaultTo = new Date(now); defaultTo.setDate(defaultTo.getDate() + 62);
    const from = isoDate(url.searchParams.get("from"), defaultFrom);
    const to = isoDate(url.searchParams.get("to"), defaultTo);
    if (to < from || to.getTime() - from.getTime() > 370 * 86400000) {
      return Response.json({ error: "Selecione um período de até 12 meses." }, { status: 400 });
    }
    const status = String(url.searchParams.get("status") ?? "");
    const meetingQuery = new URLSearchParams({
      select: "*,companies(name)",
      starts_at: `gte.${from.toISOString()}`,
      order: "starts_at.asc",
    });
    meetingQuery.set("starts_at", `gte.${from.toISOString()}`);
    meetingQuery.set("ends_at", `lte.${to.toISOString()}`);
    if (MEETING_STATUSES.has(status)) meetingQuery.set("status", `eq.${status}`);

    const slotFrom = from.toISOString().slice(0, 10);
    const slotLimit = new Date(Math.min(to.getTime(), from.getTime() + 62 * 86400000)).toISOString().slice(0, 10);
    const [meetings, partners, slots, companies] = await Promise.all([
      restRequest<Array<Record<string, unknown>>>(request, `commercial_meetings?${meetingQuery.toString()}`),
      restRequest<Array<Record<string, unknown>>>(request, "commercial_schedule_partners?is_active=eq.true&select=profile_id,display_name,sort_order,is_reference&order=sort_order.asc"),
      restRequest<Array<Record<string, unknown>>>(request, "rpc/list_commercial_slots", {
        method: "POST",
        body: JSON.stringify({ p_from: slotFrom, p_to: slotLimit, p_duration_minutes: 60 }),
      }),
      isAgency
        ? restRequest<Array<Record<string, unknown>>>(request, "companies?select=id,name,email,phone,whatsapp,relationship_type&order=name.asc")
        : Promise.resolve([]),
    ]);
    const meetingIds = meetings.map((meeting) => String(meeting.id));
    const participantRows = meetingIds.length
      ? await restRequest<Array<Record<string, unknown>>>(request, `commercial_meeting_participants?meeting_id=in.(${meetingIds.join(",")})&select=meeting_id,profile_id,display_name,email`)
      : [];
    const participantsByMeeting = new Map<string, Array<Record<string, unknown>>>();
    for (const participant of participantRows) {
      const id = String(participant.meeting_id);
      participantsByMeeting.set(id, [...(participantsByMeeting.get(id) ?? []), participant]);
    }
    const [availability, blocks] = isAgency ? await Promise.all([
      restRequest<Array<Record<string, unknown>>>(request, "commercial_availability?select=*&order=profile_id.asc,weekday.asc,start_time.asc"),
      restRequest<Array<Record<string, unknown>>>(request, `commercial_schedule_blocks?ends_at=gte.${encodeURIComponent(from.toISOString())}&starts_at=lte.${encodeURIComponent(to.toISOString())}&select=*&order=starts_at.asc`),
    ]) : [[], []];
    const mapped = meetings.map((meeting) => mapMeeting(meeting, participantsByMeeting.get(String(meeting.id)) ?? []));
    return Response.json({
      isAgency,
      canManageSchedule: actor.role === "super_admin" || actor.role === "socio",
      actor: { id: actor.id, name: actor.name, email: actor.email, role: actor.role, companyId: actor.companyId },
      partners: partners.map((partner) => ({ profileId: partner.profile_id, name: partner.display_name, sortOrder: partner.sort_order, isReference: partner.is_reference })),
      availability: availability.map((item) => ({ id: item.id, profileId: item.profile_id, weekday: item.weekday, startTime: String(item.start_time).slice(0, 5), endTime: String(item.end_time).slice(0, 5), validFrom: item.valid_from, validUntil: item.valid_until, active: item.is_active })),
      blocks: blocks.map((block) => ({ id: block.id, profileId: block.profile_id, startsAt: block.starts_at, endsAt: block.ends_at, reason: block.reason })),
      meetings: mapped,
      slots: slots.map((slot) => ({ startsAt: slot.starts_at, endsAt: slot.ends_at })),
      companies: companies.map((company) => ({ id: company.id, name: company.name, email: company.email, phone: company.phone ?? company.whatsapp ?? "", relationshipType: company.relationship_type })),
      stats: {
        scheduled: mapped.filter((meeting) => meeting.status === "agendada").length,
        completed: mapped.filter((meeting) => meeting.status === "realizada").length,
        noShow: mapped.filter((meeting) => meeting.status === "no_show").length,
        cancelled: mapped.filter((meeting) => meeting.status === "cancelada").length,
        qualified: mapped.filter((meeting) => meeting.result === "qualificado").length,
        disqualified: mapped.filter((meeting) => meeting.result === "desqualificado").length,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getActor(request);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "book");

    if (action === "availability") {
      await requireAgencyAdministrator(request);
      const profileId = text(body.profileId, 100);
      const weekday = Number(body.weekday);
      const startTime = text(body.startTime, 8);
      const endTime = text(body.endTime, 8);
      if (!profileId || !WEEKDAYS.has(weekday) || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || startTime >= endTime) {
        return Response.json({ error: "Informe o sócio, o dia e um intervalo de disponibilidade válido." }, { status: 400 });
      }
      const created = await restRequest<Array<Record<string, unknown>>>(request, "commercial_availability", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          profile_id: profileId,
          weekday,
          start_time: startTime,
          end_time: endTime,
          timezone: "America/Sao_Paulo",
          valid_from: text(body.validFrom, 10) || null,
          valid_until: text(body.validUntil, 10) || null,
          created_by: actor.id,
        }),
      });
      return Response.json({ availability: created[0] }, { status: 201 });
    }

    if (action === "block") {
      await requireAgencyAdministrator(request);
      const blockId = await restRequest<string>(request, "rpc/create_commercial_schedule_block", {
        method: "POST",
        body: JSON.stringify({
          p_profile_id: text(body.profileId, 100),
          p_starts_at: isoTimestamp(body.startsAt, "o início do bloqueio"),
          p_ends_at: isoTimestamp(body.endsAt, "o fim do bloqueio"),
          p_reason: text(body.reason, 1000),
        }),
      });
      return Response.json({ id: blockId }, { status: 201 });
    }

    if (action === "sync_google") {
      await requireAgency(request);
      const id = text(body.id, 100);
      const sync = await synchronizeGoogle(request, id);
      return Response.json(sync, { status: sync.synchronized ? 200 : 202 });
    }

    const clientName = text(body.clientName, 200);
    if (!clientName) return Response.json({ error: "Informe o nome do cliente." }, { status: 400 });
    const clientEmail = validEmail(body.clientEmail);
    const startsAt = isoTimestamp(body.startsAt, "o início da reunião");
    const endsAt = isoTimestamp(body.endsAt, "o fim da reunião");
    const booked = await restRequest<Record<string, unknown>>(request, "rpc/book_commercial_meeting", {
      method: "POST",
      body: JSON.stringify({
        p_company_id: text(body.companyId, 100) || null,
        p_client_name: clientName,
        p_client_email: clientEmail,
        p_client_phone: text(body.clientPhone, 80),
        p_client_company: text(body.clientCompany, 200),
        p_starts_at: startsAt,
        p_ends_at: endsAt,
        p_client_needs: text(body.clientNeeds),
        p_service_interest: text(body.serviceInterest),
        p_budget: text(body.budget),
        p_objections: text(body.objections),
        p_important_information: text(body.importantInformation),
        p_next_step: text(body.nextStep),
        p_closing_notes: text(body.closingNotes),
        p_observations: text(body.observations),
      }),
    });
    const id = String(booked.id ?? "");
    if (!id) throw new Error("A reunião foi salva, mas o identificador não foi retornado.");
    const sync = await synchronizeGoogle(request, id);
    const current = await meetingRows(request, id);
    return Response.json({ meeting: mapMeeting(current.meeting, current.participants), sync }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireAgency(request);
    const body = await request.json() as Record<string, unknown>;
    const id = text(body.id, 100);
    const status = text(body.status, 30);
    const result = text(body.result, 30);
    if (!id || !MEETING_STATUSES.has(status)) return Response.json({ error: "Selecione uma situação válida." }, { status: 400 });
    if (status === "realizada" && !MEETING_RESULTS.has(result)) {
      return Response.json({ error: "Informe se a reunião realizada foi qualificada ou desqualificada." }, { status: 400 });
    }
    const { meeting } = await meetingRows(request, id);
    const updates = {
      status,
      result: status === "realizada" ? result : null,
      client_needs: text(body.clientNeeds),
      service_interest: text(body.serviceInterest),
      budget: text(body.budget),
      objections: text(body.objections),
      important_information: text(body.importantInformation),
      next_step: text(body.nextStep),
      closing_notes: text(body.closingNotes),
      observations: text(body.observations),
      cancelled_at: status === "cancelada" ? new Date().toISOString() : null,
    };
    await restRequest(request, `commercial_meetings?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(updates),
    });
    let warning = "";
    if (status === "cancelada" && meeting.google_event_id) {
      try {
        const cancellation = await cancelGoogleCommercialMeeting(String(meeting.google_event_id));
        if (cancellation.configured) await recordGoogleSync(request, id, { status: "cancelado" });
      } catch (error) {
        warning = error instanceof Error ? error.message : "O Google Calendar não confirmou o cancelamento.";
      }
    }
    await restRequest(request, "audit_logs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        profile_id: actor.id,
        company_id: meeting.company_id ?? null,
        action: "reuniao_comercial_atualizada",
        entity_type: "commercial_meeting",
        entity_id: id,
        metadata: { status, result: updates.result },
      }),
    });
    const current = await meetingRows(request, id);
    return Response.json({ meeting: mapMeeting(current.meeting, current.participants), warning });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAgencyAdministrator(request);
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const id = text(url.searchParams.get("id"), 100);
    if (!id || !["availability", "block"].includes(String(type))) {
      return Response.json({ error: "Registro de agenda inválido." }, { status: 400 });
    }
    const table = type === "availability" ? "commercial_availability" : "commercial_schedule_blocks";
    await restRequest(request, `${table}?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    return Response.json({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}
