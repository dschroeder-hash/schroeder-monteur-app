CREATE TABLE "bc_refresh_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "bc_refresh_request" ADD CONSTRAINT "bc_refresh_request_order_id_service_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bc_refresh_request" ADD CONSTRAINT "bc_refresh_request_requested_by_app_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bc_refresh_request_open_idx" ON "bc_refresh_request" USING btree ("done_at","requested_at");--> statement-breakpoint
ALTER TABLE bc_refresh_request ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bc_refresh_request FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Whoever may see the order may ask for a refresh; only the worker processes requests.
CREATE POLICY bc_refresh_request_insert ON bc_refresh_request FOR INSERT WITH CHECK (
  app_is_worker() OR (requested_by = app_user_id() AND app_can_see_order(order_id))
);
--> statement-breakpoint
CREATE POLICY bc_refresh_request_select ON bc_refresh_request FOR SELECT USING (app_is_worker() OR requested_by = app_user_id());
--> statement-breakpoint
CREATE POLICY bc_refresh_request_update ON bc_refresh_request FOR UPDATE USING (app_is_worker()) WITH CHECK (app_is_worker());
