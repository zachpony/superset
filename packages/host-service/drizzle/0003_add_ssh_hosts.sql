CREATE TABLE `ssh_hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 22 NOT NULL,
	`username` text NOT NULL,
	`private_key_path` text,
	`forward_agent` integer DEFAULT 1 NOT NULL,
	`connect_timeout` integer DEFAULT 30000 NOT NULL,
	`keepalive_interval` integer DEFAULT 15000 NOT NULL,
	`last_connected_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ssh_hosts_host_user_unique` ON `ssh_hosts` (`host`,`username`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`worktree_path` text,
	`branch` text NOT NULL,
	`head_sha` text,
	`pull_request_id` text,
	`execution_mode` text DEFAULT 'local' NOT NULL,
	`ssh_host_id` text,
	`remote_path` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`ssh_host_id`) REFERENCES `ssh_hosts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_workspaces`("id", "project_id", "worktree_path", "branch", "head_sha", "pull_request_id", "execution_mode", "ssh_host_id", "remote_path", "created_at") SELECT "id", "project_id", "worktree_path", "branch", "head_sha", "pull_request_id", "execution_mode", "ssh_host_id", "remote_path", "created_at" FROM `workspaces`;--> statement-breakpoint
DROP TABLE `workspaces`;--> statement-breakpoint
ALTER TABLE `__new_workspaces` RENAME TO `workspaces`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `workspaces_project_id_idx` ON `workspaces` (`project_id`);--> statement-breakpoint
CREATE INDEX `workspaces_branch_idx` ON `workspaces` (`branch`);--> statement-breakpoint
CREATE INDEX `workspaces_pull_request_id_idx` ON `workspaces` (`pull_request_id`);--> statement-breakpoint
CREATE INDEX `workspaces_ssh_host_id_idx` ON `workspaces` (`ssh_host_id`);