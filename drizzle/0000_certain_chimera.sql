CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `post_files` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`file_name` text NOT NULL,
	`file_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_original` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `scheduled_posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `post_files_post_idx` ON `post_files` (`post_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `post_files_tenant_idx` ON `post_files` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `scheduled_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`title` text NOT NULL,
	`content_type` text NOT NULL,
	`social_network` text NOT NULL,
	`scheduled_date` text NOT NULL,
	`scheduled_time` text NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`internal_notes` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`assigned_to` text DEFAULT '' NOT NULL,
	`client_feedback` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `scheduled_posts_tenant_date_idx` ON `scheduled_posts` (`tenant_id`,`scheduled_date`);--> statement-breakpoint
CREATE INDEX `scheduled_posts_tenant_status_idx` ON `scheduled_posts` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `user_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`tenant_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_memberships_email_idx` ON `user_memberships` (`email`);--> statement-breakpoint
CREATE INDEX `user_memberships_tenant_idx` ON `user_memberships` (`tenant_id`);