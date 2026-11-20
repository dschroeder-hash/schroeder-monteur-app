CREATE TABLE "checklist_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid,
	"title" text NOT NULL,
	"order_type_code" text,
	"brand" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL,
	"tx_id" "xid8" DEFAULT pg_current_xact_id() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_checklist" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"device_time" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL,
	"tx_id" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "order_checklist_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "order_signature" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"author_id" uuid NOT NULL,
	"signer_name" text DEFAULT '' NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"image_png" text,
	"absent_reason" text,
	"device_time" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL,
	"tx_id" "xid8" DEFAULT pg_current_xact_id() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checklist_template" ADD CONSTRAINT "checklist_template_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_checklist" ADD CONSTRAINT "order_checklist_order_id_service_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_checklist" ADD CONSTRAINT "order_checklist_template_id_checklist_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_checklist" ADD CONSTRAINT "order_checklist_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_signature" ADD CONSTRAINT "order_signature_order_id_service_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_signature" ADD CONSTRAINT "order_signature_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER checklist_template_row_version BEFORE INSERT OR UPDATE ON checklist_template FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER order_checklist_row_version BEFORE INSERT OR UPDATE ON order_checklist FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER order_signature_row_version BEFORE INSERT OR UPDATE ON order_signature FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
-- Checklist templates: readable for everyone signed in, maintained by Admin (and the worker).
ALTER TABLE checklist_template ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE checklist_template FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY checklist_template_select ON checklist_template FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY checklist_template_write ON checklist_template FOR ALL USING (app_is_worker() OR app_is_admin()) WITH CHECK (app_is_worker() OR app_is_admin());
--> statement-breakpoint
-- Filled-in checklist and customer signature: like the work report – whoever may see the order.
ALTER TABLE order_checklist ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE order_checklist FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY order_checklist_all ON order_checklist FOR ALL USING (app_is_worker() OR app_can_see_order(order_id)) WITH CHECK (app_is_worker() OR app_can_see_order(order_id));
--> statement-breakpoint
ALTER TABLE order_signature ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE order_signature FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY order_signature_all ON order_signature FOR ALL USING (app_is_worker() OR app_can_see_order(order_id)) WITH CHECK (app_is_worker() OR app_can_see_order(order_id));
