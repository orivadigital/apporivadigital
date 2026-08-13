import { getActor, jsonError, postStatusToUi, restRequest } from "../../../lib/oriva-data";

export const dynamic = "force-dynamic";
const taskStatusUi: Record<string, string> = { pendente: "Pendente", em_andamento: "Em andamento", atrasado: "Atrasado", concluido: "Concluído" };

export async function GET(request: Request) {
  try {
    const actor = await getActor(request);
    const url = new URL(request.url);
    let companyId = String(url.searchParams.get("tenant_id") ?? "").trim();

    if (actor.role === "colaborador") {
      return Response.json({ error: "Use a área Minhas demandas ou Minha agenda para ver somente as atividades atribuídas a você." }, { status: 403 });
    }

    if (actor.role === "empresa_cliente") {
      if (!actor.companyId) return Response.json({ error: "Nenhuma empresa está vinculada ao seu login." }, { status: 403 });
      if (companyId && companyId !== actor.companyId) return Response.json({ error: "Você não possui acesso a esta empresa." }, { status: 403 });
      companyId = actor.companyId;
    }
    if (actor.role === "parceiro" && !actor.partnerId) {
      return Response.json({ error: "Seu acesso ainda não está vinculado a um cadastro de Parceiro PJ." }, { status: 403 });
    }
    if (!["empresa_cliente", "parceiro"].includes(actor.role) && !companyId) {
      return Response.json({ error: "Selecione uma empresa para abrir o calendário geral." }, { status: 400 });
    }

    const taskFilters = new URLSearchParams({
      select: "*,companies(name)",
      order: "due_date.asc,created_at.asc",
    });
    if (companyId) taskFilters.set("company_id", `eq.${companyId}`);
    if (actor.role === "parceiro") taskFilters.set("partner_id", `eq.${actor.partnerId}`);
    const tasks = await restRequest<Array<Record<string, unknown>>>(request, `agency_tasks?${taskFilters.toString()}`);

    const companyIds = Array.from(new Set(tasks.map((task) => String(task.company_id ?? "")).filter(Boolean)));
    if (companyId && !companyIds.includes(companyId)) companyIds.push(companyId);

    const companies = companyIds.length
      ? await restRequest<Array<Record<string, unknown>>>(request, `companies?id=in.(${companyIds.join(",")})&select=id,name&order=name.asc`)
      : [];

    const postFilters = new URLSearchParams({ select: "id,company_id,title,content_type,social_network,scheduled_date,scheduled_time,status", order: "scheduled_date.asc,scheduled_time.asc" });
    if (companyIds.length) postFilters.set("company_id", `in.(${companyIds.join(",")})`);
    if (actor.role === "parceiro") postFilters.set("assigned_to", `eq.${actor.id}`);
    const posts = companyIds.length
      ? await restRequest<Array<Record<string, unknown>>>(request, `scheduled_posts?${postFilters.toString()}`)
      : [];

    const taskIds = tasks.map((task) => String(task.id));
    const files = taskIds.length
      ? await restRequest<Array<Record<string, unknown>>>(request, `task_files?task_id=in.(${taskIds.join(",")})&select=*&order=created_at.asc`)
      : [];
    const filesByTask = new Map<string, Array<Record<string, unknown>>>();
    for (const file of files) {
      const key = String(file.task_id);
      const current = filesByTask.get(key) ?? [];
      current.push(file);
      filesByTask.set(key, current);
    }

    const events = [
      ...tasks.map((task) => {
        const company = task.companies && typeof task.companies === "object" ? task.companies as Record<string, unknown> : {};
        return {
          id: task.id,
          entityType: "task",
          companyId: task.company_id,
          companyName: company.name ?? "Empresa",
          title: task.title,
          description: task.description ?? "",
          date: task.due_date,
          time: "",
          status: taskStatusUi[String(task.status)] ?? task.status,
          type: "Demanda",
          partnerId: task.partner_id ?? "",
          files: (filesByTask.get(String(task.id)) ?? []).map((file) => ({
            id: file.id,
            fileName: file.file_name,
            fileType: file.mime_type,
            fileSize: file.file_size,
            uploadedBy: file.uploaded_by ?? "",
            previewUrl: `/api/files?entity=task&id=${encodeURIComponent(String(file.id))}`,
            downloadUrl: `/api/files?entity=task&id=${encodeURIComponent(String(file.id))}&download=1`,
          })),
        };
      }),
      ...posts.map((post) => ({
        id: post.id,
        entityType: "post",
        companyId: post.company_id,
        companyName: companies.find((company) => String(company.id) === String(post.company_id))?.name ?? "Empresa",
        title: post.title,
        description: String(post.content_type ?? "Conteúdo").replace(/_/g, " "),
        date: post.scheduled_date,
        time: String(post.scheduled_time ?? "").slice(0, 5),
        status: postStatusToUi(post.status),
        type: "Conteúdo",
        files: [],
      })),
    ].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time)));

    return Response.json({
      events,
      companies,
      selectedCompanyId: companyId || companyIds[0] || "",
      permissions: { canAttach: true, canManageTasks: ["super_admin", "socio"].includes(actor.role) },
    });
  } catch (error) {
    return jsonError(error);
  }
}
