CREATE TABLE "shop_cart_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lines" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_cart_link" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop_cart_inbox" ADD CONSTRAINT "shop_cart_inbox_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_cart_link" ADD CONSTRAINT "shop_cart_link_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shop_cart_inbox_user_idx" ON "shop_cart_inbox" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_cart_link_token_uq" ON "shop_cart_link" USING btree ("token_hash");--> statement-breakpoint
-- Bookmark link (E-78): own row; the push endpoint looks the hash up with the technical role ShopCart.Push.
ALTER TABLE shop_cart_link ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE shop_cart_link FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shop_cart_link_all ON shop_cart_link FOR ALL
  USING (user_id = app_user_id() OR app_has_role('ShopCart.Push') OR app_is_admin() OR app_is_worker())
  WITH CHECK (user_id = app_user_id() OR app_is_admin());
--> statement-breakpoint
-- Carts waiting for pick-up: only the own ones.
ALTER TABLE shop_cart_inbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE shop_cart_inbox FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shop_cart_inbox_all ON shop_cart_inbox FOR ALL
  USING (user_id = app_user_id() OR app_is_worker())
  WITH CHECK (user_id = app_user_id());
