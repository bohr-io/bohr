CREATE TABLE `dns_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cloudflare_zone_id` text NOT NULL,
	`user_id` text,
	`org_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dns_zones_name_unique` ON `dns_zones` (`name`);--> statement-breakpoint
CREATE INDEX `dns_zones_user` ON `dns_zones` (`user_id`);--> statement-breakpoint
CREATE INDEX `dns_zones_org` ON `dns_zones` (`org_id`);