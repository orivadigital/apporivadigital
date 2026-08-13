CREATE TABLE `agency_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`tenant_id` text,
	`task_type` text DEFAULT 'Outro' NOT NULL,
	`assigned_to` text DEFAULT '' NOT NULL,
	`due_date` text NOT NULL,
	`priority` text DEFAULT 'Média' NOT NULL,
	`status` text DEFAULT 'Pendente' NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agency_tasks_due_idx` ON `agency_tasks` (`due_date`,`status`);--> statement-breakpoint
CREATE INDEX `agency_tasks_tenant_idx` ON `agency_tasks` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`party_type` text NOT NULL,
	`party_name` text NOT NULL,
	`related_id` text,
	`start_date` text NOT NULL,
	`end_date` text DEFAULT '' NOT NULL,
	`value_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Ativo' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `financial_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`party_name` text DEFAULT '' NOT NULL,
	`company_id` text,
	`amount_cents` integer NOT NULL,
	`due_date` text NOT NULL,
	`paid_date` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Pendente' NOT NULL,
	`recurrence` text DEFAULT 'Único' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `financial_entries_due_idx` ON `financial_entries` (`due_date`,`status`);--> statement-breakpoint
CREATE INDEX `financial_entries_company_idx` ON `financial_entries` (`company_id`);--> statement-breakpoint
CREATE TABLE `partners` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`company_name` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`specialty` text DEFAULT '' NOT NULL,
	`average_value_cents` integer DEFAULT 0 NOT NULL,
	`open_demands` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Ativo' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `companies` ADD `contact_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `companies` ADD `phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `companies` ADD `services` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `companies` ADD `responsible` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `companies` ADD `status` text DEFAULT 'Ativo' NOT NULL;--> statement-breakpoint
ALTER TABLE `companies` ADD `updated_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_memberships` ADD `name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_memberships` ADD `status` text DEFAULT 'Ativo' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_memberships` ADD `updated_at` text DEFAULT '' NOT NULL;