CREATE UNIQUE INDEX `idx_relationship_unique` ON `relationships` (`from_person_id`,`to_person_id`,`type`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_story_attachments_unique` ON `story_attachments` (`story_id`,`attachment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_story_people_unique` ON `story_people` (`story_id`,`person_id`);