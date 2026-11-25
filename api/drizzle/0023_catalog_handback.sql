CREATE TABLE "catalog_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"order_id" uuid,
	"catalog_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_cart_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"order_id" uuid,
	"catalog_id" text NOT NULL,
	"lines" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_session" ADD CONSTRAINT "catalog_session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_session" ADD CONSTRAINT "catalog_session_order_id_service_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_cart_inbox" ADD CONSTRAINT "shop_cart_inbox_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_cart_inbox" ADD CONSTRAINT "shop_cart_inbox_order_id_service_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_session_token_uq" ON "catalog_session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "shop_cart_inbox_user_idx" ON "shop_cart_inbox" USING btree ("user_id");--> statement-breakpoint
-- Catalog sessions (E-80): own rows; the public return address looks the hash up with the technical role
-- Catalog.Return, which may only read.
ALTER TABLE catalog_session ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE catalog_session FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY catalog_session_all ON catalog_session FOR ALL
  USING (user_id = app_user_id() OR app_has_role('Catalog.Return') OR app_is_worker())
  WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
-- Handed-back carts waiting for pick-up: only the own ones.
ALTER TABLE shop_cart_inbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE shop_cart_inbox FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shop_cart_inbox_all ON shop_cart_inbox FOR ALL
  USING (user_id = app_user_id() OR app_is_worker())
  WITH CHECK (user_id = app_user_id());
