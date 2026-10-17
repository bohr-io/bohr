CREATE TABLE `org_members` (
	`org_id` text NOT NULL,
	`github_user_id` integer NOT NULL,
	`github_login` text NOT NULL,
	`user_id` text,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`github_role` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`org_id`, `github_user_id`),
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `org_members_user` ON `org_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `orgs` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`github_account_id` integer NOT NULL,
	`github_login` text NOT NULL,
	`avatar_url` text,
	`installation_id` integer,
	`members_permission` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`installation_id`) REFERENCES `github_installations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orgs_slug_unique` ON `orgs` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `orgs_github_account_id_unique` ON `orgs` (`github_account_id`);--> statement-breakpoint
DROP INDEX `cf_connections_user_account`;--> statement-breakpoint
ALTER TABLE `cf_connections` ADD `org_id` text REFERENCES orgs(id) ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX `cf_connections_org_account` ON `cf_connections` (`org_id`,`account_id`) WHERE "cf_connections"."org_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `cf_connections_user_account` ON `cf_connections` (`user_id`,`account_id`) WHERE "cf_connections"."org_id" IS NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `org_id` text REFERENCES orgs(id);--> statement-breakpoint
CREATE INDEX `projects_org` ON `projects` (`org_id`);--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `org_id` text REFERENCES orgs(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `subscriptions_org` ON `subscriptions` (`org_id`);