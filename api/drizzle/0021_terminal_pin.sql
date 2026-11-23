ALTER TYPE "public"."location_role" ADD VALUE 'TERMINAL';--> statement-breakpoint
CREATE TABLE "user_pin" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"pin_hash" text NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_pin" ADD CONSTRAINT "user_pin_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- PIN hashes: the own row, the shared workshop PC (verification) and the Admin (reset). Never listed by the API.
ALTER TABLE user_pin ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_pin FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_pin_all ON user_pin FOR ALL
  USING (user_id = app_user_id() OR app_has_role('Werkstatt.Terminal') OR app_is_admin() OR app_is_worker())
  WITH CHECK (user_id = app_user_id() OR app_has_role('Werkstatt.Terminal') OR app_is_admin() OR app_is_worker());
