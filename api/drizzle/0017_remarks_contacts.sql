CREATE TABLE "bc_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bc_company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"customer_no" text NOT NULL,
	"name" text NOT NULL,
	"job_title" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"mobile" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"bc_system_id" uuid,
	"bc_etag" text,
	"bc_modified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL,
	"tx_id" "xid8" DEFAULT pg_current_xact_id() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bc_remark" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bc_company_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"ref_no" text NOT NULL,
	"kind" text DEFAULT 'General' NOT NULL,
	"line_no" integer NOT NULL,
	"date" text,
	"text" text NOT NULL,
	"bc_system_id" uuid,
	"bc_etag" text,
	"bc_modified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL,
	"tx_id" "xid8" DEFAULT pg_current_xact_id() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bc_contact_uq" ON "bc_contact" USING btree ("bc_company_id","number");--> statement-breakpoint
CREATE INDEX "bc_contact_customer" ON "bc_contact" USING btree ("customer_no");--> statement-breakpoint
CREATE UNIQUE INDEX "bc_remark_uq" ON "bc_remark" USING btree ("bc_company_id","scope","ref_no","kind","line_no");--> statement-breakpoint
CREATE INDEX "bc_remark_ref" ON "bc_remark" USING btree ("scope","ref_no");--> statement-breakpoint
CREATE TRIGGER bc_remark_row_version BEFORE INSERT OR UPDATE ON bc_remark FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER bc_contact_row_version BEFORE INSERT OR UPDATE ON bc_contact FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
-- BC master data like customers: written only by the worker; read through the API for the Monteur's own orders.
ALTER TABLE bc_remark ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bc_remark FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bc_remark_select ON bc_remark FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY bc_remark_write ON bc_remark FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
--> statement-breakpoint
ALTER TABLE bc_contact ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bc_contact FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bc_contact_select ON bc_contact FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY bc_contact_write ON bc_contact FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
