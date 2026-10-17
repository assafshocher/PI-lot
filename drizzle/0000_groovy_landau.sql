CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`record_id` text NOT NULL,
	`action` text NOT NULL,
	`revision` integer,
	`data_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_user_record` ON `audit_events` (`user_id`,`record_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `files_user` ON `files` (`user_id`);--> statement-breakpoint
CREATE TABLE `lab_links` (
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`student_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `project_id`, `student_id`)
);
--> statement-breakpoint
CREATE TABLE `mutations` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`attempt_id` text NOT NULL,
	`response_json` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `key`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mutations_attempt` ON `mutations` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `records` (
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`data_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`last_mutation_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `records_user_kind` ON `records` (`user_id`,`kind`,`deleted_at`);