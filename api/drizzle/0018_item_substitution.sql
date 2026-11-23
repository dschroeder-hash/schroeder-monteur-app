CREATE TABLE "item_substitution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bc_company_id" uuid NOT NULL,
	"item_no" text NOT NULL,
	"substitute_no" text NOT NULL,
	"interchangeable" boolean DEFAULT false NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"bc_system_id" uuid,
	"bc_etag" text,
	"bc_modified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT 0 NOT NULL,
	"tx_id" "xid8" DEFAULT pg_current_xact_id() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "item_substitution_uq" ON "item_substitution" USING btree ("bc_company_id","item_no","substitute_no");--> statement-breakpoint
CREATE INDEX "item_substitution_sub" ON "item_substitution" USING btree ("substitute_no");--> statement-breakpoint
CREATE TRIGGER item_substitution_row_version BEFORE INSERT OR UPDATE ON item_substitution FOR EACH ROW EXECUTE FUNCTION set_row_version();
