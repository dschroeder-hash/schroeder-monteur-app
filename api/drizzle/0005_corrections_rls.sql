-- Phase 3: Meister corrections (E-37). The Meister may add/void stamp events of Monteure at his location,
-- always marked with created_by / voided_by and a reason. Raw events stay append-only.
CREATE TRIGGER time_correction_request_row_version BEFORE INSERT OR UPDATE ON time_correction_request FOR EACH ROW EXECUTE FUNCTION set_row_version();
--> statement-breakpoint
REVOKE UPDATE, DELETE ON stamp_event_void FROM monteur_app;
--> statement-breakpoint
REVOKE DELETE ON time_correction_request FROM monteur_app;
--> statement-breakpoint
DROP POLICY stamp_event_all ON stamp_event;
--> statement-breakpoint
CREATE POLICY stamp_event_all ON stamp_event FOR ALL
  USING (app_is_worker() OR user_id = app_user_id() OR app_is_meister_of(user_id) OR app_has_role('Werkstatt.Personal'))
  WITH CHECK (
    app_is_worker()
    OR (user_id = app_user_id() AND created_by IS NULL)
    OR (app_is_meister_of(user_id) AND created_by = app_user_id() AND correction_reason IS NOT NULL)
  );
--> statement-breakpoint
ALTER TABLE stamp_event_void ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE stamp_event_void FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY stamp_event_void_all ON stamp_event_void FOR ALL
  USING (app_is_worker() OR user_id = app_user_id() OR app_is_meister_of(user_id) OR app_has_role('Werkstatt.Personal'))
  WITH CHECK (app_is_worker() OR (app_is_meister_of(user_id) AND voided_by = app_user_id()));
--> statement-breakpoint
ALTER TABLE time_correction_request ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE time_correction_request FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY time_correction_request_all ON time_correction_request FOR ALL
  USING (app_is_worker() OR user_id = app_user_id() OR location_id = ANY (app_meister_locations()))
  WITH CHECK (
    app_is_worker()
    OR (user_id = app_user_id() AND state = 'OFFEN')
    OR location_id = ANY (app_meister_locations())
  );
--> statement-breakpoint
-- Recomputation after a Meister correction may remove stale derived entries of that Monteur.
DROP POLICY time_entry_delete_restrict ON time_entry;
--> statement-breakpoint
CREATE POLICY time_entry_delete_restrict ON time_entry AS RESTRICTIVE FOR DELETE
  USING (
    app_is_worker()
    OR (state = 'OPEN' AND segment_key IS NOT NULL AND (user_id = app_user_id() OR app_is_meister_of(user_id)))
  );
