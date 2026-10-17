CREATE TABLE `cli_deploys` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`branch` text NOT NULL,
	`production` integer NOT NULL,
	`worker_name` text,
	`version_id` text,
	`url` text,
	`commit_sha` text,
	`user_id` text,
	`token_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cli_deploys_project` ON `cli_deploys` (`project_id`,`created_at`);