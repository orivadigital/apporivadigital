import { analyzeCalendarText } from "../../../lib/calendar-import-ai";
import {
  CONTENT_TYPES,
  NETWORKS,
  jsonError,
  requireCompany,
  restRequest,
} from "../../../lib/oriva-data";

export const dynamic = "force-dynamic";

type ImportCandidate = {
  sourceCode: string;
  scheduledDate: string;
  scheduledTime: string;
  title: string;
  contentType: string;
  socialNetwork: string;
  caption: string;
  internalNotes: string;
  referenceLinks: string[];
  warnings: string[];
};

function clean(value: unknown, max = 50_000) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizeTitle(value: unknown) {
  return clean(value, 120).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function links(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => clean(item, 2_000))
    .filter((item) => /^https?:\/\//i.test(item))
    .filter((item, index, all) => all.indexOf(item) === index)
    .slice(0, 20);
}

function warnings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => clean(item, 500)).filter(Boolean).slice(0, 20);
}

function candidate(value: unknown, defaultTime: string): ImportCandidate {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    sourceCode: clean(raw.sourceCode, 80),
    scheduledDate: clean(raw.scheduledDate, 10),
    scheduledTime: clean(raw.scheduledTime, 5) || defaultTime,
    title: clean(raw.title, 120),
    contentType: clean(raw.contentType, 40).toLowerCase(),
    socialNetwork: clean(raw.socialNetwork, 40).toLowerCase(),
    caption: clean(raw.caption, 20_000),
    internalNotes: clean(raw.internalNotes, 50_000),
    referenceLinks: links(raw.referenceLinks),
    warnings: warnings(raw.warnings),
  };
}

async function existingPosts(request: Request, companyId: string, items: ImportCandidate[]) {
  const dates = Array.from(new Set(items.map((item) => item.scheduledDate).filter(validDate)));
  if (!dates.length) return [];
  return restRequest<Array<Record<string, unknown>>>(
    request,
    `scheduled_posts?company_id=eq.${encodeURIComponent(companyId)}&scheduled_date=in.(${dates.join(",")})&select=id,title,scheduled_date`,
  );
}

function duplicateKeys(rows: Array<Record<string, unknown>>) {
  return new Set(rows.map((row) => `${clean(row.scheduled_date, 10)}|${normalizeTitle(row.title)}`));
}

async function companyForImport(request: Request, tenantId: string) {
  const access = await requireCompany(request, tenantId);
  if (!access.isAgency) {
    throw Response.json({ error: "Somente a equipe da Óriva pode importar cronogramas." }, { status: 403 });
  }
  const companies = await restRequest<Array<Record<string, unknown>>>(
    request,
    `companies?id=eq.${encodeURIComponent(access.companyId)}&select=id,name,relationship_type&limit=1`,
  );
  const company = companies[0];
  if (!company) throw Response.json({ error: "Empresa não encontrada." }, { status: 404 });
  if (company.relationship_type === "lead") {
    throw Response.json({ error: "Selecione uma empresa cliente antes de importar o cronograma." }, { status: 400 });
  }
  return { access, company };
}

async function analyze(request: Request, body: Record<string, unknown>) {
  const tenantId = clean(body.tenantId, 80);
  const sourceText = clean(body.sourceText, 60_000);
  const defaultTime = clean(body.defaultTime, 5) || "09:00";
  if (sourceText.length < 80) {
    return Response.json({ error: "Cole um cronograma mais completo para que eu consiga organizar as publicações." }, { status: 400 });
  }
  if (!validTime(defaultTime)) {
    return Response.json({ error: "Escolha um horário padrão válido." }, { status: 400 });
  }
  const { access, company } = await companyForImport(request, tenantId);
  const analysis = await analyzeCalendarText(sourceText);
  if (!analysis.items.length) {
    return Response.json({
      error: "Não consegui identificar publicações com data nesse texto. Confira os títulos e datas do cronograma.",
      warnings: analysis.warnings,
    }, { status: 422 });
  }
  const items = analysis.items.map((item) => candidate({ ...item, scheduledTime: defaultTime }, defaultTime));
  const existing = duplicateKeys(await existingPosts(request, access.companyId, items));
  const sourceCompany = normalizeTitle(analysis.companyName);
  const selectedCompany = normalizeTitle(company.name);
  const analysisWarnings = analysis.warnings.slice();
  if (sourceCompany && selectedCompany && sourceCompany !== selectedCompany) {
    analysisWarnings.push(`O cronograma cita “${analysis.companyName}”, mas a empresa selecionada é “${clean(company.name, 160)}”. Confira antes de importar.`);
  }
  return Response.json({
    analysis: {
      ...analysis,
      warnings: analysisWarnings,
      selectedCompanyName: clean(company.name, 160),
      items: items.map((item) => {
        const itemWarnings = item.warnings.slice();
        if (!validDate(item.scheduledDate)) itemWarnings.push("Defina uma data válida antes de importar.");
        if (!item.title) itemWarnings.push("Defina um título antes de importar.");
        const duplicate = existing.has(`${item.scheduledDate}|${normalizeTitle(item.title)}`);
        if (duplicate) itemWarnings.push("Já existe um conteúdo com o mesmo título nesta data.");
        return { ...item, warnings: Array.from(new Set(itemWarnings)), duplicate };
      }),
    },
  });
}

async function commit(request: Request, body: Record<string, unknown>) {
  const tenantId = clean(body.tenantId, 80);
  const { access } = await companyForImport(request, tenantId);
  if (!Array.isArray(body.items) || !body.items.length) {
    return Response.json({ error: "Selecione pelo menos um conteúdo para importar." }, { status: 400 });
  }
  if (body.items.length > 31) {
    return Response.json({ error: "Importe no máximo 31 conteúdos de cada vez." }, { status: 400 });
  }
  const items = body.items.map((item) => candidate(item, "09:00"));
  for (const item of items) {
    if (!item.title) return Response.json({ error: "Todos os conteúdos selecionados precisam de um título." }, { status: 400 });
    if (!validDate(item.scheduledDate)) return Response.json({ error: `Revise a data do conteúdo “${item.title}”.` }, { status: 400 });
    if (!validTime(item.scheduledTime)) return Response.json({ error: `Revise o horário do conteúdo “${item.title}”.` }, { status: 400 });
    if (!CONTENT_TYPES.includes(item.contentType) || !NETWORKS.includes(item.socialNetwork)) {
      return Response.json({ error: `Revise o tipo ou a rede social do conteúdo “${item.title}”.` }, { status: 400 });
    }
  }
  const requestedKeys = new Set<string>();
  for (const item of items) {
    const key = `${item.scheduledDate}|${normalizeTitle(item.title)}`;
    if (requestedKeys.has(key)) {
      return Response.json({ error: `O conteúdo “${item.title}” aparece duas vezes na mesma data.` }, { status: 409 });
    }
    requestedKeys.add(key);
  }
  const existing = duplicateKeys(await existingPosts(request, access.companyId, items));
  const duplicated = items.find((item) => existing.has(`${item.scheduledDate}|${normalizeTitle(item.title)}`));
  if (duplicated) {
    return Response.json({
      error: `“${duplicated.title}” já existe em ${duplicated.scheduledDate}. Volte à prévia para alterar ou desmarcar esse item.`,
    }, { status: 409 });
  }

  const posts = await restRequest<Array<Record<string, unknown>>>(
    request,
    "rpc/create_scheduled_posts_batch",
    {
      method: "POST",
      body: JSON.stringify({
        p_company_id: access.companyId,
        p_posts: items.map((item) => ({
          title: item.title,
          content_type: item.contentType,
          social_network: item.socialNetwork,
          scheduled_date: item.scheduledDate,
          scheduled_time: item.scheduledTime,
          working_caption: item.caption,
          working_client_notes: "",
          internal_references: item.referenceLinks.join("\n"),
          internal_notes: item.internalNotes,
          status: "rascunho",
          assigned_to: null,
          partner_id: null,
        })),
        p_files: [],
      }),
    },
  );
  const ids = posts.map((post) => clean(post.id, 80)).filter(Boolean);
  if (ids.length !== items.length) throw new Error("Não foi possível criar todos os rascunhos do cronograma.");
  return Response.json({
    created: true,
    createdCount: ids.length,
    ids,
    firstDate: items.map((item) => item.scheduledDate).sort()[0],
    message: `${ids.length} conteúdo${ids.length === 1 ? " foi criado" : "s foram criados"} como rascunho interno. Nada foi enviado ao cliente.`,
  }, { status: 201 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 30);
    if (action === "analyze") return await analyze(request, body);
    if (action === "commit") return await commit(request, body);
    return Response.json({ error: "Ação de importação inválida." }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
