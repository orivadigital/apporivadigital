import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const companies = sqliteTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  contactEmail: text("contact_email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  services: text("services").notNull().default(""),
  responsible: text("responsible").notNull().default(""),
  status: text("status").notNull().default("Ativo"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull().default(""),
});

export const userMemberships = sqliteTable(
  "user_memberships",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    role: text("role", {
      enum: ["agency_owner", "agency_member", "client"],
    }).notNull(),
    tenantId: text("tenant_id").references(() => companies.id),
    status: text("status").notNull().default("Ativo"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull().default(""),
  },
  (table) => [
    index("user_memberships_email_idx").on(table.email),
    index("user_memberships_tenant_idx").on(table.tenantId),
  ],
);

export const partners = sqliteTable("partners", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  companyName: text("company_name").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  specialty: text("specialty").notNull().default(""),
  averageValueCents: integer("average_value_cents").notNull().default(0),
  openDemands: integer("open_demands").notNull().default(0),
  status: text("status").notNull().default("Ativo"),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const contracts = sqliteTable("contracts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  partyType: text("party_type").notNull(),
  partyName: text("party_name").notNull(),
  relatedId: text("related_id"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull().default(""),
  valueCents: integer("value_cents").notNull().default(0),
  status: text("status").notNull().default("Ativo"),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const financialEntries = sqliteTable(
  "financial_entries",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    partyName: text("party_name").notNull().default(""),
    companyId: text("company_id").references(() => companies.id),
    amountCents: integer("amount_cents").notNull(),
    dueDate: text("due_date").notNull(),
    paidDate: text("paid_date").notNull().default(""),
    status: text("status").notNull().default("Pendente"),
    recurrence: text("recurrence").notNull().default("Único"),
    notes: text("notes").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("financial_entries_due_idx").on(table.dueDate, table.status),
    index("financial_entries_company_idx").on(table.companyId),
  ],
);

export const agencyTasks = sqliteTable(
  "agency_tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    tenantId: text("tenant_id").references(() => companies.id),
    taskType: text("task_type").notNull().default("Outro"),
    assignedTo: text("assigned_to").notNull().default(""),
    dueDate: text("due_date").notNull(),
    priority: text("priority").notNull().default("Média"),
    status: text("status").notNull().default("Pendente"),
    completedAt: text("completed_at").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("agency_tasks_due_idx").on(table.dueDate, table.status),
    index("agency_tasks_tenant_idx").on(table.tenantId),
  ],
);

export const scheduledPosts = sqliteTable(
  "scheduled_posts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => companies.id),
    title: text("title").notNull(),
    contentType: text("content_type").notNull(),
    socialNetwork: text("social_network").notNull(),
    scheduledDate: text("scheduled_date").notNull(),
    scheduledTime: text("scheduled_time").notNull(),
    caption: text("caption").notNull().default(""),
    internalNotes: text("internal_notes").notNull().default(""),
    clientNotes: text("client_notes").notNull().default(""),
    status: text("status").notNull(),
    assignedTo: text("assigned_to").notNull().default(""),
    clientFeedback: text("client_feedback").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("scheduled_posts_tenant_date_idx").on(
      table.tenantId,
      table.scheduledDate,
    ),
    index("scheduled_posts_tenant_status_idx").on(
      table.tenantId,
      table.status,
    ),
  ],
);

export const postFiles = sqliteTable(
  "post_files",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => scheduledPosts.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => companies.id),
    r2Key: text("r2_key").notNull(),
    fileName: text("file_name").notNull(),
    fileType: text("file_type").notNull(),
    fileSize: integer("file_size").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isOriginal: integer("is_original", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("post_files_post_idx").on(table.postId, table.sortOrder),
    index("post_files_tenant_idx").on(table.tenantId),
  ],
);
