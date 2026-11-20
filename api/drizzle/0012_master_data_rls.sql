-- Security finding L2 (SICHERHEIT.md, OP-40): master data that the RLS policies rely on (user_location drives
-- app_meister_locations()) may only be written by the Admin or the worker. Reading stays open – the scope of every
-- request is resolved from these tables before a session exists.
CREATE OR REPLACE FUNCTION app_is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app_has_role('Werkstatt.Admin')
$$;
--> statement-breakpoint
ALTER TABLE user_location ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_location FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_location_select ON user_location FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY user_location_write ON user_location FOR ALL USING (app_is_worker() OR app_is_admin()) WITH CHECK (app_is_worker() OR app_is_admin());
--> statement-breakpoint
ALTER TABLE bc_resource_mapping ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bc_resource_mapping FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bc_resource_mapping_select ON bc_resource_mapping FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY bc_resource_mapping_write ON bc_resource_mapping FOR ALL USING (app_is_worker() OR app_is_admin()) WITH CHECK (app_is_worker() OR app_is_admin());
--> statement-breakpoint
ALTER TABLE feature_flag ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feature_flag FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY feature_flag_select ON feature_flag FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY feature_flag_write ON feature_flag FOR ALL USING (app_is_worker() OR app_is_admin()) WITH CHECK (app_is_worker() OR app_is_admin());
--> statement-breakpoint
ALTER TABLE setting ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE setting FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY setting_select ON setting FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY setting_write ON setting FOR ALL USING (app_is_worker() OR app_is_admin()) WITH CHECK (app_is_worker() OR app_is_admin());
--> statement-breakpoint
-- app_user: first sign-in creates the row without a session (no roles, active); a user may refresh only the own row
-- (role snapshot at sign-in); everything else is Admin/worker.
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app_user FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY app_user_select ON app_user FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY app_user_insert ON app_user FOR INSERT WITH CHECK (
  app_is_worker() OR app_is_admin() OR (app_user_id() IS NULL AND active AND cardinality(roles) = 0 AND NOT is_apprentice)
);
--> statement-breakpoint
CREATE POLICY app_user_update ON app_user FOR UPDATE USING (app_is_worker() OR app_is_admin() OR id = app_user_id())
  WITH CHECK (app_is_worker() OR app_is_admin() OR id = app_user_id());
--> statement-breakpoint
-- A user must not re-activate or re-classify the own account: only the role snapshot may change on the own row.
CREATE OR REPLACE FUNCTION app_user_guard_self_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (app_is_worker() OR app_is_admin()) AND NEW.id = app_user_id()
     AND (NEW.active IS DISTINCT FROM OLD.active OR NEW.is_apprentice IS DISTINCT FROM OLD.is_apprentice
          OR NEW.entra_oid IS DISTINCT FROM OLD.entra_oid) THEN
    RAISE EXCEPTION 'only the Admin may change account status' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER app_user_guard_self_update BEFORE UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION app_user_guard_self_update();
--> statement-breakpoint
-- Finding L3 (OP-41): Meister see approvals of colleagues at a shared location only, not of every location.
DROP POLICY approval_select ON approval;
--> statement-breakpoint
CREATE POLICY approval_select ON approval FOR SELECT USING (
  app_is_worker() OR approved_by = app_user_id() OR app_has_role('Werkstatt.Personal')
  OR (app_has_role('Werkstatt.Meister') AND app_shares_location(approved_by))
);
