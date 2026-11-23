CREATE TABLE "bc_checklist_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bc_company_id" uuid NOT NULL,
	"order_no" text NOT NULL,
	"line_no" integer NOT NULL,
	"description" text NOT NULL,
	"line_type" text NOT NULL,
	"input_enabled" boolean DEFAULT false NOT NULL,
	"answer_type" text DEFAULT 'None' NOT NULL,
	"options" text[] DEFAULT '{}'::text[] NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"unit_options" text[] DEFAULT '{}'::text[] NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"answer_unit" text DEFAULT '' NOT NULL,
	"bc_system_id" uuid,
	"bc_etag" text,
	"bc_modified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL,
	"tx_id" "xid8" DEFAULT pg_current_xact_id() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_checklist" ALTER COLUMN "template_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "order_checklist" ADD COLUMN "source" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bc_checklist_line_uq" ON "bc_checklist_line" USING btree ("bc_company_id","order_no","line_no");--> statement-breakpoint
CREATE TRIGGER bc_checklist_line_row_version BEFORE INSERT OR UPDATE ON bc_checklist_line FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
ALTER TABLE bc_checklist_line ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bc_checklist_line FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bc_checklist_line_select ON bc_checklist_line FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY bc_checklist_line_write ON bc_checklist_line FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
