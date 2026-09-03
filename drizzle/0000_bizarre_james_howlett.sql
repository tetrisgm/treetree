CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `change_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_email` text NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`given_name` text,
	`family_name` text,
	`birth_date` text,
	`death_date` text,
	`birth_place` text,
	`death_place` text,
	`biography` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`from_person_id` text NOT NULL,
	`to_person_id` text NOT NULL,
	`type` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`date` text,
	`place` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `story_attachments` (
	`story_id` text NOT NULL,
	`attachment_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `story_people` (
	`story_id` text NOT NULL,
	`person_id` text NOT NULL
);
