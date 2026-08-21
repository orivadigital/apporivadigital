import {
  contentTypeToUi,
  getActor,
  jsonError,
  postStatusToUi,
  restRequest,
} from "../../../lib/oriva-data";

export const dynamic = "force-dynamic";

const taskStatusUi: Record<string, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  atrasado: "Atrasado",
  concluido: "Concluído",
};

const priorityUi: Record<string, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  urgente: "Urgente",
};

function contentBoardStatus(value: unknown) {
  const status = postStatusToUi(value);
  if (status === "Aprovado" || status === "Publicado") return "Concluído";
  if (status === "Aguardando aprovação" || status === "Revisão solicitada") return "Em andamento";
  return "Pendente";
}

export async function GET(request: Request) {
  try {
    const actor = await getActor(request);
    if (!["super_admin", "socio", "colaborador", "parceiro"].includes(actor.role)) {
      return Response.json({ error: "Acesso restrito à equipe e aos parceiros da agência." }, { status: 403 });
    }
    if (actor.role === "parceiro" && !actor.partnerId) {
      return Response.json({ error: "Seu login ainda não está vinculado a um Parceiro PJ." }, { status: 403 });
    }

    const taskFilters = new URLSearchParams({
      select: "*,companies(name)",
      order: "due_date.asc,created_at.asc",
    });
    const postFilters = new URLSearchParams({
      select: "*,companies(name)",
      order: "scheduled_date.asc,scheduled_time.asc,created_at.asc",
    });

    if (actor.role === "colaborador") {
      if (actor.partnerId) {
        const assignments = `(assigned_to.eq.${actor.id},partner_id.eq.${actor.partnerId})`;
        taskFilters.set("or", assignments);
        postFilters.set("or", assignments);
      } else {
        taskFilters.set("assigned_to", `eq.${actor.id}`);
        postFilters.set("assigned_to", `eq.${actor.id}`);
      }
    }
    if (actor.role === "parceiro") {
      taskFilters.set("partner_id", `eq.${actor.partnerId}`);
      postFilters.set("partner_id", `eq.${actor.partnerId}`);
    }

    const [taskRows, postRows] = await Promise.all([
      restRequest<Array<Record<string, unknown>>>(request, `agency_tasks?${taskFilters.toString()}`),
      restRequest<Array<Record<string, unknown>>>(request, `scheduled_posts?${postFilters.toString()}`),
    ]);

    const assignedIds = Array.from(new Set(
      [...taskRows, ...postRows].map((row) => String(row.assigned_to ?? "")).filter(Boolean),
    ));
    const partnerIds = Array.from(new Set(
      [...taskRows, ...postRows].map((row) => String(row.partner_id ?? "")).filter(Boolean),
    ));
    const [people, partners] = await Promise.all([
      assignedIds.length
        ? restRequest<Array<Record<string, unknown>>>(request, `profiles?id=in.(${assignedIds.join(",")})&select=id,name,email`)
        : Promise.resolve([]),
      partnerIds.length
        ? restRequest<Array<Record<string, unknown>>>(request, `partners?id=in.(${partnerIds.join(",")})&select=id,name,company_name,profile_id`)
        : Promise.resolve([]),
    ]);
    const peopleById = new Map(people.map((person) => [String(person.id), person]));
    const partnersById = new Map(partners.map((partner) => [String(partner.id), partner]));
    const today = new Date().toISOString().slice(0, 10);

    const tasks = taskRows.map((row) => {
      const person = peopleById.get(String(row.assigned_to ?? ""));
      const company = row.companies && typeof row.companies === "object"
        ? row.companies as Record<string, unknown>
        : null;
      const partner = partnersById.get(String(row.partner_id ?? ""));
      const status = taskStatusUi[String(row.status)] ?? String(row.status ?? "Pendente");
      const overdue = status !== "Concluído" && String(row.due_date) < today;
      return {
        id: row.id,
        entityType: "task",
        sourceLabel: "Tarefa",
        title: row.title,
        description: row.description,
        tenantId: row.company_id ?? "",
        companyName: company?.name ?? "",
        taskType: String(row.task_type ?? "outro").replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase()),
        assignedTo: row.assigned_to ?? "",
        assignedToName: person?.name ?? person?.email ?? "",
        partnerId: row.partner_id ?? "",
        partnerProfileId: partner?.profile_id ?? "",
        partnerName: partner?.name ?? partner?.company_name ?? "",
        dueDate: row.due_date,
        scheduledTime: "",
        priority: priorityUi[String(row.priority)] ?? row.priority,
        status,
        displayStatus: overdue ? "Atrasado" : status,
        completedAt: row.completed_at ?? "",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    const posts = postRows.map((row) => {
      const person = peopleById.get(String(row.assigned_to ?? ""));
      const company = row.companies && typeof row.companies === "object"
        ? row.companies as Record<string, unknown>
        : null;
      const partner = partnersById.get(String(row.partner_id ?? ""));
      const contentStatus = postStatusToUi(row.status);
      const status = contentBoardStatus(row.status);
      const overdue = status !== "Concluído" && String(row.scheduled_date) < today;
      return {
        id: row.id,
        entityType: "post",
        sourceLabel: "Calendário de Posts",
        title: row.title,
        description: row.caption ?? "",
        tenantId: row.company_id ?? "",
        companyName: company?.name ?? "",
        taskType: contentTypeToUi(row.content_type),
        assignedTo: row.assigned_to ?? "",
        assignedToName: person?.name ?? person?.email ?? "",
        partnerId: row.partner_id ?? "",
        partnerProfileId: partner?.profile_id ?? "",
        partnerName: partner?.name ?? partner?.company_name ?? "",
        dueDate: row.scheduled_date,
        scheduledTime: String(row.scheduled_time ?? "").slice(0, 5),
        priority: "Média",
        status,
        displayStatus: overdue ? "Atrasado" : status,
        contentStatus,
        completedAt: status === "Concluído" ? row.updated_at ?? "" : "",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    const workItems = [...tasks, ...posts].sort((first, second) =>
      String(first.dueDate).localeCompare(String(second.dueDate))
      || String(first.scheduledTime).localeCompare(String(second.scheduledTime))
      || String(first.createdAt).localeCompare(String(second.createdAt)),
    );
    return Response.json({ tasks: workItems });
  } catch (error) {
    return jsonError(error);
  }
}
