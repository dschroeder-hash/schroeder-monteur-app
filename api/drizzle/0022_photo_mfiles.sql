ALTER TABLE "photo" ADD COLUMN "mfiles_object_id" text;--> statement-breakpoint
ALTER TABLE "photo" ADD COLUMN "mfiles_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "photo" ADD COLUMN "mfiles_error" text;--> statement-breakpoint
ALTER TABLE "photo" ADD COLUMN "mfiles_attempts" integer DEFAULT 0 NOT NULL;