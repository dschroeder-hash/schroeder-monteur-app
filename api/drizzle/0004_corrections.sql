CREATE TYPE "public"."correction_state" AS ENUM('OFFEN', 'ANGENOMMEN', 'ABGELEHNT');--> statement-breakpoint
CREATE TABLE "stamp_event_void" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"voided_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_correction_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"proposal" jsonb NOT NULL,
	"comment" text,
	"state" "correction_state" DEFAULT 'OFFEN' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL,
	"tx_id" "xid8" DEFAULT pg_current_xact_id() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stamp_event" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "stamp_event" ADD COLUMN "correction_reason" text;--> statement-breakpoint
ALTER TABLE "stamp_event_void" ADD CONSTRAINT "stamp_event_void_event_id_stamp_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."stamp_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stamp_event_void" ADD CONSTRAINT "stamp_event_void_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stamp_event_void" ADD CONSTRAINT "stamp_event_void_voided_by_app_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_correction_request" ADD CONSTRAINT "time_correction_request_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_correction_request" ADD CONSTRAINT "time_correction_request_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_correction_request" ADD CONSTRAINT "time_correction_request_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_correction_request_loc_idx" ON "time_correction_request" USING btree ("location_id","state");--> statement-breakpoint
ALTER TABLE "stamp_event" ADD CONSTRAINT "stamp_event_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;