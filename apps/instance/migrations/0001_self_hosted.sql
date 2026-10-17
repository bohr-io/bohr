CREATE TABLE `cf_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`account_name` text,
	`token_sealed` text NOT NULL,
	`capabilities` text,
	`workers_subdomain` text,
	`verified_at` integer,
	`last_used_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cf_connections_user_account` ON `cf_connections` (`user_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `github_installations` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_login` text NOT NULL,
	`account_type` text,
	`user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `github_installations_user` ON `github_installations` (`user_id`);--> statement-breakpoint
CREATE TABLE `instance_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`sealed` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `onboarding` (
	`user_id` text PRIMARY KEY NOT NULL,
	`step` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `runtimes` (
	`project_id` text PRIMARY KEY NOT NULL,
	`cf_connection_id` text,
	`account_id` text NOT NULL,
	`script` text NOT NULL,
	`preview_script` text NOT NULL,
	`worker_url` text,
	`preview_url` text,
	`project_secret_sealed` text NOT NULL,
	`telegram_bot_id` integer,
	`telegram_bot_username` text,
	`image_ref` text,
	`version` text,
	`migration_tag` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cf_connection_id`) REFERENCES `cf_connections`(`id`) ON UPDATE no action ON DELETE set null
);
