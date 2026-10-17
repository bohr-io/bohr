CREATE TABLE `build_plans` (
	`project_id` text PRIMARY KEY NOT NULL,
	`node_version` text NOT NULL,
	`install` text,
	`build` text,
	`files` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
