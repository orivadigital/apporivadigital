type GoogleCalendarConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
};

export type CommercialMeetingForGoogle = {
  id: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientCompany: string;
  startsAt: string;
  endsAt: string;
  clientNeeds: string;
  serviceInterest: string;
  budget: string;
  objections: string;
  importantInformation: string;
  nextStep: string;
  closingNotes: string;
  observations: string;
};

export type CommercialParticipantForGoogle = {
  displayName: string;
  email: string;
};

async function runtimeEnvironment() {
  try {
    const cloudflare = await import("cloudflare:workers");
    return cloudflare.env as unknown as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

async function googleConfig(): Promise<GoogleCalendarConfig | null> {
  const runtime = await runtimeEnvironment();
  const read = (name: string) => String(runtime[name] ?? process.env[name] ?? "").trim();
  const config = {
    clientId: read("GOOGLE_CALENDAR_CLIENT_ID"),
    clientSecret: read("GOOGLE_CALENDAR_CLIENT_SECRET"),
    refreshToken: read("GOOGLE_CALENDAR_REFRESH_TOKEN"),
    calendarId: read("GOOGLE_CALENDAR_ID") || "primary",
  };
  return config.clientId && config.clientSecret && config.refreshToken ? config : null;
}

async function googleAccessToken(config: GoogleCalendarConfig) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const token = String(payload.access_token ?? "");
  if (!response.ok || !token) {
    throw new Error("O Google Calendar recusou a renovação da autorização.");
  }
  return token;
}

function meetingDescription(meeting: CommercialMeetingForGoogle) {
  const details = [
    ["Cliente", meeting.clientName],
    ["Empresa", meeting.clientCompany],
    ["E-mail", meeting.clientEmail],
    ["Telefone", meeting.clientPhone],
    ["Necessidade", meeting.clientNeeds],
    ["Serviço de interesse", meeting.serviceInterest],
    ["Orçamento", meeting.budget],
    ["Objeções", meeting.objections],
    ["Informações importantes", meeting.importantInformation],
    ["Próximo passo", meeting.nextStep],
    ["Observações para o fechamento", meeting.closingNotes],
    ["Observações gerais", meeting.observations],
  ].filter((entry) => entry[1]);
  return ["Reunião comercial agendada pela plataforma Óriva.", "", ...details.map(([label, value]) => `${label}: ${value}`)].join("\n");
}

export async function createGoogleCommercialMeeting(
  meeting: CommercialMeetingForGoogle,
  participants: CommercialParticipantForGoogle[],
) {
  const config = await googleConfig();
  if (!config) return { configured: false as const };

  const token = await googleAccessToken(config);
  const attendees = new Map<string, { email: string; displayName?: string }>();
  for (const participant of participants) {
    const email = participant.email.trim().toLowerCase();
    if (email) attendees.set(email, { email, displayName: participant.displayName });
  }
  if (meeting.clientEmail.trim()) {
    attendees.set(meeting.clientEmail.trim().toLowerCase(), {
      email: meeting.clientEmail.trim().toLowerCase(),
      displayName: meeting.clientName,
    });
  }

  const calendarId = encodeURIComponent(config.calendarId);
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?conferenceDataVersion=1&sendUpdates=all`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: `Reunião comercial Óriva — ${meeting.clientName}`,
        description: meetingDescription(meeting),
        start: { dateTime: meeting.startsAt, timeZone: "America/Sao_Paulo" },
        end: { dateTime: meeting.endsAt, timeZone: "America/Sao_Paulo" },
        attendees: Array.from(attendees.values()),
        guestsCanInviteOthers: false,
        guestsCanModify: false,
        guestsCanSeeOtherGuests: true,
        conferenceData: {
          createRequest: {
            requestId: `oriva-${meeting.id}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
        extendedProperties: { private: { orivaMeetingId: meeting.id } },
      }),
    },
  );
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : {};
    throw new Error(String(error.message ?? "Não foi possível criar o evento no Google Calendar."));
  }
  const conference = payload.conferenceData && typeof payload.conferenceData === "object"
    ? payload.conferenceData as Record<string, unknown>
    : {};
  const entryPoints = Array.isArray(conference.entryPoints)
    ? conference.entryPoints as Array<Record<string, unknown>>
    : [];
  const meetUrl = String(payload.hangoutLink ?? entryPoints.find((entry) => entry.entryPointType === "video")?.uri ?? "");
  const eventId = String(payload.id ?? "");
  if (!eventId || !meetUrl) throw new Error("O Google criou o evento, mas não retornou o link do Meet.");
  return { configured: true as const, eventId, meetUrl };
}

export async function cancelGoogleCommercialMeeting(eventId: string) {
  const config = await googleConfig();
  if (!config || !eventId.trim()) return { configured: false as const };
  const token = await googleAccessToken(config);
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error("A reunião foi cancelada na Óriva, mas o Google Calendar não confirmou o cancelamento.");
  }
  return { configured: true as const };
}
