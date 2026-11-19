-- Row-level security, roles and row_version triggers (ARCHITEKTUR.md 2.2, ENTSCHEIDUNGEN E-08).
-- The API connects with a login that is a member of monteur_app; the worker with a member of monteur_worker.
-- Only app.user_id and app.roles are taken from the session; location scopes are derived from user_location.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'monteur_app') THEN CREATE ROLE monteur_app NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'monteur_worker') THEN CREATE ROLE monteur_worker NOLOGIN; END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO monteur_app, monteur_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO monteur_app, monteur_worker;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO monteur_app, monteur_worker;
--> statement-breakpoint
-- Append-only for the API: raw stamp events, revisions, audit log, approvals, sync inbox.
REVOKE UPDATE, DELETE ON stamp_event, time_entry_revision, audit_log, approval, sync_command FROM monteur_app;
--> statement-breakpoint
REVOKE DELETE ON time_entry, absence, consumption, chat_message, photo, work_report FROM monteur_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- row_version
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS row_version_seq;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE row_version_seq TO monteur_app, monteur_worker;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_row_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.row_version := nextval('row_version_seq');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER location_row_version BEFORE INSERT OR UPDATE ON location FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER storage_location_row_version BEFORE INSERT OR UPDATE ON storage_location FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER app_user_row_version BEFORE INSERT OR UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER setting_row_version BEFORE INSERT OR UPDATE ON setting FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER customer_row_version BEFORE INSERT OR UPDATE ON customer FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER machine_row_version BEFORE INSERT OR UPDATE ON machine FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER order_type_row_version BEFORE INSERT OR UPDATE ON order_type FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER item_row_version BEFORE INSERT OR UPDATE ON item FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER item_stock_row_version BEFORE INSERT OR UPDATE ON item_stock FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER container_row_version BEFORE INSERT OR UPDATE ON container FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER overhead_type_row_version BEFORE INSERT OR UPDATE ON overhead_type FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER service_order_row_version BEFORE INSERT OR UPDATE ON service_order FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER service_order_item_row_version BEFORE INSERT OR UPDATE ON service_order_item FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER assignment_row_version BEFORE INSERT OR UPDATE ON assignment FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER order_status_event_row_version BEFORE INSERT OR UPDATE ON order_status_event FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER stamp_event_row_version BEFORE INSERT OR UPDATE ON stamp_event FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER time_entry_row_version BEFORE INSERT OR UPDATE ON time_entry FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER consumption_row_version BEFORE INSERT OR UPDATE ON consumption FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER part_request_row_version BEFORE INSERT OR UPDATE ON part_request FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER text_template_row_version BEFORE INSERT OR UPDATE ON text_template FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER work_report_row_version BEFORE INSERT OR UPDATE ON work_report FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER photo_row_version BEFORE INSERT OR UPDATE ON photo FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER chat_message_row_version BEFORE INSERT OR UPDATE ON chat_message FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER absence_row_version BEFORE INSERT OR UPDATE ON absence FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER vacation_balance_row_version BEFORE INSERT OR UPDATE ON vacation_balance FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER notification_row_version BEFORE INSERT OR UPDATE ON notification FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
CREATE TRIGGER productivity_snapshot_row_version BEFORE INSERT OR UPDATE ON productivity_snapshot FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Session helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_has_role(r text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT r = ANY (string_to_array(coalesce(current_setting('app.roles', true), ''), ','))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_is_worker() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT pg_has_role(current_user, 'monteur_worker', 'MEMBER')
$$;
--> statement-breakpoint
-- Locations where the current user acts as Meister (requires Entra role AND location assignment).
CREATE OR REPLACE FUNCTION app_meister_locations() RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(location_id), '{}')
  FROM user_location
  WHERE user_id = app_user_id() AND role = 'MEISTER' AND app_has_role('Werkstatt.Meister')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_lager_locations() RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(location_id), '{}')
  FROM user_location
  WHERE user_id = app_user_id() AND role = 'LAGER' AND app_has_role('Werkstatt.Lager')
$$;
--> statement-breakpoint
-- True if the given user works at one of the current Meister's locations.
CREATE OR REPLACE FUNCTION app_is_meister_of(target_user uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_location ul
    WHERE ul.user_id = target_user AND ul.location_id = ANY (app_meister_locations())
  )
$$;
--> statement-breakpoint
-- Order visibility is delegated to the service_order policy (SECURITY INVOKER → RLS applies).
CREATE OR REPLACE FUNCTION app_can_see_order(target_order uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM service_order WHERE id = target_order)
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
ALTER TABLE service_order ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_order FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY service_order_select ON service_order FOR SELECT USING (app_is_worker() OR location_id = ANY (app_meister_locations()) OR location_id = ANY (app_lager_locations()) OR EXISTS (SELECT 1 FROM assignment a WHERE a.order_id = service_order.id AND a.user_id = app_user_id() AND a.cancelled_at IS NULL) OR EXISTS (SELECT 1 FROM time_entry te WHERE te.order_id = service_order.id AND te.user_id = app_user_id()));
--> statement-breakpoint
CREATE POLICY service_order_update ON service_order FOR UPDATE USING (app_is_worker() OR location_id = ANY (app_meister_locations()) OR EXISTS (SELECT 1 FROM assignment a WHERE a.order_id = service_order.id AND a.user_id = app_user_id() AND a.cancelled_at IS NULL)) WITH CHECK (app_is_worker() OR location_id = ANY (app_meister_locations()) OR EXISTS (SELECT 1 FROM assignment a WHERE a.order_id = service_order.id AND a.user_id = app_user_id()));
--> statement-breakpoint
CREATE POLICY service_order_insert ON service_order FOR INSERT WITH CHECK (app_is_worker());
--> statement-breakpoint
CREATE POLICY service_order_delete ON service_order FOR DELETE USING (app_is_worker());
--> statement-breakpoint
ALTER TABLE assignment ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assignment FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY assignment_all ON assignment FOR ALL USING (app_is_worker() OR user_id = app_user_id() OR location_id = ANY (app_meister_locations())) WITH CHECK (app_is_worker() OR location_id = ANY (app_meister_locations()));
--> statement-breakpoint
ALTER TABLE service_order_item ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_order_item FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY service_order_item_select ON service_order_item FOR SELECT USING (app_is_worker() OR app_can_see_order(order_id));
--> statement-breakpoint
CREATE POLICY service_order_item_insert ON service_order_item FOR INSERT WITH CHECK (app_is_worker());
--> statement-breakpoint
CREATE POLICY service_order_item_update ON service_order_item FOR UPDATE USING (app_is_worker()) WITH CHECK (app_is_worker());
--> statement-breakpoint
CREATE POLICY service_order_item_delete ON service_order_item FOR DELETE USING (app_is_worker());
--> statement-breakpoint
ALTER TABLE order_status_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE order_status_event FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY order_status_event_all ON order_status_event FOR ALL USING (app_is_worker() OR app_can_see_order(order_id)) WITH CHECK (app_is_worker() OR app_can_see_order(order_id));
--> statement-breakpoint
ALTER TABLE stamp_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE stamp_event FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY stamp_event_all ON stamp_event FOR ALL USING (app_is_worker() OR user_id = app_user_id() OR app_is_meister_of(user_id) OR app_has_role('Werkstatt.Personal')) WITH CHECK (app_is_worker() OR user_id = app_user_id());
--> statement-breakpoint
ALTER TABLE time_entry ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE time_entry FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY time_entry_all ON time_entry FOR ALL USING (app_is_worker() OR user_id = app_user_id() OR location_id = ANY (app_meister_locations()) OR (app_has_role('Werkstatt.Personal') AND kind = 'ATTENDANCE')) WITH CHECK (app_is_worker() OR user_id = app_user_id() OR location_id = ANY (app_meister_locations()));
--> statement-breakpoint
ALTER TABLE time_entry_revision ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE time_entry_revision FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY time_entry_revision_all ON time_entry_revision FOR ALL USING (app_is_worker() OR EXISTS (SELECT 1 FROM time_entry te WHERE te.id = time_entry_id)) WITH CHECK (app_is_worker() OR EXISTS (SELECT 1 FROM time_entry te WHERE te.id = time_entry_id));
--> statement-breakpoint
ALTER TABLE consumption ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE consumption FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY consumption_all ON consumption FOR ALL USING (app_is_worker() OR user_id = app_user_id() OR location_id = ANY (app_meister_locations()) OR location_id = ANY (app_lager_locations()) OR (order_id IS NOT NULL AND app_can_see_order(order_id))) WITH CHECK (app_is_worker() OR user_id = app_user_id() OR location_id = ANY (app_meister_locations()));
--> statement-breakpoint
ALTER TABLE part_request ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE part_request FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY part_request_all ON part_request FOR ALL USING (app_is_worker() OR requested_by = app_user_id() OR location_id = ANY (app_meister_locations()) OR location_id = ANY (app_lager_locations())) WITH CHECK (app_is_worker() OR requested_by = app_user_id() OR location_id = ANY (app_meister_locations()) OR location_id = ANY (app_lager_locations()));
--> statement-breakpoint
ALTER TABLE work_report ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE work_report FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY work_report_all ON work_report FOR ALL USING (app_is_worker() OR app_can_see_order(order_id)) WITH CHECK (app_is_worker() OR app_can_see_order(order_id));
--> statement-breakpoint
ALTER TABLE photo ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE photo FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY photo_all ON photo FOR ALL USING (app_is_worker() OR app_can_see_order(order_id)) WITH CHECK (app_is_worker() OR app_can_see_order(order_id));
--> statement-breakpoint
ALTER TABLE chat_message ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_message FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_message_all ON chat_message FOR ALL USING (app_is_worker() OR app_can_see_order(order_id)) WITH CHECK (app_is_worker() OR app_can_see_order(order_id));
--> statement-breakpoint
ALTER TABLE chat_read ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_read FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_read_all ON chat_read FOR ALL USING (app_is_worker() OR user_id = app_user_id() OR EXISTS (SELECT 1 FROM chat_message m WHERE m.id = message_id)) WITH CHECK (app_is_worker() OR user_id = app_user_id());
--> statement-breakpoint
ALTER TABLE absence ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE absence FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY absence_all ON absence FOR ALL USING (app_is_worker() OR user_id = app_user_id() OR location_id = ANY (app_meister_locations()) OR app_has_role('Werkstatt.Personal')) WITH CHECK (app_is_worker() OR user_id = app_user_id() OR location_id = ANY (app_meister_locations()) OR app_has_role('Werkstatt.Personal'));
--> statement-breakpoint
ALTER TABLE vacation_balance ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE vacation_balance FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY vacation_balance_all ON vacation_balance FOR ALL USING (app_is_worker() OR user_id = app_user_id() OR app_is_meister_of(user_id) OR app_has_role('Werkstatt.Personal')) WITH CHECK (app_is_worker() OR app_has_role('Werkstatt.Personal'));
--> statement-breakpoint
ALTER TABLE productivity_snapshot ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE productivity_snapshot FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY productivity_snapshot_all ON productivity_snapshot FOR ALL USING (app_is_worker() OR user_id = app_user_id() OR location_id = ANY (app_meister_locations())) WITH CHECK (app_is_worker());
--> statement-breakpoint
ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notification FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_all ON notification FOR ALL USING (app_is_worker() OR user_id = app_user_id()) WITH CHECK (app_is_worker() OR user_id = app_user_id());
--> statement-breakpoint
ALTER TABLE push_subscription ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE push_subscription FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY push_subscription_all ON push_subscription FOR ALL USING (app_is_worker() OR user_id = app_user_id()) WITH CHECK (app_is_worker() OR user_id = app_user_id());
--> statement-breakpoint
ALTER TABLE sync_command ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sync_command FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sync_command_all ON sync_command FOR ALL USING (app_is_worker() OR user_id = app_user_id()) WITH CHECK (app_is_worker() OR user_id = app_user_id());
--> statement-breakpoint
ALTER TABLE bc_transfer ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bc_transfer FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bc_transfer_all ON bc_transfer FOR ALL USING (app_is_worker() OR app_has_role('Werkstatt.Admin') OR location_id = ANY (app_meister_locations())) WITH CHECK (app_is_worker() OR location_id = ANY (app_meister_locations()) OR app_has_role('Werkstatt.Admin'));
--> statement-breakpoint
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_log_select ON audit_log FOR SELECT USING (app_is_worker() OR app_has_role('Werkstatt.Admin') OR actor_id = app_user_id());
--> statement-breakpoint
CREATE POLICY audit_log_insert ON audit_log FOR INSERT WITH CHECK (app_is_worker() OR actor_id = app_user_id());
--> statement-breakpoint
ALTER TABLE approval ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE approval FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY approval_select ON approval FOR SELECT USING (app_is_worker() OR approved_by = app_user_id() OR app_has_role('Werkstatt.Meister') OR app_has_role('Werkstatt.Personal'));
--> statement-breakpoint
CREATE POLICY approval_insert ON approval FOR INSERT WITH CHECK (app_is_worker() OR approved_by = app_user_id());
--> statement-breakpoint

-- Future tables created by the migration owner are granted automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO monteur_app, monteur_worker;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO monteur_app, monteur_worker;
